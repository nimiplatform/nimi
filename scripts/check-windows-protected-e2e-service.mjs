#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const installer = path.join(repoRoot, 'scripts', 'install-windows-protected-e2e.ps1');

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error(`Windows protected E2E service verification is not admitted for ${process.platform}/${process.arch}`);
}

const result = spawnSync('powershell.exe', [
  '-NoProfile',
  '-ExecutionPolicy',
  'Bypass',
  '-File',
  installer,
  '-Mode',
  'Status',
  '-Json',
], {
  cwd: repoRoot,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});
if (result.error) {
  throw new Error(`failed to start Windows protected E2E status probe: ${result.error.message}`);
}
if (result.status !== 0) {
  throw new Error(`Windows protected E2E status probe failed: ${String(result.stderr || result.stdout).trim()}`);
}

let status;
try {
  status = JSON.parse(String(result.stdout || ''));
} catch (error) {
  throw new Error(`Windows protected E2E status probe returned invalid JSON: ${error.message}`);
}

const failures = [];
if (status.serviceName !== 'NimiRuntimeE2E' || status.nonProduct !== true) failures.push('fixture identity');
if (status.state !== 'running' || !Number.isSafeInteger(status.processId) || status.processId <= 0) failures.push('live SCM process');
if (status.startMode !== 'Manual' || status.serviceAccountMatches !== true) failures.push('fixed SCM definition');
if (status.serviceSidMatches !== true || status.restrictedSid !== true) failures.push('restricted service SID');
if (status.binaryPathMatches !== true || status.signatureStatus !== 'Valid') failures.push('signed Runtime binary');
if (status.stateRootExists !== true) failures.push('protected state root');
if (status.desktopPipePresent !== true || status.installedPipePresent !== true) failures.push('protected native listeners');
if (failures.length > 0) {
  throw new Error(`Windows protected E2E service gate failed: ${failures.join(', ')}\n${JSON.stringify(status)}`);
}

process.stdout.write(`${JSON.stringify(status)}\n`);
