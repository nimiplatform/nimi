import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readlink,
  realpath,
  readdir,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import YAML from 'yaml';
import {
  validateLiveEnvironmentAttestationBinding,
  validateLiveEnvironmentCleanupReceipt,
  validateLiveEnvironmentExecutionReceipt,
} from './realm-v3-full-data-live-environment.mjs';

import {
  ACCESS_POLICY_VERSION,
  AGGREGATE_SCHEMA,
  AUTHORIZATION_BOUNDARY,
  AUTHORIZATION_INPUTS,
  CAPTURE_INDEX_SCHEMA,
  CLOSE_CANDIDATE_SCHEMA,
  CONTRACT_EXACT_PATHS,
  CONTRACT_PATH_PATTERNS,
  FIRST_PARTY_AUTHORITY_CLASS,
  FIXED_PERSONA_SOURCE,
  FORBIDDEN_AUTHORIZATION_INPUTS,
  FullDataContractError,
  FULL_DATA_DENOMINATOR,
  FULL_DATA_STAGES,
  GIT_OBJECT_RE,
  MANIFEST_SCHEMA,
  PACKET_OPERATION,
  PACKET_SCHEMA,
  PARTITION_STAGES,
  PERSONA_CHARACTER_DENOMINATOR,
  PROGRESS_INTERVAL_MS,
  REASON_RE,
  RECEIPT_SCHEMA,
  RETIRED_AUTHORIZATION_ENDPOINTS,
  RETIRED_AUTHORIZATION_IDENTIFIERS,
  RUN_LOCK_SCHEMA,
  SAFE_ID_RE,
  SHA256_RE,
  SNAPSHOT_SCHEMA,
  SOURCE_CENSUS_SCHEMA,
  SOURCE_LANES,
  STAGE_REPORT_SCHEMA,
  WORLD_CHARACTER_DENOMINATOR,
  assertClosedObject,
  assertCount,
  assertEqual,
  assertExactKeys,
  assertGitObject,
  assertNoAmbientNodeInjection,
  assertSHA256,
  assertString,
  canonicalJSONStringify,
  canonicalPathThroughExistingAncestor,
  cleanupRuntimeDataRoot,
  cleanupRuntimeDataRootResumable,
  closedExecutionEnvironment,
  domainHash,
  ensurePrivateEvidenceDirectory,
  fail,
  git,
  gitBuffer,
  hashLengthFramed,
  initializePreflightRuntimeDataRoot,
  initializeRuntimeDataRoot,
  readJSON,
  requireOwnedRuntimeDataRoot,
  sha256File,
  sha256Hex,
  syncDirectory,
  validateEvidenceDirectory,
  validateRuntimeDataRoot,
  writeJSONAtomic,
} from './realm-v3-full-data-contract.mjs';

import {
  assertFixedPersonaSource,
  buildCensusExpectation,
  buildWorkerIdentity,
  buildWorkerInputIdentity,
  contractPathInventory,
  currentGitIdentity,
  findCaptureIndex,
  liveExecutionReceiptBindingDigest,
  liveExecutionStableAuthority,
  liveSourceInputFromEvidence,
  materializeLiveWorkerArguments,
  parseLock,
  parseSourceRef,
  resolveWorkerExecutable,
  validateFrozenLiveSourceInput,
  validateLiveEnvironmentProjection,
  validateLiveWorkerArgumentTemplate,
  validateSourceCensus,
} from './realm-v3-full-data-preflight.mjs';
import { validateRunLockIntegrity } from './realm-v3-full-data-run-lock.mjs';
function validateCaptureIndex(captureIndex) {
  assertClosedObject(
    captureIndex,
    ['schemaVersion', 'expectedWorldCharacters', 'expectedPersonaCharacters', 'rows', 'contentHash'],
    [],
    'capture index',
  );
  if (captureIndex.schemaVersion !== CAPTURE_INDEX_SCHEMA) {
    fail('capture_index_schema_mismatch', 'captured inventory schema is not admitted');
  }
  if (
    captureIndex.expectedWorldCharacters !== WORLD_CHARACTER_DENOMINATOR ||
    captureIndex.expectedPersonaCharacters !== PERSONA_CHARACTER_DENOMINATOR ||
    !Array.isArray(captureIndex.rows) ||
    captureIndex.rows.length !== FULL_DATA_DENOMINATOR
  ) {
    fail('denominator_mismatch', 'captured inventory denominator is not exactly 470 + 1');
  }
  assertSHA256(captureIndex.contentHash, 'capture index contentHash');
}

