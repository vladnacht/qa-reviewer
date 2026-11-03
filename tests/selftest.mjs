#!/usr/bin/env node
// qa-reviewer self-test: runs every script against the fixture app and a fake
// project, and checks that the planted defects and graph gaps are caught.
//
//   node tests/selftest.mjs        (or: npm run selftest)

import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HOME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = path.join(HOME, 'tests', '.tmp');
const PORT = 4319;
const BASE = `http://localhost:${PORT}`;
const QA = path.join(HOME, 'scripts', 'qa.mjs');
const SWEEP = path.join(HOME, 'scripts', 'sweep.mjs');

let failures = 0;
const check = (label, cond, detail = '') => {
  console.log(`${cond ? '✓' : '✗'} ${label}${!cond && detail ? `\n    ${detail.split('\n').slice(0, 12).join('\n    ')}` : ''}`);
  if (!cond) failures++;
};
const run = (args, opts = {}) => {
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', cwd: opts.cwd || HOME });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};
const write = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof s === 'string' ? s : JSON.stringify(s, null, 2)); };

fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

// 1. doctor (informative: a missing npm install should not hide the rest)
const doc = run([path.join(HOME, 'scripts', 'doctor.mjs')]);
console.log(doc.out.trim().split('\n').map(l => `  doctor | ${l}`).join('\n'));

// 2. init
const project = path.join(TMP, 'project');
fs.mkdirSync(path.join(project, '.git', 'info'), { recursive: true });
const init = run([QA, 'init', project, '--run-id', 'selftest']);
const RUN = /RUN=(.+)/.exec(init.out)?.[1];
check('init creates the run folder', init.code === 0 && RUN && fs.existsSync(path.join(RUN, 'reports')), init.out);
check('init writes one profile per viewport', fs.existsSync(path.join(RUN, 'profiles', 'mobile.json')) && fs.existsSync(path.join(RUN, 'profiles', 'wide.json')));
check('init excludes .qa-reviewer/ from git', fs.readFileSync(path.join(project, '.git', 'info', 'exclude'), 'utf8').includes('.qa-reviewer/'));

// 3. discover on a fake Next.js project
write(path.join(project, 'app', 'page.tsx'), 'export default function Home() { return <main>Home</main> }\n');
write(path.join(project, 'app', 'login', 'page.tsx'), 'export default function Login() { return <form><input name="email" /></form> }\n');
write(path.join(project, 'app', 'api', 'items', 'route.ts'), 'export async function GET() { return Response.json([]) }\n');
write(path.join(project, 'lib', 'actions.ts'), '"use server"\nexport async function save() {}\n');
write(path.join(project, 'components', 'confirm.tsx'), 'export const C = () => <Dialog open>Sure?</Dialog>\n');
write(path.join(project, 'app', 'login', 'page.test.tsx'), 'test("x", () => {})\n');
const disc = run([QA, 'discover', project, '--out', path.join(RUN, 'discovery.txt')]);
const discovered = fs.readFileSync(path.join(RUN, 'discovery.txt'), 'utf8');
check('discover finds pages, forms, route handlers, server actions and modals',
  /form,route\tapp\/login\/page\.tsx/.test(discovered) && /route\tapp\/api\/items\/route\.ts/.test(discovered) &&
  /action\tlib\/actions\.ts/.test(discovered) && /modal\tcomponents\/confirm\.tsx/.test(discovered), discovered + disc.out);
check('discover skips test files', !discovered.includes('page.test.tsx'));

