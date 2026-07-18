#!/usr/bin/env node

import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

import {
  ACCESS_POLICY_DIGEST,
  ACCESS_POLICY_SELECTOR,
  ACCESS_POLICY_VERSION,
  ADMISSION_SCHEMA_VERSION,
  LOCK_SCHEMA_VERSION,
  RUNTIME_GRANT_ACQUISITION,
  canonicalJson,
  compareUtf16CodeUnits,
  REALM_REPOSITORY,
  assertAccessPolicyAdmission,
  assertAccessPolicyOpenApi,
  extractSourceMaterializationFragment,
  sha256Hex,
} from './generate-realm-contract-lock.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const admissionPath = path.join(repoRoot, 'config/realm-v3/current-producer-admission.json');
const lockPath = path.join(repoRoot, 'config/realm-contract-lock.yaml');

function fail(message) {
  throw new Error(`current Realm contract admission failed: ${message}`);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function git(root, ...args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function normalizeRepository(value) {
  const source = String(value || '').trim();
  if (source.startsWith('git@github.com:')) {
    return `https://github.com/${source.slice('git@github.com:'.length)}`;
  }
  if (source.startsWith('ssh://git@github.com/')) {
    return `https://github.com/${source.slice('ssh://git@github.com/'.length)}`;
  }
  return source;
}

function parseArgs(argv) {
  const realmRootIndex = argv.indexOf('--realm-root');
  if (realmRootIndex < 0 || !String(argv[realmRootIndex + 1] || '').trim()) {
    fail('usage: check-realm-contract-current.mjs --realm-root <realm-checkout> [--admission-only]');
  }
  return {
    realmRoot: path.resolve(argv[realmRootIndex + 1]),
    admissionOnly: argv.includes('--admission-only'),
  };
}

function assertFileDigest(realmRoot, admittedCommit, file) {
  const workingPath = path.join(realmRoot, file.path);
  if (!fs.existsSync(workingPath) || !fs.statSync(workingPath).isFile()) {
    fail(`missing admitted Realm input ${file.path}`);
  }
  const working = fs.readFileSync(workingPath);
  const admitted = execFileSync('git', ['show', `${admittedCommit}:${file.path}`], {
    cwd: realmRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const workingHash = sha256(working);
  const admittedHash = sha256(admitted);
  if (workingHash !== file.sha256 || admittedHash !== file.sha256) {
    fail(`${file.path} digest drift: expected=${file.sha256} admitted=${admittedHash} worktree=${workingHash}`);
  }
  const admittedObject = git(realmRoot, 'rev-parse', `${admittedCommit}:${file.path}`);
  const headObject = git(realmRoot, 'rev-parse', `HEAD:${file.path}`);
  if (headObject !== admittedObject) {
    fail(`${file.path} current HEAD object drift: admitted=${admittedObject} head=${headObject}`);
  }
  return { path: file.path, sha256: workingHash, object: admittedObject };
}

function collectStringConstants(value, output = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectStringConstants(item, output);
  } else if (value && typeof value === 'object') {
    if (typeof value.const === 'string') output.add(value.const);
    if (Array.isArray(value.enum)) {
      for (const item of value.enum) if (typeof item === 'string') output.add(item);
    }
    for (const item of Object.values(value)) collectStringConstants(item, output);
  }
  return output;
}

function assertSourceRef(document, admission) {
  const schemas = document?.components?.schemas;
  const union = schemas?.[admission.sourceRef.schema];
  if (union?.discriminator?.propertyName !== admission.sourceRef.discriminator) {
    fail('CharacterSourceRefV3 discriminator drift');
  }
  if (JSON.stringify(Object.keys(union?.discriminator?.mapping || {}).sort())
    !== JSON.stringify([...admission.sourceRef.kinds].sort())) {
    fail('CharacterSourceRefV3 discriminator kind set drift');
  }
  const oneOfRefs = (union?.oneOf || []).map((entry) => entry?.$ref);
  const expectedRefs = admission.sourceRef.kinds.map((kind) =>
    `#/components/schemas/${admission.sourceRef.branches[kind]}`);
  if (JSON.stringify(oneOfRefs) !== JSON.stringify(expectedRefs)) {
    fail('CharacterSourceRefV3 oneOf branch drift');
  }
  for (const kind of admission.sourceRef.kinds) {
    const branchName = admission.sourceRef.branches[kind];
    if (union?.discriminator?.mapping?.[kind] !== `#/components/schemas/${branchName}`) {
      fail(`CharacterSourceRefV3 mapping drift for ${kind}`);
    }
    const branch = schemas?.[branchName];
    if (branch?.additionalProperties !== false
      || JSON.stringify(branch?.properties?.kind?.enum) !== JSON.stringify([kind])) {
      fail(`CharacterSourceRefV3 branch is not closed for ${kind}`);
    }
    if (JSON.stringify(branch?.required) !== JSON.stringify(admission.sourceRef.requiredFields[kind])) {
      fail(`CharacterSourceRefV3 required-field order/set drift for ${kind}`);
    }
  }
}

function assertPublishedLimits(document, admission) {
  const schemas = document?.components?.schemas;
  const schema = schemas?.SourceMaterializationPublishedLimitsDto;
  if (schema?.additionalProperties !== false) fail('published limits schema is not closed');
  const fields = Object.keys(admission.publishedLimits);
  if (JSON.stringify([...(schema?.required || [])].sort()) !== JSON.stringify([...fields].sort())) {
    fail('published limits required-field set drift');
  }
  for (const [field, maximum] of Object.entries(admission.publishedLimits)) {
    const property = schema?.properties?.[field];
    if (property?.type !== 'number' || property?.minimum !== 1 || property?.maximum !== maximum) {
      fail(`published limit drift for ${field}`);
    }
  }
  for (const owner of [
    'CreateSourceMaterializationPacketV3Dto',
    'SourceMaterializationPacketV3Dto',
    'MaterializationClosureSetManifestV3Dto',
  ]) {
    if (schemas?.[owner]?.properties?.publishedLimits?.$ref
      !== '#/components/schemas/SourceMaterializationPublishedLimitsDto') {
      fail(`published limits reference drift for ${owner}`);
    }
  }
}

function collectOperationInventory(document) {
  const verbs = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);
  const operations = [];
  for (const [operationPath, pathItem] of Object.entries(document?.paths || {})) {
    for (const [method, operation] of Object.entries(pathItem || {})) {
      const operationId = String(operation?.operationId || '').trim();
      if (!verbs.has(method) || !operationId) continue;
      operations.push({ operationId, method, path: operationPath });
    }
  }
  operations.sort((left, right) => compareUtf16CodeUnits(left.operationId, right.operationId));
  return operations;
}

function assertOpenApi(realmRoot, admission) {
  const [fileResult] = [assertFileDigest(realmRoot, admission.admittedCommit, admission.openapi)];
  const text = fs.readFileSync(path.join(realmRoot, admission.openapi.path), 'utf8');
  const fragment = extractSourceMaterializationFragment(text);
  if (fragment.sha256 !== admission.openapi.fragmentSha256) {
    fail(`materialization fragment digest drift: expected=${admission.openapi.fragmentSha256} actual=${fragment.sha256}`);
  }
  if (fragment.componentSchemaNames.length !== admission.openapi.componentSchemaCount) {
    fail(`materialization fragment schema count drift: expected=${admission.openapi.componentSchemaCount} actual=${fragment.componentSchemaNames.length}`);
  }
  if (JSON.stringify(fragment.componentSchemaNames) !== JSON.stringify(admission.openapi.componentSchemaNames)) {
    fail('materialization fragment exact schema-name set drift');
  }
  const document = YAML.parse(text);
  assertAccessPolicyOpenApi(text, admission);
  const operation = document?.paths?.[admission.openapi.pathTemplate]?.[admission.openapi.method];
  if (operation?.operationId !== admission.openapi.operationId) {
    fail('materialization operation id/path/method drift');
  }
  const operations = collectOperationInventory(document);
  const operationInventorySha256 = sha256Hex(canonicalJson(operations));
  if (operations.length !== admission.openapi.operationCount
    || operationInventorySha256 !== admission.openapi.operationInventorySha256) {
    fail(`OpenAPI operation inventory drift: count=${operations.length} sha256=${operationInventorySha256}`);
  }
  if (operations.some((entry) => /RealmPersona|realmPersona/u.test(entry.operationId))) {
    fail('OpenAPI operation inventory retains RealmPersona operation IDs');
  }
  assertSourceRef(document, admission);
  assertPublishedLimits(document, admission);
  const constants = collectStringConstants(fragment.fragment);
  for (const expected of Object.values(admission.schemaVersions)) {
    if (!constants.has(expected)) fail(`materialization fragment is missing schema constant ${expected}`);
  }
  for (const forbidden of [
    'realm.source-materialization-packet/v2',
    'realm.materialization-context/v1',
    'realm.materialization-coverage/v1',
    'realm.materialization-bundle-manifest/v1',
  ]) {
    if (constants.has(forbidden)) fail(`materialization fragment retains forbidden schema constant ${forbidden}`);
  }
  return {
    ...fileResult,
    fragmentSha256: fragment.sha256,
    componentSchemaCount: fragment.componentSchemaNames.length,
    componentSchemaNames: fragment.componentSchemaNames,
    operationCount: operations.length,
    operationInventorySha256,
    sourceKinds: admission.sourceRef.kinds,
    publishedLimits: admission.publishedLimits,
  };
}

function assertFocusedA1Evidence(realmRoot, admission) {
  const expected = admission.focusedA1;
  const absolute = path.join(realmRoot, expected.path);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    fail(`missing Realm focused A1 ${expected.path}`);
  }
  const bytes = fs.readFileSync(absolute);
  const actualSha = sha256(bytes);
  if (actualSha !== expected.sha256) {
    fail(`${expected.path} SHA-256 drift: expected=${expected.sha256} actual=${actualSha}`);
  }
  const value = YAML.parse(bytes.toString('utf8'));
  if (value?.schema_version !== expected.schemaVersion
    || value?.candidate?.commit !== admission.admittedCommit
    || value?.candidate?.tree !== admission.admittedTree
    || value?.candidate?.identity_match !== true
    || value?.verdict !== expected.verdict
    || value?.acceptance?.pass !== expected.acceptancePass
    || value?.acceptance?.fail !== 0
    || value?.acceptance?.unverifiable !== 0
    || value?.product_blockers !== expected.productBlockers
    || value?.finding_closure?.id !== expected.findingId
    || value?.finding_closure?.status !== expected.findingStatus) {
    fail(`${expected.path} focused A1 identity/verdict drift`);
  }
  return {
    path: expected.path,
    sha256: actualSha,
    verdict: value.verdict,
    acceptancePass: value.acceptance.pass,
    productBlockers: value.product_blockers,
    findingStatus: value.finding_closure.status,
  };
}

function assertJsonEvidence(realmRoot, expected, extraChecks) {
  const absolute = path.join(realmRoot, expected.path);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    fail(`missing Realm evidence ${expected.path}`);
  }
  const bytes = fs.readFileSync(absolute);
  const actualSha = sha256(bytes);
  if (actualSha !== expected.sha256) {
    fail(`${expected.path} SHA-256 drift: expected=${expected.sha256} actual=${actualSha}`);
  }
  const value = JSON.parse(bytes.toString('utf8'));
  if (value.schemaVersion !== expected.schemaVersion || value.contentHash !== expected.contentHash) {
    fail(`${expected.path} schema/content hash drift`);
  }
  extraChecks(value);
  return { path: expected.path, sha256: actualSha, contentHash: value.contentHash };
}

