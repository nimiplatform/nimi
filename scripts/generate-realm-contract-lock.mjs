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
export const MATERIALIZATION_OPERATION_ID = 'WorldCoreController_createSourceMaterializationPacket';
export const MATERIALIZATION_OPERATION_PATH = '/api/realm/core/source-materialization-packets';
export const MATERIALIZATION_OPERATION_METHOD = 'post';
export const FRAGMENT_SCHEMA_VERSION = 'nimi.realm-openapi-source-materialization-fragment/v1';
export const LOCK_SCHEMA_VERSION = 'nimi.realm-contract-lock/v3';
export const ADMISSION_SCHEMA_VERSION = 'nimi.realm-current-producer-admission/v2';
export const ACCESS_POLICY_VERSION = 'realm.source-materialization-access-policy/v4';
export const ACCESS_POLICY_DIGEST = '34f338ae76cbd85de58054cd6fc4d0ee18500030a0bc12f091e88d46f2fc572f';
export const ACCESS_POLICY_SELECTOR = Object.freeze({
  appId: 'nimi.avatar',
  scopeFamily: 'realm_source',
  scopeName: 'realm_source.snapshot.consume',
  qualifier: null,
  qualifierKey: '',
  state: 'GRANTED',
});
export const RUNTIME_GRANT_ACQUISITION = Object.freeze({
  admitted_result_states: Object.freeze(['PENDING', 'GRANTED']),
  pending_disposition: 'explicit_grant_same_id_expected_version',
  granted_disposition: 'reuse_exact_current_same_id',
  packet_grant_id_source: 'canonical_request_result_id',
  fresh_packet_security: Object.freeze(['challenge', 'nonce', 'ttl', 'proof', 'realm_authorization']),
  rejected_result_states: Object.freeze(['DENIED', 'EXPIRED', 'REVOKED', 'SUPERSEDED']),
});

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const lockPath = path.join(repoRoot, 'config', 'realm-contract-lock.yaml');
const admissionPath = path.join(repoRoot, 'config', 'realm-v3', 'current-producer-admission.json');
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
    throw new Error(`Realm repository mismatch: expected ${REALM_REPOSITORY}, got ${repository || '<missing>'}`);
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
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
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

function readAdmission() {
  const admission = JSON.parse(fs.readFileSync(admissionPath, 'utf8'));
  if (admission?.schemaVersion !== ADMISSION_SCHEMA_VERSION) {
    throw new Error(`unsupported current Realm admission schema: ${admission?.schemaVersion || '<missing>'}`);
  }
  if (admission.repository !== REALM_REPOSITORY) {
    throw new Error(`current Realm admission repository mismatch: ${admission.repository || '<missing>'}`);
  }
  if (admission.headPolicy !== 'identical_admitted_inputs') {
    throw new Error(`unsupported current Realm HEAD policy: ${admission.headPolicy || '<missing>'}`);
  }
  return admission;
}

function assertAdmittedGitFile(realmRoot, admittedCommit, file) {
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

function assertEvidenceFile(realmRoot, file) {
  const absolutePath = path.join(realmRoot, file.path);
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    throw new Error(`missing admitted Realm evidence ${file.path}`);
  }
  const bytes = fs.readFileSync(absolutePath);
  assertSha256(bytes, file.sha256, file.path);
  const value = JSON.parse(bytes.toString('utf8'));
  if (value.schemaVersion !== file.schemaVersion || value.contentHash !== file.contentHash) {
    throw new Error(`${file.path} schema/content hash mismatch`);
  }
}