async function inspectCaptureRow({ row, ordinal, captureIndexPath, realmEvidence, runLock }) {
  assertClosedObject(
    row,
    [
      'expectation',
      'jwksFile',
      'ordinal',
      'packetBytes',
      'packetFile',
      'packetSha256',
      'sourceHash',
      'sourceId',
      'sourceKind',
      'worldId',
    ],
    [],
    `capture row ${ordinal}`,
  );
  if (row.ordinal !== ordinal) {
    fail('ordinal_gap', `capture ordinal ${row.ordinal} does not match ${ordinal}`);
  }
  assertCount(row.packetBytes, `capture row ${ordinal}.packetBytes`, { positive: true });
  assertSHA256(row.packetSha256, `capture row ${ordinal}.packetSha256`);
  assertSHA256(row.sourceHash, `capture row ${ordinal}.sourceHash`);
  assertString(row.sourceId, `capture row ${ordinal}.sourceId`);
  assertString(row.worldId, `capture row ${ordinal}.worldId`);
  if (!['worldCharacter', 'personaCharacter'].includes(row.sourceKind)) {
    fail('invalid_source_kind', `capture row ${ordinal} has an invalid source kind`);
  }
  const captureDir = path.dirname(captureIndexPath);
  const packetPath = path.resolve(captureDir, 'captured-packets', row.packetFile);
  const expectedPacketParent = path.resolve(captureDir, 'captured-packets');
  if (!packetPath.startsWith(`${expectedPacketParent}${path.sep}`)) {
    fail('capture_path_escape', `capture row ${ordinal} packet path escapes its inventory`);
  }
  const packetInfo = await stat(packetPath);
  if (!packetInfo.isFile() || packetInfo.size !== row.packetBytes) {
    fail('capture_size_mismatch', `capture row ${ordinal} packet size does not match`);
  }
  if ((await sha256File(packetPath)) !== row.packetSha256) {
    fail('capture_digest_mismatch', `capture row ${ordinal} packet digest does not match`);
  }
  const jwksPath = path.resolve(realmEvidence, row.jwksFile);
  if (!jwksPath.startsWith(`${path.resolve(realmEvidence)}${path.sep}`)) {
    fail('capture_path_escape', `capture row ${ordinal} JWKS path escapes Realm evidence`);
  }
  const jwksInfo = await stat(jwksPath);
  if (!jwksInfo.isFile()) {
    fail('missing_capture_jwks', `capture row ${ordinal} JWKS is unavailable`);
  }
  const compressed = await readFile(packetPath);
  let packet;
  try {
    packet = JSON.parse(gunzipSync(compressed).toString('utf8'));
  } catch (error) {
    fail('invalid_capture_packet', `capture row ${ordinal} packet cannot be decoded: ${error.message}`);
  }
  const parsedSource = parseSourceRef(packet.sourceRef, `capture row ${ordinal}.packet.sourceRef`);
  if (
    parsedSource.kind !== row.sourceKind ||
    parsedSource.id !== row.sourceId ||
    parsedSource.worldId !== row.worldId ||
    parsedSource.sourceHash !== row.sourceHash
  ) {
    fail('capture_source_mismatch', `capture row ${ordinal} source identity does not match its index`);
  }
  if (packet.packetSchemaVersion !== PACKET_SCHEMA) {
    fail('wrong_packet_schema', `capture row ${ordinal} is not Packet v3`);
  }
  assertSHA256(packet.packetHash, `capture row ${ordinal}.packetHash`);
  assertSHA256(packet.closureSetManifestHash, `capture row ${ordinal}.closureSetManifestHash`);
  assertSHA256(packet.materializationContextHash, `capture row ${ordinal}.materializationContextHash`);
  assertSHA256(packet.payloadHash, `capture row ${ordinal}.payloadHash`);
  assertString(packet.issuedAt, `capture row ${ordinal}.issuedAt`, /^\d{4}-\d{2}-\d{2}T.*Z$/u);
  assertClosedObject(
    packet.closureSetManifest,
    [
      'challengeDigest',
      'chunkCount',
      'componentCount',
      'manifestSchemaVersion',
      'orderedComponentSetHash',
      'packetId',
      'payloadAssemblyVersion',
      'publishedLimits',
      'segmentCount',
      'segments',
      'totalCanonicalBytes',
    ],
    [],
    `capture row ${ordinal}.closureSetManifest`,
  );
  const closure = packet.closureSetManifest;
  const segmentCount = assertCount(closure.segmentCount, `capture row ${ordinal}.segmentCount`, { positive: true });
  const componentCount = assertCount(closure.componentCount, `capture row ${ordinal}.componentCount`, { positive: true });
  const chunkCount = assertCount(closure.chunkCount, `capture row ${ordinal}.chunkCount`, { positive: true });
  const canonicalBytes = assertCount(closure.totalCanonicalBytes, `capture row ${ordinal}.totalCanonicalBytes`, { positive: true });
  if (!Array.isArray(closure.segments) || closure.segments.length !== segmentCount) {
    fail('segment_count_mismatch', `capture row ${ordinal} segment inventory does not match`);
  }
  const segmentTotals = closure.segments.reduce(
    (totals, segment) => ({
      components: totals.components + assertCount(segment.componentCount, 'segment.componentCount', { positive: true }),
      chunks: totals.chunks + assertCount(segment.chunkCount, 'segment.chunkCount', { positive: true }),
      bytes: totals.bytes + assertCount(segment.totalCanonicalBytes, 'segment.totalCanonicalBytes', { positive: true }),
    }),
    { components: 0, chunks: 0, bytes: 0 },
  );
  if (
    segmentTotals.components !== componentCount ||
    segmentTotals.chunks !== chunkCount ||
    segmentTotals.bytes !== canonicalBytes
  ) {
    fail('closure_total_mismatch', `capture row ${ordinal} closure totals are inconsistent`);
  }
  const expectation = row.expectation;
  assertClosedObject(
    expectation,
    [
      'accessPolicyVersionDigest',
      'challengeDigest',
      'challengeExpiresAt',
      'challengeId',
      'intendedRuntimeAudience',
      'issuer',
      'materializerAccountId',
      'publishedLimits',
      'verifiedAt',
    ],
    [],
    `capture row ${ordinal}.expectation`,
  );
  assertSHA256(expectation.accessPolicyVersionDigest, `capture row ${ordinal}.historicalPolicyDigest`);
  assertSHA256(expectation.challengeDigest, `capture row ${ordinal}.challengeDigest`);
  if (expectation.accessPolicyVersionDigest === runLock.realm.accessPolicyDigest) {
    fail('capture_mislabeled_current_auth', `capture row ${ordinal} unexpectedly uses the current policy digest`);
  }
  const sourceRefHash = domainHash('nimi.realm-v3-full-data-source-ref/v1', parsedSource.sourceRef);
  const realmContractDigest = domainHash('nimi.realm-v3-full-data-realm-contract/v1', runLock.realm);
  const partitionKey = domainHash('nimi.realm-v3-full-data-partition/v1', {
    sourceRefHash,
    realmContractDigest,
    runtimeConsumerDigest: runLock.nimi.consumerContractDigest,
  });
  return {
    ordinal,
    partitionKey,
    source: {
      kind: parsedSource.kind,
      id: parsedSource.id,
      worldId: parsedSource.worldId,
      sourceHash: parsedSource.sourceHash,
      sourceRefHash,
      sourceRef: parsedSource.sourceRef,
    },
    capture: {
      packetFile: path.relative(realmEvidence, packetPath),
      packetBytes: row.packetBytes,
      packetSha256: row.packetSha256,
      jwksFile: path.relative(realmEvidence, jwksPath),
      jwksSha256: await sha256File(jwksPath),
      historicalAccessPolicyDigest: expectation.accessPolicyVersionDigest,
      packetIssuedAt: packet.issuedAt,
      expectation,
      expectedTransport: {
        packetHash: packet.packetHash,
        closureSetManifestHash: packet.closureSetManifestHash,
        orderedComponentSetHash: assertSHA256(
          closure.orderedComponentSetHash,
          `capture row ${ordinal}.orderedComponentSetHash`,
        ),
        materializationContextHash: packet.materializationContextHash,
        payloadHash: packet.payloadHash,
        segmentCount,
        componentCount,
        chunkCount,
        canonicalBytes,
      },
    },
    identity: {
      realm: {
        commit: runLock.realm.commit,
        tree: runLock.realm.tree,
        openapiDigest: runLock.realm.openapiDigest,
        policyDigest: runLock.realm.accessPolicyDigest,
        vectorDigests: runLock.realm.compactVectorDigests,
      },
      nimi: {
        commit: runLock.nimi.commit,
        tree: runLock.nimi.tree,
        contractDigest: runLock.nimi.consumerContractDigest,
        worktreeDigest: runLock.nimi.worktreeDigest,
      },
      liveEnvironmentAttestationDigest: runLock.liveEnvironmentAttestationDigest,
    },
  };
}

