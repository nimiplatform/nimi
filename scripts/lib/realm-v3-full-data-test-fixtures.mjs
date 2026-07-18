import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, lstat, mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  FULL_DATA_DENOMINATOR,
  FullDataContractError,
  SOURCE_LANES,
  __test,
  buildRunLock,
  canonicalJSONStringify,
  sha256Hex,
  selectPartitionsForResume,
  validateCloseAggregate,
  validatePartitionManifest,
  validatePartitionReceipt,
  validateFrozenRunLock,
  validateSourceCensus,
} from './realm-v3-full-data-runner.mjs';

const hash = (seed) => __test.domainHash('test.realm-v3-full-data/v1', seed);
const gitHash = (seed) => hash(seed).slice(0, 40);

function runLock({
  final = false,
  upstreamEvidence = {
    schemaVersion: 'nimi.realm-v3-compact-acceptance/v1',
    sha256: hash('nc6'),
    status: 'PASS',
    mode: 'current-realm-live',
    currentRealmLive: 'PASS',
    fixedProducerValidation: 'PASS',
  },
  sourceMode = final ? 'live' : 'captured',
} = {}) {
  const lock = {
    schemaVersion: __test.RUN_LOCK_SCHEMA,
    evidenceClass: final ? 'final_candidate' : 'development_resume',
    denominator: { total: 471, worldCharacters: 470, personaCharacters: 1 },
    realm: {
      commit: gitHash('realm-commit'),
      tree: gitHash('realm-tree'),
      packetSchema: 'realm.source-materialization-packet/v3',
      openapiDigest: hash('openapi'),
      openapiFragmentDigest: hash('fragment'),
      operationInventoryDigest: hash('operations'),
      accessPolicyVersion: __test.ACCESS_POLICY_VERSION,
      accessPolicyDigest: hash('policy'),
      authorityClass: __test.FIRST_PARTY_AUTHORITY_CLASS,
      thirdPartyAppPermissionRequired: false,
      permissionCatalog: 'empty',
      packetOperation: __test.PACKET_OPERATION,
      authorizationInputs: __test.AUTHORIZATION_INPUTS,
      forbiddenInputs: __test.FORBIDDEN_AUTHORIZATION_INPUTS,
      compactVectorDigests: {
        'world-character.json': hash('world-vector'),
        'persona-character.json': hash('persona-vector'),
        'negative-mutations.json': hash('negative-vector'),
      },
      producerAdmission: {
        trackedOnly: true,
        headPolicy: 'identical_admitted_inputs',
        semanticFileBundleDigest: hash('semantic-files'),
      },
    },
    sourceInput: sourceMode === 'live'
      ? null
      : {
          mode: 'historical_capture_development',
          schemaVersion: 'realm.fullchain-packet-capture-index/v2',
          indexSha256: hash('capture-index'),
          contentHash: hash('capture-content'),
          sourceCount: 471,
        },
    nimi: {
      branch: 'refactory/third-party',
      commit: gitHash('nimi-commit'),
      tree: gitHash('nimi-tree'),
      worktreeClean: final,
      worktreeStatusDigest: hash('status'),
      trackedDiffDigest: hash('tracked-diff'),
      untrackedCount: final ? 0 : 7,
      untrackedContentDigest: hash('untracked-content'),
      worktreeDigest: hash('worktree'),
      consumerContractDigest: hash('contract'),
      consumerContractPaths: [],
    },
    authorizationBoundary: __test.AUTHORIZATION_BOUNDARY,
    runtimeDataRootDigest: hash('data-root'),
    liveEnvironment: sourceMode === 'live' ? liveEnvironmentProjection() : null,
    liveEnvironmentAttestationDigest: sourceMode === 'live'
      ? hash('live-environment-attestation')
      : null,
    liveEnvironmentAttestationFileSha256: sourceMode === 'live'
      ? hash('live-environment-attestation-file')
      : null,
    liveEnvironmentWrapperRegistrationDigest: sourceMode === 'live'
      ? hash('live-environment-wrapper-registration')
      : null,
    liveEnvironmentWrapperIdentityDigest: sourceMode === 'live'
      ? hash('live-environment-wrapper-identity')
      : null,
    liveEnvironmentCensusChildIdentityDigest: sourceMode === 'live'
      ? hash('live-environment-census-child')
      : null,
    liveEnvironmentPartitionChildIdentityDigest: sourceMode === 'live'
      ? hash('live-environment-partition-child')
      : null,
    upstreamEvidence,
    inputDigest: hash(final ? 'final-input' : 'development-input'),
  };
  if (sourceMode === 'live') {
    const census = sourceCensusForIdentity(
      censusIdentity(lock),
      lock.liveEnvironmentAttestationDigest,
    );
    lock.sourceInput = __test.liveSourceInputFromEvidence(
      census,
      censusWrapperExecutionReceipt(lock),
    );
  }
  return lock;
}