function assertCurrentLock(admission) {
  if (!fs.existsSync(lockPath)) fail('missing config/realm-contract-lock.yaml');
  const lock = YAML.parse(fs.readFileSync(lockPath, 'utf8'));
  if (lock?.schema_version !== LOCK_SCHEMA_VERSION) {
    fail(`stale Realm lock schema ${lock?.schema_version || '<missing>'}; expected ${LOCK_SCHEMA_VERSION}`);
  }
  const expected = {
    repository: admission.repository,
    commit: admission.admittedCommit,
    tree: admission.admittedTree,
    documentSha256: admission.openapi.sha256,
    fragmentSha256: admission.openapi.fragmentSha256,
    componentSchemaCount: admission.openapi.componentSchemaCount,
    schemaVersions: admission.schemaVersions,
    vectorHashes: Object.fromEntries(admission.compactVectors.map((item) => [path.basename(item.path), item.sha256])),
    closureContentHash: admission.closureManifest.contentHash,
    handoffContentHash: admission.handoff.contentHash,
    accessPolicy: {
      version: ACCESS_POLICY_VERSION,
      digest: ACCESS_POLICY_DIGEST,
      selector: ACCESS_POLICY_SELECTOR,
      lifecycle: admission.accessPolicy.lifecycle,
      runtimeAcquisition: RUNTIME_GRANT_ACQUISITION,
      nonAuthorizingScopeNames: admission.accessPolicy.nonAuthorizingScopeNames,
    },
    focusedA1: {
      path: admission.focusedA1.path,
      schemaVersion: admission.focusedA1.schemaVersion,
      sha256: admission.focusedA1.sha256,
      verdict: admission.focusedA1.verdict,
      acceptancePass: admission.focusedA1.acceptancePass,
      productBlockers: admission.focusedA1.productBlockers,
      findingId: admission.focusedA1.findingId,
      findingStatus: admission.focusedA1.findingStatus,
    },
  };
  const actual = {
    repository: lock?.realm?.repository,
    commit: lock?.realm?.commit,
    tree: lock?.realm?.tree,
    documentSha256: lock?.openapi?.document_sha256,
    fragmentSha256: lock?.openapi?.fragment_sha256,
    componentSchemaCount: lock?.openapi?.component_schema_count,
    schemaVersions: lock?.schema_versions,
    vectorHashes: lock?.compact_vectors,
    closureContentHash: lock?.producer_evidence?.closure_content_hash,
    handoffContentHash: lock?.producer_evidence?.handoff_content_hash,
    accessPolicy: {
      version: lock?.access_policy?.version,
      digest: lock?.access_policy?.digest,
      selector: lock?.access_policy?.selector,
      lifecycle: lock?.access_policy?.lifecycle,
      runtimeAcquisition: lock?.access_policy?.runtime_acquisition,
      nonAuthorizingScopeNames: lock?.access_policy?.non_authorizing_scope_names,
    },
    focusedA1: {
      path: lock?.producer_evidence?.focused_a1?.path,
      schemaVersion: lock?.producer_evidence?.focused_a1?.schema_version,
      sha256: lock?.producer_evidence?.focused_a1?.sha256,
      verdict: lock?.producer_evidence?.focused_a1?.verdict,
      acceptancePass: lock?.producer_evidence?.focused_a1?.acceptance_pass,
      productBlockers: lock?.producer_evidence?.focused_a1?.product_blockers,
      findingId: lock?.producer_evidence?.focused_a1?.finding_id,
      findingStatus: lock?.producer_evidence?.focused_a1?.finding_status,
    },
  };
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail('config/realm-contract-lock.yaml does not bind the admitted current Realm producer');
  }
}

