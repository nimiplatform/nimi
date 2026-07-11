#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import {
  BUNDLE_MANIFEST_SCHEMA_VERSION,
  COVERAGE_MANIFEST_SCHEMA_VERSION,
  MATERIALIZATION_CONTEXT_SCHEMA_VERSION,
  NIMI_OPENAPI_SYNCED_PATH,
  PACKET_SCHEMA_VERSION,
  REALM_OPENAPI_SOURCE_PATH,
  REALM_REPOSITORY,
  assertRealmRepository,
  extractSourceMaterializationFragment,
  git,
  renderLock,
} from './generate-realm-contract-lock.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const lockPath = path.join(repoRoot, 'config', 'realm-contract-lock.yaml');

function parseRealmRoot(argv) {
  const index = argv.indexOf('--realm-root');
  if (index < 0 || !String(argv[index + 1] || '').trim()) {
    throw new Error('usage: pnpm check:realm-contract-lock --realm-root <realm-checkout>');
  }
  return path.resolve(argv[index + 1]);
}

function assertDeepEqual(actual, expected, label) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${label} mismatch; run generate:realm-contract-lock against the admitted Realm checkout`);
  }
}

function clone(value) {
  return structuredClone(value);
}

function assertMutationRejected(validLock, expectedLock, mutate, label) {
  const candidate = clone(validLock);
  mutate(candidate);
  try {
    assertDeepEqual(candidate, expectedLock, label);
  } catch {
    return;
  }
  throw new Error(`contract-lock mutation self-test did not reject ${label}`);
}

function runMutationSelfTests(validLock, expectedLock) {
  const mutations = [
    ['repository', (value) => { value.realm.repository = 'https://github.com/example/forged.git'; }],
    ['commit', (value) => { value.realm.commit = '0'.repeat(40); }],
    ['fragment hash', (value) => { value.openapi.fragment_sha256 = '0'.repeat(64); }],
    ['packet schema version', (value) => { value.schema_versions.packet = 'realm.source-materialization-packet/v1'; }],
    ['materialization context schema version', (value) => { value.schema_versions.materialization_context = 'realm.materialization-context/v0'; }],
  ];
  for (const [label, mutate] of mutations) {
    assertMutationRejected(validLock, expectedLock, mutate, label);
  }
}

function check(realmRoot) {
  assertRealmRepository(realmRoot);
  if (!fs.existsSync(lockPath)) throw new Error(`missing ${path.relative(repoRoot, lockPath)}`);
  const lock = YAML.parse(fs.readFileSync(lockPath, 'utf8'));
  if (lock?.schema_version !== 'nimi.realm-contract-lock/v1') {
    throw new Error('unsupported or missing realm contract lock schema_version');
  }
  if (lock?.realm?.repository !== REALM_REPOSITORY) {
    throw new Error('realm contract lock repository is not canonical');
  }
  const realmCommit = String(lock?.realm?.commit || '');
  if (!/^[a-f0-9]{40}$/.test(realmCommit)) {
    throw new Error('realm contract lock commit must be a full immutable SHA');
  }
  git(realmRoot, ['cat-file', '-e', `${realmCommit}^{commit}`]);
  const committedOpenapi = `${git(realmRoot, ['show', `${realmCommit}:${REALM_OPENAPI_SOURCE_PATH}`])}\n`;
  const fragment = extractSourceMaterializationFragment(committedOpenapi);
  const expected = renderLock({ realmCommit, openapiText: committedOpenapi, fragment });
  assertDeepEqual(lock, expected, 'realm contract lock');

  const syncedOpenapi = fs.readFileSync(path.join(repoRoot, NIMI_OPENAPI_SYNCED_PATH), 'utf8');
  if (syncedOpenapi !== committedOpenapi) {
    throw new Error(`${NIMI_OPENAPI_SYNCED_PATH} is not byte-equal to ${realmCommit}:${REALM_OPENAPI_SOURCE_PATH}`);
  }
  if (lock.schema_versions.packet !== PACKET_SCHEMA_VERSION
      || lock.schema_versions.materialization_context !== MATERIALIZATION_CONTEXT_SCHEMA_VERSION
      || lock.schema_versions.coverage_manifest !== COVERAGE_MANIFEST_SCHEMA_VERSION
      || lock.schema_versions.bundle_transport_manifest !== BUNDLE_MANIFEST_SCHEMA_VERSION) {
    throw new Error('realm contract lock schema versions are incomplete');
  }
  runMutationSelfTests(lock, expected);
  process.stdout.write(
    `realm contract lock check passed: realm=${realmCommit} fragment=${fragment.sha256} mutation_tests=5/5\n`,
  );
}

try {
  check(parseRealmRoot(process.argv.slice(2)));
} catch (error) {
  process.stderr.write(`[check:realm-contract-lock] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
