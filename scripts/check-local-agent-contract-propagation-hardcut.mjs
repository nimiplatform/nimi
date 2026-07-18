#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const PACKET_OPERATION_PATH = '/api/realm/core/source-materialization-packets';
const PACKET_OPERATION_ID = 'WorldCoreController_createSourceMaterializationPacket';
const PACKET_SCHEMA = 'realm.source-materialization-packet/v3';
const MATERIALIZATION_RPC = 'MaterializeRealmSource';
const RETIRED_RPCS = Object.freeze([
  'CreateSourceMaterializationChallenge',
  'BeginSourceMaterializationUpload',
  'PutSourceMaterializationChunk',
  'CommitSourceMaterialization',
  'AbortSourceMaterializationUpload',
]);
const RETIRED_TOKENS = Object.freeze([
  'SourceMaterializationPacketV2',
  'realm.source-materialization-packet/v2',
  'RealmPersona',
  'accessGrantId',
  '/api/human/me/permission-grants',
  '/api/runtime/realm-grants/issue',
  'realm_source.snapshot.consume',
  'realm_source.snapshot.bind',
  'agent.identity.project',
]);
const RAW_PUBLIC_INPUTS = Object.freeze([
  'realmBase',
  'bearer',
  'grantId',
  'packet',
  'packetProof',
  'challenge',
  'challengeDigest',
  'orderedSegments',
  'jwks',
  'localAgentRef',
]);
const HANDOFF_DISPOSITION_PATH = 'config/realm-v3/handoff-dispositions.json';
const HANDOFF_ACCEPTANCE_EVIDENCE = Object.freeze([
  'consumer-hardcut',
  'five-lane-restart-offline',
  'hard-delete-zero-residue',
  'runtime-current-realm-live-world-persona',
  'runtime-hermetic-fullchain-security',
  'security-zero-product-mutation',
]);
const FULL_DATA_RETIRED_POSITIVE_AUTHORITY = Object.freeze([
  'ACCESS_SELECTOR',
  'LOCAL_IDENTITY_AUTHORIZATION',
  'permissionSplit',
  'PermissionSplit',
  'realmV3FullDataAccessPolicyVersionV4',
  'RequestGrantIDHash',
  'DecisionGrantIDHash',
  'PacketGrantIDHash',
  'GrantDecisionPerformed',
  'producer_evidence',
]);
const FULL_DATA_RUNNER_PATHS = Object.freeze([
  'scripts/lib/realm-v3-full-data-contract.mjs',
  'scripts/lib/realm-v3-full-data-preflight.mjs',
  'scripts/lib/realm-v3-full-data-run-lock.mjs',
  'scripts/lib/realm-v3-full-data-manifest.mjs',
  'scripts/lib/realm-v3-full-data-execution.mjs',
  'scripts/lib/realm-v3-full-data-close.mjs',
  'scripts/lib/realm-v3-full-data-runner.mjs',
]);
const FULL_DATA_RUNTIME_PROOF_PATHS = Object.freeze([
  'runtime/internal/services/runtimeagent/realm_source_materialization_full_data_worker_test.go',
  'runtime/internal/services/runtimeagent/realm_source_materialization_full_data_security_test.go',
  'runtime/internal/services/runtimeagent/realm_source_materialization_full_data_security_fixture_test.go',
  'runtime/internal/services/runtimeagent/realm_source_materialization_full_data_request_test.go',
  'runtime/internal/services/runtimeagent/realm_source_materialization_full_data_custody_test.go',
  'runtime/internal/services/runtimeagent/realm_source_materialization_full_data_transport_test.go',
  'runtime/internal/services/runtimeagent/realm_source_materialization_full_data_lifecycle_test.go',
  'runtime/internal/services/runtimeagent/realm_source_materialization_full_data_attempt_ledger_test.go',
  'runtime/internal/services/runtimeagent/realm_source_materialization_full_data_evidence_test.go',
]);
const FULL_DATA_LIVE_ENVIRONMENT_PATHS = Object.freeze([
  'scripts/lib/realm-v3-full-data-live-contract.mjs',
  'scripts/lib/realm-v3-full-data-live-attestation.mjs',
  'scripts/lib/realm-v3-full-data-live-infrastructure.mjs',
  'scripts/lib/realm-v3-full-data-live-services.mjs',
  'scripts/lib/realm-v3-full-data-live-prepare.mjs',
  'scripts/lib/realm-v3-full-data-live-cleanup.mjs',
  'scripts/lib/realm-v3-full-data-live-environment.mjs',
]);

function read(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    throw new Error(`required hard-cut input is missing: ${relativePath}`);
  }
  return fs.readFileSync(absolutePath, 'utf8');
}

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function sorted(values) {
  return [...values].sort((left, right) =>
    Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8')),
  );
}

