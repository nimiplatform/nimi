#!/usr/bin/env node
import { createRequire } from 'node:module';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const requireFromDesktop = createRequire(path.join(repoRoot, 'apps', 'desktop', 'package.json'));
const { chromium } = requireFromDesktop('playwright');
const port = Number(process.argv[2]);

if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error('usage: close-electron-observed-app.mjs <cdp-port>');
}

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
try {
  const contexts = browser.contexts();
  if (contexts.length !== 1) throw new Error('observed Electron app must expose exactly one browser context');
  const pages = contexts[0].pages();
  if (pages.length !== 1) throw new Error('observed Electron app must expose exactly one renderer page');
  const session = await contexts[0].newCDPSession(pages[0]);
  await session.send('Browser.close').catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (!/Target page, context or browser has been closed/u.test(message)) throw error;
  });
} finally {
  await browser.close().catch(() => undefined);
}
