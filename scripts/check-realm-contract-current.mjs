#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

import {
  NIMI_OPENAPI_SYNCED_PATH,
  assertAccessPolicyAdmission,
  assertAccessPolicyOpenApi,
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
    throw new Error('usage: pnpm check:realm-contract-current --realm-root <realm-checkout>');
  }
  return path.resolve(argv[index + 1]);
}

function assertCanonicalEqual(actual, expected, label) {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error(`${label} mismatch; regenerate the Realm contract lock`);
  }
}

function assertRejected(label, operation) {
  try {
    operation();
  } catch {
    return;
  }
  throw new Error(`current Realm mutation self-test accepted ${label}`);
}

function runAdmissionMutationTests(admission, openapiText) {
  const admissionMutations = [
    [
      'authority class',
      (value) => {
        value.accessPolicy.authorityClass = 'user_permission';
      },
    ],
    [
      'permission requirement',
      (value) => {
        value.accessPolicy.thirdPartyAppPermissionRequired = true;
      },
    ],
  ];
  for (const [label, mutate] of admissionMutations) {
    const candidate = structuredClone(admission);
    mutate(candidate);
    assertRejected(label, () => assertAccessPolicyAdmission(candidate));
  }

  const document = YAML.parse(openapiText);
  const openApiMutations = [
    [
      'retired endpoint',
      (value) => {
        value.paths['/api/runtime/realm-grants/issue'] = { post: { operationId: 'forged' } };
      },
    ],
    [
      'retired grant schema',
      (value) => {
        value.components.schemas.AppPermissionGrantDto = { type: 'object' };
      },
    ],
    [
      'packet permission input',
      (value) => {
        const request = value.components.schemas.CreateSourceMaterializationPacketV3Dto;
        request.properties.accessGrantId = { type: 'string' };
        request.required.push('accessGrantId');
      },
    ],
  ];
  for (const [label, mutate] of openApiMutations) {
    const candidate = structuredClone(document);
    mutate(candidate);
    assertRejected(label, () => assertAccessPolicyOpenApi(YAML.stringify(candidate), admission));
  }
  return admissionMutations.length + openApiMutations.length;
}

function main(realmRoot) {
  const admission = readAdmission();
  const { openapiBytes, fragment } = validateAdmittedProducer(realmRoot, admission);
  const lock = YAML.parse(fs.readFileSync(lockPath, 'utf8'));
  assertCanonicalEqual(
    lock,
    renderLock({ admission, openapiBytes, fragment }),
    'current Realm contract lock',
  );
  const syncedOpenapi = fs.readFileSync(path.join(repoRoot, NIMI_OPENAPI_SYNCED_PATH));
  if (!syncedOpenapi.equals(openapiBytes)) {
    throw new Error(`${NIMI_OPENAPI_SYNCED_PATH} is not byte-equal to admitted Realm OpenAPI`);
  }
  const mutations = runAdmissionMutationTests(admission, openapiBytes.toString('utf8'));
  process.stdout.write(
    `current Realm contract admission passed: realm=${admission.admittedCommit} tree=${admission.admittedTree} tracked_semantic_files=${admission.semanticFiles.length} negative_mutations=${mutations}/${mutations}\n`,
  );
}

try {
  main(parseRealmRoot(process.argv.slice(2)));
} catch (error) {
  process.stderr.write(
    `[check:realm-contract-current] ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