export async function buildPartitionManifest({
  runLock,
  captureIndex = null,
  captureIndexPath = null,
  realmEvidence = null,
  sourceCensus = null,
  onProgress = () => {},
}) {
  const partitions = [];
  if (runLock.sourceInput.mode === 'current_realm_live_census') {
    validateSourceCensus(sourceCensus, {
      realm: {
        commit: runLock.realm.commit,
        tree: runLock.realm.tree,
        openapiDigest: runLock.realm.openapiDigest,
        policyDigest: runLock.realm.accessPolicyDigest,
      },
      nimi: {
        commit: runLock.nimi.commit,
        tree: runLock.nimi.tree,
        contractDigest: runLock.nimi.consumerContractDigest,
        worktreeDigest: runLock.nimi.worktreeDigest,
      },
    });
    const realmContractDigest = domainHash('nimi.realm-v3-full-data-realm-contract/v1', runLock.realm);
    for (const row of sourceCensus.sources) {
      const parsed = parseSourceRef(row.sourceRef, `live census source ${row.ordinal}.sourceRef`);
      const sourceRefHash = domainHash('nimi.realm-v3-full-data-source-ref/v1', parsed.sourceRef);
      partitions.push({
        ordinal: row.ordinal,
        partitionKey: domainHash('nimi.realm-v3-full-data-partition/v1', {
          sourceRefHash,
          realmContractDigest,
          runtimeConsumerDigest: runLock.nimi.consumerContractDigest,
        }),
        source: {
          kind: parsed.kind,
          id: parsed.id,
          worldId: parsed.worldId,
          sourceHash: parsed.sourceHash,
          sourceRefHash,
          sourceRef: parsed.sourceRef,
        },
        capture: null,
        identity: {
          realm: {
            commit: runLock.realm.commit,
            tree: runLock.realm.tree,
            openapiDigest: runLock.realm.openapiDigest,
            policyDigest: runLock.realm.accessPolicyDigest,
            vectorDigests: runLock.realm.compactVectorDigests,
          },
          nimi: {
            commit: runLock.nimi.commit,
            tree: runLock.nimi.tree,
            contractDigest: runLock.nimi.consumerContractDigest,
            worktreeDigest: runLock.nimi.worktreeDigest,
          },
        },
      });
      onProgress({ completed: row.ordinal + 1, total: FULL_DATA_DENOMINATOR, partition: row.ordinal });
    }
  } else {
    validateCaptureIndex(captureIndex);
    for (let ordinal = 0; ordinal < captureIndex.rows.length; ordinal += 1) {
      partitions.push(
        await inspectCaptureRow({
          row: captureIndex.rows[ordinal],
          ordinal,
          captureIndexPath,
          realmEvidence,
          runLock,
        }),
      );
      onProgress({ completed: ordinal + 1, total: FULL_DATA_DENOMINATOR, partition: ordinal });
    }
  }
  const manifest = {
    schemaVersion: MANIFEST_SCHEMA,
    inputDigest: runLock.inputDigest,
    sourceMode: runLock.sourceInput.mode,
    sourceCensusContentHash: runLock.sourceInput.mode === 'current_realm_live_census'
      ? runLock.sourceInput.contentHash
      : null,
    denominator: runLock.denominator,
    partitions,
  };
  manifest.manifestDigest = domainHash('nimi.realm-v3-full-data-partition-manifest/v1', manifest);
  validatePartitionManifest(manifest, runLock);
  return manifest;
}