function expectedTransport(index) {
  return {
    packetHash: hash(`packet-${index}`),
    closureSetManifestHash: hash(`closure-${index}`),
    orderedComponentSetHash: hash(`components-${index}`),
    materializationContextHash: hash(`context-${index}`),
    payloadHash: hash(`payload-${index}`),
    segmentCount: 1,
    componentCount: 2,
    chunkCount: 3,
    canonicalBytes: 4,
  };
}

function partition(index, lock) {
  const persona = index === 0;
  const worldIndex = index - 1;
  const worldSuffix = String(worldIndex).padStart(3, '0');
  const sourceHash = persona ? __test.FIXED_PERSONA_SOURCE.sourceHash : hash(`source-${index}`);
  const sourceRef = persona
    ? __test.FIXED_PERSONA_SOURCE
    : {
        kind: 'worldCharacter',
        id: `world-character-${worldSuffix}`,
        worldId: 'world-fixture',
        worldEntityRef: {
          kind: 'worldEntity',
          worldId: 'world-fixture',
          entityId: `entity-${worldSuffix}`,
        },
        sourceHash,
      };
  const sourceRefHash = __test.domainHash('nimi.realm-v3-full-data-source-ref/v1', sourceRef);
  const realmContractDigest = __test.domainHash(
    'nimi.realm-v3-full-data-realm-contract/v1',
    lock.realm,
  );
  return {
    ordinal: index,
    partitionKey: __test.domainHash('nimi.realm-v3-full-data-partition/v1', {
      sourceRefHash,
      realmContractDigest,
      runtimeConsumerDigest: lock.nimi.consumerContractDigest,
    }),
    source: {
      kind: sourceRef.kind,
      id: sourceRef.id,
      worldId: sourceRef.worldId,
      sourceHash,
      sourceRefHash,
      sourceRef,
    },
    capture: lock.sourceInput.mode === 'historical_capture_development'
      ? {
          packetFile: `captured/${index}.json.gz`,
          packetBytes: 100 + index,
          packetSha256: hash(`packet-file-${index}`),
          jwksFile: 'jwks/current.json',
          jwksSha256: hash('jwks'),
          historicalAccessPolicyDigest: hash('historical-policy'),
          packetIssuedAt: '2026-07-17T00:00:00.000Z',
          expectation: {},
          expectedTransport: expectedTransport(index),
        }
      : null,
    identity: {
      realm: {
        commit: lock.realm.commit,
        tree: lock.realm.tree,
        openapiDigest: lock.realm.openapiDigest,
        policyDigest: lock.realm.accessPolicyDigest,
        vectorDigests: lock.realm.compactVectorDigests,
      },
      nimi: {
        commit: lock.nimi.commit,
        tree: lock.nimi.tree,
        contractDigest: lock.nimi.consumerContractDigest,
        worktreeDigest: lock.nimi.worktreeDigest,
      },
    },
  };
}

function manifest(lock) {
  const value = {
    schemaVersion: __test.MANIFEST_SCHEMA,
    inputDigest: lock.inputDigest,
    sourceMode: lock.sourceInput.mode,
    sourceCensusContentHash: lock.sourceInput.mode === 'current_realm_live_census'
      ? lock.sourceInput.contentHash
      : null,
    denominator: lock.denominator,
    partitions: Array.from({ length: FULL_DATA_DENOMINATOR }, (_, index) => partition(index, lock)),
  };
  value.manifestDigest = __test.domainHash(
    'nimi.realm-v3-full-data-partition-manifest/v1',
    value,
  );
  return value;
}

