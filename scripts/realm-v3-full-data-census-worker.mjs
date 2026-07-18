#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, open, readFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

const REQUEST_SCHEMA = 'nimi.realm-v3-full-data-source-census-request/v1';
const RECEIPT_SCHEMA = 'nimi.realm-v3-full-data-source-census/v1';
const LIVE_ATTESTATION_SCHEMA = 'nimi.realm-v3-full-data-live-environment-attestation/v1';
export const FIXED_REALM_COMMIT = '15d96300bf9c4b1305bb68818208682b10e0c7c0';
export const FIXED_REALM_TREE = '0b743e2b5190a470a5e8685eac09a0a3221b41ee';
export const CURRENT_OPENAPI_DIGEST = 'ebf90752f0033779231bbe87cacdca4b079f3c3c976ac5f429b092bc39c9145f';
export const CURRENT_ACCESS_POLICY_DIGEST = '7649e8c7aa85f6667b1af5134686fc653f33ed5094e5d11483a5e60f39765faa';
const SHA256_RE = /^[0-9a-f]{64}$/u;
const SAFE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u;
const DISPOSABLE_DATABASE_RE = /^nimi_realm_v3_n7_[0-9a-f]{32}$/u;
const REQUIRED_TOTAL = 471;
const REQUIRED_WORLDS = 470;
const REQUIRED_PERSONAS = 1;
const TRUSTED_TOOL_NAMES = ['docker', 'git', 'go', 'pnpm', 'ps', 'tar'];
export const LIVE_ENVIRONMENT_MODULE_BASENAMES = Object.freeze([
  'realm-v3-full-data-live-contract.mjs',
  'realm-v3-full-data-live-attestation.mjs',
  'realm-v3-full-data-live-infrastructure.mjs',
  'realm-v3-full-data-live-services.mjs',
  'realm-v3-full-data-live-prepare.mjs',
  'realm-v3-full-data-live-cleanup.mjs',
]);
let admittedDockerPathHash = null;

export function canonicalJSONStringify(value) {
  const normalize = (candidate, pointer) => {
    if (candidate === null || typeof candidate === 'string' || typeof candidate === 'boolean') {
      return candidate;
    }
    if (typeof candidate === 'number') {
      if (!Number.isSafeInteger(candidate)) throw new Error(`${pointer} must be a safe integer`);
      return candidate;
    }
    if (Array.isArray(candidate)) {
      return candidate.map((entry, index) => normalize(entry, `${pointer}/${index}`));
    }
    if (candidate && typeof candidate === 'object') {
      const result = {};
      for (const key of Object.keys(candidate).sort()) {
        if (candidate[key] === undefined) throw new Error(`${pointer}/${key} is undefined`);
        result[key] = normalize(candidate[key], `${pointer}/${key}`);
      }
      return result;
    }
    throw new Error(`${pointer} is not canonical JSON data`);
  };
  return JSON.stringify(normalize(value, '$'));
}

export function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function domainHash(domain, value) {
  return sha256Hex(`${domain}\0${canonicalJSONStringify(value)}`);
}

function assertClosedObject(value, required, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const expected = new Set(required);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) throw new Error(`${label}.${key} is not admitted`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) throw new Error(`${label}.${key} is required`);
  }
}

function assertSHA256(value, label) {
  if (typeof value !== 'string' || !SHA256_RE.test(value)) throw new Error(`${label} is not SHA-256`);
}

function assertEqual(left, right, label) {
  if (canonicalJSONStringify(left) !== canonicalJSONStringify(right)) {
    throw new Error(`${label} mismatch`);
  }
}

function validateProducerIdentity(identity, label) {
  assertClosedObject(identity, ['commit', 'tree', 'openapiDigest', 'policyDigest'], label);
  if (identity.commit !== FIXED_REALM_COMMIT || identity.tree !== FIXED_REALM_TREE) {
    throw new Error(`${label} is not the admitted current Realm producer`);
  }
  assertSHA256(identity.openapiDigest, `${label}.openapiDigest`);
  assertSHA256(identity.policyDigest, `${label}.policyDigest`);
  if (identity.openapiDigest !== CURRENT_OPENAPI_DIGEST) {
    throw new Error(`${label} OpenAPI digest differs from the admitted current Realm producer`);
  }
  if (identity.policyDigest !== CURRENT_ACCESS_POLICY_DIGEST) {
    throw new Error(`${label} access policy digest differs from the admitted current Realm producer`);
  }
}

function validateNimiIdentity(identity) {
  assertClosedObject(identity, ['commit', 'tree', 'contractDigest', 'worktreeDigest'], 'request.nimi');
  if (!/^[0-9a-f]{40}$/u.test(identity.commit) || !/^[0-9a-f]{40}$/u.test(identity.tree)) {
    throw new Error('request.nimi commit/tree is invalid');
  }
  assertSHA256(identity.contractDigest, 'request.nimi.contractDigest');
  assertSHA256(identity.worktreeDigest, 'request.nimi.worktreeDigest');
}