function assertFocusedA1(realmRoot, admission) {
  const file = admission.focusedA1;
  const absolutePath = path.join(realmRoot, file.path);
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    throw new Error(`missing admitted Realm focused A1 ${file.path}`);
  }
  const bytes = fs.readFileSync(absolutePath);
  assertSha256(bytes, file.sha256, file.path);
  const value = YAML.parse(bytes.toString('utf8'));
  if (value?.schema_version !== file.schemaVersion
    || value?.candidate?.commit !== admission.admittedCommit
    || value?.candidate?.tree !== admission.admittedTree
    || value?.candidate?.identity_match !== true
    || value?.verdict !== file.verdict
    || value?.acceptance?.pass !== file.acceptancePass
    || value?.acceptance?.fail !== 0
    || value?.acceptance?.unverifiable !== 0
    || value?.product_blockers !== file.productBlockers
    || value?.finding_closure?.id !== file.findingId
    || value?.finding_closure?.status !== file.findingStatus) {
    throw new Error(`${file.path} focused A1 identity/verdict mismatch`);
  }
}

function schemaRef(value) {
  return value?.$ref;
}

function operationAt(document, expected) {
  const operation = document?.paths?.[expected.path]?.[expected.method];
  if (operation?.operationId !== expected.operationId) {
    throw new Error(`Realm OpenAPI missing ${expected.method.toUpperCase()} ${expected.path} (${expected.operationId})`);
  }
  return operation;
}

export function assertAccessPolicyAdmission(admission) {
  const policy = admission?.accessPolicy;
  if (policy?.version !== ACCESS_POLICY_VERSION
    || policy?.digest !== ACCESS_POLICY_DIGEST
    || canonicalJson(policy?.selector) !== canonicalJson(ACCESS_POLICY_SELECTOR)) {
    throw new Error('current Realm access-policy version/digest/selector mismatch');
  }
  const expectedLifecycle = {
    request: {
      operationId: 'requestMyAppPermissionGrant',
      method: 'post',
      path: '/api/human/me/permission-grants',
      resultState: 'PENDING',
    },
    grant: {
      operationId: 'grantMyAppPermissionGrant',
      method: 'post',
      path: '/api/human/me/permission-grants/by-id/{grantId}/grant',
      requiresExpectedVersion: true,
    },
    packet: {
      operationId: MATERIALIZATION_OPERATION_ID,
      method: MATERIALIZATION_OPERATION_METHOD,
      path: MATERIALIZATION_OPERATION_PATH,
      grantIdField: 'accessGrantId',
    },
  };
  if (canonicalJson(policy?.lifecycle) !== canonicalJson(expectedLifecycle)
    || canonicalJson(policy?.nonAuthorizingScopeNames)
      !== canonicalJson(['realm_source.snapshot.bind', 'agent.identity.project'])) {
    throw new Error('current Realm grant lifecycle/non-authorizing scope contract mismatch');
  }
}