function censusIdentity(lock) {
  return {
    realm: {
      commit: lock.realm.commit,
      tree: lock.realm.tree,
      openapiDigest: lock.realm.openapiDigest,
      policyDigest: lock.realm.accessPolicyDigest,
    },
    nimi: {
      commit: lock.nimi.commit,
      tree: lock.nimi.tree,
      contractDigest: lock.nimi.consumerContractDigest,
      worktreeDigest: lock.nimi.worktreeDigest,
    },
  };
}

function sourceCensusForIdentity(
  identity,
  liveEnvironmentAttestationDigest = hash('live-environment-attestation'),
) {
  const sources = [];
  const personaRef = {
    ...__test.FIXED_PERSONA_SOURCE,
  };
  sources.push({ ordinal: 0, sourceRef: personaRef });
  for (let index = 0; index < 470; index += 1) {
    const suffix = String(index).padStart(3, '0');
    sources.push({
      ordinal: index + 1,
      sourceRef: {
        kind: 'worldCharacter',
        id: `world-character-${suffix}`,
        worldId: 'world-fixture',
        worldEntityRef: {
          kind: 'worldEntity',
          worldId: 'world-fixture',
          entityId: `entity-${suffix}`,
        },
        sourceHash: hash(`source-${index + 1}`),
      },
    });
  }
  const value = {
    schemaVersion: __test.SOURCE_CENSUS_SCHEMA,
    status: 'PASS',
    reasonCode: 'passed',
    producer: identity.realm,
    nimi: identity.nimi,
    instanceDigest: hash('nimi-dev-instance'),
    liveEnvironmentAttestationDigest,
    persistentInstanceDigest: hash('persistent-instance'),
    disposableInstanceDigest: hash('disposable-instance'),
    persistentDatabase: 'nimi_dev',
    readOnlyPersistentCensus: true,
    persistentMutationCount: 0,
    persistentWorldCharacters: 470,
    persistentPersonaCharacters: 1,
    disposableWorldCharacters: 470,
    disposablePersonaCharacters: 1,
    worldParity: {
      count: 470,
      sourceRefsExact: true,
      sourceHashesExact: true,
      persistentWorldSourceSetDigest: hash('world-source-set'),
      disposableWorldSourceSetDigest: hash('world-source-set'),
    },
    personaProvisioningAttestationDigest: hash('persona-provisioning'),
    sourceCount: 471,
    worldCharacters: 470,
    personaCharacters: 1,
    sources,
  };
  value.contentHash = __test.domainHash('nimi.realm-v3-full-data-source-census/v1', value);
  return value;
}

function sourceCensus(lock) {
  return sourceCensusForIdentity(censusIdentity(lock));
}

function liveEnvironmentProjection() {
  return {
    canonicalRealmBaseURL: 'http://127.0.0.1:43123',
    canonicalTokenURL: 'http://127.0.0.1:43123/api/auth/oauth/token',
    expectedIssuer: 'http://127.0.0.1:43123',
    materializerAccountIdHash: hash('materializer-account'),
    serverExportAttestationDigest: hash('server-export'),
    disposableSourceInstanceDigest: hash('disposable-source-instance'),
    apiProcessIntentDigest: hash('api-process-intent'),
    apiEntrySha256: hash('api-entry'),
    runtimeDependencyClosureDigest: hash('runtime-dependency-closure'),
  };
}

function materialization(index) {
  return {
    snapshotSchema: __test.SNAPSHOT_SCHEMA,
    snapshotHash: hash(`snapshot-${index}`),
    materializationContextHash: hash(`context-${index}`),
    sourceLaneSemanticHashes: Object.fromEntries(
      SOURCE_LANES.map((lane) => [lane, hash(`lane-${index}-${lane}`)]),
    ),
    sourceLaneItemCounts: Object.fromEntries(SOURCE_LANES.map((lane) => [lane, 1])),
    sourceLanesHash: hash(`lanes-${index}`),
    localAgentRefHash: hash(`agent-${index}`),
  };
}

