#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const distDir = path.join(repoRoot, 'dist');
const binaryName = process.platform === 'win32' ? 'nimi.exe' : 'nimi';
const binaryPath = path.join(distDir, binaryName);

if (!fs.existsSync(binaryPath)) {
  process.stderr.write(`[run-runtime-dist] missing ${path.relative(repoRoot, binaryPath)}; run 'pnpm build:runtime' first.\n`);
  process.exit(1);
}

const child = spawn(binaryPath, process.argv.slice(2), {
  cwd: repoRoot,
  stdio: 'inherit',
  env: process.env,
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
