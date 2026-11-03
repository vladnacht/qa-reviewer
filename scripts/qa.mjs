#!/usr/bin/env node
// qa-reviewer core CLI: the deterministic half of the agent. Everything that
// decides *what* must be tested (inventory, graph completeness, coverage
// matrix, batches, report validation, coverage merge) lives here, so the
// agents cannot silently skip a case.
//
//   node qa.mjs init <project> [--run-id ID]
//   node qa.mjs discover <project> --out discovery.txt
//   node qa.mjs graph-check <feature-graph.json> [--project DIR] [--discovery FILE] [--sweeps RUN/sweep | --sweep sweep.json ...]
//   node qa.mjs matrix <feature-graph.json> --run RUN --depth quick|standard|exhaustive
//   node qa.mjs batches --run RUN --domain DOMAIN --wave 1|2 [--max-cells 60]
//   node qa.mjs reports --project DIR [--batch BATCH.json] <report.json>...
//   node qa.mjs coverage --run RUN
//   node qa.mjs wave2 --run RUN
//   node qa.mjs status --run RUN --wave 1|2
//   node qa.mjs teardown --run RUN

import fs from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const QA_HOME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = JSON.parse(fs.readFileSync(path.join(QA_HOME, 'references', 'checks.json'), 'utf8'));

const KINDS = ['page', 'modal', 'form', 'layout', 'api', 'job'];
const STATES = ['default', 'empty', 'loading', 'error', 'success', 'disabled', 'partial'];
const DEPTH_ORDER = ['quick', 'standard', 'exhaustive'];
const DIM_ORDER = ['viewport', 'role', 'state', 'action', 'input'];
const STATUS_RANK = { fail: 4, pass: 3, na: 2, blocked: 1 };
const SEVERITIES = ['P0', 'P1', 'P2', 'P3'];
const CONFIDENCE = ['high', 'medium', 'low'];
const CATEGORIES = ['flow', 'action', 'rule', 'validation', 'permission', 'data', 'layout', 'design', 'state', 'content',
  'journey', 'feedback', 'copy', 'a11y', 'input', 'network', 'console', 'concurrency', 'navigation', 'session',
  'responsive', 'touch', 'parity', 'zoom', 'perf', 'security', 'other'];
const EVIDENCE_KINDS = ['screenshot', 'snapshot', 'code', 'console', 'network', 'command'];
const MUST_MAP = ['route', 'action', 'api', 'router', 'modal', 'form'];

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { opts._.push(a); continue; }
    const [k, v] = a.slice(2).split('=');
    const val = v ?? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true);
    if (opts[k] === undefined) opts[k] = val;
    else opts[k] = [].concat(opts[k], val);
  }
  return opts;
}

