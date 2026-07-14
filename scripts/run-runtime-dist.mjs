#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const distDir = path.join(repoRoot, 'dist');
const binaryName = process.platform === 'win32' ? 'nimi.exe' : 'nimi';
const binaryPath = path.join(distDir, binaryName);
const windowsDevSigningScript = path.join(repoRoot, 'scripts', 'lib', 'windows-dev-signing.ps1');
const rootEnvPath = path.join(repoRoot, '.env');
const devAppRegistryPath = path.join(repoRoot, '.nimi', 'spec', 'platform', 'kernel', 'tables', 'nimi-app-registry.yaml');

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
    return null;
  }
  const separatorIndex = trimmed.indexOf('=');
  const key = trimmed.slice(0, separatorIndex).trim();
  let value = trimmed.slice(separatorIndex + 1).trim();
  if (!key) {
    return null;
  }
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return { key, value };
}

function applyRootRuntimeEnv(env) {
  if (fs.existsSync(rootEnvPath)) {
    const raw = fs.readFileSync(rootEnvPath, 'utf8');
    for (const line of raw.split(/\r?\n/u)) {
      const parsed = parseEnvLine(line);
      if (!parsed) {
        continue;
      }
      const shouldApply = parsed.key.startsWith('NIMI_') || parsed.key.startsWith('VITE_NIMI_');
      if (shouldApply) {
        env[parsed.key] = parsed.value;
      } else if (env[parsed.key] == null) {
        env[parsed.key] = parsed.value;
      }
    }
  }
  if (!String(env.NIMI_RUNTIME_APP_REGISTRY_PATH || '').trim() && fs.existsSync(devAppRegistryPath)) {
    env.NIMI_RUNTIME_APP_REGISTRY_PATH = devAppRegistryPath;
  }
  return env;
}

function shouldRunWindowsSigningDiagnostic(error, detail) {
  if (process.platform !== 'win32') {
    return false;
  }
  const errorCode = String(error?.code || '').toUpperCase();
  if (errorCode === 'UNKNOWN' || errorCode === 'EPERM' || errorCode === 'EACCES') {
    return true;
  }
  return /application control|code integrity|blocked this file|enterprise signing/i.test(String(detail || ''));
}

function writeWindowsSigningDiagnostic() {
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      windowsDevSigningScript,
      '-Mode',
      'Diagnose',
      '-Path',
      binaryPath,
      '-Json',
    ],
    {
      cwd: repoRoot,
      env: process.env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  if (result.error) {
    process.stderr.write(`[run-runtime-dist] windows dev signing diagnostic failed to start: ${result.error.message}\n`);
    return;
  }
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .join('\n');
    process.stderr.write(`[run-runtime-dist] windows dev signing diagnostic failed${detail ? `:\n${detail}\n` : '\n'}`);
    return;
  }

  try {
    const parsed = JSON.parse(String(result.stdout || '{}'));
    process.stderr.write(`[run-runtime-dist] windows dev signing diagnostic:\n${JSON.stringify(parsed, null, 2)}\n`);
  } catch {
    process.stderr.write(`[run-runtime-dist] windows dev signing diagnostic:\n${String(result.stdout || '').trim()}\n`);
  }
}

function runtimeCommandArgs() {
  const args = process.argv.slice(2);
  if (process.platform !== 'win32' || args[0] !== 'stop') {
    return args;
  }
  const hasForce = args.some((arg) => arg === '--force' || arg.startsWith('--force='));
  if (hasForce) {
    return args;
  }
  return ['stop', '--force', ...args.slice(1)];
}

if (!fs.existsSync(binaryPath)) {
  process.stderr.write(`[run-runtime-dist] missing ${path.relative(repoRoot, binaryPath)}; run 'pnpm build:runtime' first.\n`);
  process.exit(1);
}

const runtimeEnv = applyRootRuntimeEnv({ ...process.env });

const child = spawn(binaryPath, runtimeCommandArgs(), {
  cwd: repoRoot,
  stdio: 'inherit',
  env: runtimeEnv,
});

let childExited = false;

const forwardSignal = (signal) => {
  if (childExited || child.pid == null) {
    return;
  }
  try {
    child.kill(signal);
  } catch {
    // Child exit races are expected during shutdown.
  }
};

const cleanupSignals = () => {
  process.off('SIGINT', onSigInt);
  process.off('SIGTERM', onSigTerm);
};

const onSigInt = () => {
  if (process.platform === 'win32') {
    forwardSignal('SIGINT');
  }
};
const onSigTerm = () => {
  forwardSignal('SIGTERM');
};

process.on('SIGINT', onSigInt);
process.on('SIGTERM', onSigTerm);

child.once('error', (error) => {
  cleanupSignals();
  process.stderr.write(`[run-runtime-dist] failed to start ${path.relative(repoRoot, binaryPath)}: ${error.message}\n`);
  if (shouldRunWindowsSigningDiagnostic(error, error.message)) {
    writeWindowsSigningDiagnostic();
  }
  process.exit(1);
});

child.once('exit', (code, signal) => {
  childExited = true;
  cleanupSignals();
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

await new Promise(() => {
  // Keep the wrapper process alive until the child exits.
});