export function validatePartitionManifest(manifest, runLock) {
  assertClosedObject(
    manifest,
    [
      'schemaVersion',
      'inputDigest',
      'sourceMode',
      'sourceCensusContentHash',
      'denominator',
      'partitions',
      'manifestDigest',
    ],
    [],
    'partition manifest',
  );
  if (manifest.schemaVersion !== MANIFEST_SCHEMA) {
    fail('manifest_schema_mismatch', 'partition manifest schema is not admitted');
  }
  assertEqual(manifest.denominator, runLock.denominator, 'denominator_mismatch', 'partition denominator');
  if (manifest.inputDigest !== runLock.inputDigest) {
    fail('resume_digest_mismatch', 'partition manifest input digest changed');
  }
  if (manifest.sourceMode !== runLock.sourceInput.mode) {
    fail('source_mode_mismatch', 'partition manifest source mode differs from the frozen run');
  }
  const expectedCensusContentHash = runLock.sourceInput.mode === 'current_realm_live_census'
    ? runLock.sourceInput.contentHash
    : null;
  if (manifest.sourceCensusContentHash !== expectedCensusContentHash) {
    fail('source_census_mismatch', 'partition manifest does not bind the frozen source census');
  }
  if (!Array.isArray(manifest.partitions) || manifest.partitions.length !== FULL_DATA_DENOMINATOR) {
    fail('denominator_mismatch', 'partition manifest must contain exactly 471 partitions');
  }
  const partitionKeys = new Set();
  const sourceRefHashes = new Set();
  const realmContractDigest = domainHash('nimi.realm-v3-full-data-realm-contract/v1', runLock.realm);
  let worlds = 0;
  let personas = 0;
  for (const [index, partition] of manifest.partitions.entries()) {
    if (partition.ordinal !== index) {
      fail('ordinal_gap', `partition ordinal ${partition.ordinal} does not match ${index}`);
    }
    assertSHA256(partition.partitionKey, `partition ${index}.partitionKey`);
    assertSHA256(partition.source.sourceRefHash, `partition ${index}.sourceRefHash`);
    if (partitionKeys.has(partition.partitionKey) || sourceRefHashes.has(partition.source.sourceRefHash)) {
      fail('duplicate_partition', `partition ${index} duplicates a partition or source identity`);
    }
    partitionKeys.add(partition.partitionKey);
    sourceRefHashes.add(partition.source.sourceRefHash);
    const parsedSource = parseSourceRef(partition.source.sourceRef, `partition ${index}.sourceRef`);
    assertEqual(partition.source, {
      kind: parsedSource.kind,
      id: parsedSource.id,
      worldId: parsedSource.worldId,
      sourceHash: parsedSource.sourceHash,
      sourceRefHash: domainHash('nimi.realm-v3-full-data-source-ref/v1', parsedSource.sourceRef),
      sourceRef: parsedSource.sourceRef,
    }, 'partition_identity_mismatch', `partition ${index} source identity`);
    const expectedPartitionKey = domainHash('nimi.realm-v3-full-data-partition/v1', {
      sourceRefHash: partition.source.sourceRefHash,
      realmContractDigest,
      runtimeConsumerDigest: runLock.nimi.consumerContractDigest,
    });
    if (partition.partitionKey !== expectedPartitionKey) {
      fail('partition_identity_mismatch', `partition ${index} key does not bind its source and contract`);
    }
    if (manifest.sourceMode === 'current_realm_live_census' && partition.capture !== null) {
      fail('captured_final_forbidden', `live partition ${index} retained historical capture input`);
    }
    if (manifest.sourceMode === 'historical_capture_development' && !partition.capture) {
      fail('missing_capture_evidence', `captured development partition ${index} has no capture input`);
    }
    if (partition.source.kind === 'worldCharacter') worlds += 1;
    if (partition.source.kind === 'personaCharacter') {
      personas += 1;
      if (manifest.sourceMode === 'current_realm_live_census') {
        assertFixedPersonaSource(parsedSource, `partition ${index} selected Persona source`);
      }
    }
    assertEqual(partition.identity.realm, {
      commit: runLock.realm.commit,
      tree: runLock.realm.tree,
      openapiDigest: runLock.realm.openapiDigest,
      policyDigest: runLock.realm.accessPolicyDigest,
      vectorDigests: runLock.realm.compactVectorDigests,
    }, 'identity_mismatch', `partition ${index} Realm identity`);
    assertEqual(partition.identity.nimi, {
      commit: runLock.nimi.commit,
      tree: runLock.nimi.tree,
      contractDigest: runLock.nimi.consumerContractDigest,
      worktreeDigest: runLock.nimi.worktreeDigest,
    }, 'identity_mismatch', `partition ${index} Nimi identity`);
  }
  if (worlds !== WORLD_CHARACTER_DENOMINATOR || personas !== PERSONA_CHARACTER_DENOMINATOR) {
    fail('denominator_mismatch', `partition kinds are ${worlds} world + ${personas} persona`);
  }
  const digestInput = { ...manifest };
  delete digestInput.manifestDigest;
  const computed = domainHash('nimi.realm-v3-full-data-partition-manifest/v1', digestInput);
  if (computed !== manifest.manifestDigest) {
    fail('manifest_digest_mismatch', 'partition manifest digest does not match its content');
  }
  return manifest;
}