function receiptBase(stage, item, lock) {
  return {
    schemaVersion: __test.RECEIPT_SCHEMA,
    stage,
    inputDigest: lock.inputDigest,
    partitionKey: item.partitionKey,
    ordinal: item.ordinal,
    source: {
      kind: item.source.kind,
      id: item.source.id,
      sourceHash: item.source.sourceHash,
      sourceRefHash: item.source.sourceRefHash,
    },
    identity: item.identity,
    status: 'PASS',
    reasonCode: 'passed',
  };
}

function sealReceipt(receipt) {
  delete receipt.contentHash;
  receipt.contentHash = __test.domainHash(__test.RECEIPT_SCHEMA, receipt);
  return receipt;
}

function capturedReceipt(item, lock) {
  return sealReceipt({
    ...receiptBase('captured-replay', item, lock),
    evidence: {
      evidenceClass: 'captured_structural_replay',
      authorization: {
        historicalPacketProofOnly: true,
        liveAuthorizationProven: false,
        countsTowardCurrentRealmAuthorization: false,
      },
      transport: { ...item.capture.expectedTransport, packetSha256: item.capture.packetSha256 },
      materialization: materialization(item.ordinal),
      snapshotCodecReloadParity: true,
      rawTransportResidue: 0,
    },
  });
}

function wrapperExecutionReceipt(stage, item, lock, status = 'PASS') {
  const wrapperIdentity = lock.liveEnvironmentWrapperIdentityDigest;
  const childIdentity = lock.liveEnvironmentPartitionChildIdentityDigest;
  const apiProcessIdentity = hash('api-process-identity');
  const partitionId = `${stage}:${item.ordinal}:${item.partitionKey}`;
  const receipt = {
    schemaVersion: 'nimi.realm-v3-full-data-live-execution-receipt/v1',
    status,
    reasonCode: status === 'PASS' ? 'passed' : 'child_failed',
    environmentAttestationDigest: lock.liveEnvironmentAttestationDigest,
    wrapperIdentityDigest: wrapperIdentity,
    childRegistrationDigest: lock.liveEnvironmentWrapperRegistrationDigest,
    stage: 'partition',
    partitionIdHash: sha256Hex(partitionId),
    executionReceiptPathHash: hash(`execution-path-${stage}-${item.ordinal}`),
    childIdentityDigest: childIdentity,
    argsDigest: hash(`execution-args-${stage}-${item.ordinal}`),
    exitCode: status === 'PASS' ? 0 : 1,
    signal: null,
    preExecutionWrapperIdentityDigest: wrapperIdentity,
    postExecutionWrapperIdentityDigest: wrapperIdentity,
    preExecutionChildIdentityDigest: childIdentity,
    postExecutionChildIdentityDigest: childIdentity,
    apiProcessIntentDigest: hash('api-process-intent'),
    apiGeneration: 1,
    apiProcessIdentityDigest: apiProcessIdentity,
    postExecutionAPIProcessIdentityDigest: apiProcessIdentity,
    apiIdentityUnchanged: true,
    runtimeDependencyClosureDigest: hash('runtime-dependency-closure'),
    identityUnchanged: true,
  };
  receipt.contentHash = __test.domainHash(receipt.schemaVersion, receipt);
  return receipt;
}

function censusWrapperExecutionReceipt(lock) {
  const apiProcessIdentity = hash('api-process-identity');
  const receipt = {
    schemaVersion: 'nimi.realm-v3-full-data-live-execution-receipt/v1',
    status: 'PASS',
    reasonCode: 'passed',
    environmentAttestationDigest: lock.liveEnvironmentAttestationDigest,
    wrapperIdentityDigest: lock.liveEnvironmentWrapperIdentityDigest,
    childRegistrationDigest: lock.liveEnvironmentWrapperRegistrationDigest,
    stage: 'census',
    partitionIdHash: sha256Hex('live-source-census'),
    executionReceiptPathHash: hash('census-execution-path'),
    childIdentityDigest: lock.liveEnvironmentCensusChildIdentityDigest,
    argsDigest: hash('census-execution-args'),
    exitCode: 0,
    signal: null,
    preExecutionWrapperIdentityDigest: lock.liveEnvironmentWrapperIdentityDigest,
    postExecutionWrapperIdentityDigest: lock.liveEnvironmentWrapperIdentityDigest,
    preExecutionChildIdentityDigest: lock.liveEnvironmentCensusChildIdentityDigest,
    postExecutionChildIdentityDigest: lock.liveEnvironmentCensusChildIdentityDigest,
    apiProcessIntentDigest: hash('api-process-intent'),
    apiGeneration: 1,
    apiProcessIdentityDigest: apiProcessIdentity,
    postExecutionAPIProcessIdentityDigest: apiProcessIdentity,
    apiIdentityUnchanged: true,
    runtimeDependencyClosureDigest: hash('runtime-dependency-closure'),
    identityUnchanged: true,
  };
  receipt.contentHash = __test.domainHash(receipt.schemaVersion, receipt);
  return receipt;
}

