#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const failures = [];
let deferredLegacyInventorySummary = '';

function read(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    failures.push(`${relativePath}: missing`);
    return '';
  }
  return fs.readFileSync(absolutePath, 'utf8');
}

function requireMatch(text, pattern, label) {
  if (!pattern.test(text)) failures.push(`missing ${label}`);
}

function forbidMatch(text, pattern, label) {
  if (pattern.test(text)) failures.push(`forbidden ${label}`);
}

function countMatches(text, pattern) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  return [...text.matchAll(new RegExp(pattern.source, flags))].length;
}

function block(text, keyword, name) {
  const startPattern = new RegExp(`\\b${keyword}\\s+${name}\\s*\\{`, 'g');
  const match = startPattern.exec(text);
  if (!match) {
    failures.push(`missing ${keyword} ${name}`);
    return '';
  }
  const open = text.indexOf('{', match.index);
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === '{') depth += 1;
    if (text[index] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, index);
    }
  }
  failures.push(`unterminated ${keyword} ${name}`);
  return '';
}

function trackedActiveFiles() {
  const output = execFileSync(
    'git',
    ['ls-files', '-z', '--', 'apps', 'runtime', 'sdks', 'scripts'],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  return output
    .split('\0')
    .filter(Boolean)
    .filter((relativePath) => fs.existsSync(path.join(repoRoot, relativePath)))
    .filter(
      (relativePath) =>
        relativePath !== 'scripts/check-local-agent-contract-propagation-hardcut.mjs',
    )
    .sort();
}

function requireFields(messageBlock, messageName, fields) {
  for (const field of fields) {
    if (!new RegExp(`\\b${field}\\s*=\\s*\\d+\\s*;`).test(messageBlock)) {
      failures.push(`${messageName}: missing field ${field}`);
    }
  }
}

function checkOpenApi() {
  const relativePath = 'config/realm-openapi/api-nimi.yaml';
  const text = read(relativePath);
  const document = YAML.parse(text);
  const schemas = document?.components?.schemas || {};
  const packet = schemas.SourceMaterializationPacketV2Dto;
  requireMatch(text, /realm\.source-materialization-packet\/v2/u, `${relativePath} packet v2`);
  forbidMatch(text, /realm\.source-materialization-packet\/v1|sourceDisplayMetadata|hmac-sha256/iu, `${relativePath} v1/HMAC/display metadata`);
  if (packet?.additionalProperties !== false) failures.push('SourceMaterializationPacketV2Dto must be closed');
  const semanticRefs = packet?.properties?.semanticPayload?.oneOf?.map((entry) => entry?.$ref) || [];
  const expectedRefs = [
    '#/components/schemas/WorldCharacterMaterializationPayloadV2Dto',
    '#/components/schemas/RealmPersonaMaterializationPayloadV2Dto',
  ];
  if (JSON.stringify(semanticRefs) !== JSON.stringify(expectedRefs)) {
    failures.push('SourceMaterializationPacketV2Dto semanticPayload must be the Character/Persona discriminated union');
  }
  for (const schemaName of [
    'CreateSourceMaterializationPacketDto',
    'SourceMaterializationPacketV2Dto',
    'WorldCharacterMaterializationPayloadV2Dto',
    'RealmPersonaMaterializationPayloadV2Dto',
    'BundleTransportManifestV1Dto',
    'SourceMaterializationComponentV1Dto',
  ]) {
    if (!schemas[schemaName]) failures.push(`${relativePath}: missing schema ${schemaName}`);
  }
}

function checkProto() {
  const serviceRelativePath = 'proto/runtime/v1/agent_service.proto';
  const relativePath = 'proto/runtime/v1/agent_source_materialization.proto';
  const serviceText = read(serviceRelativePath);
  const text = read(relativePath);
  const service = block(serviceText, 'service', 'RuntimeAgentService');
  for (const rpc of [
    'CreateSourceMaterializationChallenge',
    'BeginSourceMaterializationUpload',
    'PutSourceMaterializationChunk',
    'CommitSourceMaterialization',
    'AbortSourceMaterializationUpload',
  ]) {
    requireMatch(service, new RegExp(`\\brpc\\s+${rpc}\\s*\\(`), `${serviceRelativePath} RPC ${rpc}`);
  }
  for (const [messageName, fields] of Object.entries({
    CreateSourceMaterializationChallengeRequest: ['context', 'request_id', 'source_ref'],
    CreateSourceMaterializationChallengeResponse: ['challenge_id', 'intended_runtime_audience', 'challenge_digest', 'expires_at', 'limits', 'state', 'reason_code'],
    BeginSourceMaterializationUploadRequest: ['context', 'begin_request_id', 'control'],
    SourceMaterializationBeginControl: ['packet_envelope', 'packet_proof', 'bundle_transport_manifest'],
    PutSourceMaterializationChunkRequest: ['context', 'put_request_id', 'upload_id', 'packet_hash', 'bundle_manifest_hash', 'global_ordinal', 'component_id', 'component_offset', 'chunk_sha256', 'bytes'],
    CommitSourceMaterializationRequest: ['context', 'commit_request_id', 'upload_id', 'packet_hash', 'bundle_manifest_hash'],
    AbortSourceMaterializationUploadRequest: ['context', 'abort_request_id', 'upload_id', 'packet_hash', 'bundle_manifest_hash'],
    LocalAgentSourceContextStatus: ['schema_version', 'ready', 'state', 'reason_code', 'source_ref', 'snapshot_schema_version', 'snapshot_hash', 'captured_at', 'world_content_hash', 'materialization_context_hash', 'coverage_sections'],
    AgentTurnContextSummary: ['schema_version', 'ready', 'state', 'reason_code', 'manifest_schema_version', 'compiler_schema_version', 'manifest_instance_hash', 'context_content_hash', 'prompt_hash', 'source_snapshot_hash', 'lanes', 'budget', 'transcript_turn_count', 'memory_item_count', 'media_count', 'tool_count', 'route_digest', 'catalog_revision_digest'],
  })) {
    requireFields(block(text, 'message', messageName), messageName, fields);
  }

  for (const enumName of [
    'AgentSourceMaterializationSourceKind',
    'AgentSourceMaterializationChallengeState',
    'AgentSourceMaterializationUploadState',
    'AgentSourceMaterializationComponentKind',
    'AgentSourceMaterializationProofAlgorithm',
    'AgentSourceMaterializationKeyUse',
    'AgentSourceMaterializationPacketSchemaVersion',
    'AgentSourceMaterializationBundleManifestSchemaVersion',
    'AgentSourceMaterializationPayloadAssemblyVersion',
    'AgentSourceMaterializationReasonCode',
    'AgentLocalSourceContextState',
    'AgentLocalSourceCoverageSection',
    'AgentLocalSourceCoverageState',
    'AgentTurnContextState',
    'AgentTurnContextLaneId',
    'AgentTurnContextLaneState',
    'AgentTurnContextTruncationReason',
    'AgentContextProjectionReasonCode',
    'AgentLocalSourceContextSchemaVersion',
    'AgentLocalSourceSnapshotSchemaVersion',
    'AgentTurnContextSummarySchemaVersion',
    'AgentTurnContextManifestSchemaVersion',
    'AgentTurnContextCompilerSchemaVersion',
  ]) {
    const enumBlock = block(text, 'enum', enumName);
    requireMatch(enumBlock, /_UNSPECIFIED\s*=\s*0\s*;/u, `${enumName} UNSPECIFIED=0`);
  }

  const beginControl = block(text, 'message', 'SourceMaterializationBeginControl');
  forbidMatch(beginControl, /google\.protobuf\.Struct|raw_(?:source|world|core|prompt|memory|packet)|system_prompt|lane_text|chunk_bytes/iu, 'SourceMaterializationBeginControl private/raw field');
  requireMatch(beginControl, /string\s+packet_proof\s*=\s*2\s*;/u, 'SourceMaterializationBeginControl detached proof');
  for (const messageName of [
    'SourceMaterializationPacketEnvelopeV2',
    'BundleTransportManifestV1',
    'LocalAgentSourceContextStatus',
    'AgentTurnContextSummary',
  ]) {
    const messageBlock = block(text, 'message', messageName);
    forbidMatch(messageBlock, /google\.protobuf\.Struct|raw_(?:source|world|core|prompt|memory|packet)|system_prompt|lane_text|packet_proof|chunk_bytes/iu, `${messageName} private/raw field`);
  }
  forbidMatch(service, /MaterializeSource\s*\(|CreateLocalAgentFromPacket\s*\(/u, 'unary packet shortcut RPC');
  requireMatch(
    block(text, 'message', 'SourceMaterializationBundleComponentDescriptorV1'),
    /AgentSourceMaterializationComponentKind\s+kind\s*=\s*2\s*;/u,
    'closed bundle component kind',
  );
}

function checkGeneratedAndFacade() {
  const generated = read('sdks/typescript/core-generated/realm-typed-client.ts');
  const packetBlock = block(generated, 'interface', 'SourceMaterializationPacketV2Dto');
  requireMatch(packetBlock, /packetSchemaVersion:\s*"realm\.source-materialization-packet\/v2"/u, 'generated packet v2 literal');
  requireMatch(packetBlock, /semanticPayload:\s*SourceMaterializationPacketV2DtoSemanticPayload/u, 'generated named semantic payload union binding');
  requireMatch(
    generated,
    /export type SourceMaterializationPacketV2DtoSemanticPayload\s*=\s*WorldCharacterMaterializationPayloadV2Dto\s*\|\s*RealmPersonaMaterializationPayloadV2Dto\s*;/u,
    'generated Character/Persona semantic payload union',
  );
  forbidMatch(packetBlock, /unknown|Record<string,\s*unknown>|sourceDisplayMetadata|hmac/iu, 'generated anonymous/v1 packet field');
  for (const sourceName of ['WorldCharacterMaterializationSourceV2Dto', 'RealmPersonaMaterializationSourceV2Dto']) {
    const sourceBlock = block(generated, 'interface', sourceName);
    requireMatch(sourceBlock, /readonly\s+core:\s*\w+Core\s*;/u, `${sourceName} named strict core`);
    forbidMatch(sourceBlock, /Record<string,\s*unknown>|\bunknown\b/u, `${sourceName} anonymous core`);
  }

  const facadeTypes = read('sdks/typescript/realm/social-types.ts');
  const facade = read('sdks/typescript/realm/social.ts');
  requireMatch(facadeTypes, /SourceMaterializationPacketV2Dto/u, 'Realm facade generated v2 packet alias');
  forbidMatch(`${facadeTypes}\n${facade}`, /\bSourceMaterializationPacketDto\b|realm\.source-materialization-packet\/v1|sourceDisplayMetadata|hmac-sha256/iu, 'Realm facade v1 alias or content');
  forbidMatch(facadeTypes, /interface\s+\w*SourceMaterializationPacket/u, 'handwritten duplicate packet interface');

  const runtimeTypedClient = read('sdks/typescript/core-generated/runtime-typed-client.ts');
  const runtimeGenerated = read('sdks/typescript/core-generated/runtime-protobuf/runtime/v1/agent_source_materialization.ts');
  for (const typeName of [
    'CreateSourceMaterializationChallengeRequest',
    'BeginSourceMaterializationUploadRequest',
    'PutSourceMaterializationChunkRequest',
    'CommitSourceMaterializationRequest',
    'AbortSourceMaterializationUploadRequest',
    'LocalAgentSourceContextStatus',
    'AgentTurnContextSummary',
  ]) {
    requireMatch(runtimeGenerated, new RegExp(`(?:interface|type)\\s+${typeName}\\b`), `generated Runtime type ${typeName}`);
  }
  for (const methodName of [
    'createSourceMaterializationChallenge',
    'beginSourceMaterializationUpload',
    'putSourceMaterializationChunk',
    'commitSourceMaterialization',
    'abortSourceMaterializationUpload',
  ]) {
    requireMatch(runtimeTypedClient, new RegExp(`async\\s+${methodName}\\s*\\(`), `generated Runtime typed method ${methodName}`);
  }
  const agentEnums = read('sdks/typescript/runtime/wire-types/agent-participation-enums.ts');
  for (const enumName of [
    'AgentSourceMaterializationSourceKind',
    'AgentSourceMaterializationChallengeState',
    'AgentSourceMaterializationUploadState',
    'AgentSourceMaterializationComponentKind',
    'AgentSourceMaterializationReasonCode',
    'AgentLocalSourceContextState',
    'AgentTurnContextState',
    'AgentTurnContextLaneId',
  ]) {
    requireMatch(agentEnums, new RegExp(`export function assertKnown${enumName}\\b`), `fail-closed numeric validator ${enumName}`);
  }

  const pythonGenerated = read('sdks/python/core_generated/realm_typed_client.py');
  requireMatch(
    pythonGenerated,
    /SourceMaterializationPacketV2DtoSemanticPayload\s*=\s*WorldCharacterMaterializationPayloadV2Dto\s*\|\s*RealmPersonaMaterializationPayloadV2Dto/u,
    'Python Character/Persona semantic payload union',
  );

  const goGenerated = read('sdks/go/coregenerated/typed_clients.go');
  requireMatch(
    goGenerated,
    /type SourceMaterializationPacketV2DtoSemanticPayload struct \{[\s\S]*?WorldCharacter \*WorldCharacterMaterializationPayloadV2Dto[\s\S]*?RealmPersona \*RealmPersonaMaterializationPayloadV2Dto[\s\S]*?\}/u,
    'Go Character/Persona semantic payload union',
  );
  requireMatch(
    goGenerated,
    /func \(value \*SourceMaterializationPacketV2DtoSemanticPayload\) UnmarshalJSON\([\s\S]*?unknown discriminator/u,
    'Go fail-closed semantic payload discriminator',
  );

  const rustGenerated = read('sdks/rust/core_generated/typed_clients.rs');
  requireMatch(
    rustGenerated,
    /pub enum SourceMaterializationPacketV2DtoSemanticPayload \{[\s\S]*?WorldCharacterMaterializationPayloadV2\([\s\S]*?RealmPersonaMaterializationPayloadV2\([\s\S]*?\}/u,
    'Rust Character/Persona semantic payload union',
  );
  requireMatch(
    rustGenerated,
    /impl SourceMaterializationPacketV2DtoSemanticPayload \{[\s\S]*?try_from_discriminator[\s\S]*?unknown SourceMaterializationPacketV2DtoSemanticPayload discriminator/u,
    'Rust fail-closed semantic payload discriminator',
  );
}

function checkDeferredLegacyMaterializationInventory() {
  // The Runtime/SDK/app admission chain is hard-cut. Every remaining match is
  // rejection-only checker or negative-fixture vocabulary. Enumerate the exact
  // active source locations so any new positive producer fails immediately.
  const rejectionOnly = new Map([
    ['scripts/check-local-agent-full-chain-hardcut.mjs', 1],
    ['scripts/check-realm-contract-lock.mjs', 1],
    ['scripts/lib/local-agent-full-chain-app-scan.mjs', 9],
    ['scripts/lib/local-agent-runtime-materialization-hardcut.mjs', 7],
    ['sdks/go/coregenerated/behavior_test.go', 1],
  ]);
  const expected = new Map(rejectionOnly);
  deferredLegacyInventorySummary = [
    `legacy rejection inventory: ${expected.size} tracked files`,
    `(positive producers 0, rejection-only ${rejectionOnly.size})`,
  ].join(' ');
  const legacyPattern = new RegExp(
    [
      'realm\\.source-materialization-packet/v1',
      'sourceDisplayMetadata',
      'hmac-sha256',
      'SOURCE_MATERIALIZATION_PACKET_HMAC_SECRET',
      'SOURCE_PACKET_HMAC_SECRET',
      'SourceMaterializationPacketHMACSecret',
      'sourceMaterializationPacketHmacSecret',
      'sourceMaterializationHMACSecretEnv',
      'sourceMaterializationPacketHMACSecret',
      'sourcePacketSecret',
      'nimi\\.desktop\\.local-agent\\.materialization',
    ].join('|'),
    'u',
  );
  const actualFiles = trackedActiveFiles().filter((relativePath) =>
    legacyPattern.test(read(relativePath)),
  );
  if (JSON.stringify(actualFiles) !== JSON.stringify([...expected.keys()].sort())) {
    failures.push(`deferred legacy materialization inventory drift: expected ${expected.size} exact tracked files, got ${actualFiles.join(', ') || '<none>'}`);
  }
  for (const [relativePath, expectedCount] of expected) {
    const actualCount = countMatches(read(relativePath), legacyPattern);
    if (actualCount !== expectedCount) {
      failures.push(`deferred legacy materialization count drift: ${relativePath} expected ${expectedCount}, got ${actualCount}`);
    }
  }
}

checkOpenApi();
checkProto();
checkGeneratedAndFacade();
checkDeferredLegacyMaterializationInventory();

if (failures.length > 0) {
  process.stderr.write('local-agent contract propagation hardcut failed:\n');
  for (const failure of failures) process.stderr.write(`- ${failure}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`local-agent contract propagation hardcut passed; ${deferredLegacyInventorySummary}\n`);
}
