#!/usr/bin/env node

import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

export const REALM_REPOSITORY = 'https://github.com/nimiplatform/nimi-realm.git';
export const REALM_OPENAPI_SOURCE_PATH = 'nimi-backend/api-nimi.yaml';
export const NIMI_OPENAPI_SYNCED_PATH = 'config/realm-openapi/api-nimi.yaml';
export const MATERIALIZATION_OPERATION_ID =
  'WorldCoreController_createSourceMaterializationPacket';
export const MATERIALIZATION_OPERATION_PATH = '/api/realm/core/source-materialization-packets';
export const MATERIALIZATION_OPERATION_METHOD = 'post';
export const FRAGMENT_SCHEMA_VERSION =
  'nimi.realm-openapi-source-materialization-fragment/v1';
export const LOCK_SCHEMA_VERSION = 'nimi.realm-contract-lock/v4';
export const ADMISSION_SCHEMA_VERSION = 'nimi.realm-current-producer-admission/v3';
export const ACCESS_POLICY_VERSION = 'realm.source-materialization-access-policy/v5';
export const ACCESS_POLICY_DIGEST =
  '7649e8c7aa85f6667b1af5134686fc653f33ed5094e5d11483a5e60f39765faa';
export const ACCESS_POLICY_AUTHORITY_CLASS =
  'authenticated_first_party_product_operation';
export const AUTHORIZATION_INPUTS = Object.freeze([
  'authenticated_realm_account',
  'canonical_source_and_world_materialization_visibility',
  'exact_CharacterSourceRefV3',
  'materialization_readiness',
  'runtime_challenge_audience_limits_and_proof_boundary',
]);
export const FORBIDDEN_INPUTS = Object.freeze([
  'app_id',
  'permission_scope',
  'access_grant_id',
  'synthetic_grant_decision',
]);
export const RETIRED_IDENTIFIERS = Object.freeze([
  'realm_source.snapshot.consume',
  'realm_source.snapshot.bind',
  'agent.identity.project',
]);
export const RETIRED_ENDPOINTS = Object.freeze([
  '/api/human/me/permission-grants',
  '/api/runtime/realm-grants/issue',
]);

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const lockPath = path.join(repoRoot, 'config', 'realm-contract-lock.yaml');
const admissionPath = path.join(
  repoRoot,
  'config',
  'realm-v3',
  'current-producer-admission.json',
);
const syncedOpenapiPath = path.join(repoRoot, NIMI_OPENAPI_SYNCED_PATH);

function parseRealmRoot(argv) {
  const index = argv.indexOf('--realm-root');
  if (index < 0 || !String(argv[index + 1] || '').trim()) {
    throw new Error('usage: pnpm generate:realm-contract-lock --realm-root <realm-checkout>');
  }
  return path.resolve(argv[index + 1]);
}