const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const writeJson = (f, data) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(data, null, 2) + '\n'); };
const norm = s => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const fileOf = ref => String(ref).replace(/^\.\//, '').replace(/:\d+(-\d+)?$/, '');
const asList = v => (v === undefined ? [] : [].concat(v));
const fail = msg => { console.error(`[qa] ${msg}`); process.exit(1); };

// ---------------------------------------------------------------- init

function init(opts) {
  const project = path.resolve(opts._[0] || fail('usage: init <project> [--run-id ID]'));
  if (!fs.existsSync(project)) fail(`project not found: ${project}`);
  const d = new Date(), p2 = n => String(n).padStart(2, '0');
  let runId = opts['run-id'] || `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
  let run = path.join(project, '.qa-reviewer', 'runs', runId);
  for (let i = 2; fs.existsSync(run); i++) run = path.join(project, '.qa-reviewer', 'runs', `${runId}-${i}`);
  runId = path.basename(run);
  for (const sub of ['sweep', 'matrix', 'missions/batches', 'missions/wave2', 'reports', 'leads', 'screens', 'scratch', 'profiles'])
    fs.mkdirSync(path.join(run, sub), { recursive: true });
  for (const [name, v] of Object.entries(CATALOG.viewports)) {
    const contextOptions = { viewport: { width: v.width, height: v.height }, deviceScaleFactor: v.touch ? 3 : 1 };
    if (v.touch) Object.assign(contextOptions, { isMobile: v.width < 768, hasTouch: true });
    if (v.touch && v.width < 768) contextOptions.userAgent =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    writeJson(path.join(run, 'profiles', `${name}.json`), { browser: { isolated: true, contextOptions }, outputMode: 'file' });
  }
  const exclude = path.join(project, '.git', 'info', 'exclude');
  if (fs.existsSync(path.join(project, '.git', 'info'))) {
    const cur = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : '';
    if (!cur.split('\n').includes('.qa-reviewer/')) fs.appendFileSync(exclude, (cur && !cur.endsWith('\n') ? '\n' : '') + '.qa-reviewer/\n');
  }
  writeJson(path.join(run, 'run.json'), { run_id: runId, project, created_at: d.toISOString(),
    preexisting: { '.playwright-cli': fs.existsSync(path.join(project, '.playwright-cli')) } });
  console.log(`RUN_ID=${runId}`);
  console.log(`RUN=${run}`);
}

// ---------------------------------------------------------------- discover

const SKIP_DIRS = new Set(['node_modules', '.git', '.next', '.nuxt', '.svelte-kit', '.output', 'dist', 'build', 'out', 'coverage',
  '.qa-reviewer', '.turbo', '.vercel', '.cache', 'graphify-out', '__pycache__', 'venv', '.venv', 'vendor',
  '__tests__', '__mocks__', 'e2e', 'tests', 'test', '.storybook', '.playwright-cli']);
const CODE_EXT = /\.(jsx?|tsx?|mjs|cjs|vue|svelte|astro|py|php|rb|prisma|sql)$/;
const SKIP_FILE = /\.(test|spec|stories|d)\.[^.]+$/;

const BY_PATH = [
  ['route', /(^|\/)app\/(.*\/)?(page|layout|template|route|loading|error|not-found|default)\.(t|j)sx?$/],
  ['route', /(^|\/)(src\/)?pages\/(?!_app\.|_document\.).*\.(t|j)sx?$/],
  ['route', /(^|\/)\+(page|layout|server|error)(\.server)?\.(svelte|ts|js)$/],
  ['route', /(^|\/)app\/routes(\/|\.(t|j)sx?$)/],
  ['route', /(^|\/)server\/(api|routes)\//],
  ['route', /(^|\/)(urls\.py|routes\/(web|api)\.php|config\/routes\.rb)$/],
  ['middleware', /(^|\/)middleware\.(t|j)s$/],
  ['schema', /(^|\/)(schema\.prisma|models\.py)$/],
  ['schema', /(^|\/)migrations\/.*\.sql$/],
];
const BY_CONTENT = [
  ['action', /^\s*['"]use server['"]/m],
  ['api', /\b(app|router|server|fastify|api|hono)\.(get|post|put|patch|delete|all|route)\(\s*['"`]/],
  ['api', /@(Controller|Get|Post|Put|Patch|Delete)\(/],
  ['api', /@(app|router|bp|blueprint)\.(get|post|put|patch|delete|route)\(/],
  ['router', /<Route\s[^>]*path=|createBrowserRouter\(|path:\s*['"`]\/[^'"`]*['"`]\s*,\s*(element|component|Component|lazy)\b/],
  ['modal', /<(Dialog|Modal|Sheet|Drawer|AlertDialog|Popover|DropdownMenu)[\s>]/],
  ['form', /<form[\s>]|\buseForm\(|<Form[\s>]/],
  ['schema', /\b(pgTable|mysqlTable|sqliteTable)\(|@Entity\(|new Schema\(/],
];

function discover(opts) {
  const project = path.resolve(opts._[0] || fail('usage: discover <project> --out FILE'));
  const lines = [];
  const walk = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(abs); continue; }
      if (!e.isFile() || !CODE_EXT.test(e.name) || SKIP_FILE.test(e.name)) continue;
      const rel = path.relative(project, abs).split(path.sep).join('/');
      const cats = new Set(BY_PATH.filter(([, re]) => re.test(rel)).map(([c]) => c));
      if (fs.statSync(abs).size <= 1024 * 1024) {
        const text = fs.readFileSync(abs, 'utf8');
        for (const [c, re] of BY_CONTENT) if (re.test(text)) cats.add(c);
      }
      if (cats.size) lines.push(`${[...cats].sort().join(',')}\t${rel}`);
    }
  };
  walk(project);
  lines.sort((a, b) => a.split('\t')[1].localeCompare(b.split('\t')[1]));
  const out = lines.join('\n') + (lines.length ? '\n' : '');
  if (opts.out && opts.out !== true) fs.writeFileSync(opts.out, out);
  const tally = {};
  for (const l of lines) for (const c of l.split('\t')[0].split(',')) tally[c] = (tally[c] || 0) + 1;
  console.log(`${lines.length} files · ` + Object.entries(tally).map(([k, v]) => `${k}=${v}`).join(' ') + (opts.out ? ` · wrote ${opts.out}` : ''));
  if (!opts.out) process.stdout.write(out);
}

// ---------------------------------------------------------------- graph

function routeRegex(pattern) {
  let p = String(pattern).replace(/^[A-Z]+\s+/, '').split('?')[0];
  p = p.replace(/\/\([^/)]+\)/g, '');
  const parts = p.split('/').map(seg => {
    if (/^\[\[?\.\.\.[^\]]+\]\]?$/.test(seg)) return '.+';
    if (/^\[[^\]]+\]$/.test(seg) || /^:[^/]+$/.test(seg) || /^\{[^}]+\}$/.test(seg)) return '[^/]+';
    return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  });
  return new RegExp('^' + (parts.join('/') || '/') + '/?$');
}

function schemaIssues(g) {
  const issues = [];
  const add = (rule, msg) => issues.push({ rule, msg });
  if (!Array.isArray(g.nodes)) { add(5, '"nodes" must be an array'); return issues; }
  const roles = new Set(asList(g.roles));
  if (!roles.size) add(5, '"roles" must list at least one role (use "anon" for public)');
  const ids = new Map();
  for (const n of g.nodes) {
    const where = n?.id || '(node without id)';
    if (!n?.id || !/^[a-z0-9][a-z0-9._-]*$/.test(n.id)) add(5, `${where}: id must match [a-z0-9][a-z0-9._-]*`);
    if (ids.has(n?.id)) add(5, `${where}: duplicate id`);
    ids.set(n?.id, n);
    if (!KINDS.includes(n?.kind)) { add(5, `${where}: kind "${n?.kind}" not in ${KINDS.join(', ')}`); continue; }
    for (const k of ['title', 'roles']) if (n[k] === undefined || n[k] === '') add(5, `${where}: missing "${k}"`);
    if (n.kind !== 'layout' && !n.route) add(5, `${where}: missing "route"`);
    if (['page', 'modal', 'layout'].includes(n.kind) && !n.url) add(5, `${where}: missing "url" (concrete URL to open)`);
    if (n.kind !== 'job' && !asList(n.source).length) add(5, `${where}: missing "source"`);
    for (const r of asList(n.roles)) if (!roles.has(r)) add(5, `${where}: role "${r}" not declared in "roles"`);
    for (const s of asList(n.states)) if (!STATES.includes(s)) add(5, `${where}: state "${s}" not in ${STATES.join(', ')}`);
    const acts = new Set(asList(n.actions).map(norm));
    for (const a of asList(n.destructive)) if (!acts.has(norm(a))) add(5, `${where}: destructive "${a}" not in actions`);
    for (const i of asList(n.inputs)) if (!i?.name) add(5, `${where}: every input needs a "name"`);
  }
  for (const n of g.nodes) {
    if (!n?.id) continue;
    if (n.parent && !ids.has(n.parent)) add(5, `${n.id}: parent "${n.parent}" does not exist`);
    for (const a of asList(n.api)) if (!ids.has(a)) add(5, `${n.id}: api "${a}" does not exist`);
    else if (ids.get(a).kind !== 'api') add(5, `${n.id}: api "${a}" is a ${ids.get(a).kind}, not an api node`);
  }
  for (const f of asList(g.flows)) {
    const where = f?.id || '(flow without id)';
    if (!f?.id || !f.title) add(5, `${where}: flow needs id and title`);
    if (ids.has(f?.id)) add(5, `${where}: flow id collides with a node id`);
    if (!asList(f?.steps).length) add(5, `${where}: flow without steps`);
    for (const s of asList(f?.steps)) if (!ids.has(s)) add(5, `${where}: step "${s}" does not exist`);
    for (const r of asList(f?.roles)) if (!roles.has(r)) add(5, `${where}: role "${r}" not declared`);
  }
  for (const e of asList(g.edges)) {
    if (!ids.has(e?.from)) add(5, `edge ${e?.from} → ${e?.to}: "from" does not exist`);
    if (!ids.has(e?.to)) add(5, `edge ${e?.from} → ${e?.to}: "to" does not exist`);
  }
  return issues;
}

function graphCheck(opts) {
  const file = opts._[0] || fail('usage: graph-check <feature-graph.json> [--project DIR] [--discovery FILE] [--sweeps DIR | --sweep FILE ...]');
  let g;
  try { g = readJson(file); } catch (e) { fail(`cannot read ${file}: ${e.message}`); }
  const issues = schemaIssues(g);
  const add = (rule, msg) => issues.push({ rule, msg });
  const nodes = asList(g.nodes).filter(n => n?.id);
  const byId = new Map(nodes.map(n => [n.id, n]));
  const outItems = asList(g.out_of_scope).map(o => String(o?.item ?? '').replace(/^\.\//, '')).filter(Boolean);
  const outOfScope = p => outItems.some(i => p === i || (i.endsWith('/') ? p.startsWith(i) : p.startsWith(i + '/')));

  // rule 6: connectivity and critical nodes in flows
  const linked = new Set();
  for (const e of asList(g.edges)) { linked.add(e.from); linked.add(e.to); }
  for (const f of asList(g.flows)) for (const s of asList(f.steps)) linked.add(s);
  for (const n of nodes) { if (n.parent) { linked.add(n.id); linked.add(n.parent); } for (const a of asList(n.api)) { linked.add(a); linked.add(n.id); } }
  for (const n of nodes) if (n.kind !== 'layout' && !linked.has(n.id)) add(6, `${n.id}: isolated node (no edge, flow step, parent or api reference)`);
  const inFlow = new Set(asList(g.flows).flatMap(f => asList(f.steps)));
  const inFlowViaAncestor = n => {
    for (let cur = n, hops = 0; cur && hops < 20; cur = byId.get(cur.parent), hops++) if (inFlow.has(cur.id)) return true;
    return false;
  };
  for (const n of nodes) if (n.critical && n.kind !== 'api' && !inFlowViaAncestor(n)) add(6, `${n.id}: critical node in no flow (itself or its parent)`);

  // sources exist
  if (opts.project) {
    const root = path.resolve(opts.project);
    for (const n of nodes) for (const ref of asList(n.source)) {
      const m = /^(.+?)(?::(\d+)(?:-(\d+))?)?$/.exec(String(ref));
      const abs = path.join(root, m[1]);
      if (!fs.existsSync(abs)) { add(5, `${n.id}: source not found: ${ref}`); continue; }
      if (m[2] && fs.statSync(abs).isFile()) {
        const lines = fs.readFileSync(abs, 'utf8').split('\n').length;
        if (Number(m[3] || m[2]) > lines) add(5, `${n.id}: source ${ref} beyond end of file (${lines} lines)`);
      }
    }
  }

  // rule 1: discovery inventory
  if (opts.discovery) {
    const cited = new Set(nodes.flatMap(n => asList(n.source).map(fileOf)));
    for (const line of fs.readFileSync(opts.discovery, 'utf8').split('\n').filter(Boolean)) {
      const [cats, p] = line.split('\t');
      if (!cats.split(',').some(c => MUST_MAP.includes(c))) continue;
      if (!cited.has(p) && !outOfScope(p)) add(1, `${p} (${cats}): cited by no node source and not in out_of_scope`);
    }
  }

  // rules 2, 3, 4: sweep
  const pages = nodes.filter(n => n.kind === 'page');
  // /items?empty=1 is the /items page in another state, not an unknown route
  const nodeForPath = p => { const bare = String(p).split(/[?#]/)[0] || '/';
    return pages.find(n => n.url === p || n.url === bare) || pages.find(n => routeRegex(n.route).test(bare)); };
  const children = new Map();
  for (const n of nodes) if (n.parent) children.set(n.parent, [...(children.get(n.parent) || []), n]);
  const layoutActions = new Set(nodes.filter(n => n.kind === 'layout').flatMap(n => asList(n.actions).map(norm)));
  const actionsUnder = (n, seen = new Set()) => {
    if (seen.has(n.id)) return [];
    seen.add(n.id);
    const own = [...asList(n.actions), ...asList(n.inputs).flatMap(i => [i.name, i.label])].filter(Boolean).map(norm);
    return [...own, ...(children.get(n.id) || []).flatMap(c => actionsUnder(c, seen))];
  };
  const missingByPath = new Map(), unmapped = new Set(), unlisted = new Set();
  // --sweeps DIR reads every DIR/<viewport>/sweep.json: no shell loop, so paths with spaces survive
  const sweepFiles = [...asList(opts.sweep), ...asList(opts.sweeps).flatMap(d => fs.existsSync(d)
    ? fs.readdirSync(d).map(v => path.join(d, v, 'sweep.json')).filter(f => fs.existsSync(f)) : [])];
  for (const sf of sweepFiles) {
    const sweep = readJson(sf);
    for (const r of sweep.routes || []) {
      const n = nodeForPath(r.path);
      if (!n) { unmapped.add(r.path); continue; }
      const known = new Set([...actionsUnder(n), ...layoutActions]);
      const inv = [...(r.inventory?.visible || []), ...(r.inventory?.hidden || [])].map(a => a.name);
      for (const name of inv) if (!known.has(norm(name)))
        missingByPath.set(r.path, new Set([...(missingByPath.get(r.path) || []), name]));
    }
    for (const p of sweep.unlistedLinks || []) if (!nodeForPath(p) && !outOfScope(p)) unlisted.add(p);
  }
  for (const p of unmapped) add(2, `${p}: swept route matches no page node (url or route pattern)`);
  for (const p of unlisted) add(3, `${p}: link found by the sweep, no page node and not in out_of_scope`);
  for (const [p, names] of missingByPath) add(4, `${p}: actions seen by the sweep but absent from the graph: ${[...names].map(n => `"${n}"`).join(', ')}`);

  issues.sort((a, b) => a.rule - b.rule);
  for (const i of issues) console.log(`[${i.rule}] ${i.msg}`);
  const stats = `${nodes.length} nodes (${KINDS.map(k => `${k}=${nodes.filter(n => n.kind === k).length}`).join(' ')}) · ${asList(g.flows).length} flows · ${asList(g.edges).length} edges`;
  if (issues.length) { console.log(`graph NOT OK — ${issues.length} issue(s) · ${stats}`); process.exit(1); }
  console.log(`graph OK — ${stats}`);
}

// ---------------------------------------------------------------- matrix

function targetsOf(g, depth) {
  const cfg = CATALOG.depths[depth];
  const nodes = asList(g.nodes);
  const flows = asList(g.flows).map(f => ({ ...f, kind: 'flow' }));
  if (!cfg.critical_only) return { nodes, flows, baseline: [] };
  const keep = new Set(nodes.filter(n => n.critical || n.kind === 'layout').map(n => n.id));
  const critFlows = flows.filter(f => f.critical);
  for (const f of critFlows) for (const s of asList(f.steps)) keep.add(s);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of nodes) {
      const add = id => { if (id && !keep.has(id)) { keep.add(id); grew = true; } };
      if (n.parent && keep.has(n.parent)) add(n.id);
      if (keep.has(n.id)) asList(n.api).forEach(add);
    }
  }
  // the other nodes still get the depth's baseline checks: quick never leaves a page untested
  return { nodes: nodes.filter(n => keep.has(n.id)), flows: critFlows, baseline: nodes.filter(n => !keep.has(n.id)) };
}

function conditionHolds(target, cond, g) {
  if (cond === 'critical') return !!target.critical;
  if (cond === 'auth') return asList(target.roles).length > 0 && !asList(target.roles).includes('anon');
  return asList(target[cond]).length > 0;
}

function dimValues(dim, check, target, g, active) {
  if (dim === 'viewport') {
    let v = active;
    if (Array.isArray(check.viewports)) v = active.filter(x => check.viewports.includes(x));
    else if (check.viewports === 'touch') v = active.filter(x => CATALOG.viewports[x].touch);
    else if (check.viewports === 'pointer') v = active.filter(x => !CATALOG.viewports[x].touch);
    return v;
  }
  if (dim === 'role') return check.roles === 'all' ? asList(g.roles) : asList(target.roles);
  if (dim === 'state') return asList(target.states).length ? asList(target.states) : ['default'];
  if (dim === 'action') return asList(target.actions);
  if (dim === 'input') return asList(target.inputs).map(i => i.name);
  throw new Error(`unknown dimension ${dim}`);
}

function cartesian(dims) {
  return dims.reduce((acc, [k, vals]) => acc.flatMap(a => vals.map(v => ({ ...a, [k]: v }))), [{}]);
}

const cellId = (target, check, dims) =>
  [target.id, check.id, ...DIM_ORDER.filter(k => k in dims).map(k => `${k}=${dims[k]}`)].join('::');

function matrix(opts) {
  const file = opts._[0] || fail('usage: matrix <feature-graph.json> --run RUN --depth quick|standard|exhaustive');
  const run = path.resolve(opts.run || fail('--run is required'));
  const depth = opts.depth || 'standard';
  if (!CATALOG.depths[depth]) fail(`--depth must be one of ${DEPTH_ORDER.join(', ')}`);
  const g = readJson(file);
  const schema = schemaIssues(g);
  if (schema.length) fail(`the graph has ${schema.length} schema issue(s); run graph-check first`);
  const active = CATALOG.depths[depth].viewports;
  const { nodes, flows, baseline } = targetsOf(g, depth);
  const baselineChecks = new Set(CATALOG.depths[depth].baseline || []);
  const cells = [];
  for (const check of CATALOG.checks) {
    if (DEPTH_ORDER.indexOf(check.depth) > DEPTH_ORDER.indexOf(depth)) continue;
    const spec = CATALOG.specialists[check.specialist];
    for (const t of [...nodes, ...flows, ...(baselineChecks.has(check.id) ? baseline : [])]) {
      if (!check.applies.includes(t.kind)) continue;
      if (!asList(check.when).every(c => conditionHolds(t, c, g))) continue;
      const dims = asList(check.per).map(d => [d, dimValues(d, check, t, g, active)]);
      if (dims.some(([, v]) => v.length === 0)) continue;
      for (const combo of cartesian(dims))
        cells.push({ id: cellId(t, check, combo), node: t.id, kind: t.kind, check: check.id, agent: check.specialist, domain: spec.domain, dims: combo, title: check.title });
    }
  }
  const dup = cells.length - new Set(cells.map(c => c.id)).size;
  if (dup) fail(`${dup} duplicate cell id(s): check for repeated actions or inputs in a node`);
  writeJson(path.join(run, 'matrix', 'cells.json'), { depth, viewports: active, generated_at: new Date().toISOString(), cells });
  for (const agent of Object.keys(CATALOG.specialists)) {
    const own = cells.filter(c => c.agent === agent);
    const f = path.join(run, 'missions', `${agent}.json`);
    if (own.length) writeJson(f, { agent, domain: CATALOG.specialists[agent].domain, wave: 1, cells: own });
    else if (fs.existsSync(f)) fs.rmSync(f);
  }
  console.log(`depth=${depth} viewports=${active.join(',')} targets: ${nodes.length} nodes, ${flows.length} flows` +
    (baseline.length ? ` + ${baseline.length} non-critical nodes with the ${baselineChecks.size} baseline checks` : ''));
  for (const [domain, d] of Object.entries(CATALOG.domains)) {
    const per = Object.entries(CATALOG.specialists).filter(([, s]) => s.domain === domain)
      .map(([a]) => `${a}=${cells.filter(c => c.agent === a).length}`);
    console.log(`${d.title.padEnd(20)} ${String(cells.filter(c => c.domain === domain).length).padStart(5)}  ${per.join(' ')}`);
  }
  console.log(`total ${cells.length} cells · wrote ${path.join(run, 'matrix', 'cells.json')} and missions/<agent>.json`);
}

// ---------------------------------------------------------------- batches

function batches(opts) {
  const run = path.resolve(opts.run || fail('--run is required'));
  const domain = opts.domain || fail('--domain is required');
  if (!CATALOG.domains[domain]) fail(`--domain must be one of ${Object.keys(CATALOG.domains).join(', ')}`);
  const wave = Number(opts.wave || 1);
  const maxCells = Number(opts['max-cells'] || 60);
  const g = readJson(path.join(run, 'feature-graph.json'));
  const targets = new Map([...asList(g.nodes), ...asList(g.flows).map(f => ({ ...f, kind: 'flow' }))].map(t => [t.id, t]));
  const outDir = path.join(run, 'missions', 'batches', `w${wave}`);
  fs.mkdirSync(outDir, { recursive: true });
  const agents = Object.entries(CATALOG.specialists).filter(([, s]) => s.domain === domain).map(([a]) => a);
  let written = 0;
  for (const agent of agents) {
    for (const old of fs.readdirSync(outDir).filter(f => f.startsWith(`${agent}-b`))) fs.rmSync(path.join(outDir, old));
    const src = wave === 1 ? path.join(run, 'missions', `${agent}.json`) : path.join(run, 'missions', 'wave2', `${agent}.json`);
    if (!fs.existsSync(src)) continue;
    const cells = readJson(src).cells || [];
    if (!cells.length) continue;
    const byNode = new Map();
    for (const c of cells) byNode.set(c.node, [...(byNode.get(c.node) || []), c]);
    const packs = [];
    for (const group of byNode.values()) {
      const last = packs[packs.length - 1];
      if (last && last.length + group.length <= maxCells) last.push(...group);
      else packs.push([...group]);
    }
    packs.forEach((pack, i) => {
      const nodeIds = [...new Set(pack.map(c => c.node))];
      const related = new Set(nodeIds);
      for (const id of nodeIds) {
        const t = targets.get(id);
        if (t?.parent) related.add(t.parent);
        for (const s of asList(t?.steps)) related.add(s);
        for (const a of asList(t?.api)) related.add(a);
      }
      const checks = Object.fromEntries([...new Set(pack.map(c => c.check))].map(id => [id, CATALOG.checks.find(k => k.id === id)?.title || '']));
      const f = path.join(outDir, `${agent}-b${i + 1}.json`);
      writeJson(f, { agent, domain, wave, batch: `b${i + 1}`, notes: '', checks, cells: pack,
        nodes: [...related].map(id => targets.get(id)).filter(Boolean) });
      console.log(`${f}  cells=${pack.length} nodes=${nodeIds.length}`);
      written++;
    });
  }
  if (!written) console.log(`no cell for domain ${domain} in wave ${wave}`);
}

// ---------------------------------------------------------------- reports

function checkCodeRef(root, ref, cache) {
  const m = /^(.+?):(\d+)(?:-(\d+))?$/.exec(ref);
  if (!m) return 'code ref must be "path:line" or "path:start-end"';
  const abs = path.join(root, m[1]);
  if (!fs.existsSync(abs)) return `file not found: ${m[1]}`;
  if (!cache.has(abs)) cache.set(abs, fs.readFileSync(abs, 'utf8').split('\n').length);
  const n = cache.get(abs);
  if (Number(m[3] || m[2]) > n) return `line ${m[3] || m[2]} beyond end of ${m[1]} (${n} lines)`;
  return null;
}

function inferBatch(reportFile) {
  const m = /^(.+)-w(\d+)-b(\d+)\.json$/.exec(path.basename(reportFile));
  if (!m) return null;
  return path.join(path.dirname(path.dirname(reportFile)), 'missions', 'batches', `w${m[2]}`, `${m[1]}-b${m[3]}.json`);
}

function validateReport(r, root, batch) {
  const problems = [], dangling = [], cache = new Map();
  if (!r.agent) problems.push('missing "agent"');
  if (!Array.isArray(r.cells)) problems.push('"cells" must be an array');
  if (!Array.isArray(r.findings)) problems.push('"findings" must be an array');
  const findingIds = new Set();
  for (const [i, f] of (r.findings || []).entries()) {
    const where = f?.id || `findings[${i}]`;
    if (f?.id && findingIds.has(f.id)) problems.push(`duplicate finding id ${f.id}`);
    findingIds.add(f?.id);
    for (const k of ['id', 'title', 'severity', 'confidence', 'category', 'expected', 'actual'])
      if (f?.[k] === undefined || f[k] === '') problems.push(`${where}: missing "${k}"`);
    if (f?.severity && !SEVERITIES.includes(f.severity)) problems.push(`${where}: severity "${f.severity}" not in ${SEVERITIES}`);
    if (f?.confidence && !CONFIDENCE.includes(f.confidence)) problems.push(`${where}: confidence "${f.confidence}" not in ${CONFIDENCE}`);
    if (f?.category && !CATEGORIES.includes(f.category)) problems.push(`${where}: category "${f.category}" unknown`);
    if (!Array.isArray(f?.repro) || !f.repro.length) problems.push(`${where}: "repro" must be a non-empty array of steps`);
    if (!Array.isArray(f?.evidence) || !f.evidence.length) problems.push(`${where}: "evidence" must be a non-empty array`);
    for (const e of asList(f?.evidence)) {
      if (!EVIDENCE_KINDS.includes(e?.kind)) { problems.push(`${where}: evidence kind "${e?.kind}" not in ${EVIDENCE_KINDS}`); continue; }
      if (!e.ref) { problems.push(`${where}: evidence without ref`); continue; }
      if (e.kind === 'code') { const err = checkCodeRef(root, e.ref, cache); if (err) dangling.push(`${where}: ${err}`); }
      if ((e.kind === 'screenshot' || e.kind === 'snapshot') && !fs.existsSync(path.join(root, e.ref))) dangling.push(`${where}: missing file ${e.ref}`);
    }
  }
  const checkCell = (c, label) => {
    if (!c?.id) { problems.push(`${label}: cell without id`); return; }
    if (!STATUS_RANK[c.status]) { problems.push(`${c.id}: status "${c.status}" not in pass, fail, na, blocked`); return; }
    if (c.status === 'pass' && !c.evidence) problems.push(`${c.id}: pass without "evidence"`);
    // a viewport cell passes on what was seen in that viewport, not on curl or the code
    if (c.status === 'pass' && /::viewport=/.test(c.id) && typeof c.evidence === 'string' && !/\.(png|jpe?g|webp)\b|\bpw\b|\beval\b|sweep/i.test(c.evidence))
      problems.push(`${c.id}: a viewport cell needs a capture, a sweep result or a "pw eval" measure as evidence`);
    if (c.status === 'fail' && !findingIds.has(c.finding)) problems.push(`${c.id}: fail must point to a finding of this report (got "${c.finding}")`);
    if ((c.status === 'na' || c.status === 'blocked') && !(c.reason && String(c.reason).length >= 15)) problems.push(`${c.id}: ${c.status} needs a precise "reason"`);
    // evidence is free text: check every image path it cites, not the whole string
    if (c.status === 'pass' && typeof c.evidence === 'string')
      for (const img of c.evidence.match(/[^\s;,'"`()]+\.(?:png|jpe?g|webp)\b/gi) || [])
        if (!fs.existsSync(path.join(root, img))) dangling.push(`${c.id}: missing file ${img}`);
  };
  for (const c of r.cells || []) checkCell(c, 'cells');
  for (const c of r.extra_cells || []) {
    checkCell(c, 'extra_cells');
    if (c?.id && !c.id.startsWith('X-')) problems.push(`${c.id}: extra cell ids must start with "X-"`);
    if (!c?.node || !c?.title) problems.push(`${c?.id}: extra cell needs "node" and "title"`);
  }
  for (const o of r.observations || [])
    if (!CATALOG.specialists[o?.for]) problems.push(`observation for "${o?.for}": not a qa-reviewer specialist (${Object.keys(CATALOG.specialists).join(', ')})`);
  let missing = 0;
  if (batch) {
    const got = new Set((r.cells || []).map(c => c?.id));
    const expected = new Set(batch.cells.map(c => c.id));
    for (const id of expected) if (!got.has(id)) { missing++; if (missing <= 20) problems.push(`missing cell ${id}`); }
    if (missing > 20) problems.push(`… and ${missing - 20} more missing cells`);
    for (const id of got) if (!expected.has(id)) problems.push(`cell ${id} is not in the batch (typo?) — put new checks in extra_cells`);
  }
  return { problems, dangling, missing };
}

