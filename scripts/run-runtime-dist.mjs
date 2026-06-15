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

function enableLocalDeveloperRegistrationGate(env) {
  const command = String(process.argv[2] || '').trim();
  if (command !== 'serve' && command !== 'start') {
    return;
  }
  if (!fs.existsSync(devAppRegistryPath)) {
    return;
  }
  const result = spawnSync(
    binaryPath,
    [
      'config',
      'set',
      '--set',
      'auth.developerRegistration.enabled=true',
      '--json',
    ],
    {
      cwd: repoRoot,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  if (result.status === 0) {
    return;
  }
  const detail = [result.error?.message, result.stderr, result.stdout]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join('\n');
  process.stderr.write(`[run-runtime-dist] failed to enable local developer registration gate${detail ? `: ${detail}` : ''}\n`);
  process.exit(result.status ?? 1);
}

if (!fs.existsSync(binaryPath)) {
  process.stderr.write(`[run-runtime-dist] missing ${path.relative(repoRoot, binaryPath)}; run 'pnpm build:runtime' first.\n`);
  process.exit(1);
}

const runtimeEnv = applyRootRuntimeEnv({ ...process.env });
enableLocalDeveloperRegistrationGate(runtimeEnv);

const child = spawn(binaryPath, process.argv.slice(2), {
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