export function git(realmRoot, args) {
  return execFileSync('git', ['-C', realmRoot, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function gitBytes(realmRoot, args) {
  return execFileSync('git', ['-C', realmRoot, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function normalizeRepositoryUrl(value) {
  const normalized = String(value || '').trim();
  if (normalized.startsWith('git@github.com:')) {
    return `https://github.com/${normalized.slice('git@github.com:'.length)}`;
  }
  if (normalized.startsWith('ssh://git@github.com/')) {
    return `https://github.com/${normalized.slice('ssh://git@github.com/'.length)}`;
  }
  return normalized;
}

export function assertRealmRepository(realmRoot) {
  const repository = normalizeRepositoryUrl(git(realmRoot, ['remote', 'get-url', 'origin']));
  if (repository !== REALM_REPOSITORY) {
    throw new Error(
      `Realm repository mismatch: expected ${REALM_REPOSITORY}, got ${repository || '<missing>'}`,
    );
  }
}

export function compareUtf16CodeUnits(leftInput, rightInput) {
  const left = String(leftInput);
  const right = String(rightInput);
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort(compareUtf16CodeUnits)
      .map((key) => [key, sortJson(value[key])]),
  );
}

export function canonicalJson(value) {
  return JSON.stringify(sortJson(value));
}

export function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function assertSha256(bytes, expected, label) {
  const actual = sha256Hex(bytes);
  if (actual !== expected) {
    throw new Error(`${label} SHA-256 mismatch: expected ${expected}, got ${actual}`);
  }
}

function assertTrackedAuthorityPath(relativePath) {
  if (
    path.isAbsolute(relativePath) ||
    relativePath.split(/[\\/]/u).includes('..') ||
    relativePath === '.nimi/local' ||
    relativePath.startsWith('.nimi/local/') ||
    relativePath === '.local' ||
    relativePath.startsWith('.local/')
  ) {
    throw new Error(`non-tracked or local-only Realm admission path: ${relativePath}`);
  }
}

export function readAdmission() {
  const admission = JSON.parse(fs.readFileSync(admissionPath, 'utf8'));
  if (admission?.schemaVersion !== ADMISSION_SCHEMA_VERSION) {
    throw new Error(
      `unsupported current Realm admission schema: ${admission?.schemaVersion || '<missing>'}`,
    );
  }
  if (admission.repository !== REALM_REPOSITORY) {
    throw new Error(`current Realm admission repository mismatch: ${admission.repository}`);
  }
  if (admission.headPolicy !== 'identical_admitted_inputs') {
    throw new Error(`unsupported current Realm HEAD policy: ${admission.headPolicy}`);
  }
  return admission;
}

function assertAdmittedGitFile(realmRoot, admittedCommit, file) {
  assertTrackedAuthorityPath(file.path);
  const admitted = gitBytes(realmRoot, ['show', `${admittedCommit}:${file.path}`]);
  assertSha256(admitted, file.sha256, `${admittedCommit}:${file.path}`);
  const head = gitBytes(realmRoot, ['show', `HEAD:${file.path}`]);
  assertSha256(head, file.sha256, `HEAD:${file.path}`);
  const workingPath = path.join(realmRoot, file.path);
  if (!fs.existsSync(workingPath) || !fs.statSync(workingPath).isFile()) {
    throw new Error(`missing admitted Realm input ${file.path}`);
  }
  assertSha256(fs.readFileSync(workingPath), file.sha256, `worktree:${file.path}`);
  return admitted;
}

function exactPacketOperation() {
  return {
    operationId: MATERIALIZATION_OPERATION_ID,
    method: MATERIALIZATION_OPERATION_METHOD,
    path: MATERIALIZATION_OPERATION_PATH,
  };
}

export function assertAccessPolicyAdmission(admission) {
  const policy = admission?.accessPolicy;
  if (
    policy?.version !== ACCESS_POLICY_VERSION ||
    policy?.digest !== ACCESS_POLICY_DIGEST ||
    policy?.authorityClass !== ACCESS_POLICY_AUTHORITY_CLASS ||
    policy?.thirdPartyAppPermissionRequired !== false ||
    policy?.permissionCatalog !== 'empty' ||
    canonicalJson(policy?.packetOperation) !== canonicalJson(exactPacketOperation()) ||
    canonicalJson(policy?.authorizationInputs) !== canonicalJson(AUTHORIZATION_INPUTS) ||
    canonicalJson(policy?.forbiddenInputs) !== canonicalJson(FORBIDDEN_INPUTS) ||
    canonicalJson(policy?.retiredIdentifiers) !== canonicalJson(RETIRED_IDENTIFIERS) ||
    canonicalJson(policy?.retiredEndpoints) !== canonicalJson(RETIRED_ENDPOINTS)
  ) {
    throw new Error('current Realm first-party access-policy admission mismatch');
  }
}

function operationAt(document, expected) {
  const operation = document?.paths?.[expected.path]?.[expected.method];
  if (operation?.operationId !== expected.operationId) {
    throw new Error(
      `Realm OpenAPI missing ${expected.method.toUpperCase()} ${expected.path} (${expected.operationId})`,
    );
  }
  return operation;
}

function schemaRef(value) {
  return value?.$ref;
}

export function assertAccessPolicyOpenApi(openapiText, admission) {
  assertAccessPolicyAdmission(admission);
  const document = YAML.parse(openapiText);
  const schemas = document?.components?.schemas || {};
  const paths = document?.paths || {};
  for (const retired of RETIRED_ENDPOINTS) {
    if (Object.keys(paths).some((candidate) => candidate === retired || candidate.startsWith(`${retired}/`))) {
      throw new Error(`Realm OpenAPI retains retired permission endpoint ${retired}`);
    }
  }
  for (const schemaName of Object.keys(schemas)) {
    if (schemaName.startsWith('AppPermissionGrant') || schemaName.startsWith('AppPermissionScope')) {
      throw new Error(`Realm OpenAPI retains retired permission schema ${schemaName}`);
    }
  }
  const operation = operationAt(document, admission.accessPolicy.packetOperation);
  if (
    schemaRef(operation?.requestBody?.content?.['application/json']?.schema) !==
    '#/components/schemas/CreateSourceMaterializationPacketV3Dto'
  ) {
    throw new Error('Realm packet operation request-body schema drift');
  }
  const request = schemas.CreateSourceMaterializationPacketV3Dto;
  if (!request || request.type !== 'object' || request.additionalProperties !== false) {
    throw new Error('Realm packet request must be a closed named object');
  }
  for (const forbidden of ['appId', 'scopeFamily', 'scopeName', 'accessGrantId']) {
    if (request?.properties?.[forbidden] || request?.required?.includes(forbidden)) {
      throw new Error(`Realm packet request retains forbidden permission input ${forbidden}`);
    }
  }
  for (const retired of RETIRED_IDENTIFIERS) {
    if (openapiText.includes(retired)) {
      throw new Error(`Realm OpenAPI retains retired permission identifier ${retired}`);
    }
  }
}

function collectNamedValues(value, key, output = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectNamedValues(item, key, output);
    return output;
  }
  if (!value || typeof value !== 'object') return output;
  for (const [name, nested] of Object.entries(value)) {
    if (name === key) output.push(nested);
    collectNamedValues(nested, key, output);
  }
  return output;
}

function assertSemanticInputs(realmRoot, admission, openapiBytes) {
  assertAccessPolicyOpenApi(openapiBytes.toString('utf8'), admission);
  const semanticText = admission.semanticFiles
    .map((file) =>
      gitBytes(realmRoot, ['show', `${admission.admittedCommit}:${file.path}`]).toString('utf8'),
    )
    .join('\n');
  for (const token of [
    ACCESS_POLICY_VERSION,
    ACCESS_POLICY_AUTHORITY_CLASS,
    'authenticated-first-party-product-operation',
    ...RETIRED_IDENTIFIERS,
  ]) {
    if (!semanticText.includes(token)) {
      throw new Error(`admitted Realm semantic inputs omit authority token ${token}`);
    }
  }
  for (const file of admission.compactVectors.filter(
    (entry) => !entry.path.endsWith('negative-mutations.json'),
  )) {
    const value = JSON.parse(
      gitBytes(realmRoot, ['show', `${admission.admittedCommit}:${file.path}`]).toString('utf8'),
    );
    const digests = collectNamedValues(value, 'accessPolicyVersionDigest');
    if (digests.length === 0 || digests.some((digest) => digest !== ACCESS_POLICY_DIGEST)) {
      throw new Error(`${file.path} access-policy digest mismatch`);
    }
  }
}

export function collectOperationInventory(document) {
  const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);
  const operations = [];
  for (const [operationPath, pathItem] of Object.entries(document?.paths || {})) {
    for (const [method, operation] of Object.entries(pathItem || {})) {
      const operationId = String(operation?.operationId || '').trim();
      if (!methods.has(method) || !operationId) continue;
      operations.push({ operationId, method, path: operationPath });
    }
  }
  return operations.sort((left, right) =>
    compareUtf16CodeUnits(left.operationId, right.operationId),
  );
}

export function validateAdmittedProducer(realmRoot, admission) {
  assertRealmRepository(realmRoot);
  const admittedCommit = git(realmRoot, ['rev-parse', `${admission.admittedCommit}^{commit}`]);
  const admittedTree = git(realmRoot, ['rev-parse', `${admission.admittedCommit}^{tree}`]);
  if (admittedCommit !== admission.admittedCommit || admittedTree !== admission.admittedTree) {
    throw new Error(`admitted Realm commit/tree mismatch: ${admittedCommit}/${admittedTree}`);
  }
  for (const file of admission.semanticFiles) {
    assertAdmittedGitFile(realmRoot, admission.admittedCommit, file);
  }
  const openapiBytes = assertAdmittedGitFile(
    realmRoot,
    admission.admittedCommit,
    admission.openapi,
  );
  for (const file of admission.compactVectors) {
    assertAdmittedGitFile(realmRoot, admission.admittedCommit, file);
  }
  assertSemanticInputs(realmRoot, admission, openapiBytes);
  const openapiText = openapiBytes.toString('utf8');
  const fragment = extractSourceMaterializationFragment(openapiText);
  if (
    fragment.sha256 !== admission.openapi.fragmentSha256 ||
    fragment.componentSchemaNames.length !== admission.openapi.componentSchemaCount ||
    canonicalJson(fragment.componentSchemaNames) !==
      canonicalJson(admission.openapi.componentSchemaNames)
  ) {
    throw new Error('admitted Realm materialization fragment mismatch');
  }
  const operations = collectOperationInventory(YAML.parse(openapiText));
  if (
    operations.length !== admission.openapi.operationCount ||
    sha256Hex(canonicalJson(operations)) !== admission.openapi.operationInventorySha256
  ) {
    throw new Error('admitted Realm operation inventory mismatch');
  }
  return { openapiBytes, fragment };
}

function schemaRefName(value) {
  const prefix = '#/components/schemas/';
  return typeof value === 'string' && value.startsWith(prefix)
    ? value.slice(prefix.length)
    : null;
}

function collectSchemaRefs(value, output) {
  if (Array.isArray(value)) {
    for (const item of value) collectSchemaRefs(item, output);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const refName = schemaRefName(value.$ref);
  if (refName) output.add(refName);
  for (const nested of Object.values(value)) collectSchemaRefs(nested, output);
}

export function extractSourceMaterializationFragment(openapiText) {
  const document = YAML.parse(openapiText);
  const operation = operationAt(document, exactPacketOperation());
  const allSchemas = document?.components?.schemas;
  if (!allSchemas || typeof allSchemas !== 'object' || Array.isArray(allSchemas)) {
    throw new Error('Realm OpenAPI components.schemas is missing');
  }
  const pending = new Set();
  collectSchemaRefs(operation, pending);
  const selected = {};
  while (pending.size > 0) {
    const [name] = [...pending].sort(compareUtf16CodeUnits);
    pending.delete(name);
    if (Object.prototype.hasOwnProperty.call(selected, name)) continue;
    const schema = allSchemas[name];
    if (!schema) {
      throw new Error(`Realm materialization fragment has unresolved schema ref ${name}`);
    }
    selected[name] = schema;
    const nested = new Set();
    collectSchemaRefs(schema, nested);
    for (const ref of nested) {
      if (!Object.prototype.hasOwnProperty.call(selected, ref)) pending.add(ref);
    }
  }
  const fragment = {
    fragment_schema_version: FRAGMENT_SCHEMA_VERSION,
    operation_id: MATERIALIZATION_OPERATION_ID,
    operation_path: MATERIALIZATION_OPERATION_PATH,
    operation_method: MATERIALIZATION_OPERATION_METHOD,
    operation,
    component_schemas: selected,
  };
  const canonical = canonicalJson(fragment);
  return {
    fragment,
    canonical,
    sha256: sha256Hex(canonical),
    componentSchemaNames: Object.keys(selected).sort(compareUtf16CodeUnits),
  };
}

export function renderLock(input) {
  const { admission } = input;
  return {
    schema_version: LOCK_SCHEMA_VERSION,
    generated_by: 'scripts/generate-realm-contract-lock.mjs',
    realm: {
      repository: REALM_REPOSITORY,
      commit: admission.admittedCommit,
      tree: admission.admittedTree,
    },
    openapi: {
      source_path: REALM_OPENAPI_SOURCE_PATH,
      synced_path: NIMI_OPENAPI_SYNCED_PATH,
      document_sha256: sha256Hex(input.openapiBytes),
      fragment_schema_version: FRAGMENT_SCHEMA_VERSION,
      fragment_selector: {
        operation_id: MATERIALIZATION_OPERATION_ID,
        path: MATERIALIZATION_OPERATION_PATH,
        method: MATERIALIZATION_OPERATION_METHOD,
      },
      fragment_sha256: input.fragment.sha256,
      component_schema_count: input.fragment.componentSchemaNames.length,
      component_schema_names: input.fragment.componentSchemaNames,
      operation_count: admission.openapi.operationCount,
      operation_inventory_sha256: admission.openapi.operationInventorySha256,
    },
    schema_versions: admission.schemaVersions,
    source_ref: admission.sourceRef,
    published_limits: admission.publishedLimits,
    access_policy: {
      version: admission.accessPolicy.version,
      digest: admission.accessPolicy.digest,
      authority_class: admission.accessPolicy.authorityClass,
      third_party_app_permission_required:
        admission.accessPolicy.thirdPartyAppPermissionRequired,
      permission_catalog: admission.accessPolicy.permissionCatalog,
      packet_operation: admission.accessPolicy.packetOperation,
      authorization_inputs: admission.accessPolicy.authorizationInputs,
      forbidden_inputs: admission.accessPolicy.forbiddenInputs,
      retired_identifiers: admission.accessPolicy.retiredIdentifiers,
      retired_endpoints: admission.accessPolicy.retiredEndpoints,
    },
    compact_vectors: Object.fromEntries(
      admission.compactVectors.map((file) => [path.basename(file.path), file.sha256]),
    ),
    producer_admission: {
      tracked_only: true,
      head_policy: admission.headPolicy,
      semantic_file_bundle_sha256: sha256Hex(canonicalJson(admission.semanticFiles)),
      semantic_files: admission.semanticFiles,
    },
  };
}

function generate(realmRoot) {
  const admission = readAdmission();
  const { openapiBytes, fragment } = validateAdmittedProducer(realmRoot, admission);
  const lock = renderLock({ admission, openapiBytes, fragment });
  const suffix = `.tmp-${process.pid}`;
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.mkdirSync(path.dirname(syncedOpenapiPath), { recursive: true });
  fs.writeFileSync(`${lockPath}${suffix}`, YAML.stringify(lock), 'utf8');
  fs.writeFileSync(`${syncedOpenapiPath}${suffix}`, openapiBytes);
  fs.renameSync(`${syncedOpenapiPath}${suffix}`, syncedOpenapiPath);
  fs.renameSync(`${lockPath}${suffix}`, lockPath);
  process.stdout.write(
    `generated ${NIMI_OPENAPI_SYNCED_PATH} and ${path.relative(repoRoot, lockPath)}: realm=${admission.admittedCommit} tree=${admission.admittedTree} fragment=${fragment.sha256}\n`,
  );
}

const isEntrypoint =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  try {
    generate(parseRealmRoot(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(
      `[generate:realm-contract-lock] ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
