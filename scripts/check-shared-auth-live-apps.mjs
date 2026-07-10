#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const manifestRelativePath = '.nimi/local/evidence/runtime-shared-auth-broker/live-apps.json';
const manifestPath = path.join(root, manifestRelativePath);
const requiredApps = [
  'desktop',
  'tester-tauri',
  'tester-electron',
  'avatar-electron',
  'zhiyu-electron',
];

function fail(message) {
  throw new Error(`shared-auth live apps gate failed: ${message}`);
}

function requireArtifact(relativePath, label) {
  const normalized = String(relativePath || '').trim();
  if (!normalized) fail(`${label} path is missing`);
  const absolute = path.resolve(root, normalized);
  if (!absolute.startsWith(path.resolve(root) + path.sep)) fail(`${label} escapes the repository`);
  if (!existsSync(absolute)) fail(`${label} does not exist: ${normalized}`);
}

if (!existsSync(manifestPath)) {
  fail(`missing ${manifestRelativePath}; run real-shell shared-auth acceptance before closeout`);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest.schemaVersion !== 1 || manifest.authority !== 'runtime-shared-auth-broker') {
  fail('manifest schema or authority is invalid');
}
const reports = new Map((manifest.apps ?? []).map((report) => [report.id, report]));
for (const appId of requiredApps) {
  const report = reports.get(appId);
  if (!report) fail(`missing live report for ${appId}`);
  for (const state of ['success', 'failure', 'disabled', 'denied']) {
    if (report.states?.[state]?.observed !== true) fail(`${appId} lacks observed ${state} state`);
  }
  if (report.runtimeConnectivity?.passed !== true) fail(`${appId} Runtime/auth/SDK connectivity did not pass`);
  if (report.primaryPath?.passed !== true) fail(`${appId} primary interaction path did not pass`);
  if (report.accessibility?.passed !== true) fail(`${appId} accessibility audit did not pass`);
  if (report.layout?.desktopPassed !== true || report.layout?.narrowPassed !== true) {
    fail(`${appId} desktop/narrow layout acceptance is incomplete`);
  }
  if (report.chineseReadability?.passed !== true || report.longText?.passed !== true) {
    fail(`${appId} Chinese or long-text acceptance is incomplete`);
  }
  if (report.tokenLeak?.passed !== true || (report.tokenLeak?.findings ?? []).length !== 0) {
    fail(`${appId} token leak probe did not pass cleanly`);
  }
  if ((report.consoleErrors ?? []).length !== 0 || (report.pageErrors ?? []).length !== 0) {
    fail(`${appId} has console or page errors`);
  }
  if (!Array.isArray(report.domAssertions) || report.domAssertions.length === 0) {
    fail(`${appId} lacks DOM/CDP assertions`);
  }
  requireArtifact(report.screenshots?.desktop, `${appId} desktop screenshot`);
  requireArtifact(report.screenshots?.narrow, `${appId} narrow screenshot`);
  requireArtifact(report.reportPath, `${appId} detailed report`);
}

process.stdout.write(`shared-auth live apps gate passed (${requiredApps.length} shell reports)\n`);
