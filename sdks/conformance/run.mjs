#!/usr/bin/env node

import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const languages = ['typescript', 'python', 'go', 'rust'];
const privateRealmOperationTable = YAML.parse(readFileSync(
  path.join(repoRoot, 'config/sdks-realm-private-operation-carriers.yaml'),
  'utf8',
));
const privateRealmOperationIds = new Set(
  (privateRealmOperationTable.operations || [])
    .filter((operation) => operation.public_sdk_disposition === 'forbidden')
    .map((operation) => String(operation.operation_id || '').trim()),
);

function readJson(rel) {
  const abs = path.join(repoRoot, rel);
  if (!existsSync(abs)) {
    throw new Error(`missing required conformance input: ${rel}`);
  }
  return JSON.parse(readFileSync(abs, 'utf8'));
}

function requireFile(rel) {
  const abs = path.join(repoRoot, rel);
  if (!existsSync(abs)) {
    throw new Error(`missing required file: ${rel}`);
  }
}

function parseLanguageArg() {
  const idx = process.argv.indexOf('--language');
  if (idx === -1) return ['all'];
  const value = process.argv[idx + 1];
  if (!value) {
    throw new Error('--language requires a value');
  }
  return value === 'all' ? languages : value.split(',').map((item) => item.trim()).filter(Boolean);
}

function parseProfileArg() {
  const idx = process.argv.indexOf('--profile');
  if (idx === -1) return 'descriptor-foundation';
  const value = process.argv[idx + 1];
  if (!value) {
    throw new Error('--profile requires a value');
  }
  if (!['descriptor-foundation', 'typed-core'].includes(value)) {
    throw new Error(`unsupported conformance profile: ${value}`);
  }
  return value;
}

function generatedDir(language) {
  if (language === 'go') return 'sdks/go/coregenerated';
  return `sdks/${language}/${language === 'typescript' ? 'core-generated' : 'core_generated'}`;
}

