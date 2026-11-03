// Finds a usable Playwright + Chromium for sweep.mjs and doctor.mjs.
// Order: the tested project's Playwright, qa-reviewer's own node_modules
// (directly or nested under @playwright/cli), then a global @playwright/cli.
// For each, the bundled Chromium, then installed Chrome / Edge (the bundled
// build is often missing or a revision behind the cache).

import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const QA_HOME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function bases() {
  const list = [
    path.join(process.cwd(), '/'),
    path.join(QA_HOME, '/'),
    path.join(QA_HOME, 'node_modules', '@playwright', 'cli', '/'),
  ];
  try {
    list.push(path.join(execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(), '@playwright', 'cli', '/'));
  } catch {}
  return list;
}

const CHANNELS = [undefined, 'chrome', 'msedge'];

export async function launchChromium({ quiet = false } = {}) {
  const errors = [];
  for (const base of bases()) {
    for (const name of ['playwright', '@playwright/test', 'playwright-core']) {
      let pw;
      try { pw = createRequire(base)(name); } catch { continue; }
      for (const channel of CHANNELS) {
        try {
          const browser = await pw.chromium.launch({ headless: true, channel });
          if (!quiet) console.error(`[browser] ${name} from ${base}, channel=${channel ?? 'bundled'}`);
          return { browser, name, base, channel: channel ?? 'bundled' };
        } catch (e) {
          errors.push(`${name} from ${base} (${channel ?? 'bundled'}): ${e.message.split('\n')[0]}`);
        }
      }
    }
  }
  const err = new Error('no usable Playwright/Chromium found.\n  ' + errors.join('\n  ') +
    `\n  Fix: cd ${QA_HOME} && npm install && npx playwright install chromium`);
  err.code = 'NO_BROWSER';
  throw err;
}