export function validateRequest(request) {
  assertClosedObject(
    request,
    [
      'schemaVersion',
      'producer',
      'nimi',
      'denominator',
      'persistentDatabase',
      'sourceDatabaseAccess',
      'sourceOrder',
      'secretFieldsInReceipt',
    ],
    'request',
  );
  if (request.schemaVersion !== REQUEST_SCHEMA) throw new Error('request schema is not current');
  validateProducerIdentity(request.producer, 'request.producer');
  validateNimiIdentity(request.nimi);
  assertClosedObject(request.denominator, ['total', 'worldCharacters', 'personaCharacters'], 'request.denominator');
  if (
    request.denominator.total !== REQUIRED_TOTAL ||
    request.denominator.worldCharacters !== REQUIRED_WORLDS ||
    request.denominator.personaCharacters !== REQUIRED_PERSONAS
  ) {
    throw new Error('request denominator is not exact 470 + 1');
  }
  if (
    request.persistentDatabase !== 'nimi_dev' ||
    request.sourceDatabaseAccess !== 'read_only_census' ||
    request.sourceOrder !== 'kind_id_source_hash_lexicographic' ||
    request.secretFieldsInReceipt !== 'forbidden'
  ) {
    throw new Error('request does not require the admitted read-only census contract');
  }
  return request;
}

function validateLoopbackService(service) {
  assertClosedObject(
    service,
    ['canonicalRealmBaseURL', 'canonicalTokenURL', 'expectedIssuer', 'loopbackOnly'],
    'attestation.service',
  );
  if (service.loopbackOnly !== true) throw new Error('attested Realm service is not loopback-only');
  let base;
  let token;
  try {
    base = new URL(service.canonicalRealmBaseURL);
    token = new URL(service.canonicalTokenURL);
  } catch {
    throw new Error('attested Realm service URL is invalid');
  }
  if (
    base.protocol !== 'http:' ||
    base.hostname !== '127.0.0.1' ||
    base.pathname !== '/' ||
    base.search !== '' ||
    base.hash !== '' ||
    token.origin !== base.origin ||
    token.pathname !== '/api/auth/oauth/token' ||
    token.search !== '' ||
    token.hash !== '' ||
    service.canonicalRealmBaseURL !== base.origin ||
    service.canonicalTokenURL !== `${base.origin}/api/auth/oauth/token` ||
    service.expectedIssuer !== base.origin
  ) {
    throw new Error('attested Realm/token/issuer authority is not canonical loopback authority');
  }
}

function validateAttestedSnapshot(value, label, expected) {
  assertClosedObject(
    value,
    [
      'containerIdentityDigest',
      expected.persistent ? 'database' : 'databaseNameHash',
      'sourceDatabase',
      'snapshotDigest',
      'instanceDigest',
      'worldCharacters',
      'personaCharacters',
      'readOnly',
      'worldSourceSetDigest',
      ...(expected.persistent ? ['n6FrozenEvidenceSha256', 'personaSourceRefHash'] : []),
    ],
    label,
  );
  for (const field of ['containerIdentityDigest', 'snapshotDigest', 'instanceDigest', 'worldSourceSetDigest']) {
    assertSHA256(value[field], `${label}.${field}`);
  }
  if (!expected.persistent) assertSHA256(value.databaseNameHash, `${label}.databaseNameHash`);
  if (expected.persistent) {
    assertSHA256(value.n6FrozenEvidenceSha256, `${label}.n6FrozenEvidenceSha256`);
    assertSHA256(value.personaSourceRefHash, `${label}.personaSourceRefHash`);
  }
  if (
    value.sourceDatabase !== 'nimi_dev' ||
    value.worldCharacters !== REQUIRED_WORLDS ||
    value.personaCharacters !== expected.personas ||
    value.readOnly !== true
  ) {
    throw new Error(`${label} does not attest the required read-only ${REQUIRED_WORLDS}/${expected.personas} snapshot`);
  }
  if (expected.persistent && value.database !== 'nimi_dev') {
    throw new Error('attestation persistent database is not nimi_dev');
  }
}

function validateTrustedFileIdentity(identity, label) {
  assertClosedObject(
    identity,
    ['pathHash', 'sha256', 'bytes', 'mode', 'uid', 'identityDigest'],
    label,
  );
  for (const field of ['pathHash', 'sha256', 'identityDigest']) {
    assertSHA256(identity[field], `${label}.${field}`);
  }
  if (
    !Number.isSafeInteger(identity.bytes) || identity.bytes < 0 ||
    !Number.isSafeInteger(identity.mode) || identity.mode < 0 || identity.mode > 0o777 ||
    !Number.isSafeInteger(identity.uid) || identity.uid < 0 ||
    (identity.mode & 0o022) !== 0
  ) {
    throw new Error(`${label} does not attest a non-writable trusted file identity`);
  }
  const digestInput = { ...identity };
  delete digestInput.identityDigest;
  if (
    identity.identityDigest !==
    domainHash('nimi.realm-v3-full-data-trusted-file-identity/v1', digestInput)
  ) {
    throw new Error(`${label} identity digest mismatch`);
  }
  return identity;
}

