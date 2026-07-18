#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

import {
  ADMISSION_SCHEMA_VERSION,
  LOCK_SCHEMA_VERSION,
  NIMI_OPENAPI_SYNCED_PATH,
  REALM_AUTHORITY_ID,
  canonicalJson,
  readAdmission,
  renderLock,
  validateAdmittedProducer,
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

function assertCanonicalEqual(actual, expected, label) {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error(`${label} mismatch; run generate:realm-contract-lock`);
  }
}

function assertMutationRejected(validLock, expectedLock, label, mutate) {
  const candidate = structuredClone(validLock);
  mutate(candidate);
  try {
    assertCanonicalEqual(candidate, expectedLock, label);
  } catch {
    return;
  }
  throw new Error(`contract-lock mutation self-test accepted ${label}`);
}

function runMutationSelfTests(lock, expected) {
  const mutations = [
    ['authority id', (value) => (value.realm.authority_id = 'forged-realm')],
    ['commit', (value) => (value.realm.commit = '0'.repeat(40))],
    ['authority class', (value) => (value.access_policy.authority_class = 'user_permission')],
    [
      'permission required',
      (value) => (value.access_policy.third_party_app_permission_required = true),
    ],
    ['forbidden inputs', (value) => value.access_policy.forbidden_inputs.pop()],
    ['tracked-only posture', (value) => (value.producer_admission.tracked_only = false)],
  ];
  for (const [label, mutate] of mutations) {
    assertMutationRejected(lock, expected, label, mutate);
  }
  return mutations.length;
}

function main(realmRoot) {
  const admission = readAdmission();
  if (admission.schemaVersion !== ADMISSION_SCHEMA_VERSION) {
    throw new Error('unsupported current Realm admission schema');
  }
  const { openapiBytes, fragment } = validateAdmittedProducer(realmRoot, admission);
  const lock = YAML.parse(fs.readFileSync(lockPath, 'utf8'));
  if (lock?.schema_version !== LOCK_SCHEMA_VERSION || lock?.realm?.authority_id !== REALM_AUTHORITY_ID) {
    throw new Error('Realm contract lock identity/schema mismatch');
  }
  const expected = renderLock({ admission, openapiBytes, fragment });
  assertCanonicalEqual(lock, expected, 'Realm contract lock');
  const synced = fs.readFileSync(path.join(repoRoot, NIMI_OPENAPI_SYNCED_PATH));
  if (!synced.equals(openapiBytes)) {
    throw new Error(`${NIMI_OPENAPI_SYNCED_PATH} differs from admitted Realm OpenAPI`);
  }
  const mutations = runMutationSelfTests(lock, expected);
  process.stdout.write(
    `realm contract lock check passed: realm=${admission.admittedCommit} tree=${admission.admittedTree} lock_mutations=${mutations}/${mutations}\n`,
  );
}

try {
  main(parseRealmRoot(process.argv.slice(2)));
} catch (error) {
  process.stderr.write(
    `[check:realm-contract-lock] ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