function validateLaneHashes(laneHashes, label) {
  assertClosedObject(laneHashes, SOURCE_LANES, [], label);
  assertExactKeys(laneHashes, SOURCE_LANES, label);
  for (const lane of SOURCE_LANES) assertSHA256(laneHashes[lane], `${label}.${lane}`);
}

function validateLaneCounts(laneCounts, label) {
  assertClosedObject(laneCounts, SOURCE_LANES, [], label);
  assertExactKeys(laneCounts, SOURCE_LANES, label);
  for (const lane of SOURCE_LANES) assertCount(laneCounts[lane], `${label}.${lane}`);
}

function validateMaterializationEvidence(materialization, label, { requireLocalAgentRefHash = false } = {}) {
  assertClosedObject(
    materialization,
    [
      'snapshotSchema',
      'snapshotHash',
      'materializationContextHash',
      'sourceLaneSemanticHashes',
      'sourceLaneItemCounts',
      'sourceLanesHash',
      ...(requireLocalAgentRefHash ? ['localAgentRefHash'] : []),
    ],
    requireLocalAgentRefHash ? [] : ['localAgentRefHash'],
    label,
  );
  if (materialization.snapshotSchema !== SNAPSHOT_SCHEMA) {
    fail('snapshot_schema_mismatch', `${label}.snapshotSchema is not SnapshotV2`);
  }
  assertSHA256(materialization.snapshotHash, `${label}.snapshotHash`);
  assertSHA256(materialization.materializationContextHash, `${label}.materializationContextHash`);
  assertSHA256(materialization.sourceLanesHash, `${label}.sourceLanesHash`);
  if (Object.hasOwn(materialization, 'localAgentRefHash')) {
    assertSHA256(materialization.localAgentRefHash, `${label}.localAgentRefHash`);
  }
  validateLaneHashes(materialization.sourceLaneSemanticHashes, `${label}.sourceLaneSemanticHashes`);
  validateLaneCounts(materialization.sourceLaneItemCounts, `${label}.sourceLaneItemCounts`);
}

function validateTransportEvidence(transport, partition, label) {
  assertClosedObject(
    transport,
    [
      'packetHash',
      'closureSetManifestHash',
      'orderedComponentSetHash',
      'materializationContextHash',
      'payloadHash',
      'segmentCount',
      'componentCount',
      'chunkCount',
      'canonicalBytes',
    ],
    ['packetSha256'],
    label,
  );
  for (const key of [
    'packetHash',
    'closureSetManifestHash',
    'orderedComponentSetHash',
    'materializationContextHash',
    'payloadHash',
  ]) {
    assertSHA256(transport[key], `${label}.${key}`);
  }
  for (const key of ['segmentCount', 'componentCount', 'chunkCount', 'canonicalBytes']) {
    assertCount(transport[key], `${label}.${key}`, { positive: true });
  }
  if (Object.hasOwn(transport, 'packetSha256')) {
    assertSHA256(transport.packetSha256, `${label}.packetSha256`);
  }
  if (
    partition?.capture &&
    transport.materializationContextHash !== partition.capture.expectedTransport.materializationContextHash
  ) {
    fail('semantic_hash_mismatch', `${label} materialization context differs from its partition`);
  }
}

