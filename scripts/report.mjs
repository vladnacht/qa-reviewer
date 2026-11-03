#!/usr/bin/env node
// Builds the PDF report of a run: summary tables first, then one page section
// per issue with its annotated figure and legend, its reproduction and, when
// screencaster recorded one, its demo video. Everything is read from files the
// run already wrote, so the PDF never says more than consolidated.json.
//
//   node report.mjs --run RUN [--out DIR] [--depth quick] [--base-url URL] [--no-pdf]
//
// Inputs: $RUN/consolidated.json, $RUN/matrix/coverage.json,
//         $RUN/figures/<ID>.json (qa-illustrator), $RUN/videos/<ID>.json (qa-videographer).
// Output: <DIR>/qa-report-<project>-<RUN_ID>.pdf, and the videos next to it in
//         <DIR>/qa-report-<project>-<RUN_ID>-videos/. DIR defaults to the
//         Downloads folder (see downloadsDir).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { launchChromium } from './lib/browser.mjs';

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const fail = msg => { console.error(msg); process.exit(2); };
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const readIf = f => (fs.existsSync(f) ? readJson(f) : null);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// QA_REVIEWER_OUTPUT_DIR, then the system's Downloads folder whatever its
// display name (Téléchargements on a French desktop), created if missing.
export function downloadsDir(env = process.env, home = os.homedir()) {
  if (env.QA_REVIEWER_OUTPUT_DIR) return path.resolve(env.QA_REVIEWER_OUTPUT_DIR);
  if (process.platform === 'linux') {
    try {
      const d = execSync('xdg-user-dir DOWNLOAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      if (d && d !== home && fs.existsSync(d)) return d;
    } catch {}
  }
  for (const name of ['Downloads', 'Téléchargements']) if (fs.existsSync(path.join(home, name))) return path.join(home, name);
  return path.join(home, 'Downloads');
}

const DOMAINS = { functional: 'Fonctionnel', ui: 'UI', ux: 'UX', bugs: 'Bugs', responsive: 'Responsive' };
const SEVERITY = { P0: 'Bloquant', P1: 'Majeur', P2: 'Mineur', P3: 'Cosmétique' };
const STATUS = { confirmed: 'Confirmé', plausible: 'Plausible' };

function main() {
  const run = path.resolve(opt('run') || fail('usage: report.mjs --run RUN [--out DIR] [--depth D] [--base-url URL] [--no-pdf]'));
  const cons = readIf(path.join(run, 'consolidated.json')) || fail(`no consolidated.json in ${run}`);
  const meta = readIf(path.join(run, 'run.json')) || {};
  const project = meta.project || path.resolve(run, '..', '..', '..');
  const runId = cons.run_id || meta.run_id || path.basename(run);
  const name = path.basename(project);
  const cov = readIf(path.join(run, 'matrix', 'coverage.json'));
  const issues = [...(cons.issues || [])].sort((a, b) => a.severity.localeCompare(b.severity) || a.id.localeCompare(b.id));
  const outDir = path.resolve(opt('out') || downloadsDir());
  const base = `qa-report-${name}-${runId}`;
  const pdf = path.join(outDir, `${base}.pdf`);
  const videoDir = path.join(outDir, `${base}-videos`);

  // a file cited by an agent may be relative to the run or to the project
  const resolve = ref => {
    if (!ref) return null;
    for (const p of [ref, path.join(run, ref), path.join(project, ref)]) if (path.isAbsolute(p) && fs.existsSync(p)) return p;
    return null;
  };
  const figures = {}, videos = {};
  for (const i of issues) {
    const f = readIf(path.join(run, 'figures', `${i.id}.json`));
    if (f && resolve(f.path)) figures[i.id] = { ...f, file: resolve(f.path), annotated: true };
    else {
      const shot = (i.evidence || []).map(e => (e.kind === 'screenshot' ? resolve(e.ref) : null)).find(Boolean);
      if (shot) figures[i.id] = { file: shot, annotated: false, caption: f?.caption };
    }
    const v = readIf(path.join(run, 'videos', `${i.id}.json`));
    if (v && resolve(v.path)) {
      fs.mkdirSync(videoDir, { recursive: true });
      const dest = path.join(videoDir, `${i.id}-${path.basename(v.path)}`);
      fs.copyFileSync(resolve(v.path), dest);
      videos[i.id] = { ...v, file: dest, poster: resolve(v.poster) };
    }
  }

  const sevCount = list => Object.fromEntries(Object.keys(SEVERITY).map(s => [s, list.filter(i => i.severity === s).length]));
  const totals = sevCount(issues);
  const chip = s => `<span class="chip ${s}">${s}</span>`;
  const pct = r => (r && r.cells ? `${Math.round((100 * (r.cells - r.empty - r.blocked)) / r.cells)} %` : '—');

  const domainRows = Object.entries(DOMAINS).map(([d, label]) => {
    const r = cov?.by_domain?.[d];
    const mine = issues.filter(i => (i.domains || []).includes(d));
    const c = sevCount(mine);
    return `<tr><td>${label}</td><td>${r?.cells ?? '—'}</td><td>${r?.pass ?? '—'}</td><td>${r?.fail ?? '—'}</td><td>${pct(r)}</td>` +
      Object.keys(SEVERITY).map(s => `<td class="n ${c[s] ? s : ''}">${c[s] || ''}</td>`).join('') + `<td><b>${mine.length}</b></td></tr>`;
  }).join('');
  const t = cov?.totals;
  const domainTotal = `<tr class="total"><td>Total</td><td>${t?.cells ?? '—'}</td><td>${t?.pass ?? '—'}</td><td>${t?.fail ?? '—'}</td><td>${pct(t)}</td>` +
    Object.keys(SEVERITY).map(s => `<td class="n">${totals[s] || ''}</td>`).join('') + `<td><b>${issues.length}</b></td></tr>`;

  const screens = list => (list || []).length > 2 ? `${list.slice(0, 2).join(', ')} +${list.length - 2}` : (list || []).join(', ');
  const issueRows = issues.map(i => `<tr><td class="id"><a href="#${esc(i.id)}">${esc(i.id)}</a></td><td>${chip(i.severity)}</td><td>${esc(i.title)}</td>` +
    `<td>${esc((i.domains || []).map(d => DOMAINS[d] || d).join(', '))}</td><td class="small">${esc(screens(i.nodes))}</td>` +
    `<td class="small">${esc((i.viewports || []).join(', ') || '—')}</td><td class="c">${figures[i.id] ? (figures[i.id].annotated ? '▣' : '□') : '—'}</td>` +
    `<td class="c">${videos[i.id] ? '▶' : '—'}</td><td class="small">${STATUS[i.status] || esc(i.status)}</td></tr>`).join('');

  const evidenceText = i => (i.evidence || []).filter(e => e.kind !== 'screenshot').slice(0, 4).map(e =>
    `<div class="ev"><span class="kind">${esc(e.kind)}</span> <code>${esc(String(e.ref).slice(0, 300))}</code>${e.excerpt ? `<pre>${esc(String(e.excerpt).slice(0, 600))}</pre>` : ''}</div>`).join('');

  let figNo = 0;
  const details = issues.map(i => {
    const f = figures[i.id], v = videos[i.id];
    let figure = '';
    if (f) {
      figNo++;
      const legend = f.annotated && f.marks?.length
        ? `<ol class="legend">${f.marks.map(m => `<li value="${esc(m.n)}">${esc(m.label)}</li>`).join('')}</ol>` : '';
      const caption = f.annotated ? (f.caption || i.title) : `Capture d'origine, non annotée${f.caption ? ` : ${f.caption}` : ''}`;
      figure = `<figure><img src="${pathToFileURL(f.file)}"><figcaption><b>Figure ${figNo}</b> · ${esc(i.id)}${f.viewport ? ` · ${esc(f.viewport)}` : ''} — ${esc(caption)}</figcaption>${legend}</figure>`;
    }
    const video = v ? `<div class="video">${v.poster ? `<img src="${pathToFileURL(v.poster)}">` : ''}<div><b>Vidéo de démonstration</b>` +
      `${v.duration_sec ? ` · ${Math.round(v.duration_sec)} s` : ''}<br><a href="${pathToFileURL(v.file)}">${esc(path.basename(v.file))}</a>` +
      `<br><span class="small">dans ${esc(path.basename(videoDir))}/, à côté de ce PDF</span></div></div>` : '';
    return `<section class="issue" id="${esc(i.id)}"><h3>${chip(i.severity)} ${esc(i.id)} — ${esc(i.title)}</h3>
<p class="meta">${esc(SEVERITY[i.severity])} · ${esc((i.domains || []).map(d => DOMAINS[d] || d).join(', '))} · ${esc((i.nodes || []).join(', '))}${i.viewports?.length ? ` · ${esc(i.viewports.join(', '))}` : ''} · ${STATUS[i.status] || esc(i.status)}</p>
${figure}${video}
<table class="kv"><tr><th>Reproduction</th><td><ol>${(i.repro || []).map(s => `<li>${esc(s)}</li>`).join('')}</ol></td></tr>
<tr><th>Attendu</th><td>${esc(i.expected)}</td></tr><tr><th>Obtenu</th><td>${esc(i.actual)}</td></tr>
${i.cause ? `<tr><th>Cause</th><td>${esc(i.cause)}</td></tr>` : ''}
${i.verification ? `<tr><th>Vérification</th><td>${esc(i.verification)}</td></tr>` : ''}
${i.retest ? `<tr><th>Re-test</th><td>${esc(i.retest)}</td></tr>` : ''}</table>
${evidenceText(i) ? `<div class="evs">${evidenceText(i)}</div>` : ''}</section>`;
  }).join('\n');

  const systemic = (cons.systemic || []).map(s => `<li><b>${esc(s.title)}</b>${s.merged_from ? ` <span class="small">(${esc(s.merged_from.join(', '))})</span>` : ''}</li>`).join('');
  const notCovered = (cons.not_covered || []).map(n => `<tr><td>${esc(n.area)}</td><td>${esc(n.reason)}</td><td>${esc(n.todo)}</td></tr>`).join('');
  const rejected = (cons.rejected || []).map(r => `<tr><td>${esc(r.finding)}</td><td>${esc(r.reason)}</td></tr>`).join('');
  const date = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Recette QA — ${esc(name)}</title><style>
@page { size: A4; margin: 16mm 14mm 18mm }
* { box-sizing: border-box }
body { font: 10pt/1.45 -apple-system, "Segoe UI", system-ui, sans-serif; color: #1c1f24; margin: 0 }
h1 { font-size: 20pt; margin: 0 0 2mm } h2 { font-size: 13pt; margin: 8mm 0 3mm; padding-bottom: 1.5mm; border-bottom: 2px solid #1c1f24 }
h3 { font-size: 11.5pt; margin: 0 0 1mm } .sub { color: #5b6370; margin: 0 0 5mm }
.kpis { display: flex; gap: 3mm; margin: 4mm 0 } .kpi { flex: 1; border-radius: 3mm; padding: 3mm; color: #fff }
.kpi b { display: block; font-size: 18pt; line-height: 1.1 } .kpi.P0, .chip.P0 { background: #b42318 } .kpi.P1, .chip.P1 { background: #e5532a }
.kpi.P2, .chip.P2 { background: #d4a20a } .kpi.P3, .chip.P3 { background: #6b7280 } .kpi.all { background: #1c1f24 }
table { width: 100%; border-collapse: collapse; margin: 2mm 0 } th, td { border: 1px solid #d5d9e0; padding: 1.4mm 2mm; text-align: left; vertical-align: top }
thead th { background: #eef1f5; font-size: 8.5pt } tr { break-inside: avoid } td.n, td.c { text-align: center } td.n.P0, td.n.P1 { color: #b42318; font-weight: 700 }
td.id { white-space: nowrap } table.issues { font-size: 9pt } tr.total td { background: #f6f7f9; font-weight: 600 } .small { font-size: 8.5pt; color: #4a515c } a { color: #1d4ed8; text-decoration: none }
.chip { display: inline-block; color: #fff; border-radius: 1.2mm; padding: 0 1.6mm; font-size: 8.5pt; font-weight: 700 }
.issue { break-before: page } .issue:first-of-type { break-before: auto } .meta { color: #5b6370; margin: 0 0 3mm; font-size: 9pt }
figure { margin: 0 0 3mm; border: 1px solid #d5d9e0; border-radius: 2mm; padding: 2mm; break-inside: avoid }
figure img { display: block; max-width: 100%; max-height: 120mm; margin: 0 auto; border: 1px solid #eef1f5 }
figcaption { font-size: 9pt; margin-top: 2mm } .legend { margin: 1.5mm 0 0; padding-left: 0; list-style: none; counter-reset: none; font-size: 9pt }
.legend li { display: flex; gap: 2mm; margin: .8mm 0 } .legend li::before { content: attr(value); flex: none; width: 5mm; height: 5mm; border-radius: 50%; background: #e5283a; color: #fff; font-weight: 700; font-size: 8pt; text-align: center; line-height: 5mm }
.kv th { width: 26mm; background: #f6f7f9; font-size: 9pt } .kv ol { margin: 0; padding-left: 4.5mm }
.video { display: flex; gap: 3mm; align-items: center; border: 1px solid #d5d9e0; border-radius: 2mm; padding: 2mm; margin: 0 0 3mm; break-inside: avoid }
.video img { max-width: 45mm; max-height: 45mm; object-fit: contain; border-radius: 1mm; border: 1px solid #eef1f5 } .evs { margin-top: 2mm } .ev { margin: 1mm 0; font-size: 8.5pt }
.ev .kind { display: inline-block; background: #eef1f5; border-radius: 1mm; padding: 0 1.4mm; font-weight: 600 }
code, pre { font: 8pt/1.35 ui-monospace, Menlo, monospace } pre { white-space: pre-wrap; background: #f6f7f9; padding: 1.5mm 2mm; border-radius: 1mm; margin: 1mm 0 0 }
.legend-scale td:first-child { width: 14mm; text-align: center }
</style></head><body>
<h1>Recette QA — ${esc(name)}</h1>
<p class="sub">Run ${esc(runId)} · ${esc(date)}${opt('depth') ? ` · profondeur ${esc(opt('depth'))}` : ''}${opt('base-url') ? ` · ${esc(opt('base-url'))}` : ''} · rapport qa-reviewer</p>
<div class="kpis"><div class="kpi all"><b>${issues.length}</b>problèmes</div>${Object.keys(SEVERITY).map(s => `<div class="kpi ${s}"><b>${totals[s]}</b>${s} · ${SEVERITY[s]}</div>`).join('')}</div>
<h2>Synthèse par domaine</h2>
<table><thead><tr><th>Domaine</th><th>Cases</th><th>Conformes</th><th>En défaut</th><th>Couvertes</th>${Object.keys(SEVERITY).map(s => `<th>${s}</th>`).join('')}<th>Problèmes</th></tr></thead>
<tbody>${domainRows}${domainTotal}</tbody></table>
<p class="small">Un problème qui touche plusieurs domaines est compté dans chacun ; la ligne Total les compte une fois. « Couvertes » : cases testées (conformes, en défaut ou sans objet), hors bloquées.</p>
<h2>Tous les problèmes</h2>
<table class="issues"><thead><tr><th>ID</th><th>Prio</th><th>Problème</th><th>Domaines</th><th>Écran</th><th>Viewports</th><th>Capture</th><th>Vidéo</th><th>Statut</th></tr></thead><tbody>${issueRows}</tbody></table>
<p class="small">Capture : ▣ annotée (défaut encadré et légendé) · □ capture d'origine · — preuve sans image (commande, code). Vidéo : ▶ démonstration enregistrée avec screencaster.</p>
<table class="legend-scale"><tbody>${Object.entries(SEVERITY).map(([s, l]) => `<tr><td>${chip(s)}</td><td><b>${l}</b></td></tr>`).join('')}</tbody></table>
${systemic ? `<h2>Problèmes systémiques</h2><ul>${systemic}</ul>` : ''}
<h2>Détail des problèmes</h2>
${details}
${notCovered ? `<h2 style="break-before:page">Non couvert</h2><table><thead><tr><th>Zone</th><th>Raison</th><th>Ce qu'il faudrait</th></tr></thead><tbody>${notCovered}</tbody></table>` : ''}
${rejected ? `<h2>Rejetés par le contrôleur</h2><table><thead><tr><th>Finding</th><th>Raison</th></tr></thead><tbody>${rejected}</tbody></table>` : ''}
</body></html>`;

  const htmlFile = path.join(run, 'report.html');
  fs.writeFileSync(htmlFile, html);
  console.log(`html: ${htmlFile}`);
  console.log(`figures: ${Object.values(figures).filter(f => f.annotated).length} annotated, ${Object.values(figures).filter(f => !f.annotated).length} original, ${issues.length - Object.keys(figures).length} without image · videos: ${Object.keys(videos).length}`);
  if (args.includes('--no-pdf')) return;
  return printPdf(htmlFile, pdf, name, runId).then(() => {
    console.log(`pdf: ${pdf}`);
    if (Object.keys(videos).length) console.log(`videos: ${videoDir}`);
  });
}

async function printPdf(htmlFile, pdf, name, runId) {
  fs.mkdirSync(path.dirname(pdf), { recursive: true });
  const { browser } = await launchChromium({ quiet: true });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(htmlFile).href, { waitUntil: 'load' });
    await page.pdf({
      path: pdf, format: 'A4', printBackground: true, displayHeaderFooter: true, preferCSSPageSize: true,
      headerTemplate: '<span></span>',
      footerTemplate: `<div style="width:100%;font-size:7pt;color:#8a919c;padding:0 14mm;display:flex;justify-content:space-between">` +
        `<span>Recette QA — ${esc(name)} — ${esc(runId)}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
    });
  } finally { await browser.close(); }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  Promise.resolve(main()).catch(e => { console.error(e.message); process.exit(1); });
}