function reports(opts) {
  const root = path.resolve(opts.project || fail('--project is required'));
  const files = opts._;
  if (!files.length) fail('usage: reports --project DIR [--batch BATCH.json] <report.json>...');
  if (opts.batch && files.length > 1) fail('--batch works with a single report');
  let invalid = 0;
  for (const file of files) {
    let r;
    try { r = readJson(file); } catch (e) {
      console.log(`✗ ${file}: ${e.code === 'ENOENT' ? 'missing' : 'invalid JSON: ' + e.message}`); invalid++; continue;
    }
    const batchFile = opts.batch || inferBatch(path.resolve(file));
    const batch = batchFile && fs.existsSync(batchFile) ? readJson(batchFile) : null;
    const { problems, dangling } = validateReport(r, root, batch);
    const tally = s => (r.cells || []).filter(c => c?.status === s).length;
    const sev = SEVERITIES.map(s => `${s}=${(r.findings || []).filter(f => f?.severity === s).length}`).join(' ');
    const ok = problems.length === 0;
    if (!ok) invalid++;
    console.log(`${ok ? '✓' : '✗'} ${path.basename(file)} agent=${r.agent ?? '?'} cells=${(r.cells || []).length}${batch ? `/${batch.cells.length}` : ' (no batch found)'} ` +
      `pass=${tally('pass')} fail=${tally('fail')} na=${tally('na')} blocked=${tally('blocked')} extra=${(r.extra_cells || []).length} findings=${(r.findings || []).length} ${sev}`);
    for (const p of problems) console.log(`    invalid: ${p}`);
    for (const d of dangling) console.log(`    dangling evidence: ${d}`);
  }
  process.exit(invalid ? 1 : 0);
}