function skeletonFiles(language) {
  switch (language) {
    case 'typescript':
      return [
        'sdks/typescript/core-client/index.ts',
        'sdks/typescript/core-generated/runtime-client.ts',
        'sdks/typescript/core-generated/realm-client.ts',
        'sdks/typescript/core-generated/runtime-typed-client.ts',
        'sdks/typescript/core-generated/realm-typed-client.ts',
        'sdks/typescript/runtime/index.ts',
        'sdks/typescript/realm/index.ts',
        'sdks/typescript/types/index.ts',
      ];
    case 'python':
      return [
        'sdks/python/core_generated/runtime_client.py',
        'sdks/python/core_generated/realm_client.py',
        'sdks/python/core_generated/runtime_typed_client.py',
        'sdks/python/core_generated/realm_typed_client.py',
        'sdks/python/core_client/__init__.py',
        'sdks/python/runtime/__init__.py',
        'sdks/python/realm/__init__.py',
        'sdks/python/types/__init__.py',
      ];
    case 'go':
      return [
        'sdks/go/coregenerated/runtime_client.go',
        'sdks/go/coregenerated/realm_client.go',
        'sdks/go/coregenerated/typed_clients.go',
        'sdks/go/coregenerated/behavior_test.go',
        'sdks/go/coreclient/client.go',
        'sdks/go/runtime/runtime.go',
        'sdks/go/realm/realm.go',
        'sdks/go/types/types.go',
      ];
    case 'rust':
      return [
        'sdks/rust/core_generated/mod.rs',
        'sdks/rust/core_generated/runtime_client.rs',
        'sdks/rust/core_generated/realm_client.rs',
        'sdks/rust/core_generated/typed_clients.rs',
        'sdks/rust/core_client/mod.rs',
        'sdks/rust/runtime/mod.rs',
        'sdks/rust/realm/mod.rs',
        'sdks/rust/types/mod.rs',
      ];
    default:
      throw new Error(`unknown language: ${language}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertNoSdkSrcProvenance(manifest, label) {
  for (const sourcePath of manifest.source_paths || []) {
    assert(!String(sourcePath).startsWith('sdk/src/'), `${label} must not use sdk/src/** as source truth`);
  }
}

function validateSharedManifests() {
  const runtime = readJson('sdks/generators/shared/generated/runtime-core.manifest.json');
  const realm = readJson('sdks/generators/shared/generated/realm-core.manifest.json');
  const errors = readJson('sdks/generators/shared/generated/error-codes.manifest.json');
  const exportsManifest = readJson('sdks/generators/shared/generated/export-manifest.json');
  const fixtures = readJson('sdks/conformance/fixtures/core-fixtures.manifest.json');

  assert(runtime.source_kind === 'runtime_proto', 'runtime manifest must be generated from Runtime proto');
  assert(runtime.method_ids.length > 0, 'runtime manifest must include methods');
  assert(runtime.codec_maps.length === runtime.method_ids.length, 'runtime codec map count must match method ids');
  assert(runtime.contract_maps.length === runtime.method_ids.length, 'runtime contract map count must match method ids');
  assert(runtime.schema_types.messages.length > 0, 'runtime manifest must include message types');
  assertNoSdkSrcProvenance(runtime, 'runtime manifest');

  assert(
    ['realm_openapi', 'realm_spec_fallback', 'public_realm_core_manifest_projection'].includes(realm.source_kind),
    'realm manifest must use admitted Realm source kind',
  );
  assert(realm.operations.length > 0, 'realm manifest must include operations');
  assert(realm.operation_maps.length === realm.operations.length, 'realm operation map count must match operations');
  assert(realm.service_registry.length > 0, 'realm manifest must include a service registry');
  assertNoSdkSrcProvenance(realm, 'realm manifest');

  assert(errors.values.length > 0, 'error manifest must include reason-code values');
  assert(errors.codes.length > 0, 'error manifest must include structured code entries');
  assertNoSdkSrcProvenance(errors, 'error manifest');

  assert(exportsManifest.no_forwarding_shims === true, 'export manifest must forbid forwarding shims');
  for (const derivative of ['ai-provider', 'world', 'app', 'permission']) {
    assert(exportsManifest.excluded_derivative_surfaces.includes(derivative), `export manifest must exclude derivative surface ${derivative}`);
  }
  assert(fixtures.fixture_groups.length >= 6, 'conformance fixtures must include required fixture groups');

  return { runtime, realm, errors, exportsManifest };
}

function validateLanguage(language, shared) {
  assert(languages.includes(language), `unsupported language: ${language}`);
  for (const rel of skeletonFiles(language)) {
    requireFile(rel);
  }
  const dir = generatedDir(language);
  const runtime = readJson(`${dir}/runtime-core.manifest.json`);
  const realm = readJson(`${dir}/realm-core.manifest.json`);
  const errors = readJson(`${dir}/error-codes.manifest.json`);
  const exportsManifest = readJson(`${dir}/export-manifest.json`);

  assert(runtime.language === language, `${language} runtime manifest has wrong language`);
  assert(realm.language === language, `${language} realm manifest has wrong language`);
  assert(errors.language === language, `${language} error manifest has wrong language`);
  assert(exportsManifest.language === language, `${language} export manifest has wrong language`);
  assert(runtime.method_ids.length === shared.runtime.method_ids.length, `${language} runtime method parity mismatch`);
  const expectedRealmOperationIds = shared.realm.operations
    .map((operation) => operation.operation_id)
    .filter((operationId) => !privateRealmOperationIds.has(operationId));
  assert(
    JSON.stringify(realm.operations.map((operation) => operation.operation_id)) === JSON.stringify(expectedRealmOperationIds),
    `${language} public Realm operation parity mismatch`,
  );
  assert(errors.values.length === shared.errors.values.length, `${language} error-code parity mismatch`);
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

function runTypescriptBehavior(profile) {
  runPnpm([
    '--filter',
    '@nimiplatform/sdk',
    'exec',
    'tsx',
    '../conformance/behavior/typescript.ts',
  ], { env: { SDKS_CONFORMANCE_PROFILE: profile } });
}

function runPythonBehavior(profile) {
  run(process.platform === 'win32' ? 'python' : 'python3', ['sdks/conformance/behavior/python.py'], {
    env: { PYTHONPATH: repoRoot, SDKS_CONFORMANCE_PROFILE: profile },
  });
}

function runGoBehavior(profile) {
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
    execFileSync('go', ['test', './...'], {
      cwd: dir,
      stdio: 'inherit',
      env: { ...process.env, SDKS_CONFORMANCE_PROFILE: profile },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runRustBehavior(profile) {
  const dir = mkdtempSync(path.join(tmpdir(), 'sdks-rust-conformance-'));
  try {
    cpSync(path.join(repoRoot, 'sdks/rust/core_client'), path.join(dir, 'core_client'), { recursive: true });
    cpSync(path.join(repoRoot, 'sdks/rust/core_generated'), path.join(dir, 'core_generated'), { recursive: true });
    cpSync(path.join(repoRoot, 'sdks/rust/realm'), path.join(dir, 'realm'), { recursive: true });
    cpSync(path.join(repoRoot, 'sdks/rust/runtime'), path.join(dir, 'runtime'), { recursive: true });
    cpSync(path.join(repoRoot, 'sdks/rust/types'), path.join(dir, 'types'), { recursive: true });
    cpSync(path.join(repoRoot, 'sdks/conformance/behavior/rust.rs'), path.join(dir, 'behavior.rs'));
    writeFileSync(
      path.join(dir, 'lib.rs'),
      [
        'pub mod core_client;',
        'pub mod core_generated;',
        'pub mod realm;',
        'pub mod runtime;',
        'pub mod types;',
        '#[cfg(test)] mod behavior { include!("behavior.rs"); }',
        '',
      ].join('\n'),
      'utf8',
    );
    const outputName = process.platform === 'win32' ? 'sdks_rust_behavior_test.exe' : 'sdks_rust_behavior_test';
    const outputPath = path.join(dir, outputName);
    execFileSync('rustc', ['--crate-type', 'lib', '--test', path.join(dir, 'lib.rs'), '-o', outputPath], {
      cwd: dir,
      stdio: 'inherit',
    });
    execFileSync(outputPath, [], {
      cwd: dir,
      stdio: 'inherit',
      env: { ...process.env, SDKS_CONFORMANCE_PROFILE: profile },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runBehavior(language, profile) {
  switch (language) {
    case 'typescript':
      runTypescriptBehavior(profile);
      return;
    case 'python':
      runPythonBehavior(profile);
      return;
    case 'go':
      runGoBehavior(profile);
      return;
    case 'rust':
      runRustBehavior(profile);
      return;
    default:
      throw new Error(`unknown behavior language: ${language}`);
  }
}

function main() {
  const requested = parseLanguageArg();
  const profile = parseProfileArg();
  const selected = requested.includes('all') ? languages : requested;
  const shared = validateSharedManifests();
  for (const language of selected) {
    validateLanguage(language, shared);
    runBehavior(language, profile);
  }
  process.stdout.write(`sdks conformance: OK (${selected.join(', ')}; profile=${profile})\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`[sdks:conformance] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
