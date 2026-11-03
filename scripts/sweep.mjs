#!/usr/bin/env node
// qa-reviewer sweep: visits every route at a given viewport and records what
// the specialists need first (status, console errors, failed requests,
// horizontal overflow, small tap targets, inventory of visible and hidden
// actions, same-origin links, full-page screenshot). `diff` compares a
// desktop and a mobile sweep to find actions not reachable as-is on mobile.
//
//   node sweep.mjs crawl --base http://localhost:3000 --routes routes.json \
//        --viewport desktop|mobile|tablet|small|laptop|wide --out DIR [--storage state.json]
//   node sweep.mjs diff DESKTOP/sweep.json MOBILE/sweep.json [--out diff.json]
//
// Viewports come from references/checks.json. routes.json: ["/", "/login"] or
// [{ "path": "/dashboard", "auth": true }, ...]. Auth routes are visited with
// --storage and also probed anonymously: a 2xx that stays on the same path is
// flagged "suspect".

import fs from 'node:fs';
import path from 'node:path';
import { launchChromium, QA_HOME } from './lib/browser.mjs';

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const VIEWPORTS = JSON.parse(fs.readFileSync(path.join(QA_HOME, 'references', 'checks.json'), 'utf8')).viewports;
function contextOptions(name) {
  const v = VIEWPORTS[name];
  if (!v) throw new Error(`--viewport must be one of ${Object.keys(VIEWPORTS).join(', ')}`);
  const opts = { viewport: { width: v.width, height: v.height }, deviceScaleFactor: v.touch ? 3 : 1 };
  if (v.touch) Object.assign(opts, { isMobile: v.width < 768, hasTouch: true, userAgent: v.width < 768 ? IPHONE_UA : undefined });
  if (!opts.userAgent) delete opts.userAgent;
  return opts;
}

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      opts[k] = v ?? argv[++i];
    } else opts._.push(a);
  }
  return opts;
}

// Runs inside the page. Keep it self-contained (no closures over Node scope).
function inspectPage({ touch }) {
  // With isMobile emulation, innerWidth grows to the overflowing content width
  // (1200 for a 1200px table); clientWidth stays at the device width.
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const norm = s => (s || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const label = el => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    if (typeof el.className === 'string' && el.className.trim()) s += '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.');
    return s;
  };
  const visible = el => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    return el.checkVisibility ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : true;
  };
  const SEL = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=tab], [role=menuitem], [role=checkbox], [role=switch]';
  const visibleActions = [], hiddenActions = [], smallTargets = [];
  for (const el of document.querySelectorAll(SEL)) {
    const name = norm(el.getAttribute('aria-label') || el.innerText || el.value || el.placeholder || el.title || el.getAttribute('name') || el.id);
    if (!name) continue;
    const kind = el.getAttribute('role') || (el.tagName === 'INPUT' ? `input:${el.type}` : el.tagName.toLowerCase());
    if (!visible(el)) { hiddenActions.push({ kind, name }); continue; }
    visibleActions.push({ kind, name });
    if (touch) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const inlineInText = cs.display === 'inline' && el.parentElement &&
        norm(el.parentElement.innerText).length > norm(el.innerText).length + 20;
      if (!inlineInText && (r.width < 44 || r.height < 44)) {
        smallTargets.push({ name, el: label(el), w: Math.round(r.width), h: Math.round(r.height), critical: r.width < 24 || r.height < 24 });
      }
    }
  }
  const scrollWidth = document.documentElement.scrollWidth;
  const offenders = [];
  if (scrollWidth > vw + 1) {
    for (const el of document.body.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.right <= vw + 1 || r.width === 0) continue;
      const pr = el.parentElement && el.parentElement.getBoundingClientRect();
      if (pr && pr.right > vw + 1) continue; // report only the outermost offender
      offenders.push({ el: label(el), right: Math.round(r.right), width: Math.round(r.width) });
      if (offenders.length >= 5) break;
    }
  }
  const links = [...document.querySelectorAll('a[href]')]
    .map(a => { try { const u = new URL(a.href); return u.origin === location.origin ? u.pathname : null; } catch { return null; } })
    .filter(Boolean);
  return {
    title: document.title,
    overflow: scrollWidth > vw + 1 ? { scrollWidth, viewportWidth: vw, offenders } : null,
    smallTargets,
    inventory: { visible: visibleActions, hidden: hiddenActions },
    links: [...new Set(links)],
  };
}

const slug = p => (p === '/' ? 'root' : p.replace(/^\/+/, '').replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 80)) || 'root';