// ---------------------------------------------------------------- coverage

function coverage(opts) {
  const run = path.resolve(opts.run || fail('--run is required'));
  const base = readJson(path.join(run, 'matrix', 'cells.json')).cells;
  const cells = new Map(base.map(c => [c.id, { ...c, status: 'empty' }]));
  const wave2Dir = path.join(run, 'missions', 'wave2');
  if (fs.existsSync(wave2Dir)) for (const f of fs.readdirSync(wave2Dir).filter(f => f.endsWith('.json')))
    for (const c of readJson(path.join(wave2Dir, f)).cells || []) if (!cells.has(c.id)) cells.set(c.id, { ...c, status: 'empty' });
  const reportDir = path.join(run, 'reports');
  const unreadable = [];
  for (const f of fs.existsSync(reportDir) ? fs.readdirSync(reportDir).filter(f => f.endsWith('.json')).sort() : []) {
    let r;
    try { r = readJson(path.join(reportDir, f)); } catch { unreadable.push(f); continue; }
    const take = (c, extra) => {
      if (!c?.id || !STATUS_RANK[c.status]) return;
      let cur = cells.get(c.id);
      if (!cur && extra) {
        const spec = CATALOG.specialists[r.agent] || {};
        cur = { id: c.id, node: c.node, check: 'extra', agent: r.agent, domain: spec.domain, dims: {}, title: c.title, status: 'empty' };
        cells.set(c.id, cur);
      }
      if (!cur) return;
      if (cur.status === 'empty' || STATUS_RANK[c.status] > STATUS_RANK[cur.status]) {
        Object.assign(cur, { status: c.status, source: f, finding: c.finding, evidence: c.evidence, reason: c.reason });
      }
    };
    for (const c of r.cells || []) take(c, false);
    for (const c of r.extra_cells || []) take(c, true);
  }
  const all = [...cells.values()];
  const count = (list, s) => list.filter(c => c.status === s).length;
  const row = list => ({ cells: list.length, pass: count(list, 'pass'), fail: count(list, 'fail'), na: count(list, 'na'), blocked: count(list, 'blocked'), empty: count(list, 'empty') });
  const byDomain = Object.fromEntries(Object.keys(CATALOG.domains).map(d => [d, row(all.filter(c => c.domain === d))]));
  const byAgent = Object.fromEntries(Object.keys(CATALOG.specialists).map(a => [a, row(all.filter(c => c.agent === a))]).filter(([, v]) => v.cells));
  const totals = row(all);
  writeJson(path.join(run, 'matrix', 'coverage.json'), { generated_at: new Date().toISOString(), totals, by_domain: byDomain, by_agent: byAgent, cells: all });
  const group = s => {
    const out = {};
    for (const c of all.filter(c => c.status === s)) (out[c.agent] ||= []).push(s === 'blocked' ? { id: c.id, node: c.node, check: c.check, reason: c.reason } : { id: c.id, node: c.node, check: c.check });
    return out;
  };
  writeJson(path.join(run, 'matrix', 'gaps.json'), { empty: group('empty'), blocked: group('blocked') });
  const pct = r => (r.cells ? Math.round(100 * (r.cells - r.empty) / r.cells) : 100);
  console.log('domain        cells   pass   fail     na blocked  empty  filled');
  for (const [d, r] of [...Object.entries(byDomain), ['TOTAL', totals]])
    console.log(`${d.padEnd(12)} ${[r.cells, r.pass, r.fail, r.na, r.blocked, r.empty].map(n => String(n).padStart(6)).join(' ')}  ${String(pct(r)).padStart(5)}%`);
  const added = all.filter(c => c.check === 'extra').length;
  if (added) console.log(`of which ${added} extra cell(s) added by specialists (X-…), on top of the ${all.length - added} cells of the matrix and wave 2`);
  if (unreadable.length) console.log(`unreadable reports (ignored): ${unreadable.join(', ')}`);
  console.log(`wrote ${path.join(run, 'matrix', 'coverage.json')} and gaps.json`);
  if (totals.empty) { console.log(`${totals.empty} empty cell(s) — see matrix/gaps.json`); process.exit(1); }
}