function assembleLiveFixtureReceipt(workerReceipt, stage, item, lock) {
  const assembled = {
    ...workerReceipt,
    workerContentHash: workerReceipt.contentHash,
    executionReceipt: wrapperExecutionReceipt(stage, item, lock, workerReceipt.status),
  };
  delete assembled.contentHash;
  return sealReceipt(assembled);
}

function attemptGenerations(item) {
  return [{
    generation: 1,
    status: 'committed',
    reasonCode: 'committed',
    requestIdHash: sha256Hex(`realm-v3-full-data-${item.partitionKey}-attempt-1`),
  }];
}

function resealLiveFixtureReceipt(receipt) {
  const workerReceipt = { ...receipt };
  delete workerReceipt.workerContentHash;
  delete workerReceipt.executionReceipt;
  delete workerReceipt.contentHash;
  receipt.workerContentHash = sealReceipt(workerReceipt).contentHash;
  return sealReceipt(receipt);
}

function liveReceipt(item, lock) {
  const workerReceipt = sealReceipt({
    ...receiptBase('live-materialize', item, lock),
    evidence: {
      evidenceClass: 'current_realm_live_materialization',
      attemptGenerations: attemptGenerations(item),
      authorization: {
        liveAuthorizationProven: true,
        accessPolicyVersion: __test.ACCESS_POLICY_VERSION,
        accessPolicyDigest: lock.realm.accessPolicyDigest,
        authorityClass: __test.FIRST_PARTY_AUTHORITY_CLASS,
        authorizationBoundaryDigest: __test.domainHash(
          'nimi.realm-v3-full-data-authorization-boundary/v1',
          lock.authorizationBoundary,
        ),
        authenticatedAccountIdHash: lock.liveEnvironment.materializerAccountIdHash,
        packetOperation: __test.PACKET_OPERATION,
        packetRequestHash: hash(`packet-request-${item.ordinal}`),
        packetRequestAuthenticated: true,
        canonicalSourceVisibilityEnforced: true,
        sourceVisibilityDecisionOwner: 'realm',
        thirdPartyAppPermissionRequired: false,
        permissionCatalog: 'empty',
        forbiddenInputObserved: false,
        syntheticDecisionObserved: false,
        freshChallenge: true,
        freshNonce: true,
        freshTtl: true,
        currentJwks: true,
      },
      transport: expectedTransport(item.ordinal),
      materialization: materialization(item.ordinal),
      atomicity: {
        localAgentsCreated: 1,
        snapshotsCreated: 1,
        provenanceCreated: 1,
        partialProductMutations: 0,
        rawTransportResidue: 0,
      },
    },
  });
  return assembleLiveFixtureReceipt(workerReceipt, 'live-materialize', item, lock);
}

function restartReceipt(item, lock) {
  const workerReceipt = sealReceipt({
    ...receiptBase('restart-offline', item, lock),
    evidence: {
      evidenceClass: 'runtime_restart_offline_readback',
      attemptGenerations: attemptGenerations(item),
      coldStarts: 2,
      realmOffline: true,
      realmRequestsWhileOffline: 0,
      sourceRebased: false,
      materialization: materialization(item.ordinal),
      rawTransportResidue: 0,
      orphanLocalAgents: 0,
      orphanSnapshots: 0,
      orphanProvenance: 0,
      accountCustodyResidue: 0,
      authorizationBoundaryDigest: __test.domainHash(
        'nimi.realm-v3-full-data-authorization-boundary/v1',
        lock.authorizationBoundary,
      ),
      authorizationStatePersisted: false,
    },
  });
  return assembleLiveFixtureReceipt(workerReceipt, 'restart-offline', item, lock);
}

