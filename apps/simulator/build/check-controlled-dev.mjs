#!/usr/bin/env node

import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { sha256Digest } from '@nimiplatform/app-tools/simulator-conformance';

import { startControlledDevSession } from './dev-controlled-browser.mjs';
import { REPO_ROOT } from './paths.mjs';

const receiptPaths = [
  path.join(REPO_ROOT, '.nimi', 'local', 'state', 'simulator-cp5-z', 'qualification.json'),
  path.join(REPO_ROOT, '.nimi', 'local', 'state', 'simulator-cp6', 'qualification.json'),
];

function receiptState(filePath) {
  if (!existsSync(filePath)) return { exists: false };
  const stat = statSync(filePath);
  return {
    exists: true,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    digest: sha256Digest(readFileSync(filePath)),
  };
}

const before = receiptPaths.map(receiptState);
const session = await startControlledDevSession({ headless: true, watch: false });
try {
  const csp = await session.page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  if (!csp || !/(?:^|;)\s*connect-src\s+'none'\s*(?:;|$)/u.test(csp)) {
    throw new Error(`SIM_DEV_CSP_FLOOR_MISSING:${JSON.stringify(csp)}`);
  }
  if (session.diagnostics.length !== 0) {
    throw new Error(`SIM_DEV_BROWSER_DIAGNOSTICS:${JSON.stringify(session.diagnostics)}`);
  }
  const viteClientResources = await session.page.evaluate(() => performance
    .getEntriesByType('resource')
    .map((entry) => entry.name)
    .filter((name) => name.includes('/@vite/client')));
  if (viteClientResources.length !== 0) {
    throw new Error(`SIM_DEV_VITE_CLIENT_REQUEST:${JSON.stringify(viteClientResources)}`);
  }
  const instanceCount = Number(
    await session.page.locator('.simulator-shell').getAttribute('data-usable-active-instance-count'),
  );
  if (!Number.isSafeInteger(instanceCount) || instanceCount <= 0) {
    throw new Error(`SIM_DEV_INSTANCE_COUNT_INVALID:${JSON.stringify(instanceCount)}`);
  }
  if (session.traces.evidence.length !== instanceCount * 2
    || session.traces.evidence.some((row) => row.ok !== true)) {
    throw new Error(`SIM_DEV_INITIAL_RESET_TRACE_EVIDENCE:${JSON.stringify(session.traces.evidence)}`);
  }
  await session.reload('<acceptance-reload>');
  if (session.traces.evidence.length !== instanceCount * 3
    || session.traces.evidence.some((row) => row.ok !== true)) {
    throw new Error(`SIM_DEV_RELOAD_TRACE_EVIDENCE:${JSON.stringify(session.traces.evidence)}`);
  }
} finally {
  await session.close('acceptance-complete');
}

const after = receiptPaths.map(receiptState);
if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error('SIM_DEV_FORMAL_RECEIPT_MUTATED');
process.stdout.write(`simulator-controlled-dev: OK (${session.traces.evidence.length} trace windows across initial load, reset, and controlled reload; no formal receipt writes)\n`);