// 4. fixture app + sweep
const app = spawn(process.execPath, [path.join(HOME, 'tests', 'fixture-app.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
try {
  let up = false;
  for (let i = 0; i < 40 && !up; i++) {
    try { up = (await fetch(BASE)).ok; } catch { await new Promise(r => setTimeout(r, 150)); }
  }
  check('fixture app starts', up);

  write(path.join(RUN, 'routes.json'), ['/', '/login', { path: '/dashboard', auth: true }, { path: '/items', auth: true }, { path: '/items?empty=1', auth: true }, { path: '/settings', auth: true }]);
  write(path.join(RUN, 'auth-user.json'), { cookies: [{ name: 'sid', value: 'user1', domain: 'localhost', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' }], origins: [] });
  const sw = {};
  for (const vp of ['desktop', 'mobile']) {
    sw[vp] = run([SWEEP, 'crawl', '--base', BASE, '--routes', 'routes.json', '--viewport', vp, '--out', `sweep/${vp}`, '--storage', 'auth-user.json'], { cwd: RUN });
  }
  const browserOk = sw.desktop.code === 0;
  check('sweep runs (desktop)', browserOk, sw.desktop.out);
  if (browserOk) {
    check('sweep flags console error, failed request and anonymous access on /dashboard',
      /\/dashboard\s+.*console=\d.*failedReq=1.*ANON-ACCESS\?/.test(sw.desktop.out), sw.desktop.out);
    check('sweep flags overflow and small targets on mobile',
      /mobile\s+\/dashboard\s+.*overflow=1200>390.*smallTargets=/.test(sw.mobile.out), sw.mobile.out);
    check('sweep lists the unlisted /logout link', /unlisted .*\/logout/.test(sw.desktop.out), sw.desktop.out);
    const diff = run([SWEEP, 'diff', 'sweep/desktop/sweep.json', 'sweep/mobile/sweep.json', '--out', 'sweep/diff.json'], { cwd: RUN });
    check('diff finds desktop actions hidden on mobile', /"Exporter CSV"\(hidden-in-dom\)/.test(diff.out), diff.out);

    // 5. graph-check: the fixture graph forgets "Exporter CSV" and /logout
    const graph = JSON.parse(fs.readFileSync(path.join(HOME, 'tests', 'fixture', 'feature-graph.json'), 'utf8'));
    write(path.join(RUN, 'feature-graph.json'), graph);
    const sweeps = ['--sweep', path.join(RUN, 'sweep/desktop/sweep.json'), '--sweep', path.join(RUN, 'sweep/mobile/sweep.json')];
    const bad = run([QA, 'graph-check', path.join(RUN, 'feature-graph.json'), '--project', HOME, ...sweeps]);
    check('graph-check rejects a graph that misses an action', bad.code === 1 && /\[4\] \/: .*"Exporter CSV"/.test(bad.out), bad.out);
    check('graph-check rejects a graph that misses a link', /\[3\] \/logout/.test(bad.out), bad.out);
    graph.nodes.find(n => n.id === 'home').actions.push('Exporter CSV');
    graph.out_of_scope.push({ item: '/logout', reason: 'redirection sans page, couverte par le flow de déconnexion du layout' });
    write(path.join(RUN, 'feature-graph.json'), graph);
    // --sweeps reads every viewport folder (the path has spaces); /items?empty=1 maps to the /items node
    const good = run([QA, 'graph-check', path.join(RUN, 'feature-graph.json'), '--project', HOME, '--sweeps', path.join(RUN, 'sweep')]);
    check('graph-check accepts the completed graph (--sweeps, query strings)', good.code === 0 && /graph OK/.test(good.out), good.out);
  }
  const broken = { roles: ['anon'], nodes: [{ id: 'x', kind: 'page', title: 'X', route: '/x', url: '/x', roles: ['admin'], source: ['nope.ts:1'], critical: true }], flows: [], edges: [] };
  write(path.join(TMP, 'broken-graph.json'), broken);
  const br = run([QA, 'graph-check', path.join(TMP, 'broken-graph.json'), '--project', HOME]);
  check('graph-check catches undeclared roles, missing sources, isolated and orphan critical nodes',
    br.code === 1 && /role "admin" not declared/.test(br.out) && /source not found/.test(br.out) && /isolated node/.test(br.out) && /critical node in no flow/.test(br.out), br.out);
} finally {
  app.kill();
}
if (!fs.existsSync(path.join(RUN, 'feature-graph.json'))) {
  write(path.join(RUN, 'feature-graph.json'), JSON.parse(fs.readFileSync(path.join(HOME, 'tests', 'fixture', 'feature-graph.json'), 'utf8')));
}

// 6. matrix
const quick = run([QA, 'matrix', path.join(RUN, 'feature-graph.json'), '--run', RUN, '--depth', 'quick']);
const quickCells = JSON.parse(fs.readFileSync(path.join(RUN, 'matrix', 'cells.json'), 'utf8')).cells;
// non-critical nodes keep only the baseline checks: quick never leaves a page untested
check('quick matrix: full checks on critical nodes, baseline only on the others', quick.code === 0 && /non-critical nodes with the 8 baseline checks/.test(quick.out)
  && quickCells.some(c => c.node === 'dashboard' && c.check === 'ui.state.render')
  && quickCells.some(c => c.node === 'settings' && c.check === 'ux.a11y.semantics') && !quickCells.some(c => c.node === 'settings' && c.check === 'ui.state.render'), quick.out);
const std = run([QA, 'matrix', path.join(RUN, 'feature-graph.json'), '--run', RUN, '--depth', 'standard']);
const cells = JSON.parse(fs.readFileSync(path.join(RUN, 'matrix', 'cells.json'), 'utf8')).cells;
const has = id => cells.some(c => c.id === id);
check('standard matrix crosses nodes with states, inputs, roles and viewports',
  std.code === 0 && has('items::ui.state.render::state=empty') && has('login.form::bug.input.limits::input=password') &&
  has('dashboard::fn.perm.access::role=anon') && has('F01::fn.flow.happy::viewport=mobile') && has('items::ux.feedback.destructive'), std.out);
check('every specialist mission file is written', fs.existsSync(path.join(RUN, 'missions', 'qa-ui-states.json')));

// 7. batches
const bt = run([QA, 'batches', '--run', RUN, '--domain', 'ui', '--wave', '1', '--max-cells', '5']);
const batchFile = path.join(RUN, 'missions', 'batches', 'w1', 'qa-ui-states-b1.json');
const batch = fs.existsSync(batchFile) ? JSON.parse(fs.readFileSync(batchFile, 'utf8')) : null;
const byNode = {};
for (const f of fs.readdirSync(path.join(RUN, 'missions', 'batches', 'w1')).filter(f => f.startsWith('qa-ui-states'))) {
  for (const c of JSON.parse(fs.readFileSync(path.join(RUN, 'missions', 'batches', 'w1', f), 'utf8')).cells) (byNode[c.node] ||= new Set()).add(f);
}
check('batches split by node without cutting a node in two', bt.code === 0 && batch && Object.values(byNode).every(s => s.size === 1), bt.out);

// 8. reports
const shot = '.qa-reviewer/runs/selftest/screens/qa-ui-states/STA-001.png';
write(path.join(project, shot), 'png');
const target = batch.cells.find(c => c.id.includes('state=empty')) || batch.cells[0];
const report = {
  agent: 'qa-ui-states', batch: 'b1', run_id: 'selftest',
  cells: batch.cells.map(c => c.id === target.id ? { id: c.id, status: 'fail', finding: 'STA-001' }
    // free-text evidence that cites an existing capture must not count as dangling
    : { id: c.id, status: 'pass', evidence: `command: pw eval getBoundingClientRect() — écart 1.5px ; ${shot}` }),
  findings: [{ id: 'STA-001', title: 'Total NaN € quand la liste est vide', severity: 'P2', confidence: 'high', category: 'state', nodes: [target.node], cells: [target.id],
    viewports: ['desktop'], evidence: [{ kind: 'screenshot', ref: shot }, { kind: 'code', ref: 'app/page.tsx:1' }],
    repro: ['Ouvrir /items?empty=1'], expected: 'État vide dédié', actual: 'Total : NaN €' }],
};
const reportFile = path.join(RUN, 'reports', 'qa-ui-states-w1-b1.json');
write(reportFile, report);
const rv = run([QA, 'reports', '--project', project, reportFile]);
check('a complete report passes validation (batch inferred from the file name)', rv.code === 0 && /✓ qa-ui-states-w1-b1\.json/.test(rv.out) && !/dangling/.test(rv.out), rv.out);
const badReport = { ...report, cells: report.cells.slice(1).concat({ id: 'x::y', status: 'na', reason: 'non' }, { id: 'home::rsp.layout::viewport=mobile', status: 'pass', evidence: 'curl -s / → 200' }), findings: [{ ...report.findings[0], severity: 'P9', evidence: [{ kind: 'code', ref: 'app/page.tsx:99' }] }],
  observations: [{ for: 'qa-ui-responsive', note: 'agent qui n\'existe pas' }] };
const badFile = path.join(TMP, 'qa-ui-states-w1-b1.json');
write(badFile, badReport);
const rb = run([QA, 'reports', '--project', project, '--batch', batchFile, badFile]);
check('an incomplete report is rejected (missing cell, unknown cell, vague reason, bad severity, dangling code ref, unknown observation target)',
  rb.code === 1 && /missing cell/.test(rb.out) && /not in the batch/.test(rb.out) && /precise "reason"/.test(rb.out) && /severity "P9"/.test(rb.out) && /beyond end/.test(rb.out) && /"qa-ui-responsive": not a qa-reviewer specialist/.test(rb.out) && /viewport cell needs a capture/.test(rb.out), rb.out);

// 9. coverage + wave 2
const cv = run([QA, 'coverage', '--run', RUN]);
const cov = JSON.parse(fs.readFileSync(path.join(RUN, 'matrix', 'coverage.json'), 'utf8'));
check('coverage merges reports and fails while cells are empty',
  cv.code === 1 && cov.totals.pass + cov.totals.fail === batch.cells.length && cov.totals.empty === cells.length - batch.cells.length, cv.out);
const w2 = run([QA, 'wave2', '--run', RUN]);
check('wave2 turns empty cells into missions', w2.code === 0 && fs.existsSync(path.join(RUN, 'missions', 'wave2', 'qa-fn-flows.json')), w2.out);

// 10. status: files, not agent replies, say when a domain is finished
const st = run([QA, 'status', '--run', RUN, '--wave', '1']);
check('status shows which specialists still owe a report', st.code === 0 && /^ui\s+(specialists running|to consolidate)\s+reports 1\//m.test(st.out) && /waiting: .*ui/.test(st.out), st.out);

// 11. teardown: stops exactly what the run started, brings stray browser files back into the run
const web = spawn('/bin/sh', ['-c', 'sleep 60 & wait'], { stdio: 'ignore' });
spawnSync('sleep', ['0.3']);
const child = Number((spawnSync('pgrep', ['-P', String(web.pid)], { encoding: 'utf8' }).stdout || '').trim().split('\n')[0]);
write(path.join(RUN, 'started.json'), [{ name: 'db', stop: `touch "${path.join(TMP, 'db-stopped')}"` }, { name: 'web', pid: web.pid }]);
write(path.join(project, '.playwright-cli', 'page.yml'), 'snapshot');
const td = run([QA, 'teardown', '--run', RUN]);
spawnSync('sleep', ['0.3']);
const gone = pid => !/^\s*[^Z\s]/.test(spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).stdout || '');
check('teardown stops the listed services and their children, and moves .playwright-cli/ into the run',
  td.code === 0 && fs.existsSync(path.join(TMP, 'db-stopped')) && gone(web.pid) && child > 0 && gone(child)
  && !fs.existsSync(path.join(project, '.playwright-cli')) && fs.existsSync(path.join(RUN, 'scratch', 'playwright-cli-outside-run', 'page.yml')), td.out);
write(path.join(RUN, 'leads', 'ux.json'), '{"domain": "ux", "issues": [');
check('status flags a lead file that is not valid JSON', /^ux\s+lead file is not valid JSON/m.test(run([QA, 'status', '--run', RUN, '--wave', '1']).out));

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