// ---------------------------------------------------------------- wave2

function wave2(opts) {
  const run = path.resolve(opts.run || fail('--run is required'));
  const cov = readJson(path.join(run, 'matrix', 'coverage.json'));
  const todo = cov.cells.filter(c => c.status === 'empty' || c.status === 'blocked');
  const byAgent = {};
  for (const c of todo) (byAgent[c.agent] ||= []).push({
    id: c.id, node: c.node, kind: c.kind, check: c.check, agent: c.agent, domain: c.domain, dims: c.dims, title: c.title,
    ...(c.status === 'blocked' ? { previous: { status: 'blocked', reason: c.reason, source: c.source } } : {}),
  });
  const dir = path.join(run, 'missions', 'wave2');
  for (const [agent, cells] of Object.entries(byAgent)) {
    const f = path.join(dir, `${agent}.json`);
    const existing = fs.existsSync(f) ? readJson(f).cells || [] : [];
    const ids = new Set(cells.map(c => c.id));
    const merged = [...cells, ...existing.filter(c => !ids.has(c.id))];
    writeJson(f, { agent, domain: CATALOG.specialists[agent]?.domain, wave: 2, cells: merged });
    console.log(`${f}  cells=${merged.length} (empty=${cells.filter(c => !c.previous).length} blocked=${cells.filter(c => c.previous).length})`);
  }
  if (!todo.length) console.log('nothing to retry: no empty or blocked cell');
}