async function visit(context, url, { inspect, touch, screenshot }) {
  const page = await context.newPage();
  const consoleErrors = [], pageErrors = [], failedRequests = [];
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const src = m.location()?.url || '';
    if (/\/favicon\.ico$/.test(src)) return; // browser-level noise, not the app's
    consoleErrors.push((m.text().startsWith('Failed to load resource') && src ? `${m.text()} @ ${src}` : m.text()).slice(0, 300));
  });
  page.on('pageerror', e => pageErrors.push(String(e.message || e).slice(0, 300)));
  page.on('response', r => { if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.request().method()} ${r.url()}`); });
  page.on('requestfailed', r => {
    const why = r.failure()?.errorText || 'failed';
    if (!why.includes('ERR_ABORTED')) failedRequests.push(`${why} ${r.method()} ${r.url()}`);
  });
  let status = null, navError = null;
  try {
    const resp = await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    status = resp ? resp.status() : null;
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  } catch (e) {
    navError = e.message.split('\n')[0];
  }
  const out = { status, finalUrl: page.url(), navError, consoleErrors, pageErrors, failedRequests };
  if (inspect && !navError) Object.assign(out, await page.evaluate(inspectPage, { touch }));
  if (screenshot && !navError) {
    await page.screenshot({ path: screenshot, fullPage: true }).catch(e => { out.screenshotError = e.message; });
    out.screenshot = screenshot;
  }
  await page.close();
  return out;
}

async function crawl(opts) {
  const device = opts.viewport || opts.device || 'desktop';
  const ctxOpts = contextOptions(device);
  if (!opts.base) throw new Error('--base is required');
  const out = path.resolve(opts.out || `sweep-${device}`);
  fs.mkdirSync(out, { recursive: true });
  const routes = (opts.routes ? JSON.parse(fs.readFileSync(opts.routes, 'utf8')) : ['/'])
    .map(r => (typeof r === 'string' ? { path: r } : r));

  const { browser } = await launchChromium();
  const anon = await browser.newContext(ctxOpts);
  const authed = opts.storage ? await browser.newContext({ ...ctxOpts, storageState: opts.storage }) : null;
  const touch = !!ctxOpts.hasTouch;
  const results = [];
  for (const r of routes) {
    const url = new URL(r.path, opts.base).href;
    const ctx = r.auth && authed ? authed : anon;
    const res = { path: r.path, auth: !!r.auth, ...(await visit(ctx, url, { inspect: true, touch, screenshot: path.join(out, `${slug(r.path)}.png`) })) };
    if (r.auth && !authed) res.authSkipped = 'no --storage given: visited anonymously';
    if (r.auth && authed) {
      const probe = await visit(anon, url, {});
      const samePath = new URL(probe.finalUrl).pathname === new URL(url).pathname;
      res.anonProbe = { status: probe.status, finalUrl: probe.finalUrl, suspect: !!(probe.status && probe.status < 400 && samePath) };
    }
    results.push(res);
    const finalPath = res.navError ? null : new URL(res.finalUrl).pathname;
    const flags = [
      `status=${res.status ?? res.navError}`,
      finalPath && finalPath !== new URL(url).pathname && `-> ${finalPath}`,
      res.consoleErrors.length && `console=${res.consoleErrors.length}`,
      res.pageErrors.length && `pageerror=${res.pageErrors.length}`,
      res.failedRequests.length && `failedReq=${res.failedRequests.length}`,
      res.overflow && `overflow=${res.overflow.scrollWidth}>${res.overflow.viewportWidth}`,
      res.smallTargets?.length && `smallTargets=${res.smallTargets.length}`,
      res.anonProbe?.suspect && 'ANON-ACCESS?',
      res.authSkipped && 'auth-skipped',
    ].filter(Boolean).join(' ');
    console.log(`${device.padEnd(8)} ${r.path.padEnd(32)} ${flags}`);
  }
  const listed = new Set(routes.map(r => r.path));
  const unlistedLinks = [...new Set(results.flatMap(r => r.links || []))].filter(p => !listed.has(p)).sort();
  if (unlistedLinks.length) console.log(`unlisted same-origin links (add to routes.json?): ${unlistedLinks.join(' ')}`);
  const file = path.join(out, 'sweep.json');
  fs.writeFileSync(file, JSON.stringify({ viewportName: device, ...ctxOpts, base: opts.base, at: new Date().toISOString(), routes: results, unlistedLinks }, null, 2));
  console.log(`wrote ${file}`);
  await browser.close();
}

function diff(opts) {
  const [dFile, mFile] = opts._;
  if (!dFile || !mFile) throw new Error('usage: diff DESKTOP/sweep.json MOBILE/sweep.json [--out diff.json]');
  const d = JSON.parse(fs.readFileSync(dFile, 'utf8'));
  const m = JSON.parse(fs.readFileSync(mFile, 'utf8'));
  const mByPath = new Map(m.routes.map(r => [r.path, r]));
  const routes = [];
  for (const dr of d.routes) {
    const mr = mByPath.get(dr.path);
    if (!dr.inventory || !mr?.inventory) { routes.push({ path: dr.path, error: 'missing inventory on one side' }); continue; }
    const mVisible = new Set(mr.inventory.visible.map(a => a.name));
    const mHidden = new Set(mr.inventory.hidden.map(a => a.name));
    const seen = new Set();
    const missing = [];
    for (const a of dr.inventory.visible) {
      if (mVisible.has(a.name) || seen.has(a.name)) continue;
      seen.add(a.name);
      // hidden-in-dom: probably behind a menu/drawer, verify a toggle opens it.
      // absent: not rendered on mobile at all.
      missing.push({ ...a, onMobile: mHidden.has(a.name) ? 'hidden-in-dom' : 'absent' });
    }
    if (missing.length) routes.push({ path: dr.path, missingOnMobile: missing });
  }
  for (const r of routes) {
    if (r.error) console.log(`${r.path.padEnd(32)} ${r.error}`);
    else console.log(`${r.path.padEnd(32)} ${r.missingOnMobile.map(a => `"${a.name}"(${a.onMobile})`).join(', ')}`);
  }
  if (!routes.length) console.log('no desktop action missing on mobile');
  if (opts.out) { fs.writeFileSync(opts.out, JSON.stringify({ desktop: dFile, mobile: mFile, routes }, null, 2)); console.log(`wrote ${opts.out}`); }
}

const opts = parseArgs(process.argv.slice(2));
const cmd = opts._.shift();
try {
  if (cmd === 'crawl') await crawl(opts);
  else if (cmd === 'diff') diff(opts);
  else { console.error('usage: sweep.mjs crawl|diff ... (see header of this file)'); process.exit(1); }
} catch (e) {
  console.error(`[sweep] ${e.message}`);
  process.exit(1);
}