function externalCleanupReceipt(lock, closeCandidate) {
  const persistentSnapshot = hash('persistent-cleanup-snapshot');
  const writeBoundary = hash('cleanup-write-boundary');
  const receipt = {
    schemaVersion: 'nimi.realm-v3-full-data-live-environment-cleanup-receipt/v1',
    status: 'PASS',
    reasonCode: 'passed',
    environmentAttestationDigest: lock.liveEnvironmentAttestationDigest,
    runInputDigest: lock.inputDigest,
    closeCandidateDigest: closeCandidate.contentHash,
    api: {
      stopped: true,
      pidAbsent: true,
      processIdentityDigest: hash('cleanup-api-process'),
    },
    disposableDatabase: {
      databaseNameHash: hash('cleanup-disposable-database'),
      deleted: true,
      residue: 0,
    },
    redis: {
      keysBeforeCleanup: 471,
      keysAfterCleanup: 0,
      removed: true,
      containerResidue: 0,
    },
    temporaryResidue: {
      export: 0,
      state: 0,
      custody: 0,
      keyMaterial: 0,
      apiProcess: 0,
    },
    persistentParity: {
      database: 'nimi_dev',
      snapshotDigestBefore: persistentSnapshot,
      snapshotDigestAfter: persistentSnapshot,
      worldCharactersBefore: 470,
      worldCharactersAfter: 470,
      personaCharactersBefore: 1,
      personaCharactersAfter: 1,
      unchanged: true,
      readOnly: true,
    },
    writeBoundary: {
      rootWrites: 0,
      nimiWrites: 0,
      appsWrites: 0,
      beforeDigest: writeBoundary,
      afterDigest: writeBoundary,
      unchanged: true,
    },
  };
  receipt.contentHash = __test.domainHash(receipt.schemaVersion, receipt);
  return receipt;
}

function runtimeCleanupReceipt(lock) {
  const receipt = {
    schemaVersion: 'nimi.realm-v3-full-data-runtime-cleanup/v1',
    inputDigest: lock.inputDigest,
    runtimeDataRootDigest: lock.runtimeDataRootDigest,
    quarantineDigest: hash('runtime-cleanup-quarantine'),
    status: 'PASS',
    reasonCode: 'passed',
    residue: 0,
  };
  receipt.contentHash = __test.domainHash(receipt.schemaVersion, receipt);
  return receipt;
}

