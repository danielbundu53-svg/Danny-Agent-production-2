/* Shared by the browser tests: starts a private copy of the site and opens Chromium. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const { chromium } = require('playwright-core');
const { readConfig } = require('../server/config');
const { createLogger } = require('../server/logger');
const { createApp } = require('../server/app');

export const ADMIN_KEY = 'browser-test-key-0123456789abcdef';

function findChromium() {
  const candidates = [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
  const found = candidates.find(p => p && fs.existsSync(p));
  return found; // undefined lets Playwright use its own download, if any
}

export async function startSite({ env = {}, fetchImpl } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-browser-'));
  const config = readConfig({ NODE_ENV: 'test', DATABASE_PATH: path.join(tmp, 'b.sqlite'), ADMIN_KEY, ...env });
  const quiet = { log() {}, error() {} };
  const made = await createApp(config, { log: createLogger({ level: 'error', out: quiet }), fetchImpl });
  const server = await new Promise(resolve => { const s = made.app.listen(0, () => resolve(s)); });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    db: made.db,
    async stop() {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      await made.db.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  };
}

export async function openBrowser() {
  return chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] });
}

export const shotsDir = path.join(here, 'shots');

/* Collects everything that goes wrong on a page */
export function watchPage(page) {
  const problems = [];
  page.on('console', msg => { if (msg.type() === 'error' || msg.type() === 'warning') problems.push(`console ${msg.type()}: ${msg.text()}`); });
  page.on('pageerror', err => problems.push(`script error: ${err.message}`));
  page.on('requestfailed', req => problems.push(`request failed: ${req.url()} ${req.failure() && req.failure().errorText}`));
  page.on('response', res => {
    if (res.status() >= 400 && !res.url().includes('/api/')) problems.push(`HTTP ${res.status()}: ${res.url()}`);
  });
  return problems;
}