function validateAttestedChild(child, expectedStage) {
  const isCensus = expectedStage === 'census';
  assertClosedObject(
    child,
    [
      'stage',
      'kind',
      'command',
      ...(isCensus ? ['script'] : []),
      ...(!isCensus ? ['goBuildInfoDigest'] : []),
      'argsDigest',
      'argsCount',
      'childIdentityDigest',
    ],
    `attestation.wrapper.allowedChildren.${expectedStage}`,
  );
  if (
    child.stage !== expectedStage ||
    child.kind !== (isCensus ? 'node_script' : 'native') ||
    !Number.isSafeInteger(child.argsCount) ||
    child.argsCount < (isCensus ? 1 : 0)
  ) {
    throw new Error(`attestation wrapper ${expectedStage} child is invalid`);
  }
  validateTrustedFileIdentity(child.command, `attestation.wrapper.allowedChildren.${expectedStage}.command`);
  if (isCensus) {
    validateTrustedFileIdentity(child.script, 'attestation.wrapper.allowedChildren.census.script');
  } else {
    assertSHA256(child.goBuildInfoDigest, 'attestation.wrapper.allowedChildren.partition.goBuildInfoDigest');
  }
  assertSHA256(child.argsDigest, `attestation.wrapper.allowedChildren.${expectedStage}.argsDigest`);
  assertSHA256(
    child.childIdentityDigest,
    `attestation.wrapper.allowedChildren.${expectedStage}.childIdentityDigest`,
  );
  const digestInput = { ...child };
  delete digestInput.childIdentityDigest;
  if (
    child.childIdentityDigest !==
    domainHash('nimi.realm-v3-full-data-live-child-identity/v1', digestInput)
  ) {
    throw new Error(`attestation wrapper ${expectedStage} child identity digest mismatch`);
  }
  return child;
}

function validateWrapperTrust(wrapper) {
  assertClosedObject(
    wrapper,
    [
      'modules',
      'cli',
      'node',
      'tools',
      'childRegistrationDigest',
      'allowedChildren',
      'wrapperIdentityDigest',
    ],
    'attestation.wrapper',
  );
  if (
    !Array.isArray(wrapper.modules) ||
    wrapper.modules.length !== LIVE_ENVIRONMENT_MODULE_BASENAMES.length
  ) {
    throw new Error('attestation wrapper module closure is incomplete');
  }
  for (const [index, expectedName] of LIVE_ENVIRONMENT_MODULE_BASENAMES.entries()) {
    const module = wrapper.modules[index];
    assertClosedObject(module, ['name', 'identity'], `attestation.wrapper.modules.${index}`);
    if (module.name !== expectedName) {
      throw new Error('attestation wrapper module closure order or identity changed');
    }
    validateTrustedFileIdentity(module.identity, `attestation.wrapper.modules.${expectedName}`);
  }
  validateTrustedFileIdentity(wrapper.cli, 'attestation.wrapper.cli');
  validateTrustedFileIdentity(wrapper.node, 'attestation.wrapper.node');
  if ((wrapper.node.mode & 0o111) === 0) {
    throw new Error('attestation wrapper Node identity is not executable');
  }
  assertClosedObject(wrapper.tools, TRUSTED_TOOL_NAMES, 'attestation.wrapper.tools');
  for (const name of TRUSTED_TOOL_NAMES) {
    const tool = validateTrustedFileIdentity(wrapper.tools[name], `attestation.wrapper.tools.${name}`);
    if ((tool.mode & 0o111) === 0) {
      throw new Error(`attestation wrapper ${name} tool identity is not executable`);
    }
  }
  assertSHA256(wrapper.childRegistrationDigest, 'attestation.wrapper.childRegistrationDigest');
  assertSHA256(wrapper.wrapperIdentityDigest, 'attestation.wrapper.wrapperIdentityDigest');
  if (!Array.isArray(wrapper.allowedChildren) || wrapper.allowedChildren.length !== 2) {
    throw new Error('attestation wrapper must bind exactly census and partition children');
  }
  const census = validateAttestedChild(wrapper.allowedChildren[0], 'census');
  validateAttestedChild(wrapper.allowedChildren[1], 'partition');
  if (
    canonicalJSONStringify(census.command) !== canonicalJSONStringify(wrapper.node) ||
    (census.command.mode & 0o111) === 0 ||
    (wrapper.allowedChildren[1].command.mode & 0o111) === 0
  ) {
    throw new Error('attestation wrapper child executable identity mismatch');
  }
  const digestInput = { ...wrapper };
  delete digestInput.wrapperIdentityDigest;
  if (
    wrapper.wrapperIdentityDigest !==
    domainHash('nimi.realm-v3-full-data-live-wrapper-identity/v1', digestInput)
  ) {
    throw new Error('attestation wrapper identity digest mismatch');
  }
  return wrapper;
}