function validateCapturedEvidence(evidence, partition) {
  assertClosedObject(
    evidence,
    ['evidenceClass', 'authorization', 'transport', 'materialization', 'snapshotCodecReloadParity', 'rawTransportResidue'],
    [],
    'captured receipt evidence',
  );
  if (evidence.evidenceClass !== 'captured_structural_replay') {
    fail('wrong_evidence_class', 'captured replay must identify itself as structural only');
  }
  assertEqual(evidence.authorization, {
    historicalPacketProofOnly: true,
    liveAuthorizationProven: false,
    countsTowardCurrentRealmAuthorization: false,
  }, 'captured_auth_misclassification', 'captured authorization classification');
  validateTransportEvidence(evidence.transport, partition, 'captured receipt transport');
  assertEqual(
    evidence.transport,
    { ...partition.capture.expectedTransport, packetSha256: partition.capture.packetSha256 },
    'captured_transport_mismatch',
    'captured transport evidence',
  );
  validateMaterializationEvidence(evidence.materialization, 'captured receipt materialization');
  if (!evidence.snapshotCodecReloadParity || evidence.rawTransportResidue !== 0) {
    fail('captured_replay_incomplete', 'captured replay did not prove codec parity and zero raw residue');
  }
}

function validateLiveAuthorization(authorization, label, runLock) {
  assertClosedObject(
    authorization,
    [
      'liveAuthorizationProven',
      'accessPolicyVersion',
      'accessPolicyDigest',
      'authorityClass',
      'authorizationBoundaryDigest',
      'authenticatedAccountIdHash',
      'packetOperation',
      'packetRequestHash',
      'packetRequestAuthenticated',
      'canonicalSourceVisibilityEnforced',
      'sourceVisibilityDecisionOwner',
      'thirdPartyAppPermissionRequired',
      'permissionCatalog',
      'forbiddenInputObserved',
      'syntheticDecisionObserved',
      'freshChallenge',
      'freshNonce',
      'freshTtl',
      'currentJwks',
    ],
    [],
    label,
  );
  if (!authorization.liveAuthorizationProven) {
    fail('live_auth_missing', `${label} does not prove current Realm authorization`);
  }
  if (
    authorization.accessPolicyVersion !== ACCESS_POLICY_VERSION ||
    authorization.authorityClass !== FIRST_PARTY_AUTHORITY_CLASS ||
    authorization.sourceVisibilityDecisionOwner !== 'realm' ||
    authorization.packetRequestAuthenticated !== true ||
    authorization.canonicalSourceVisibilityEnforced !== true ||
    authorization.thirdPartyAppPermissionRequired !== false ||
    authorization.permissionCatalog !== 'empty' ||
    authorization.forbiddenInputObserved !== false ||
    authorization.syntheticDecisionObserved !== false
  ) {
    fail('first_party_authorization_mismatch', `${label} does not preserve the first-party no-permission boundary`);
  }
  assertEqual(authorization.packetOperation, PACKET_OPERATION, 'wrong_packet_operation', `${label}.packetOperation`);
  assertSHA256(authorization.accessPolicyDigest, `${label}.accessPolicyDigest`);
  assertSHA256(authorization.authorizationBoundaryDigest, `${label}.authorizationBoundaryDigest`);
  assertSHA256(authorization.authenticatedAccountIdHash, `${label}.authenticatedAccountIdHash`);
  assertSHA256(authorization.packetRequestHash, `${label}.packetRequestHash`);
  if (
    authorization.authorizationBoundaryDigest !==
      domainHash('nimi.realm-v3-full-data-authorization-boundary/v1', runLock.authorizationBoundary) ||
    authorization.authenticatedAccountIdHash !== runLock.liveEnvironment?.materializerAccountIdHash
  ) {
    fail('first_party_authorization_mismatch', `${label} authorization boundary digest differs from the frozen run`);
  }
  for (const field of ['freshChallenge', 'freshNonce', 'freshTtl', 'currentJwks']) {
    if (authorization[field] !== true) {
      fail('fresh_packet_security_missing', `${label}.${field} is not proven`);
    }
  }
}

function validateAttemptGenerations(generations, partition, label) {
  if (!Array.isArray(generations) || generations.length === 0) {
    fail('attempt_generation_invalid', `${label} must contain at least one closed attempt generation`);
  }
  let failed = 0;
  const requestIdHashes = new Set();
  for (let index = 0; index < generations.length; index += 1) {
    const generation = generations[index];
    assertClosedObject(
      generation,
      ['generation', 'status', 'reasonCode', 'requestIdHash'],
      [],
      `${label}[${index}]`,
    );
    const expectedGeneration = index + 1;
    if (generation.generation !== expectedGeneration) {
      fail('attempt_generation_invalid', `${label} is not a contiguous one-based generation history`);
    }
    assertString(generation.reasonCode, `${label}[${index}].reasonCode`, REASON_RE);
    assertSHA256(generation.requestIdHash, `${label}[${index}].requestIdHash`);
    const expectedRequestIdHash = sha256Hex(
      `realm-v3-full-data-${partition.partitionKey}-attempt-${expectedGeneration}`,
    );
    if (
      generation.requestIdHash !== expectedRequestIdHash ||
      requestIdHashes.has(generation.requestIdHash)
    ) {
      fail('attempt_generation_invalid', `${label} request identity is not uniquely partition-bound`);
    }
    requestIdHashes.add(generation.requestIdHash);
    const finalGeneration = index === generations.length - 1;
    if (finalGeneration) {
      if (generation.status !== 'committed' || generation.reasonCode !== 'committed') {
        fail('attempt_generation_invalid', `${label} has no unique terminal committed generation`);
      }
    } else {
      if (
        generation.status !== 'failed' ||
        generation.reasonCode === 'committed' ||
        generation.reasonCode === 'attempt_started'
      ) {
        fail('attempt_generation_invalid', `${label} contains a non-terminal prior generation`);
      }
      failed += 1;
    }
  }
  return { total: generations.length, failed, recovered: failed > 0 };
}