// ---------------------------------------------------------------- status

// Subagents run in the background: a lead can end its turn while its
// specialists still work. Files are the only reliable completion signal.
function status(opts) {
  const run = path.resolve(opts.run || fail('--run is required'));
  const wave = Number(opts.wave || 1);
  const dir = path.join(run, 'missions', 'batches', `w${wave}`);
  const byDomain = new Map();
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort() : []) {
    const m = f.match(/^(.+)-b(\d+)\.json$/);
    if (!m) continue;
    const domain = CATALOG.specialists[m[1]]?.domain || '?';
    const report = path.join(run, 'reports', `${m[1]}-w${wave}-b${m[2]}.json`);
    if (!byDomain.has(domain)) byDomain.set(domain, { done: [], waiting: [] });
    byDomain.get(domain)[fs.existsSync(report) ? 'done' : 'waiting'].push(`${m[1]}-b${m[2]}`);
  }
  const pending = [];
  for (const domain of Object.keys(CATALOG.domains)) {
    const lead = path.join(run, 'leads', wave === 1 ? `${domain}.json` : `${domain}-w2.json`);
    const b = byDomain.get(domain);
    let state = !b ? 'not started' : b.waiting.length ? 'specialists running' : 'to consolidate';
    if (fs.existsSync(lead)) try { readJson(lead); state = 'consolidated'; } catch { state = 'lead file is not valid JSON'; }
    if (state !== 'consolidated' && (b || fs.existsSync(lead))) pending.push(domain);
    console.log(`${domain.padEnd(12)} ${state.padEnd(20)} reports ${b ? b.done.length : 0}/${b ? b.done.length + b.waiting.length : 0}` +
      (b?.waiting.length ? `  missing: ${b.waiting.join(' ')}` : ''));
  }
  console.log(pending.length ? `waiting: ${pending.join(' ')}` : `wave ${wave}: every started domain is consolidated`);
}