export function validateLiveEnvironmentAttestation(attestation) {
  assertClosedObject(
    attestation,
    [
      'schemaVersion',
      'status',
      'reasonCode',
      'environmentIdHash',
      'producer',
      'export',
      'service',
      'materializerAccountIdHash',
      'persistent',
      'disposable',
      'worldParity',
      'personaProvisioning',
      'redis',
      'api',
      'custody',
      'wrapper',
      'writeBoundary',
      'contentHash',
    ],
    'attestation',
  );
  if (
    attestation.schemaVersion !== LIVE_ATTESTATION_SCHEMA ||
    attestation.status !== 'PASS' ||
    attestation.reasonCode !== 'passed'
  ) {
    throw new Error('live environment attestation is not a current PASS');
  }
  validateProducerIdentity(attestation.producer, 'attestation.producer');
  for (const field of ['environmentIdHash', 'materializerAccountIdHash', 'contentHash']) {
    assertSHA256(attestation[field], `attestation.${field}`);
  }
  assertClosedObject(
    attestation.export,
    [
      'archiveSha256',
      'manifestDigest',
      'buildArtifactDigest',
      'dependencyRootDigest',
      'offlineStoreDirectoryPathHash',
      'runtimeDependencyClosureDigest',
      'runtimeDependencyFileCount',
      'runtimeDependencySymlinkCount',
      'serverExportAttestationDigest',
    ],
    'attestation.export',
  );
  for (const field of [
    'archiveSha256',
    'manifestDigest',
    'buildArtifactDigest',
    'dependencyRootDigest',
    'offlineStoreDirectoryPathHash',
    'runtimeDependencyClosureDigest',
    'serverExportAttestationDigest',
  ]) assertSHA256(attestation.export[field], `attestation.export.${field}`);
  if (
    !Number.isSafeInteger(attestation.export.runtimeDependencyFileCount) ||
    attestation.export.runtimeDependencyFileCount < 1 ||
    !Number.isSafeInteger(attestation.export.runtimeDependencySymlinkCount) ||
    attestation.export.runtimeDependencySymlinkCount < 0
  ) {
    throw new Error('attestation export runtime dependency counts are invalid');
  }
  const expectedExportDigest = domainHash('nimi.realm-v3-full-data-server-export-attestation/v1', {
    producer: {
      commit: attestation.producer.commit,
      tree: attestation.producer.tree,
    },
    archiveSha256: attestation.export.archiveSha256,
    manifestDigest: attestation.export.manifestDigest,
    buildArtifactDigest: attestation.export.buildArtifactDigest,
    dependencyRootDigest: attestation.export.dependencyRootDigest,
    offlineStoreDirectoryPathHash: attestation.export.offlineStoreDirectoryPathHash,
    runtimeDependencyClosureDigest: attestation.export.runtimeDependencyClosureDigest,
    runtimeDependencyFileCount: attestation.export.runtimeDependencyFileCount,
    runtimeDependencySymlinkCount: attestation.export.runtimeDependencySymlinkCount,
    expectedIssuer: attestation.service.expectedIssuer,
  });
  if (attestation.export.serverExportAttestationDigest !== expectedExportDigest) {
    throw new Error('server export attestation digest mismatch');
  }
  validateLoopbackService(attestation.service);
  validateAttestedSnapshot(attestation.persistent, 'attestation.persistent', { persistent: true, personas: 1 });
  validateAttestedSnapshot(attestation.disposable, 'attestation.disposable', { persistent: false, personas: 1 });
  assertClosedObject(
    attestation.worldParity,
    [
      'count',
      'sourceRefsExact',
      'sourceHashesExact',
      'persistentWorldSourceSetDigest',
      'disposableWorldSourceSetDigest',
    ],
    'attestation.worldParity',
  );
  if (
    attestation.worldParity.count !== REQUIRED_WORLDS ||
    attestation.worldParity.sourceRefsExact !== true ||
    attestation.worldParity.sourceHashesExact !== true ||
    attestation.worldParity.persistentWorldSourceSetDigest !== attestation.persistent.worldSourceSetDigest ||
    attestation.worldParity.disposableWorldSourceSetDigest !== attestation.disposable.worldSourceSetDigest ||
    attestation.persistent.worldSourceSetDigest !== attestation.disposable.worldSourceSetDigest
  ) {
    throw new Error('attested World source parity is incomplete');
  }
  assertClosedObject(
    attestation.personaProvisioning,
    [
      'method',
      'fixtureSourcePath',
      'fixtureSourceSha256',
      'sourceRefHash',
      'sourceHash',
      'ownerAccountIdHash',
      'attestationDigest',
    ],
    'attestation.personaProvisioning',
  );
  if (
    attestation.personaProvisioning.method !== 'current_realm_admitted_fullchain_fixture' ||
    attestation.personaProvisioning.fixtureSourcePath !== 'scripts/realm-materialization/run-realm-fullchain.ts'
  ) {
    throw new Error('Persona provisioning did not use the admitted current Realm fixture');
  }
  for (const field of ['fixtureSourceSha256', 'sourceRefHash', 'sourceHash', 'ownerAccountIdHash', 'attestationDigest']) {
    assertSHA256(attestation.personaProvisioning[field], `attestation.personaProvisioning.${field}`);
  }
  if (attestation.personaProvisioning.ownerAccountIdHash !== attestation.materializerAccountIdHash) {
    throw new Error('Persona provisioning account does not match the materializer account');
  }
  if (attestation.personaProvisioning.sourceRefHash !== attestation.persistent.personaSourceRefHash) {
    throw new Error('selected disposable Persona does not match the frozen N6 persistent Persona identity');
  }
  const expectedPersonaProvisioningDigest = domainHash(
    'nimi.realm-v3-full-data-persona-provisioning-attestation/v1',
    {
      method: attestation.personaProvisioning.method,
      fixtureSourcePath: attestation.personaProvisioning.fixtureSourcePath,
      fixtureSourceSha256: attestation.personaProvisioning.fixtureSourceSha256,
      sourceRefHash: attestation.personaProvisioning.sourceRefHash,
      sourceHash: attestation.personaProvisioning.sourceHash,
      ownerAccountIdHash: attestation.personaProvisioning.ownerAccountIdHash,
      producerCommit: attestation.producer.commit,
      producerTree: attestation.producer.tree,
      disposableDatabaseNameHash: attestation.disposable.databaseNameHash,
    },
  );
  if (attestation.personaProvisioning.attestationDigest !== expectedPersonaProvisioningDigest) {
    throw new Error('Persona provisioning attestation digest mismatch');
  }
  assertClosedObject(
    attestation.redis,
    ['containerIdentityDigest', 'containerNameHash', 'imageIdentityDigest', 'initialKeyCount', 'isolationLabelDigest'],
    'attestation.redis',
  );
  for (const field of ['containerIdentityDigest', 'containerNameHash', 'imageIdentityDigest', 'isolationLabelDigest']) {
    assertSHA256(attestation.redis[field], `attestation.redis.${field}`);
  }
  if (attestation.redis.initialKeyCount !== 0) throw new Error('attested isolated Redis did not start empty');
  assertClosedObject(
    attestation.api,
    [
      'processIntentDigest',
      'entryPathHash',
      'workingDirectoryHash',
      'entrySha256',
      'logPathHash',
      'markerHash',
      'buildArtifactDigest',
      'runtimeDependencyClosureDigest',
      'canonicalRealmBaseURLHash',
      'loopbackPort',
      'loopbackOnly',
    ],
    'attestation.api',
  );
  for (const field of [
    'processIntentDigest',
    'entryPathHash',
    'workingDirectoryHash',
    'entrySha256',
    'logPathHash',
    'markerHash',
    'buildArtifactDigest',
    'runtimeDependencyClosureDigest',
    'canonicalRealmBaseURLHash',
  ]) {
    assertSHA256(attestation.api[field], `attestation.api.${field}`);
  }
  if (
    attestation.api.processIntentDigest !== domainHash(
      'nimi.realm-v3-full-data-api-resource/v3',
      {
        entryPathHash: attestation.api.entryPathHash,
        workingDirectoryHash: attestation.api.workingDirectoryHash,
        entrySha256: attestation.api.entrySha256,
        logPathHash: attestation.api.logPathHash,
        markerHash: attestation.api.markerHash,
        canonicalRealmBaseURLHash: attestation.api.canonicalRealmBaseURLHash,
        loopbackPort: attestation.api.loopbackPort,
        buildArtifactDigest: attestation.api.buildArtifactDigest,
        runtimeDependencyClosureDigest: attestation.api.runtimeDependencyClosureDigest,
      },
    ) ||
    attestation.api.loopbackOnly !== true ||
    attestation.api.buildArtifactDigest !== attestation.export.buildArtifactDigest ||
    attestation.api.runtimeDependencyClosureDigest !== attestation.export.runtimeDependencyClosureDigest ||
    attestation.api.canonicalRealmBaseURLHash !== sha256Hex(attestation.service.canonicalRealmBaseURL) ||
    !Number.isSafeInteger(attestation.api.loopbackPort) ||
    attestation.api.loopbackPort < 1 || attestation.api.loopbackPort > 65535 ||
    attestation.api.loopbackPort !== Number(new URL(attestation.service.canonicalRealmBaseURL).port)
  ) {
    throw new Error('attested API identity differs from the fixed export/loopback service');
  }
  assertClosedObject(
    attestation.custody,
    ['directoryDigest', 'mode', 'secretFieldsInAttestation'],
    'attestation.custody',
  );
  assertSHA256(attestation.custody.directoryDigest, 'attestation.custody.directoryDigest');
  if (
    attestation.custody.mode !== 'state-dir:0700/files:0600' ||
    attestation.custody.secretFieldsInAttestation !== false
  ) {
    throw new Error('attested custody is not private and sanitized');
  }
  validateWrapperTrust(attestation.wrapper);
  assertClosedObject(
    attestation.writeBoundary,
    ['rootSnapshotDigest', 'nimiSnapshotDigest', 'appsSnapshotDigest', 'productWrites'],
    'attestation.writeBoundary',
  );
  for (const field of ['rootSnapshotDigest', 'nimiSnapshotDigest', 'appsSnapshotDigest']) {
    assertSHA256(attestation.writeBoundary[field], `attestation.writeBoundary.${field}`);
  }
  if (attestation.writeBoundary.productWrites !== 0) {
    throw new Error('attested setup crossed the Root/Nimi/apps product write boundary');
  }
  const digestInput = { ...attestation };
  delete digestInput.contentHash;
  if (attestation.contentHash !== domainHash(LIVE_ATTESTATION_SCHEMA, digestInput)) {
    throw new Error('live environment attestation content hash mismatch');
  }
  return attestation;
}