async function writeReceipt(root, stage, item, value) {
  const directory = path.join(root, 'partitions', item.partitionKey);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${stage}.json`), `${JSON.stringify(value)}\n`);
}

async function writePrivateJSONFixture(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  await chmod(filePath, 0o600);
}

async function writeStageReport(root, stage, receipts, lock, value) {
  const report = {
    schemaVersion: __test.STAGE_REPORT_SCHEMA,
    stage,
    evidenceClass: lock.evidenceClass,
    inputDigest: lock.inputDigest,
    manifestDigest: value.manifestDigest,
    denominator: FULL_DATA_DENOMINATOR,
    processed: FULL_DATA_DENOMINATOR,
    passed: receipts.filter((receipt) => receipt.status === 'PASS').length,
    failed: receipts.filter((receipt) => receipt.status === 'FAIL').length,
    skipped: 0,
    reused: 0,
    executed: FULL_DATA_DENOMINATOR,
    resumable: true,
    status: 'PASS',
    receiptSetDigest: __test.domainHash(
      'nimi.realm-v3-full-data-stage-receipt-set/v1',
      receipts.map((receipt) => ({
        stage,
        ordinal: receipt.ordinal,
        partitionKey: receipt.partitionKey,
        contentHash: receipt.contentHash,
      })),
    ),
  };
  report.contentHash = __test.domainHash('nimi.realm-v3-full-data-stage-report/v1', report);
  await mkdir(path.join(root, 'stages'), { recursive: true });
  await writeFile(path.join(root, 'stages', `${stage}.json`), `${JSON.stringify(report)}\n`);
}

async function writeRepositoryFile(root, relativePath, body) {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, body);
}

async function createDirtyCandidateRepository(root) {
  const openapi = 'openapi: 3.1.0\ninfo:\n  title: fixture\n  version: 1\npaths: {}\n';
  const lock = {
    schema_version: 'nimi.realm-contract-lock/v4',
    generated_by: 'test',
    realm: { repository: 'fixture', commit: gitHash('realm-fixture'), tree: gitHash('realm-tree-fixture') },
    openapi: {
      source_path: 'nimi-backend/api-nimi.yaml',
      synced_path: 'config/realm-openapi/api-nimi.yaml',
      document_sha256: sha256Hex(openapi),
      fragment_sha256: hash('fixture-fragment'),
      operation_inventory_sha256: hash('fixture-operations'),
    },
    schema_versions: { packet: 'realm.source-materialization-packet/v3' },
    source_ref: {},
    published_limits: {},
    access_policy: {
      version: __test.ACCESS_POLICY_VERSION,
      digest: hash('fixture-policy'),
      authority_class: __test.FIRST_PARTY_AUTHORITY_CLASS,
      third_party_app_permission_required: false,
      permission_catalog: 'empty',
      packet_operation: __test.PACKET_OPERATION,
      authorization_inputs: __test.AUTHORIZATION_INPUTS,
      forbidden_inputs: __test.FORBIDDEN_AUTHORIZATION_INPUTS,
    },
    compact_vectors: { 'world-character.json': hash('fixture-world-vector') },
    producer_admission: {
      tracked_only: true,
      head_policy: 'identical_admitted_inputs',
      semantic_file_bundle_sha256: hash('fixture-semantic-files'),
    },
  };
  const producerAdmission = {
    schemaVersion: 'nimi.realm-current-producer-admission/v3',
    admittedCommit: lock.realm.commit,
    admittedTree: lock.realm.tree,
    headPolicy: lock.producer_admission.head_policy,
  };
  const files = new Map([
    ['.gitignore', '.nimi/local/\n'],
    ['config/realm-contract-lock.yaml', `${JSON.stringify(lock)}\n`],
    ['config/realm-openapi/api-nimi.yaml', openapi],
    ['config/realm-v3/current-producer-admission.json', `${JSON.stringify(producerAdmission)}\n`],
    ['config/realm-v3/handoff-dispositions.json', '{"schemaVersion":"fixture/v1"}\n'],
    ['proto/runtime/v1/agent_service.proto', 'syntax = "proto3";\n'],
    ['proto/runtime/v1/agent_source_materialization.proto', 'syntax = "proto3";\n'],
    ['runtime/internal/services/runtimeagent/realm_source_materialization_full_data_worker_test.go', 'package runtimeagent\n'],
    ['scripts/lib/realm-v3-full-data-close.mjs', 'export const close = 1;\n'],
    ['scripts/lib/realm-v3-full-data-contract.mjs', 'export const contract = 1;\n'],
    ['scripts/lib/realm-v3-full-data-execution.mjs', 'export const execution = 1;\n'],
    ['scripts/lib/realm-v3-full-data-live-cleanup.mjs', 'export const liveCleanup = 1;\n'],
    ['scripts/lib/realm-v3-full-data-live-contract.mjs', 'export const liveContract = 1;\n'],
    ['scripts/lib/realm-v3-full-data-live-attestation.mjs', 'export const liveAttestation = 1;\n'],
    ['scripts/lib/realm-v3-full-data-live-environment.mjs', 'export const environment = 1;\n'],
    ['scripts/lib/realm-v3-full-data-live-infrastructure.mjs', 'export const liveInfrastructure = 1;\n'],
    ['scripts/lib/realm-v3-full-data-live-prepare.mjs', 'export const livePrepare = 1;\n'],
    ['scripts/lib/realm-v3-full-data-live-services.mjs', 'export const liveServices = 1;\n'],
    ['scripts/lib/realm-v3-full-data-manifest.mjs', 'export const manifest = 1;\n'],
    ['scripts/lib/realm-v3-full-data-preflight.mjs', 'export const preflight = 1;\n'],
    ['scripts/lib/realm-v3-full-data-run-lock.mjs', 'export const runLock = 1;\n'],
    ['scripts/lib/realm-v3-full-data-runner.mjs', 'export const runner = 1;\n'],
    ['scripts/realm-v3-full-data-census-worker.mjs', '#!/usr/bin/env node\n'],
    ['scripts/realm-v3-full-data-live-environment.mjs', '#!/usr/bin/env node\n'],
    ['scripts/test-realm-v3-full-data.mjs', 'export const cli = 1;\n'],
    ['sdks/typescript/index.ts', "export * from './runtime';\n"],
    ['sdks/typescript/runtime/index.ts', 'export const runtime = 1;\n'],
    ['sdks/typescript/runtime/runtime-agent-materialization.ts', 'export const materialization = 1;\n'],
  ]);
  for (const [relativePath, body] of files) await writeRepositoryFile(root, relativePath, body);
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync(
    'git',
    ['-c', 'user.name=N7 Test', '-c', 'user.email=n7@example.invalid', 'commit', '-qm', 'fixture'],
    { cwd: root },
  );
  await writeRepositoryFile(root, 'scripts/lib/realm-v3-full-data-runner.mjs', 'export const runner = 2;\n');
  const nc6Path = path.join(await realpath(root), '.nimi', 'local', 'n6-current-realm-live.json');
  await writeRepositoryFile(root, path.relative(root, nc6Path), `${JSON.stringify({
    schemaVersion: 'nimi.realm-v3-compact-acceptance/v1',
    mode: 'current-realm-live',
    status: 'PASS',
    currentRealmLive: 'PASS',
    fixedProducer: {
      commit: lock.realm.commit,
      tree: lock.realm.tree,
      packetSchema: lock.schema_versions.packet,
      accessPolicy: lock.access_policy.version,
      accessPolicyDigest: lock.access_policy.digest,
      realmAccessPolicy: {
        version: lock.access_policy.version,
        digest: lock.access_policy.digest,
        authorityClass: lock.access_policy.authority_class,
        thirdPartyAppPermissionRequired: false,
        permissionCatalog: 'empty',
        packetOperation: __test.PACKET_OPERATION,
        authorizationInputs: __test.AUTHORIZATION_INPUTS,
        forbiddenInputs: __test.FORBIDDEN_AUTHORIZATION_INPUTS,
        retiredIdentifiers: __test.RETIRED_AUTHORIZATION_IDENTIFIERS,
        retiredEndpoints: __test.RETIRED_AUTHORIZATION_ENDPOINTS,
      },
      admissionSchemaVersion: producerAdmission.schemaVersion,
      admissionSha256: sha256Hex(`${JSON.stringify(producerAdmission)}\n`),
      validation: 'PASS',
    },
    tests: [
      'runtime-hermetic-fullchain-security',
      'account-current-jwks-first-party-materialization',
      'desktop-current-first-party-packet-v3-fixture',
      'current-realm-live-world-persona',
    ].map((id) => ({ id, status: 'PASS' })),
    writeBoundary: {
      status: 'PASS',
      rootRealmUnchanged: true,
      nimiUnchanged: true,
      nimiAppsUnchanged: true,
    },
    rawTransportResidue: 0,
    orphanSnapshots: 0,
    orphanProvenance: 0,
    protectedDiffs: 0,
  })}\n`);
  return nc6Path;
}


export {
  assembleLiveFixtureReceipt,
  capturedReceipt,
  censusIdentity,
  censusWrapperExecutionReceipt,
  createDirtyCandidateRepository,
  expectedTransport,
  externalCleanupReceipt,
  hash,
  liveEnvironmentProjection,
  liveReceipt,
  manifest,
  materialization,
  partition,
  receiptBase,
  resealLiveFixtureReceipt,
  restartReceipt,
  runLock,
  runtimeCleanupReceipt,
  sealReceipt,
  sourceCensus,
  sourceCensusForIdentity,
  wrapperExecutionReceipt,
  writePrivateJSONFixture,
  writeReceipt,
  writeRepositoryFile,
  writeStageReport,
};
