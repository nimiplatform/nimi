#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import {
  ADMISSION_SCHEMA_VERSION,
  LOCK_SCHEMA_VERSION,
  NIMI_OPENAPI_SYNCED_PATH,
  REALM_OPENAPI_SOURCE_PATH,
  REALM_REPOSITORY,
  assertAccessPolicyOpenApi,
  assertRealmRepository,
  extractSourceMaterializationFragment,
  git,
  renderLock,
  sha256Hex,
} from './generate-realm-contract-lock.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const lockPath = path.join(repoRoot, 'config', 'realm-contract-lock.yaml');
const admissionPath = path.join(repoRoot, 'config', 'realm-v3', 'current-producer-admission.json');

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

function admittedOpenapiBytes(realmRoot, admission) {
  return execFileSync(
    'git',
    ['-C', realmRoot, 'show', `${admission.admittedCommit}:${REALM_OPENAPI_SOURCE_PATH}`],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
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
    ['tree', (value) => { value.realm.tree = '0'.repeat(40); }],
    ['document hash', (value) => { value.openapi.document_sha256 = '0'.repeat(64); }],
    ['fragment hash', (value) => { value.openapi.fragment_sha256 = '0'.repeat(64); }],
    ['operation inventory', (value) => { value.openapi.operation_inventory_sha256 = '0'.repeat(64); }],
    ['packet schema version', (value) => { value.schema_versions.packet = 'realm.source-materialization-packet/v2'; }],
    ['source ref kind', (value) => { value.source_ref.kinds = ['worldCharacter', 'realmPersona']; }],
    ['compact vector', (value) => { value.compact_vectors['world-character.json'] = '0'.repeat(64); }],
    ['access policy digest', (value) => { value.access_policy.digest = '0'.repeat(64); }],
    ['Realm grant selector', (value) => { value.access_policy.selector.scopeName = 'agent.identity.project'; }],
    ['explicit grant lifecycle', (value) => { value.access_policy.lifecycle.grant.operationId = 'requestMyAppPermissionGrant'; }],
    ['closure evidence', (value) => { value.producer_evidence.closure_content_hash = '0'.repeat(64); }],
    ['handoff evidence', (value) => { value.producer_evidence.handoff_content_hash = '0'.repeat(64); }],
    ['focused A1 evidence', (value) => { value.producer_evidence.focused_a1.verdict = 'NEEDS_REVISION'; }],
  ];
  for (const [label, mutate] of mutations) {
    assertMutationRejected(validLock, expectedLock, mutate, label);
  }
  return mutations.length;
}

function assertOpenApiMutationRejected(openapiBytes, expectedSha256, label, mutate) {
  const candidate = mutate(Buffer.from(openapiBytes));
  if (sha256Hex(candidate) === expectedSha256) {
    throw new Error(`OpenAPI mutation self-test did not reject ${label}`);
  }
}

function assertAccessPolicyMutationRejected(openapiText, admission, label, mutate) {
  const candidate = mutate(openapiText);
  try {
    assertAccessPolicyOpenApi(candidate, admission);
  } catch {
    return;
  }
  throw new Error(`OpenAPI contract mutation self-test did not reject ${label}`);
}

function runOpenApiMutationSelfTests(openapiBytes, expectedSha256, admission) {
  const text = openapiBytes.toString('utf8');
  assertOpenApiMutationRejected(openapiBytes, expectedSha256, 'stale document', (value) =>
    Buffer.concat([value, Buffer.from('# stale projection\n', 'utf8')]));
  assertOpenApiMutationRejected(openapiBytes, expectedSha256, 'old RealmPersona operation', () =>
    Buffer.from(text.replace(
      'WorldCoreController_listPersonaCharacters',
      'WorldCoreController_listRealmPersonas',
    ), 'utf8'));
  assertAccessPolicyMutationRejected(text, admission, 'local scope as Realm selector', (value) =>
    value.replace('realm_source.snapshot.consume', 'agent.identity.project'));
  assertAccessPolicyMutationRejected(text, admission, 'missing explicit grant operation', (value) =>
    value.replace('grantMyAppPermissionGrant', 'grantMyAppPermissionGrantRemoved'));
  return 4;
}

function check(realmRoot) {
  assertRealmRepository(realmRoot);
  const admission = JSON.parse(fs.readFileSync(admissionPath, 'utf8'));
  if (admission?.schemaVersion !== ADMISSION_SCHEMA_VERSION) {
    throw new Error(`unsupported current Realm admission schema ${admission?.schemaVersion || '<missing>'}`);
  }
  if (admission.repository !== REALM_REPOSITORY) {
    throw new Error('current Realm admission repository is not canonical');
  }
  if (!fs.existsSync(lockPath)) throw new Error(`missing ${path.relative(repoRoot, lockPath)}`);
  const lock = YAML.parse(fs.readFileSync(lockPath, 'utf8'));
  if (lock?.schema_version !== LOCK_SCHEMA_VERSION) {
    throw new Error('unsupported or missing realm contract lock schema_version');
  }
  if (lock?.realm?.repository !== REALM_REPOSITORY) {
    throw new Error('realm contract lock repository is not canonical');
  }
  if (lock?.realm?.commit !== admission.admittedCommit || lock?.realm?.tree !== admission.admittedTree) {
    throw new Error('realm contract lock does not bind the admitted commit/tree');
  }
  git(realmRoot, ['cat-file', '-e', `${admission.admittedCommit}^{commit}`]);
  const actualTree = git(realmRoot, ['rev-parse', `${admission.admittedCommit}^{tree}`]);
  if (actualTree !== admission.admittedTree) throw new Error('admitted Realm tree mismatch');
  const openapiBytes = admittedOpenapiBytes(realmRoot, admission);
  if (sha256Hex(openapiBytes) !== admission.openapi.sha256) {
    throw new Error('admitted Realm OpenAPI digest mismatch');
  }
  const fragment = extractSourceMaterializationFragment(openapiBytes.toString('utf8'));
  const expected = renderLock({ admission, openapiBytes, fragment });
  assertDeepEqual(lock, expected, 'realm contract lock');

  const syncedOpenapi = fs.readFileSync(path.join(repoRoot, NIMI_OPENAPI_SYNCED_PATH), 'utf8');
  if (syncedOpenapi !== openapiBytes.toString('utf8')) {
    throw new Error(`${NIMI_OPENAPI_SYNCED_PATH} is not byte-equal to ${admission.admittedCommit}:${REALM_OPENAPI_SOURCE_PATH}`);
  }
  if (JSON.stringify(lock.schema_versions) !== JSON.stringify(admission.schemaVersions)) {
    throw new Error('realm contract lock schema versions are incomplete or stale');
  }
  const lockMutationCount = runMutationSelfTests(lock, expected);
  const openapiMutationCount = runOpenApiMutationSelfTests(openapiBytes, admission.openapi.sha256, admission);
  process.stdout.write(
    `realm contract lock check passed: realm=${admission.admittedCommit} tree=${admission.admittedTree} fragment=${fragment.sha256} lock_mutations=${lockMutationCount}/${lockMutationCount} openapi_mutations=${openapiMutationCount}/${openapiMutationCount}\n`,
  );
}

try {
  check(parseRealmRoot(process.argv.slice(2)));
} catch (error) {
  process.stderr.write(`[check:realm-contract-lock] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