function requiredEnvironment(name, pattern = null) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  if (pattern && !pattern.test(value)) throw new Error(`${name} is invalid`);
  return value;
}

function runDocker(args, options = {}) {
  const executable = requiredEnvironment('NIMI_REALM_V3_FULL_DOCKER_EXECUTABLE');
  if (
    !path.isAbsolute(executable) ||
    !admittedDockerPathHash ||
    sha256Hex(executable) !== admittedDockerPathHash
  ) {
    throw new Error('Docker executable is not the attested canonical tool');
  }
  return execFileSync(executable, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
    ...options,
  }).trim();
}

export function validateSourceRef(sourceRef, index) {
  if (!sourceRef || typeof sourceRef !== 'object' || Array.isArray(sourceRef)) {
    throw new Error(`source ${index} is invalid`);
  }
  const common = ['kind', 'id', 'worldId', 'sourceHash'];
  const branch = sourceRef.kind === 'worldCharacter' ? 'worldEntityRef' : 'ownerAccountId';
  assertClosedObject(sourceRef, [...common, branch], `source ${index}`);
  for (const key of ['id', 'worldId']) {
    if (typeof sourceRef[key] !== 'string' || sourceRef[key].length === 0) {
      throw new Error(`source ${index}.${key} is invalid`);
    }
  }
  assertSHA256(sourceRef.sourceHash, `source ${index}.sourceHash`);
  if (sourceRef.kind === 'worldCharacter') {
    assertClosedObject(sourceRef.worldEntityRef, ['kind', 'worldId', 'entityId'], `source ${index}.worldEntityRef`);
    if (
      sourceRef.worldEntityRef.kind !== 'worldEntity' ||
      sourceRef.worldEntityRef.worldId !== sourceRef.worldId ||
      typeof sourceRef.worldEntityRef.entityId !== 'string' ||
      sourceRef.worldEntityRef.entityId.length === 0
    ) {
      throw new Error(`source ${index}.worldEntityRef is invalid`);
    }
  } else if (
    sourceRef.kind !== 'personaCharacter' ||
    typeof sourceRef.ownerAccountId !== 'string' ||
    sourceRef.ownerAccountId.length === 0
  ) {
    throw new Error(`source ${index} has an invalid PersonaCharacter branch`);
  }
  return sourceRef;
}