function assertExactSet(actual, expected, label) {
  const normalizedActual = sorted(actual);
  const normalizedExpected = sorted(expected);
  invariant(
    JSON.stringify(normalizedActual) === JSON.stringify(normalizedExpected),
    `${label} mismatch: expected ${normalizedExpected.join(', ')}, got ${normalizedActual.join(', ')}`,
  );
}

function block(text, keyword, name) {
  const match = new RegExp(`\\b${keyword}\\s+${name}\\s*\\{`, 'u').exec(text);
  invariant(match, `missing ${keyword} ${name}`);
  const open = text.indexOf('{', match.index);
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === '{') depth += 1;
    if (text[index] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, index);
    }
  }
  throw new Error(`unterminated ${keyword} ${name}`);
}

function protoFieldNames(messageBlock) {
  return [...messageBlock.matchAll(
    /^\s*(?:optional\s+|repeated\s+)?[A-Za-z0-9_.]+\s+([a-z][a-z0-9_]*)\s*=\s*\d+\s*;/gmu,
  )].map((match) => match[1]);
}

function typescriptFieldNames(interfaceBlock) {
  return [...interfaceBlock.matchAll(/^\s*readonly\s+([A-Za-z0-9_]+)\??\s*:/gmu)]
    .map((match) => match[1]);
}

function assertNoTokens(text, tokens, label) {
  for (const token of tokens) {
    invariant(!text.includes(token), `${label} retains forbidden token ${token}`);
  }
}

function assertOpenApi(document, text) {
  const operation = document?.paths?.[PACKET_OPERATION_PATH]?.post;
  invariant(operation?.operationId === PACKET_OPERATION_ID, 'current Realm Packet v3 operation is missing');
  invariant(
    operation?.requestBody?.content?.['application/json']?.schema?.$ref ===
      '#/components/schemas/CreateSourceMaterializationPacketV3Dto',
    'Realm Packet operation does not use CreateSourceMaterializationPacketV3Dto',
  );
  invariant(
    operation?.responses?.['201']?.content?.['application/json']?.schema?.$ref ===
      '#/components/schemas/SourceMaterializationPacketV3Dto',
    'Realm Packet operation does not return SourceMaterializationPacketV3Dto',
  );

  const schemas = document?.components?.schemas ?? {};
  const request = schemas.CreateSourceMaterializationPacketV3Dto;
  invariant(request?.type === 'object' && request?.additionalProperties === false, 'Packet v3 request must be closed');
  assertExactSet(Object.keys(request?.properties ?? {}), [
    'sourceRef',
    'materializerAccountId',
    'challengeId',
    'challengeDigest',
    'intendedRuntimeAudience',
    'challengeExpiresAt',
    'publishedLimits',
  ], 'Packet v3 request properties');
  assertExactSet(request?.required ?? [], Object.keys(request?.properties ?? {}), 'Packet v3 request required fields');

  const packet = schemas.SourceMaterializationPacketV3Dto;
  invariant(packet?.type === 'object' && packet?.additionalProperties === false, 'Packet v3 response must be closed');
  invariant(
    JSON.stringify(packet?.properties?.packetSchemaVersion?.enum) === JSON.stringify([PACKET_SCHEMA]),
    'Packet v3 response schema version is not exact',
  );
  assertExactSet(
    (packet?.properties?.semanticPayload?.oneOf ?? []).map((entry) => entry?.$ref),
    [
      '#/components/schemas/WorldCharacterMaterializationPayloadV3Dto',
      '#/components/schemas/PersonaCharacterMaterializationPayloadV3Dto',
    ],
    'Packet v3 semantic payload variants',
  );

  const sourceRef = schemas.CharacterSourceRefV3Dto;
  invariant(sourceRef?.discriminator?.propertyName === 'kind', 'CharacterSourceRefV3 discriminator is not kind');
  assertExactSet(
    (sourceRef?.oneOf ?? []).map((entry) => entry?.$ref),
    [
      '#/components/schemas/WorldCharacterSourceRefV3Dto',
      '#/components/schemas/PersonaCharacterSourceRefV3Dto',
    ],
    'CharacterSourceRefV3 variants',
  );
  assertExactSet(Object.keys(sourceRef?.discriminator?.mapping ?? {}), [
    'worldCharacter',
    'personaCharacter',
  ], 'CharacterSourceRefV3 discriminator mapping');

  for (const retiredPath of ['/api/human/me/permission-grants', '/api/runtime/realm-grants/issue']) {
    invariant(
      !Object.keys(document?.paths ?? {}).some(
        (candidate) => candidate === retiredPath || candidate.startsWith(`${retiredPath}/`),
      ),
      `Realm OpenAPI retains retired permission endpoint ${retiredPath}`,
    );
  }
  for (const schemaName of Object.keys(schemas)) {
    invariant(!/^AppPermission(?:Grant|Scope)/u.test(schemaName), `Realm OpenAPI retains ${schemaName}`);
    invariant(!/SourceMaterializationPacketV[12]|RealmPersona/u.test(schemaName), `Realm OpenAPI retains ${schemaName}`);
  }
  assertNoTokens(text, [
    'realm.source-materialization-packet/v2',
    'realm_source.snapshot.consume',
    'realm_source.snapshot.bind',
    'agent.identity.project',
    'accessGrantId',
  ], 'Realm OpenAPI');
}

