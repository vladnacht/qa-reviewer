#!/usr/bin/env node
// qa-reviewer environment check. Installs what is missing on first use (npm
// packages, then Chromium when no browser can be launched), prints the
// variables the agents need (QA_HOME, PWCLI, AXE) and exits 1 with the fix
// when something is still missing.
//
//   node doctor.mjs [--no-install]

import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import { launchChromium, QA_HOME } from './lib/browser.mjs';

const install = !process.argv.includes('--no-install');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const setup = (cmd, args, what) => {
  console.log(`… ${what}`);
  const r = spawnSync(cmd, args, { cwd: QA_HOME, stdio: ['ignore', 'ignore', 'inherit'], shell: process.platform === 'win32' });
  return r.status === 0;
};

// a plugin is installed without its node_modules: fetch them once
if (install && !fs.existsSync(path.join(QA_HOME, 'node_modules', '@playwright', 'cli')))
  setup(npm, [fs.existsSync(path.join(QA_HOME, 'package-lock.json')) ? 'ci' : 'install', '--no-audit', '--no-fund'], 'installing npm packages (first run)');

const problems = [];
const ok = msg => console.log(`✓ ${msg}`);
const ko = (msg, fix) => { console.log(`✗ ${msg}`); problems.push(fix); };

const [major] = process.versions.node.split('.').map(Number);
if (major >= 18) ok(`node ${process.versions.node}`);
else ko(`node ${process.versions.node} (18 or later required)`, 'install Node.js 18 or later');

let pwcli = path.join(QA_HOME, 'node_modules', '.bin', 'playwright-cli');
if (!fs.existsSync(pwcli)) {
  try { pwcli = execSync('command -v playwright-cli', { shell: '/bin/sh', stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { pwcli = ''; }
}
if (pwcli) {
  try { ok(`playwright-cli ${execSync(`"${pwcli}" --version`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()} (${pwcli})`); }
  catch { ko(`playwright-cli found but not runnable: ${pwcli}`, `cd "${QA_HOME}" && npm install`); }
} else ko('playwright-cli not found', `cd "${QA_HOME}" && npm install`);

const axe = path.join(QA_HOME, 'node_modules', 'axe-core', 'axe.min.js');
if (fs.existsSync(axe)) ok(`axe-core (${axe})`);
else ko('axe-core missing (accessibility checks will be blocked)', `cd "${QA_HOME}" && npm install`);

const playwrightBin = path.join(QA_HOME, 'node_modules', '.bin', 'playwright');
let launched = false;
for (let attempt = 0; attempt < 2 && !launched; attempt++) {
  try {
    const { browser, name, channel } = await launchChromium({ quiet: true });
    ok(`browser: ${name}, channel=${channel}`);
    await browser.close();
    launched = true;
  } catch (e) {
    // no Chrome, Edge or bundled Chromium: download Chromium once, then retry
    if (attempt === 0 && install && e.code === 'NO_BROWSER' && fs.existsSync(playwrightBin)
      && setup(playwrightBin, ['install', 'chromium'], 'downloading Chromium (first run, about a minute)')) continue;
    ko('no browser can be launched', e.code === 'NO_BROWSER' ? `cd "${QA_HOME}" && npm install && npx playwright install chromium` : e.message);
    break;
  }
}

console.log(`QA_HOME=${QA_HOME}`);
if (pwcli) console.log(`PWCLI=${pwcli}`);
if (fs.existsSync(axe)) console.log(`AXE=${axe}`);
if (problems.length) {
  console.log('\nTo fix:\n' + [...new Set(problems)].map(p => `  ${p}`).join('\n'));
  process.exit(1);
}