export function buildSnapshotProof({ containerIdentityDigest, databaseName, sources, expectedPersonas }) {
  assertSHA256(containerIdentityDigest, 'containerIdentityDigest');
  if (!SAFE_NAME_RE.test(databaseName)) throw new Error('database name is unsafe');
  const canonicalSources = sources.map((source, index) => validateSourceRef(source, index));
  const worlds = canonicalSources.filter((source) => source.kind === 'worldCharacter');
  const personas = canonicalSources.filter((source) => source.kind === 'personaCharacter');
  if (
    worlds.length !== REQUIRED_WORLDS ||
    personas.length !== expectedPersonas ||
    canonicalSources.length !== REQUIRED_WORLDS + expectedPersonas
  ) {
    throw new Error(`source snapshot is not exactly ${REQUIRED_WORLDS} WorldCharacters + ${expectedPersonas} PersonaCharacters`);
  }
  const keys = canonicalSources.map((source) => `${source.kind}\0${source.id}\0${source.sourceHash}`);
  if (canonicalJSONStringify(keys) !== canonicalJSONStringify([...keys].sort())) {
    throw new Error('source snapshot order is not canonical');
  }
  const worldSourceSetDigest = domainHash('nimi.realm-v3-full-data-world-source-set/v1', worlds);
  const sourceSetDigest = domainHash('nimi.realm-v3-full-data-source-set/v1', canonicalSources);
  const snapshotDigest = domainHash('nimi.realm-v3-full-data-database-snapshot/v1', {
    containerIdentityDigest,
    databaseNameHash: sha256Hex(databaseName),
    transactionIsolation: 'serializable_read_only_deferrable',
    worldCharacters: worlds.length,
    personaCharacters: personas.length,
    sourceSetDigest,
  });
  const instanceDigest = domainHash('nimi.realm-v3-full-data-source-instance/v1', {
    containerIdentityDigest,
    databaseNameHash: sha256Hex(databaseName),
    snapshotDigest,
  });
  return { worlds, personas, worldSourceSetDigest, sourceSetDigest, snapshotDigest, instanceDigest };
}