function assertRuntimeProto(serviceText, materializationText) {
  const service = block(serviceText, 'service', 'RuntimeAgentService');
  const rpcNames = [...service.matchAll(/\brpc\s+([A-Za-z0-9_]+)\s*\(/gu)].map((match) => match[1]);
  invariant(rpcNames.filter((name) => name === MATERIALIZATION_RPC).length === 1, 'Runtime must expose exactly one MaterializeRealmSource RPC');
  for (const retired of RETIRED_RPCS) {
    invariant(!rpcNames.includes(retired), `Runtime retains retired public RPC ${retired}`);
  }

  assertExactSet(
    protoFieldNames(block(materializationText, 'message', 'MaterializeRealmSourceRequest')),
    ['context', 'request_id', 'source_ref'],
    'MaterializeRealmSourceRequest fields',
  );
  assertExactSet(
    protoFieldNames(block(materializationText, 'message', 'MaterializeRealmSourceResponse')),
    ['local_agent_ref', 'source_context_status', 'idempotent_replay', 'reason_code'],
    'MaterializeRealmSourceResponse fields',
  );
  assertExactSet(
    protoFieldNames(block(materializationText, 'message', 'CharacterSourceRefV3')),
    ['world_character', 'persona_character'],
    'CharacterSourceRefV3 oneof fields',
  );
  assertExactSet(
    protoFieldNames(block(materializationText, 'message', 'LocalAgentSourceContextStatus')),
    [
      'schema_version',
      'ready',
      'state',
      'reason_code',
      'local_agent_ref',
      'source_ref',
      'source_schema_version',
      'snapshot_schema_version',
      'snapshot_hash',
      'captured_at',
      'world_content_hash',
      'materialization_context_hash',
      'coverage_sections',
    ],
    'LocalAgentSourceContextStatus fields',
  );
  assertNoTokens(materializationText, [
    ...RETIRED_TOKENS,
    ...RETIRED_RPCS,
    'RealmBase',
    'Bearer',
    'PacketProof',
    'OrderedSegments',
  ], 'Runtime materialization public proto');
}

function assertGeneratedSdk() {
  const typescriptRealm = read('sdks/typescript/core-generated/realm-typed-client.ts');
  const packetBlock = block(typescriptRealm, 'interface', 'SourceMaterializationPacketV3Dto');
  invariant(
    /packetSchemaVersion:\s*"realm\.source-materialization-packet\/v3"/u.test(packetBlock),
    'TypeScript generated Packet v3 literal is missing',
  );
  invariant(
    /export type SourceMaterializationPacketV3DtoSemanticPayload\s*=\s*WorldCharacterMaterializationPayloadV3Dto\s*\|\s*PersonaCharacterMaterializationPayloadV3Dto\s*;/u.test(typescriptRealm),
    'TypeScript generated World/Persona Packet v3 union is missing',
  );

  const pythonRealm = read('sdks/python/core_generated/realm_typed_client.py');
  invariant(
    /SourceMaterializationPacketV3DtoSemanticPayload\s*=\s*WorldCharacterMaterializationPayloadV3Dto\s*\|\s*PersonaCharacterMaterializationPayloadV3Dto/u.test(pythonRealm),
    'Python generated World/Persona Packet v3 union is missing',
  );

  const goRealm = read('sdks/go/coregenerated/typed_clients.go');
  invariant(
    /type SourceMaterializationPacketV3DtoSemanticPayload struct \{[\s\S]*?WorldCharacter \*WorldCharacterMaterializationPayloadV3Dto[\s\S]*?PersonaCharacter \*PersonaCharacterMaterializationPayloadV3Dto[\s\S]*?\}/u.test(goRealm),
    'Go generated World/Persona Packet v3 union is missing',
  );
  invariant(
    /SourceMaterializationPacketV3DtoSemanticPayload[\s\S]*?unknown discriminator/u.test(goRealm),
    'Go generated Packet v3 discriminator is not fail-closed',
  );

  const rustRealm = read('sdks/rust/core_generated/typed_clients.rs');
  invariant(
    /pub enum SourceMaterializationPacketV3DtoSemanticPayload \{[\s\S]*?WorldCharacterMaterializationPayloadV3\([\s\S]*?PersonaCharacterMaterializationPayloadV3\([\s\S]*?\}/u.test(rustRealm),
    'Rust generated World/Persona Packet v3 union is missing',
  );
  invariant(
    /SourceMaterializationPacketV3DtoSemanticPayload[\s\S]*?unknown SourceMaterializationPacketV3DtoSemanticPayload discriminator/u.test(rustRealm),
    'Rust generated Packet v3 discriminator is not fail-closed',
  );

  for (const [label, text] of [
    ['TypeScript generated Realm core', typescriptRealm],
    ['Python generated Realm core', pythonRealm],
    ['Go generated Realm core', goRealm],
    ['Rust generated Realm core', rustRealm],
  ]) {
    assertNoTokens(text, ['SourceMaterializationPacketV2', 'realm.source-materialization-packet/v2', 'RealmPersona'], label);
  }
}

function assertTypescriptRuntimeFacade(runtimeText) {
  const input = block(runtimeText, 'interface', 'RuntimeMaterializeRealmSourceInput');
  assertExactSet(
    typescriptFieldNames(input),
    ['sourceRef', 'requestId'],
    'RuntimeMaterializeRealmSourceInput fields',
  );
  assertNoTokens(input, RAW_PUBLIC_INPUTS, 'RuntimeMaterializeRealmSourceInput');
  invariant(
    /strictMaterializationRecord\([\s\S]*?new Set\(\['sourceRef', 'requestId'\]\)/u.test(runtimeText),
    'TypeScript Runtime facade does not strictly close materializeRealmSource input',
  );
  invariant(
    /async materializeRealmSource\([\s\S]*?this\.#materializeRealmSource\(\{/u.test(runtimeText),
    'TypeScript Runtime facade does not delegate MaterializeRealmSource',
  );

  const generatedRuntime = read('sdks/typescript/core-generated/runtime-typed-client.ts');
  invariant(/async materializeRealmSource\s*\(/u.test(generatedRuntime), 'generated Runtime client is missing materializeRealmSource');
  assertNoTokens(generatedRuntime, RETIRED_RPCS.map((value) => `${value[0].toLowerCase()}${value.slice(1)}`), 'generated Runtime client');
}

function assertRuntimeAcquisition() {
  const issuer = read('runtime/internal/services/runtimeagent/source_materialization_v3_issuer.go');
  const account = read('runtime/internal/services/account/realm_source_materialization.go');
  invariant(
    /AcquireRealmSourceMaterialization\(context\.Context, RealmSourceMaterializationIssuanceRequest\)/u.test(issuer),
    'Runtime-private Realm materialization issuer seam is missing',
  );
  invariant(
    /doRealmSourceMaterializationStream\(ctx, credential, http\.MethodPost, realmSourceMaterializationPacketPath/u.test(account),
    'Runtime account owner does not call the fixed Packet v3 endpoint directly',
  );
  assertNoTokens(`${issuer}\n${account}`, RETIRED_TOKENS, 'Runtime Packet v3 acquisition');
}

function assertFullDataProofChain(contractLock, runner, worker, liveEnvironment, censusWorker) {
  invariant(contractLock?.schema_version === 'nimi.realm-contract-lock/v4', 'N7 full-data proof does not consume lock v4');
  invariant(
    contractLock?.access_policy?.version === 'realm.source-materialization-access-policy/v5' &&
      contractLock?.access_policy?.authority_class === 'authenticated_first_party_product_operation' &&
      contractLock?.access_policy?.third_party_app_permission_required === false &&
      contractLock?.access_policy?.permission_catalog === 'empty',
    'N7 full-data proof lock does not preserve first-party no-permission authority',
  );
  assertNoTokens(`${runner}\n${worker}`, FULL_DATA_RETIRED_POSITIVE_AUTHORITY, 'N7 full-data proof chain');
  assertNoTokens(
    `${liveEnvironment}\n${censusWorker}`,
    [
      'fixed_a30',
      'fixed-a30',
      'fixed a30',
      'realm-a30',
      'Realm a30',
      '.nimi/spec/realm/contracts/openapi.yaml',
    ],
    'N7 current Realm live proof',
  );
  invariant(
    runner.includes("lock.schema_version !== 'nimi.realm-contract-lock/v4'") &&
      runner.includes("const ACCESS_POLICY_VERSION = 'realm.source-materialization-access-policy/v5'") &&
      runner.includes("evidence?.schemaVersion !== 'nimi.realm-v3-compact-acceptance/v1'") &&
      runner.includes("'config/realm-v3/current-producer-admission.json'") &&
      runner.includes('authorizationBoundary: AUTHORIZATION_BOUNDARY'),
    'N7 runner does not freeze current producer admission and first-party authorization',
  );
  invariant(
    worker.includes('realmV3FullDataAccessPolicyVersionV5') &&
      worker.includes('realmV3FullDataExpectedAuthorizationBoundaryV1') &&
      worker.includes('AuthorizationStatePersisted: false'),
    'N7 Runtime worker does not prove the current authorization boundary and offline non-persistence',
  );
  invariant(
    liveEnvironment.includes('LIVE_ENVIRONMENT_MODULE_BASENAMES') &&
      liveEnvironment.includes('modules: modules.map') &&
      censusWorker.includes('wrapper.modules') &&
      censusWorker.includes('LIVE_ENVIRONMENT_MODULE_BASENAMES.entries()'),
    'N7 live wrapper trust does not bind the complete split-module closure',
  );
  const commit = contractLock?.realm?.commit;
  const tree = contractLock?.realm?.tree;
  const openapiDigest = contractLock?.openapi?.document_sha256;
  const policyDigest = contractLock?.access_policy?.digest;
  invariant(
    typeof commit === 'string' && typeof tree === 'string' &&
      typeof openapiDigest === 'string' && typeof policyDigest === 'string' &&
      censusWorker.includes(`export const FIXED_REALM_COMMIT = '${commit}'`) &&
      censusWorker.includes(`export const FIXED_REALM_TREE = '${tree}'`) &&
      censusWorker.includes(`export const CURRENT_OPENAPI_DIGEST = '${openapiDigest}'`) &&
      censusWorker.includes(`export const CURRENT_ACCESS_POLICY_DIGEST = '${policyDigest}'`) &&
      liveEnvironment.includes('policyDigest: CURRENT_ACCESS_POLICY_DIGEST'),
    'N7 live environment or census worker is not pinned to the admitted current Realm identity',
  );
}

function assertActiveAuthorityAndReleaseEvidence(
  realmApiContract,
  realmCoreContract,
  runtimeAuthPosture,
  zhiyuReleaseReadiness,
  runtimeMaterializationService,
  realmConsumerSmoke,
) {
  assertNoTokens(
    `${realmApiContract}\n${realmCoreContract}\n${runtimeAuthPosture}\n${zhiyuReleaseReadiness}`,
    [
      'access-grant request',
      'access-grant requests',
      'grant internally',
      'permission_scope_ref',
      'permissionGrantTruth',
      'agent.identity.project',
      'bounded-r1-scope-set',
    ],
    'active Realm consumer authority and Zhiyu release evidence',
  );
  invariant(
    realmApiContract.includes('there is no app grant') &&
      realmCoreContract.includes('authenticated first-party challenges'),
    'active SDK authority does not state the first-party no-grant boundary',
  );
  invariant(
    runtimeAuthPosture.includes('without any app permission or grant'),
    'Runtime RPC auth posture does not state the first-party no-grant boundary',
  );
  invariant(
    zhiyuReleaseReadiness.includes('permission_requirements') &&
      zhiyuReleaseReadiness.includes('permissionDecisionTruth') &&
      zhiyuReleaseReadiness.includes('not-required-empty-public-permission-requirements'),
    'Zhiyu release readiness does not use the current empty public permission model',
  );
  invariant(
    runtimeMaterializationService.includes('No app permission or grant participates.') &&
      !runtimeMaterializationService.includes('credential, grant, challenge'),
    'Runtime materialization service comment restores an internal grant step',
  );
  invariant(
    realmConsumerSmoke.includes('Retired Realm app-grant methods are absent from the first-party API.') &&
      !realmConsumerSmoke.includes('grant acquisition is Runtime-internal authority'),
    'Realm consumer smoke describes retired grant acquisition as current Runtime authority',
  );
}

function expectedHandoffClassification(index) {
  if (index <= 11) return 'realm_input_required';
  if (index <= 16) return 'runtime_derived';
  if (index <= 22) return 'runtime_owned';
  if (index <= 26) return 'forbidden_in_realm_packet';
  return 'not_applicable';
}

function expectedHandoffDisposition(classification) {
  return {
    realm_input_required: 'implemented_realm_input',
    runtime_derived: 'implemented_runtime_derived',
    runtime_owned: 'retained_runtime_owned',
    forbidden_in_realm_packet: 'rejected_forbidden_input',
    not_applicable: 'not_applicable_to_materialization',
  }[classification];
}

function assertHandoffEvidence(candidate, label, requireTestPath) {
  invariant(candidate && typeof candidate === 'object' && !Array.isArray(candidate), `${label} is missing`);
  const relativePath = candidate.path;
  const contains = candidate.contains;
  invariant(
    typeof relativePath === 'string' && relativePath !== '' && !path.isAbsolute(relativePath) &&
      !relativePath.split('/').includes('..'),
    `${label} path is invalid`,
  );
  invariant(typeof contains === 'string' && contains !== '', `${label} anchor is missing`);
  const isTestPath = /(?:^|\/)(?:test|tests)(?:\/|$)|(?:\.test\.[^.]+|_test\.go)$/u.test(relativePath);
  invariant(isTestPath === requireTestPath, `${label} path has the wrong evidence class: ${relativePath}`);
  invariant(read(relativePath).includes(contains), `${label} anchor is absent: ${relativePath}:${contains}`);
}

function assertHandoffDispositions(dispositions) {
  invariant(
    dispositions?.schemaVersion === 'nimi.realm-v3-handoff-dispositions/v1',
    'Realm handoff disposition schema is not current',
  );
  const admission = JSON.parse(read('config/realm-v3/current-producer-admission.json'));
  const requirementSource = admission?.semanticFiles?.find(
    (entry) => entry?.path === dispositions?.producerRequirementMap?.path,
  );
  invariant(requirementSource, 'admitted producer requirement map is missing');
  invariant(
    dispositions.producerRequirementMap.path === 'config/nimi-runtime-materialization-requirements.json' &&
      dispositions.producerRequirementMap.sha256 === requirementSource.sha256 &&
      dispositions.producerRequirementMap.rowCount === 28,
    'Realm handoff producer source identity drifted',
  );
  invariant(
    dispositions?.permissionModel?.authorityClass === admission?.accessPolicy?.authorityClass &&
      dispositions?.permissionModel?.thirdPartyAppPermissionRequired === false &&
      dispositions?.permissionModel?.permissionCatalog === 'empty',
    'Realm handoff disposition permission model drifted',
  );

  invariant(Array.isArray(dispositions.rows), 'Realm handoff disposition rows are missing');
  const expectedIds = Array.from(
    { length: 28 },
    (_, index) => `NIMI-MAT-${String(index + 1).padStart(3, '0')}`,
  );
  assertExactSet(dispositions.rows.map((row) => row?.requirementId), expectedIds, 'Realm handoff requirement ids');
  invariant(new Set(dispositions.rows.map((row) => row?.requirementId)).size === 28, 'Realm handoff requirement ids are duplicated');

  for (const row of dispositions.rows) {
    const index = Number.parseInt(row.requirementId.slice(-3), 10);
    const classification = expectedHandoffClassification(index);
    invariant(row.classification === classification, `${row.requirementId} classification drifted`);
    invariant(
      row.disposition === expectedHandoffDisposition(classification),
      `${row.requirementId} disposition drifted`,
    );
    assertHandoffEvidence(row.implementationEvidence, `${row.requirementId} implementation evidence`, false);
    assertHandoffEvidence(row.testEvidence, `${row.requirementId} test evidence`, true);
    invariant(
      Array.isArray(row.acceptanceEvidence) && row.acceptanceEvidence.length > 0,
      `${row.requirementId} acceptance evidence is missing`,
    );
    for (const evidence of row.acceptanceEvidence) {
      invariant(
        HANDOFF_ACCEPTANCE_EVIDENCE.includes(evidence),
        `${row.requirementId} acceptance evidence is unknown: ${evidence}`,
      );
    }
  }
  invariant(
    dispositions?.summary?.rowCount === 28 &&
      dispositions?.summary?.mappedRequirements === 28 &&
      dispositions?.summary?.unmappedRequirements === 0,
    'Realm handoff disposition summary is not exact 28/28 with zero unmapped',
  );
  return dispositions.rows.length;
}

function trackedProductionFiles() {
  const roots = [
    'apps/zhiyu/src',
    'apps/desktop/src',
    'apps/web/src',
    'kit/core/src',
    'kit/features',
    'kit/shell/renderer/src',
    'sdks/typescript/runtime',
    'runtime/internal/services/runtimeagent',
    'runtime/internal/services/account',
  ];
  return execFileSync('git', ['ls-files', '-z', '--', ...roots], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean)
    .filter((relativePath) => fs.existsSync(path.join(repoRoot, relativePath)))
    .filter((relativePath) => /\.(?:go|js|mjs|ts|tsx)$/u.test(relativePath))
    .filter((relativePath) => !/(?:^|\/)(?:test|tests|fixtures)(?:\/|$)/u.test(relativePath))
    .filter((relativePath) => !/(?:\.test\.|_test\.go$|\/generated\/|\/target\/)/u.test(relativePath))
    .sort();
}

function assertConsumerAbsence() {
  const files = trackedProductionFiles();
  const forbidden = [...RETIRED_TOKENS, ...RETIRED_RPCS];
  const violations = [];
  for (const relativePath of files) {
    const source = read(relativePath);
    for (const token of forbidden) {
      if (source.includes(token)) violations.push(`${relativePath}:${token}`);
    }
    // RealmCoreOrigin still has a canonical optional sourceContentHash field.
    // The hard cut removes it only as a consumer-selected materialization
    // identity/cache key; Runtime's strict Packet parser must keep validating
    // the producer-owned origin field.
    if (!relativePath.startsWith('runtime/internal/services/') && source.includes('sourceContentHash')) {
      violations.push(`${relativePath}:sourceContentHash`);
    }
  }
  invariant(
    violations.length === 0,
    `active consumer legacy authority remains: ${violations.join(', ')}`,
  );
  return files.length;
}

function expectRejected(label, operation) {
  try {
    operation();
  } catch {
    return;
  }
  throw new Error(`hard-cut mutation was accepted: ${label}`);
}

function runMutationTests(
  openApi,
  openApiText,
  serviceText,
  materializationText,
  runtimeText,
  dispositions,
  activeAuthority,
  fullData,
) {
  const mutations = [
    ['packet accessGrantId', () => {
      const candidate = structuredClone(openApi);
      candidate.components.schemas.CreateSourceMaterializationPacketV3Dto.properties.accessGrantId = { type: 'string' };
      candidate.components.schemas.CreateSourceMaterializationPacketV3Dto.required.push('accessGrantId');
      assertOpenApi(candidate, YAML.stringify(candidate));
    }],
    ['permission endpoint', () => {
      const candidate = structuredClone(openApi);
      candidate.paths['/api/human/me/permission-grants'] = { post: { operationId: 'forged' } };
      assertOpenApi(candidate, YAML.stringify(candidate));
    }],
    ['Packet v2 response', () => {
      const candidate = structuredClone(openApi);
      candidate.components.schemas.SourceMaterializationPacketV3Dto.properties.packetSchemaVersion.enum = ['realm.source-materialization-packet/v2'];
      assertOpenApi(candidate, YAML.stringify(candidate));
    }],
    ['public upload RPC', () => {
      const candidate = serviceText.replace(
        /service RuntimeAgentService\s*\{/u,
        'service RuntimeAgentService {\n  rpc BeginSourceMaterializationUpload(MaterializeRealmSourceRequest) returns (MaterializeRealmSourceResponse);',
      );
      assertRuntimeProto(candidate, materializationText);
    }],
    ['public bearer input', () => {
      const candidate = runtimeText.replace(
        /interface RuntimeMaterializeRealmSourceInput\s*\{/u,
        'interface RuntimeMaterializeRealmSourceInput {\n  readonly bearer: string;',
      );
      assertTypescriptRuntimeFacade(candidate);
    }],
    ['missing handoff disposition', () => {
      const candidate = structuredClone(dispositions);
      candidate.rows.pop();
      assertHandoffDispositions(candidate);
    }],
    ['misclassified handoff disposition', () => {
      const candidate = structuredClone(dispositions);
      candidate.rows[0].classification = 'runtime_owned';
      assertHandoffDispositions(candidate);
    }],
    ['missing handoff implementation anchor', () => {
      const candidate = structuredClone(dispositions);
      candidate.rows[0].implementationEvidence.contains = 'missing-forged-anchor';
      assertHandoffDispositions(candidate);
    }],
    ['active authority restores app grant', () => {
      assertActiveAuthorityAndReleaseEvidence(
        `${activeAuthority.realmApiContract}\naccess-grant request`,
        activeAuthority.realmCoreContract,
        activeAuthority.runtimeAuthPosture,
        activeAuthority.zhiyuReleaseReadiness,
        activeAuthority.runtimeMaterializationService,
        activeAuthority.realmConsumerSmoke,
      );
    }],
    ['Zhiyu release evidence restores scope grants', () => {
      assertActiveAuthorityAndReleaseEvidence(
        activeAuthority.realmApiContract,
        activeAuthority.realmCoreContract,
        activeAuthority.runtimeAuthPosture,
        `${activeAuthority.zhiyuReleaseReadiness}\nbounded-r1-scope-set`,
        activeAuthority.runtimeMaterializationService,
        activeAuthority.realmConsumerSmoke,
      );
    }],
    ['Runtime boundary comment restores an internal grant', () => {
      assertActiveAuthorityAndReleaseEvidence(
        activeAuthority.realmApiContract,
        activeAuthority.realmCoreContract,
        activeAuthority.runtimeAuthPosture,
        activeAuthority.zhiyuReleaseReadiness,
        `${activeAuthority.runtimeMaterializationService}\n// credential, grant, challenge`,
        activeAuthority.realmConsumerSmoke,
      );
    }],
    ['Realm smoke restores current internal grant authority', () => {
      assertActiveAuthorityAndReleaseEvidence(
        activeAuthority.realmApiContract,
        activeAuthority.realmCoreContract,
        activeAuthority.runtimeAuthPosture,
        activeAuthority.zhiyuReleaseReadiness,
        activeAuthority.runtimeMaterializationService,
        `${activeAuthority.realmConsumerSmoke}\n// grant acquisition is Runtime-internal authority`,
      );
    }],
    ['N7 worker restores grant lifecycle authority', () => {
      assertFullDataProofChain(
        fullData.contractLock,
        fullData.runner,
        `${fullData.worker}\ntype forged struct { PermissionSplit string }`,
        fullData.liveEnvironment,
        fullData.censusWorker,
      );
    }],
    ['N7 live proof restores stale a30 producer semantics', () => {
      assertFullDataProofChain(
        fullData.contractLock,
        fullData.runner,
        fullData.worker,
        `${fullData.liveEnvironment}\nconst method = 'fixed_a30_admitted_fullchain_fixture';`,
        fullData.censusWorker,
      );
    }],
  ];
  for (const [label, operation] of mutations) expectRejected(label, operation);
  invariant(openApiText.includes(PACKET_SCHEMA), 'positive OpenAPI fixture does not contain Packet v3');
  return mutations.length;
}

function main() {
  const contractLock = YAML.parse(read('config/realm-contract-lock.yaml'));
  const openApiText = read('config/realm-openapi/api-nimi.yaml');
  const openApi = YAML.parse(openApiText);
  const serviceText = read('proto/runtime/v1/agent_service.proto');
  const materializationText = read('proto/runtime/v1/agent_source_materialization.proto');
  const runtimeText = read('sdks/typescript/runtime/index.ts');
  const handoffDispositions = JSON.parse(read(HANDOFF_DISPOSITION_PATH));
  const fullData = {
    contractLock,
    runner: FULL_DATA_RUNNER_PATHS.map(read).join('\n'),
    worker: FULL_DATA_RUNTIME_PROOF_PATHS.map(read).join('\n'),
    liveEnvironment: FULL_DATA_LIVE_ENVIRONMENT_PATHS.map(read).join('\n'),
    censusWorker: read('scripts/realm-v3-full-data-census-worker.mjs'),
  };
  const activeAuthority = {
    realmApiContract: read('.nimi/spec/sdks/kernel/realm-api-consumer-contract.md'),
    realmCoreContract: read('.nimi/spec/sdks/kernel/realm-core-contract.md'),
    runtimeAuthPosture: read('.nimi/spec/runtime/kernel/tables/runtime-rpc-auth-posture/agent-ai-cognition.yaml'),
    zhiyuReleaseReadiness: read('scripts/zhiyu-release-readiness-report.mjs'),
    runtimeMaterializationService: read('runtime/internal/services/runtimeagent/realm_source_materialization_service.go'),
    realmConsumerSmoke: read('scripts/check-sdk-vnext-realm-consumer-smoke.mjs'),
  };

  assertOpenApi(openApi, openApiText);
  assertRuntimeProto(serviceText, materializationText);
  assertGeneratedSdk();
  assertTypescriptRuntimeFacade(runtimeText);
  assertRuntimeAcquisition();
  assertFullDataProofChain(
    fullData.contractLock,
    fullData.runner,
    fullData.worker,
    fullData.liveEnvironment,
    fullData.censusWorker,
  );
  assertActiveAuthorityAndReleaseEvidence(
    activeAuthority.realmApiContract,
    activeAuthority.realmCoreContract,
    activeAuthority.runtimeAuthPosture,
    activeAuthority.zhiyuReleaseReadiness,
    activeAuthority.runtimeMaterializationService,
    activeAuthority.realmConsumerSmoke,
  );
  const handoffRequirements = assertHandoffDispositions(handoffDispositions);
  const productionFilesScanned = assertConsumerAbsence();
  const negativeMutations = runMutationTests(
    openApi,
    openApiText,
    serviceText,
    materializationText,
    runtimeText,
    handoffDispositions,
    activeAuthority,
    fullData,
  );

  process.stdout.write(`${JSON.stringify({
    schemaVersion: 'nimi.realm-v3-consumer-hardcut-result/v1',
    verdict: 'PASS',
    packetSchema: PACKET_SCHEMA,
    publicMaterializationOperations: [MATERIALIZATION_RPC],
    permissionModel: 'authenticated_first_party_product_operation',
    appPermissionRequired: false,
    productionFilesScanned,
    legacyAuthorityMatches: 0,
    publicRawTransportMethods: 0,
    generatedLanguages: 4,
    handoffRequirements,
    unmappedHandoffRequirements: 0,
    negativeMutations,
  }, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `[check:local-agent-contract-propagation-hardcut] ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
