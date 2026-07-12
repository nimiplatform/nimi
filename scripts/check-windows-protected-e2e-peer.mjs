#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function validateInteractivePeerResult(result, principalProfile = 'LocalSystem') {
  const failures = [];
  if (result?.status !== 'connected') failures.push('protected connection');
  if (result?.serverVerified !== true) failures.push('Runtime native trust');
  if (!Number.isSafeInteger(result?.serverProcessId) || result.serverProcessId <= 0) failures.push('Runtime process binding');
  if (typeof result?.serverTrustSetId !== 'string' || result.serverTrustSetId.trim() === '') failures.push('Runtime trust set');
  if (result?.serverSettings !== true) failures.push('protected HTTP/2 transport');
  if (result?.clientElevated !== false) failures.push('unelevated interactive caller');
  if (failures.length > 0) {
    throw new Error(`Windows protected interactive peer gate failed: ${failures.join(', ')}`);
  }
  return Object.freeze({
    ...result,
    principalProfile,
    interactivePeerProbeVerified: true,
  });
}

function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error(`Windows protected interactive peer verification is not admitted for ${process.platform}/${process.arch}`);
  }
  const args = process.argv.slice(2);
  const virtualAccount = args.includes('--virtual-account');
  const unknown = args.filter((value) => value !== '--virtual-account');
  if (unknown.length > 0) {
    throw new Error(`unknown Windows protected peer argument: ${unknown[0]}`);
  }
  const variant = virtualAccount ? 'virtual-account' : 'local-system';
  const principalProfile = virtualAccount ? 'VirtualAccount' : 'LocalSystem';
  const pipeName = virtualAccount
    ? String.raw`\\.\pipe\nimi-runtime-e2e-virtual-protected-v1`
    : String.raw`\\.\pipe\nimi-runtime-e2e-protected-v1`;
  const probePath = path.join(
    repoRoot,
    'dist',
    'windows-e2e',
    variant,
    'peer-probe',
    'nimiplatform-desktop-dev-run.exe',
  );
  if (!existsSync(probePath)) {
    throw new Error(`Windows protected peer probe is missing: ${probePath}`);
  }
  const probe = spawnSync(probePath, ['--pipe', pipeName, '--timeout', '10s'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (probe.error) {
    throw new Error(`failed to start Windows protected peer probe: ${probe.error.message}`);
  }
  const output = String(probe.stdout || '').trim();
  if (probe.status !== 0) {
    const detail = [probe.stderr, output].map((value) => String(value || '').trim()).filter(Boolean).join('\n');
    throw new Error(`Windows protected interactive peer probe failed${detail ? `:\n${detail}` : ''}`);
  }
  let result;
  try {
    result = JSON.parse(output);
  } catch (error) {
    throw new Error(`Windows protected interactive peer probe returned invalid JSON: ${error.message}`);
  }
  process.stdout.write(`${JSON.stringify(validateInteractivePeerResult(result, principalProfile))}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