function validateLiveEvidence(evidence, partition, runLock) {
  assertClosedObject(
    evidence,
    ['evidenceClass', 'attemptGenerations', 'authorization', 'transport', 'materialization', 'atomicity'],
    [],
    'live receipt evidence',
  );
  if (evidence.evidenceClass !== 'current_realm_live_materialization') {
    fail('wrong_evidence_class', 'live receipt is not current Realm materialization evidence');
  }
  validateAttemptGenerations(evidence.attemptGenerations, partition, 'live receipt attempt generations');
  validateLiveAuthorization(evidence.authorization, 'live receipt authorization', runLock);
  if (evidence.authorization.accessPolicyDigest !== runLock.realm.accessPolicyDigest) {
    fail('policy_digest_mismatch', 'live receipt policy digest differs from the frozen run');
  }
  validateTransportEvidence(evidence.transport, null, 'live receipt transport');
  validateMaterializationEvidence(
    evidence.materialization,
    'live receipt materialization',
    { requireLocalAgentRefHash: true },
  );
  assertClosedObject(
    evidence.atomicity,
    ['localAgentsCreated', 'snapshotsCreated', 'provenanceCreated', 'partialProductMutations', 'rawTransportResidue'],
    [],
    'live receipt atomicity',
  );
  assertEqual(evidence.atomicity, {
    localAgentsCreated: 1,
    snapshotsCreated: 1,
    provenanceCreated: 1,
    partialProductMutations: 0,
    rawTransportResidue: 0,
  }, 'atomicity_mismatch', 'live receipt atomicity');
  if (
    evidence.materialization.materializationContextHash !== evidence.transport.materializationContextHash ||
    (
      partition.capture &&
      evidence.materialization.materializationContextHash !== partition.capture.expectedTransport.materializationContextHash
    )
  ) {
    fail('semantic_hash_mismatch', 'live materialization context differs from the frozen source revision');
  }
}

function validateRestartEvidence(evidence, partition, runLock) {
  assertClosedObject(
    evidence,
    [
      'evidenceClass',
      'attemptGenerations',
      'coldStarts',
      'realmOffline',
      'realmRequestsWhileOffline',
      'sourceRebased',
      'materialization',
      'rawTransportResidue',
      'orphanLocalAgents',
      'orphanSnapshots',
      'orphanProvenance',
      'accountCustodyResidue',
      'authorizationBoundaryDigest',
      'authorizationStatePersisted',
    ],
    [],
    'restart receipt evidence',
  );
  if (evidence.evidenceClass !== 'runtime_restart_offline_readback') {
    fail('wrong_evidence_class', 'restart receipt has the wrong evidence class');
  }
  validateAttemptGenerations(evidence.attemptGenerations, partition, 'restart receipt attempt generations');
  if (
    !Number.isSafeInteger(evidence.coldStarts) ||
    evidence.coldStarts < 2 ||
    evidence.realmOffline !== true ||
    evidence.realmRequestsWhileOffline !== 0 ||
    evidence.sourceRebased !== false ||
    evidence.rawTransportResidue !== 0 ||
    evidence.orphanLocalAgents !== 0 ||
    evidence.orphanSnapshots !== 0 ||
    evidence.orphanProvenance !== 0 ||
    evidence.accountCustodyResidue !== 0
  ) {
    fail('restart_offline_incomplete', 'restart receipt does not prove two cold starts, offline parity, and zero residue');
  }
  assertSHA256(evidence.authorizationBoundaryDigest, 'restart receipt authorizationBoundaryDigest');
  if (
    evidence.authorizationBoundaryDigest !==
      domainHash('nimi.realm-v3-full-data-authorization-boundary/v1', runLock.authorizationBoundary) ||
    evidence.authorizationStatePersisted !== false
  ) {
    fail('first_party_authorization_mismatch', 'restart receipt does not preserve the no-persisted-authorization boundary');
  }
  validateMaterializationEvidence(
    evidence.materialization,
    'restart receipt materialization',
    { requireLocalAgentRefHash: true },
  );
  if (
    partition.capture &&
    evidence.materialization.materializationContextHash !== partition.capture.expectedTransport.materializationContextHash
  ) {
    fail('semantic_hash_mismatch', 'restart receipt changed the materialization context');
  }
}