export function assertAccessPolicyOpenApi(openapiText, admission) {
  assertAccessPolicyAdmission(admission);
  const document = YAML.parse(openapiText);
  const schemas = document?.components?.schemas || {};
  if (canonicalJson(schemas.AppPermissionScopeFamily?.enum)
      !== canonicalJson([ACCESS_POLICY_SELECTOR.scopeFamily])
    || canonicalJson(schemas.AppPermissionScopeName?.enum)
      !== canonicalJson([ACCESS_POLICY_SELECTOR.scopeName])) {
    throw new Error('Realm OpenAPI permission scope catalog is not the exact current Realm selector');
  }
  const requestOperation = operationAt(document, admission.accessPolicy.lifecycle.request);
  const grantOperation = operationAt(document, admission.accessPolicy.lifecycle.grant);
  const packetOperation = operationAt(document, admission.accessPolicy.lifecycle.packet);
  if (schemaRef(requestOperation?.requestBody?.content?.['application/json']?.schema)
      !== '#/components/schemas/AppPermissionGrantRequestDto'
    || schemaRef(grantOperation?.requestBody?.content?.['application/json']?.schema)
      !== '#/components/schemas/AppPermissionGrantGrantDto'
    || schemaRef(packetOperation?.requestBody?.content?.['application/json']?.schema)
      !== '#/components/schemas/CreateSourceMaterializationPacketV3Dto') {
    throw new Error('Realm OpenAPI grant lifecycle request-body schema drift');
  }
  const request = schemas.AppPermissionGrantRequestDto;
  const grant = schemas.AppPermissionGrantGrantDto;
  const packet = schemas.CreateSourceMaterializationPacketV3Dto;
  if (!request?.required?.includes('appId')
    || !request?.required?.includes('scopeFamily')
    || !request?.required?.includes('scopeName')
    || request?.required?.includes('qualifier')
    || !grant?.required?.includes('expectedVersion')
    || !packet?.required?.includes(admission.accessPolicy.lifecycle.packet.grantIdField)) {
    throw new Error('Realm OpenAPI request -> explicit grant -> packet field contract drift');
  }
  if (canonicalJson(schemas.AppPermissionGrantState?.enum)
      !== canonicalJson(['PENDING', 'GRANTED', 'DENIED', 'EXPIRED', 'REVOKED', 'SUPERSEDED'])) {
    throw new Error('Realm OpenAPI permission grant state machine drift');
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

function assertAccessPolicyInputs(realmRoot, admission, openapiBytes) {
  assertAccessPolicyOpenApi(openapiBytes.toString('utf8'), admission);
  const semanticText = admission.semanticFiles
    .map((file) => gitBytes(realmRoot, ['show', `${admission.admittedCommit}:${file.path}`]).toString('utf8'))
    .join('\n');
  for (const token of [
    ACCESS_POLICY_VERSION,
    ACCESS_POLICY_SELECTOR.appId,
    ACCESS_POLICY_SELECTOR.scopeFamily,
    ACCESS_POLICY_SELECTOR.scopeName,
    'realm_source.snapshot.bind',
    'agent.identity.project',
  ]) {
    if (!semanticText.includes(token)) {
      throw new Error(`admitted Realm semantic inputs omit access-policy token ${token}`);
    }
  }
  for (const file of admission.compactVectors.filter((entry) => !entry.path.endsWith('negative-mutations.json'))) {
    const value = JSON.parse(gitBytes(realmRoot, ['show', `${admission.admittedCommit}:${file.path}`]).toString('utf8'));
    const digests = collectNamedValues(value, 'accessPolicyVersionDigest');
    if (digests.length === 0 || digests.some((digest) => digest !== ACCESS_POLICY_DIGEST)) {
      throw new Error(`${file.path} access-policy digest mismatch`);
    }
  }
}

function collectOperationInventory(document) {
  const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);
  const operations = [];
  for (const [operationPath, pathItem] of Object.entries(document?.paths || {})) {
    for (const [method, operation] of Object.entries(pathItem || {})) {
      const operationId = String(operation?.operationId || '').trim();
      if (!methods.has(method) || !operationId) continue;
      operations.push({ operationId, method, path: operationPath });
    }
  }
  return operations.sort((left, right) => compareUtf16CodeUnits(left.operationId, right.operationId));
}

function assertAdmittedProducer(realmRoot, admission) {
  assertRealmRepository(realmRoot);
  const admittedCommit = git(realmRoot, ['rev-parse', `${admission.admittedCommit}^{commit}`]);
  const admittedTree = git(realmRoot, ['rev-parse', `${admission.admittedCommit}^{tree}`]);
  if (admittedCommit !== admission.admittedCommit || admittedTree !== admission.admittedTree) {
    throw new Error(`admitted Realm commit/tree mismatch: commit=${admittedCommit} tree=${admittedTree}`);
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
  assertEvidenceFile(realmRoot, admission.closureManifest);
  assertEvidenceFile(realmRoot, admission.handoff);
  assertFocusedA1(realmRoot, admission);
  assertAccessPolicyInputs(realmRoot, admission, openapiBytes);
  return openapiBytes;
}

function schemaRefName(value) {
  const prefix = '#/components/schemas/';
  return typeof value === 'string' && value.startsWith(prefix) ? value.slice(prefix.length) : null;
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
  const operation = document?.paths?.[MATERIALIZATION_OPERATION_PATH]?.[MATERIALIZATION_OPERATION_METHOD];
  if (!operation || operation.operationId !== MATERIALIZATION_OPERATION_ID) {
    throw new Error(`Realm OpenAPI missing ${MATERIALIZATION_OPERATION_METHOD.toUpperCase()} ${MATERIALIZATION_OPERATION_PATH} (${MATERIALIZATION_OPERATION_ID})`);
  }

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
    if (!schema) throw new Error(`Realm OpenAPI materialization fragment has unresolved schema ref: ${name}`);
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
      selector: admission.accessPolicy.selector,
      lifecycle: admission.accessPolicy.lifecycle,
      runtime_acquisition: RUNTIME_GRANT_ACQUISITION,
      non_authorizing_scope_names: admission.accessPolicy.nonAuthorizingScopeNames,
    },
    compact_vectors: Object.fromEntries(
      admission.compactVectors.map((file) => [path.basename(file.path), file.sha256]),
    ),
    producer_evidence: {
      closure_manifest: {
        path: admission.closureManifest.path,
        schema_version: admission.closureManifest.schemaVersion,
        sha256: admission.closureManifest.sha256,
        content_hash: admission.closureManifest.contentHash,
      },
      handoff: {
        path: admission.handoff.path,
        schema_version: admission.handoff.schemaVersion,
        sha256: admission.handoff.sha256,
        content_hash: admission.handoff.contentHash,
        consumer_side_actions: admission.handoff.consumerSideActions,
        realm_side_actions: admission.handoff.realmSideActions,
        unmapped_mandatory_inputs: admission.handoff.unmappedMandatoryInputs,
      },
      focused_a1: {
        path: admission.focusedA1.path,
        schema_version: admission.focusedA1.schemaVersion,
        sha256: admission.focusedA1.sha256,
        verdict: admission.focusedA1.verdict,
        acceptance_pass: admission.focusedA1.acceptancePass,
        product_blockers: admission.focusedA1.productBlockers,
        finding_id: admission.focusedA1.findingId,
        finding_status: admission.focusedA1.findingStatus,
      },
      closure_content_hash: admission.closureManifest.contentHash,
      handoff_content_hash: admission.handoff.contentHash,
    },
  };
}