function check({ realmRoot, admissionOnly }) {
  const admission = JSON.parse(fs.readFileSync(admissionPath, 'utf8'));
  if (admission.schemaVersion !== ADMISSION_SCHEMA_VERSION) {
    fail('unsupported current producer admission schema');
  }
  if (admission.headPolicy !== 'identical_admitted_inputs') {
    fail('unsupported current producer HEAD policy');
  }
  assertAccessPolicyAdmission(admission);
  const repository = normalizeRepository(git(realmRoot, 'remote', 'get-url', 'origin'));
  if (repository !== REALM_REPOSITORY || repository !== admission.repository) {
    fail(`repository mismatch: expected=${admission.repository} actual=${repository}`);
  }
  const admittedCommit = git(realmRoot, 'rev-parse', `${admission.admittedCommit}^{commit}`);
  const admittedTree = git(realmRoot, 'rev-parse', `${admission.admittedCommit}^{tree}`);
  if (admittedCommit !== admission.admittedCommit || admittedTree !== admission.admittedTree) {
    fail(`admitted commit/tree mismatch: commit=${admittedCommit} tree=${admittedTree}`);
  }
  const semanticFiles = admission.semanticFiles.map((file) =>
    assertFileDigest(realmRoot, admittedCommit, file));
  const openapi = assertOpenApi(realmRoot, admission);
  const compactVectors = admission.compactVectors.map((file) =>
    assertFileDigest(realmRoot, admittedCommit, file));
  const closureManifest = assertJsonEvidence(realmRoot, admission.closureManifest, (value) => {
    if (value.status !== 'CLOSED' || value.realmFullchainClosed !== true || value.successorAuthorized !== true) {
      fail('Realm closure manifest is not closed and successor-authorized');
    }
  });
  const handoff = assertJsonEvidence(realmRoot, admission.handoff, (value) => {
    if (value.status !== 'FINAL'
      || value.consumerSideActions !== admission.handoff.consumerSideActions
      || value.realmSideActions !== admission.handoff.realmSideActions
      || value.unmappedMandatoryInputs !== admission.handoff.unmappedMandatoryInputs) {
      fail('Realm handoff counts/status drift');
    }
  });
  const focusedA1 = assertFocusedA1Evidence(realmRoot, admission);
  if (!admissionOnly) assertCurrentLock(admission);

  return {
    schemaVersion: 'nimi.realm-current-producer-admission-result/v2',
    verdict: 'PASS',
    mode: admissionOnly ? 'admission_only' : 'current_lock',
    realm: {
      admittedCommit,
      admittedTree,
      currentHead: git(realmRoot, 'rev-parse', 'HEAD'),
      currentTree: git(realmRoot, 'rev-parse', 'HEAD^{tree}'),
    },
    semanticFiles,
    openapi,
    compactVectors,
    closureManifest,
    handoff,
    focusedA1,
    accessPolicy: admission.accessPolicy,
  };
}

try {
  const result = check(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`[check:realm-contract-current] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