export function validatePartitionReceipt(receipt, { stage, partition, runLock, provisional = false }) {
  assertClosedObject(
    receipt,
    [
      'schemaVersion',
      'stage',
      'inputDigest',
      'partitionKey',
      'ordinal',
      'source',
      'identity',
      'status',
      'reasonCode',
      'evidence',
      'contentHash',
    ],
    ['workerContentHash', 'executionReceipt'],
    'partition receipt',
  );
  if (receipt.schemaVersion !== RECEIPT_SCHEMA || receipt.stage !== stage) {
    fail('receipt_schema_mismatch', 'partition receipt schema or stage is not admitted');
  }
  if (receipt.inputDigest !== runLock.inputDigest) {
    fail('resume_digest_mismatch', 'partition receipt belongs to a different input digest');
  }
  if (receipt.partitionKey !== partition.partitionKey || receipt.ordinal !== partition.ordinal) {
    fail('partition_identity_mismatch', 'partition receipt belongs to a different partition');
  }
  assertEqual(receipt.source, {
    kind: partition.source.kind,
    id: partition.source.id,
    sourceHash: partition.source.sourceHash,
    sourceRefHash: partition.source.sourceRefHash,
  }, 'partition_identity_mismatch', 'partition receipt source');
  assertEqual(receipt.identity, partition.identity, 'identity_mismatch', 'partition receipt identity');
  assertSHA256(receipt.contentHash, 'partition receipt contentHash');
  const receiptDigestInput = { ...receipt };
  delete receiptDigestInput.contentHash;
  if (domainHash(RECEIPT_SCHEMA, receiptDigestInput) !== receipt.contentHash) {
    fail('receipt_digest_mismatch', 'partition receipt content hash does not match its evidence');
  }
  const liveWrapperRequired = runLock.sourceInput.mode === 'current_realm_live_census';
  if (!provisional && liveWrapperRequired) {
    assertSHA256(receipt.workerContentHash, 'partition receipt workerContentHash');
    const workerReceipt = { ...receipt };
    delete workerReceipt.workerContentHash;
    delete workerReceipt.executionReceipt;
    workerReceipt.contentHash = receipt.workerContentHash;
    const workerDigestInput = { ...workerReceipt };
    delete workerDigestInput.contentHash;
    if (domainHash(RECEIPT_SCHEMA, workerDigestInput) !== receipt.workerContentHash) {
      fail('receipt_digest_mismatch', 'partition receipt does not preserve its child worker receipt hash');
    }
    const executionPartition = `${stage}:${partition.ordinal}:${partition.partitionKey}`;
    let executionReceipt;
    try {
      executionReceipt = validateLiveEnvironmentExecutionReceipt(receipt.executionReceipt, {
        environmentAttestationDigest: runLock.liveEnvironmentAttestationDigest,
        wrapperIdentityDigest: runLock.liveEnvironmentWrapperIdentityDigest,
        childRegistrationDigest: runLock.liveEnvironmentWrapperRegistrationDigest,
        stage: 'partition',
        partitionIdHash: sha256Hex(executionPartition),
        childIdentityDigest: runLock.liveEnvironmentPartitionChildIdentityDigest,
        ...liveExecutionStableAuthority(runLock.liveEnvironment),
      });
    } catch (error) {
      fail('invalid_execution_receipt', `partition wrapper evidence failed validation: ${error.message}`);
    }
    if (
      (receipt.status === 'PASS') !== (executionReceipt.status === 'PASS') ||
      (receipt.status === 'PASS' && (
        executionReceipt.exitCode !== 0 ||
        executionReceipt.signal !== null ||
        executionReceipt.identityUnchanged !== true
      ))
    ) {
      fail('invalid_execution_receipt', 'partition and wrapper execution verdicts disagree');
    }
  } else if (!provisional && (Object.hasOwn(receipt, 'workerContentHash') || Object.hasOwn(receipt, 'executionReceipt'))) {
    fail('invalid_execution_receipt', 'captured development receipt carries live wrapper evidence');
  }
  if (!['PASS', 'FAIL'].includes(receipt.status)) {
    fail('invalid_receipt_status', 'partition receipt status is invalid');
  }
  assertString(receipt.reasonCode, 'partition receipt reasonCode', REASON_RE);
  if (receipt.status === 'FAIL') {
    if (receipt.reasonCode === 'passed') {
      fail('invalid_failure_reason', 'failed partition receipt cannot use reasonCode=passed');
    }
    if (receipt.evidence !== null) {
      fail('unsafe_failure_evidence', 'failed partition receipt must not retain partial product evidence');
    }
    return receipt;
  }
  if (receipt.reasonCode !== 'passed') {
    fail('invalid_pass_reason', 'passing partition receipt must use reasonCode=passed');
  }
  if (stage === 'captured-replay') validateCapturedEvidence(receipt.evidence, partition);
  if (stage === 'live-materialize') validateLiveEvidence(receipt.evidence, partition, runLock);
  if (stage === 'restart-offline') validateRestartEvidence(receipt.evidence, partition, runLock);
  return receipt;
}


export {
  inspectCaptureRow,
  validateAttemptGenerations,
  validateCaptureIndex,
  validateCapturedEvidence,
  validateLaneCounts,
  validateLaneHashes,
  validateLiveAuthorization,
  validateLiveEvidence,
  validateMaterializationEvidence,
  validateRestartEvidence,
  validateTransportEvidence,
};