function generate(realmRoot) {
  const admission = readAdmission();
  const openapiBytes = assertAdmittedProducer(realmRoot, admission);
  const openapiText = openapiBytes.toString('utf8');
  const fragment = extractSourceMaterializationFragment(openapiText);
  if (fragment.sha256 !== admission.openapi.fragmentSha256
    || fragment.componentSchemaNames.length !== admission.openapi.componentSchemaCount
    || JSON.stringify(fragment.componentSchemaNames) !== JSON.stringify(admission.openapi.componentSchemaNames)) {
    throw new Error('admitted Realm materialization fragment mismatch');
  }
  const operations = collectOperationInventory(YAML.parse(openapiText));
  if (operations.length !== admission.openapi.operationCount
    || sha256Hex(canonicalJson(operations)) !== admission.openapi.operationInventorySha256) {
    throw new Error('admitted Realm operation inventory mismatch');
  }

  const lock = renderLock({ admission, openapiBytes, fragment });
  const lockText = YAML.stringify(lock);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.mkdirSync(path.dirname(syncedOpenapiPath), { recursive: true });
  const suffix = `.tmp-${process.pid}`;
  const lockTemporaryPath = `${lockPath}${suffix}`;
  const openapiTemporaryPath = `${syncedOpenapiPath}${suffix}`;
  fs.writeFileSync(lockTemporaryPath, lockText, 'utf8');
  fs.writeFileSync(openapiTemporaryPath, openapiBytes);
  fs.renameSync(openapiTemporaryPath, syncedOpenapiPath);
  fs.renameSync(lockTemporaryPath, lockPath);
  process.stdout.write(
    `generated ${NIMI_OPENAPI_SYNCED_PATH} and ${path.relative(repoRoot, lockPath)}: realm=${admission.admittedCommit} tree=${admission.admittedTree} fragment=${fragment.sha256}\n`,
  );
}

const isEntrypoint = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  try {
    generate(parseRealmRoot(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`[generate:realm-contract-lock] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