// ---------------------------------------------------------------- teardown

// Stops what the run started (the cartographer lists it in started.json, never
// what was already running) and moves back into the run the browser files a
// call made outside $RUN left in the project.
function killTree(pid) {
  const children = new Map();
  for (const line of (spawnSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' }).stdout || '').trim().split('\n')) {
    const [p, pp] = line.trim().split(/\s+/).map(Number);
    if (!children.has(pp)) children.set(pp, []);
    children.get(pp).push(p);
  }
  const tree = [];
  const walk = p => { tree.push(p); for (const c of children.get(p) || []) walk(c); };
  walk(pid);
  let stopped = 0;
  for (const p of tree.reverse()) try { process.kill(p, 'SIGTERM'); stopped++; } catch {}
  return stopped;
}

function teardown(opts) {
  const run = path.resolve(opts.run || fail('--run is required'));
  const meta = fs.existsSync(path.join(run, 'run.json')) ? readJson(path.join(run, 'run.json')) : {};
  const project = meta.project || path.resolve(run, '..', '..', '..');
  const startedFile = path.join(run, 'started.json');
  const started = fs.existsSync(startedFile) ? readJson(startedFile) : [];
  const appPid = path.join(run, 'app.pid');
  if (!started.length && fs.existsSync(appPid)) started.push({ name: 'app', pid: Number(fs.readFileSync(appPid, 'utf8').trim()) });
  let failed = 0;
  // reverse start order: the app goes down before the database it uses
  for (const s of [...started].reverse()) {
    try {
      if (s.stop) {
        execSync(s.stop, { cwd: s.cwd || project, stdio: 'pipe', timeout: 120000 });
        console.log(`stopped ${s.name}: ${s.stop}`);
      } else if (s.pid) {
        const n = killTree(Number(s.pid));
        console.log(n ? `stopped ${s.name}: pid ${s.pid} and ${n - 1} child process(es)` : `${s.name}: pid ${s.pid} was no longer running`);
      } else { console.log(`✗ ${s.name}: neither "pid" nor "stop" in started.json`); failed++; }
    } catch (e) { console.log(`✗ ${s.name}: ${String(e.stderr || e.message).trim().split('\n')[0]}`); failed++; }
  }
  if (!started.length) console.log('nothing to stop: started.json is empty or missing');
  const leak = path.join(project, '.playwright-cli');
  if (fs.existsSync(leak) && !meta.preexisting?.['.playwright-cli']) {
    const dest = path.join(run, 'scratch', 'playwright-cli-outside-run');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    try { fs.renameSync(leak, dest); } catch { fs.cpSync(leak, dest, { recursive: true }); fs.rmSync(leak, { recursive: true, force: true }); }
    console.log(`moved ${leak} into ${dest} (a browser call ran outside $RUN)`);
  }
  if (failed) process.exit(1);
}

// ---------------------------------------------------------------- main

const COMMANDS = { init, discover, 'graph-check': graphCheck, matrix, batches, reports, coverage, wave2, status, teardown };
const opts = parseArgs(process.argv.slice(2));
const cmd = opts._.shift();
if (!COMMANDS[cmd]) {
  console.error('usage: qa.mjs <' + Object.keys(COMMANDS).join('|') + '> … (see the header of this file)');
  process.exit(1);
}
try {
  COMMANDS[cmd](opts);
} catch (e) {
  console.error(`[qa] ${cmd}: ${e.message}`);
  process.exit(1);
}
