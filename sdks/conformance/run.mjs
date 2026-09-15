#!/usr/bin/env node

import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const languages = ['typescript', 'python', 'go', 'rust'];

function parseLanguageArg() {
  const idx = process.argv.indexOf('--language');
  if (idx === -1) return languages;
  const value = process.argv[idx + 1];
  if (!value) {
    throw new Error('--language requires a value');
  }
  const selected = value === 'all'
    ? languages
    : value.split(',').map((item) => item.trim()).filter(Boolean);
  for (const language of selected) {
    if (!languages.includes(language)) {
      throw new Error(`unsupported language: ${language}`);
    }
  }
  return selected;
}

function assertTypedCoreProfile() {
  const idx = process.argv.indexOf('--profile');
  if (idx === -1) return;
  const value = process.argv[idx + 1];
  if (!value) {
    throw new Error('--profile requires a value');
  }
  if (value !== 'typed-core') {
    throw new Error(`unsupported conformance profile: ${value}`);
  }
}

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, ...(options.env || {}) },
  });
}

function runPnpm(args, options = {}) {
  if (process.platform !== 'win32') {
    run('pnpm', args, options);
    return;
  }
  run('cmd.exe', ['/d', '/c', 'pnpm', ...args], options);
}

function runTypescriptBehavior() {
  runPnpm([
    '--filter',
    '@nimiplatform/sdk',
    'exec',
    'tsx',
    '../conformance/behavior/typescript.ts',
  ]);
}

function runPythonBehavior() {
  run(process.platform === 'win32' ? 'python' : 'python3', ['sdks/conformance/behavior/python.py'], {
    env: { PYTHONPATH: repoRoot },
  });
}

function runGoBehavior() {
  const dir = mkdtempSync(path.join(tmpdir(), 'sdks-go-conformance-'));
  try {
    cpSync(path.join(repoRoot, 'sdks/go'), dir, { recursive: true });
    cpSync(
      path.join(repoRoot, 'sdks/conformance'),
      path.join(dir, 'conformance'),
      { recursive: true },
    );
    execFileSync('go', ['mod', 'init', 'github.com/nimiplatform/nimi/sdks/go'], {
      cwd: dir,
      stdio: 'ignore',
    });
    execFileSync('go', [
      'test',
      './coregenerated',
      '-run',
      '^(TestGeneratedRuntimeOptionalScalarAndEnumPresence|TestRealmRequiredNullableScalarPreservesNullAndRejectsMissingOrWrongScalar|TestRealmNullableResponsePreservesAbsentAndPresentTransit|TestTypedRuntimeClientsPreserveRequestsAndTransportBehavior|TestSourceMaterializationPacketV3SemanticPayloadDiscriminatorFailsClosed)$',
    ], {
      cwd: dir,
      stdio: 'inherit',
      env: process.env,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runRustBehavior() {
  run('cargo', ['test', '--manifest-path', 'sdks/rust/Cargo.toml']);
}

function runBehavior(language) {
  switch (language) {
    case 'typescript':
      runTypescriptBehavior();
      return;
    case 'python':
      runPythonBehavior();
      return;
    case 'go':
      runGoBehavior();
      return;
    case 'rust':
      runRustBehavior();
      return;
    default:
      throw new Error(`unknown behavior language: ${language}`);
  }
}

function main() {
  const selected = parseLanguageArg();
  assertTypedCoreProfile();
  for (const language of selected) {
    runBehavior(language);
  }
  process.stdout.write(`sdks conformance: OK (${selected.join(', ')})\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`[sdks:conformance] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