export function buildDualSourceReceipt(request, attestation, persistentInput, disposableInput) {
  validateRequest(request);
  validateLiveEnvironmentAttestation(attestation);
  assertEqual(request.producer, attestation.producer, 'request/attestation producer');
  const persistent = buildSnapshotProof({ ...persistentInput, expectedPersonas: 1 });
  const disposable = buildSnapshotProof({ ...disposableInput, expectedPersonas: 1 });
  if (
    persistent.snapshotDigest !== attestation.persistent.snapshotDigest ||
    persistent.worldSourceSetDigest !== attestation.persistent.worldSourceSetDigest ||
    disposable.snapshotDigest !== attestation.disposable.snapshotDigest ||
    disposable.worldSourceSetDigest !== attestation.disposable.worldSourceSetDigest
  ) {
    throw new Error('current census snapshots do not match the live environment attestation');
  }
  if (canonicalJSONStringify(persistent.worlds) !== canonicalJSONStringify(disposable.worlds)) {
    throw new Error('persistent/disposable World source refs or hashes drifted');
  }
  const [persistentPersona] = persistent.personas;
  const [persona] = disposable.personas;
  const personaSourceRefHash = domainHash('nimi.realm-v3-full-data-source-ref/v1', persona);
  if (
    domainHash('nimi.realm-v3-full-data-source-ref/v1', persistentPersona) !==
      attestation.persistent.personaSourceRefHash ||
    canonicalJSONStringify(persistentPersona) !== canonicalJSONStringify(persona) ||
    personaSourceRefHash !== attestation.personaProvisioning.sourceRefHash ||
    persona.sourceHash !== attestation.personaProvisioning.sourceHash ||
    sha256Hex(persona.ownerAccountId) !== attestation.personaProvisioning.ownerAccountIdHash
  ) {
    throw new Error('disposable Persona does not match the formal provisioning attestation');
  }
  const canonicalSources = [...persistent.worlds, persona].sort((left, right) => {
    const leftKey = `${left.kind}\0${left.id}\0${left.sourceHash}`;
    const rightKey = `${right.kind}\0${right.id}\0${right.sourceHash}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  const rows = canonicalSources.map((sourceRef, ordinal) => ({ ordinal, sourceRef }));
  const liveEnvironmentAttestationDigest = attestation.contentHash;
  const worldParity = {
    count: REQUIRED_WORLDS,
    sourceRefsExact: true,
    sourceHashesExact: true,
    persistentWorldSourceSetDigest: persistent.worldSourceSetDigest,
    disposableWorldSourceSetDigest: disposable.worldSourceSetDigest,
  };
  const receipt = {
    schemaVersion: RECEIPT_SCHEMA,
    status: 'PASS',
    reasonCode: 'passed',
    producer: attestation.producer,
    nimi: request.nimi,
    instanceDigest: domainHash('nimi.realm-v3-full-data-dual-source-instance/v1', {
      persistentInstanceDigest: persistent.instanceDigest,
      disposableInstanceDigest: disposable.instanceDigest,
      liveEnvironmentAttestationDigest,
      worldParity,
      personaProvisioningAttestationDigest: attestation.personaProvisioning.attestationDigest,
    }),
    liveEnvironmentAttestationDigest,
    persistentInstanceDigest: persistent.instanceDigest,
    disposableInstanceDigest: disposable.instanceDigest,
    persistentDatabase: 'nimi_dev',
    readOnlyPersistentCensus: true,
    persistentMutationCount: 0,
    persistentWorldCharacters: REQUIRED_WORLDS,
    persistentPersonaCharacters: 1,
    disposableWorldCharacters: REQUIRED_WORLDS,
    disposablePersonaCharacters: REQUIRED_PERSONAS,
    worldParity,
    personaProvisioningAttestationDigest: attestation.personaProvisioning.attestationDigest,
    sourceCount: rows.length,
    worldCharacters: REQUIRED_WORLDS,
    personaCharacters: REQUIRED_PERSONAS,
    sources: rows,
  };
  receipt.contentHash = domainHash(RECEIPT_SCHEMA, receipt);
  return receipt;
}

function readSourceRows(container, databaseUser, database, expectedPersonas) {
  const sql = String.raw`
BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY DEFERRABLE;
SET LOCAL search_path TO pg_catalog;
SELECT pg_catalog.jsonb_build_object(
  'transactionReadOnly', pg_catalog.current_setting('transaction_read_only') = 'on',
  'transactionIsolation', pg_catalog.current_setting('transaction_isolation'),
  'searchPath', pg_catalog.current_setting('search_path'),
  'currentUser', CURRENT_USER,
  'sessionUser', SESSION_USER,
  'worldCharacters', (SELECT COUNT(*) FROM public.world_character_cores),
  'personaCharacters', (SELECT COUNT(*) FROM public.persona_character_cores),
  'sources', (
    SELECT pg_catalog.jsonb_agg(
      source_ref ORDER BY kind COLLATE pg_catalog."C", source_id COLLATE pg_catalog."C", source_hash COLLATE pg_catalog."C"
    )
    FROM (
      SELECT
        'worldCharacter'::text AS kind,
        id AS source_id,
        source_hash,
        pg_catalog.jsonb_build_object(
          'kind', 'worldCharacter',
          'id', id,
          'worldId', world_id,
          'sourceHash', source_hash,
          'worldEntityRef', pg_catalog.jsonb_build_object(
            'kind', 'worldEntity',
            'worldId', world_id,
            'entityId', world_entity_id
          )
        ) AS source_ref
      FROM public.world_character_cores
      UNION ALL
      SELECT
        'personaCharacter'::text AS kind,
        id AS source_id,
        source_hash,
        pg_catalog.jsonb_build_object(
          'kind', 'personaCharacter',
          'id', id,
          'worldId', world_id,
          'sourceHash', source_hash,
          'ownerAccountId', owner_account_id
        ) AS source_ref
      FROM public.persona_character_cores
    ) admitted_sources
  )
);
COMMIT;
`;
  const output = runDocker(
    [
      'exec', '-i', container,
      'psql', '-X', '-qAt', '--set', 'ON_ERROR_STOP=1',
      '-U', databaseUser, '-d', database,
    ],
    { input: sql },
  );
  const lines = output.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length !== 1) throw new Error(`read-only census returned ${lines.length} result rows`);
  const result = JSON.parse(lines[0]);
  if (
    result.transactionReadOnly !== true ||
    result.transactionIsolation !== 'serializable' ||
    result.searchPath !== 'pg_catalog' ||
    result.currentUser !== databaseUser ||
    result.sessionUser !== databaseUser
  ) {
    throw new Error('database did not enforce SERIALIZABLE READ ONLY fixed-role/fixed-search_path census');
  }
  if (
    result.worldCharacters !== REQUIRED_WORLDS ||
    result.personaCharacters !== expectedPersonas ||
    !Array.isArray(result.sources) ||
    result.sources.length !== REQUIRED_WORLDS + expectedPersonas
  ) {
    throw new Error(`source census is not exactly ${REQUIRED_WORLDS} WorldCharacters + ${expectedPersonas} PersonaCharacters`);
  }
  return result.sources;
}

async function writeReceipt(filePath, value) {
  if (!path.isAbsolute(filePath)) throw new Error('receipt path must be absolute');
  const temporary = `${filePath}.tmp-${process.pid}`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(`${canonicalJSONStringify(value)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, filePath);
  const target = await lstat(filePath);
  if (
    !target.isFile() || target.isSymbolicLink() || (target.mode & 0o777) !== 0o600 ||
    (typeof process.getuid === 'function' && target.uid !== process.getuid())
  ) {
    throw new Error('published census receipt identity/mode is invalid');
  }
  const parent = await open(path.dirname(filePath), 'r');
  try {
    await parent.sync();
  } finally {
    await parent.close();
  }
}

function inspectContainer(container, expectedIdentityDigest, label) {
  const running = runDocker(['inspect', '--format', '{{.State.Running}}', container]);
  if (running !== 'true') throw new Error(`${label} PostgreSQL container is not running`);
  const containerID = runDocker(['inspect', '--format', '{{.Id}}', container]);
  if (!/^[0-9a-f]{64}$/u.test(containerID)) throw new Error(`${label} PostgreSQL container identity is invalid`);
  const digest = sha256Hex(containerID);
  if (digest !== expectedIdentityDigest) throw new Error(`${label} PostgreSQL container identity changed`);
  return digest;
}

async function main() {
  const requestPath = requiredEnvironment('NIMI_REALM_V3_FULL_CENSUS_REQUEST_PATH');
  const receiptPath = requiredEnvironment('NIMI_REALM_V3_FULL_CENSUS_RECEIPT_PATH');
  const attestationPath = requiredEnvironment('NIMI_REALM_V3_FULL_LIVE_ENVIRONMENT_ATTESTATION_PATH');
  if (![requestPath, receiptPath, attestationPath].every(path.isAbsolute)) {
    throw new Error('census request, receipt, and live attestation paths must be absolute');
  }
  const persistentContainer = requiredEnvironment(
    'NIMI_REALM_V3_FULL_CENSUS_PERSISTENT_POSTGRES_CONTAINER',
    SAFE_NAME_RE,
  );
  const disposableContainer = requiredEnvironment(
    'NIMI_REALM_V3_FULL_CENSUS_DISPOSABLE_POSTGRES_CONTAINER',
    SAFE_NAME_RE,
  );
  const databaseUser = requiredEnvironment('NIMI_REALM_V3_FULL_CENSUS_DATABASE_USER', SAFE_NAME_RE);
  const persistentDatabase = requiredEnvironment('NIMI_REALM_V3_FULL_CENSUS_PERSISTENT_DATABASE', SAFE_NAME_RE);
  const disposableDatabase = requiredEnvironment('NIMI_REALM_V3_FULL_CENSUS_DISPOSABLE_DATABASE', SAFE_NAME_RE);
  if (persistentDatabase !== 'nimi_dev') throw new Error('persistent census database must be exactly nimi_dev');
  if (!DISPOSABLE_DATABASE_RE.test(disposableDatabase)) throw new Error('disposable census database target is unsafe');

  const request = validateRequest(JSON.parse(await readFile(requestPath, 'utf8')));
  const attestation = validateLiveEnvironmentAttestation(JSON.parse(await readFile(attestationPath, 'utf8')));
  admittedDockerPathHash = attestation.wrapper.tools.docker.pathHash;
  const materializerAccountID = requiredEnvironment('NIMI_REALM_V3_LIVE_ACCOUNT_ID');
  const expectedIssuer = requiredEnvironment('NIMI_REALM_V3_LIVE_EXPECTED_ISSUER');
  if (
    sha256Hex(materializerAccountID) !== attestation.materializerAccountIdHash ||
    expectedIssuer !== attestation.service.expectedIssuer
  ) {
    throw new Error('live account/issuer environment differs from the attestation');
  }
  if (sha256Hex(disposableDatabase) !== attestation.disposable.databaseNameHash) {
    throw new Error('disposable census database differs from the live attestation');
  }
  const persistentContainerDigest = inspectContainer(
    persistentContainer,
    attestation.persistent.containerIdentityDigest,
    'persistent',
  );
  const disposableContainerDigest = inspectContainer(
    disposableContainer,
    attestation.disposable.containerIdentityDigest,
    'disposable',
  );
  const persistentSources = readSourceRows(persistentContainer, databaseUser, persistentDatabase, 1);
  const disposableSources = readSourceRows(disposableContainer, databaseUser, disposableDatabase, 1);
  const receipt = buildDualSourceReceipt(
    request,
    attestation,
    {
      containerIdentityDigest: persistentContainerDigest,
      databaseName: persistentDatabase,
      sources: persistentSources,
    },
    {
      containerIdentityDigest: disposableContainerDigest,
      databaseName: disposableDatabase,
      sources: disposableSources,
    },
  );
  await writeReceipt(receiptPath, receipt);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}
