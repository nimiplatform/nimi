#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const cwd = path.resolve(scriptDir, '..');
let failed = false;

function fail(message) {
  failed = true;
  console.error(`ERROR: ${message}`);
}

function read(relPath) {
  return fs.readFileSync(path.join(cwd, relPath), 'utf8');
}

function expectRegex(content, pattern, label) {
  if (!pattern.test(content)) {
    fail(`missing ${label}`);
  }
}

function collectRuntimeKernelRuleIds() {
  const root = path.join(cwd, '.nimi/spec/runtime/kernel');
  const files = walk(root)
    .filter((file) => file.endsWith('.md'))
    .filter((file) => !file.includes(`${path.sep}generated${path.sep}`))
    .filter((file) => !file.includes(`${path.sep}companion${path.sep}`));

  const ruleIds = new Set();
  for (const file of files) {
    const rel = toRel(file);
    const content = read(rel);
    for (const match of content.matchAll(/^##\s+(K-[A-Z]+-\d{3})\b/gmu)) {
      ruleIds.add(match[1]);
    }
  }
  return ruleIds;
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function toRel(absPath) {
  return path.relative(cwd, absPath).split(path.sep).join('/');
}

function getProtoMessageBlock(protoContent, messageName, relPath) {
  const pattern = new RegExp(`message\\s+${messageName}\\s*\\{([\\s\\S]*?)\\n\\}`, 'm');
  const match = protoContent.match(pattern);
  if (!match) {
    fail(`${relPath} missing message ${messageName}`);
    return '';
  }
  return match[1];
}

function assertMessageHasFields(block, messageName, relPath, fields) {
  for (const field of fields) {
    const re = new RegExp(`\\b${field}\\s*=\\s*\\d+\\s*;`);
    if (!re.test(block)) {
      fail(`${relPath} ${messageName} missing field ${field}`);
    }
  }
}

function checkAuthJWTOnlyAndReserved() {
  const rel = 'proto/runtime/v1/auth.proto';
  const content = read(rel);

  expectRegex(content, /enum\s+ExternalProofType\s*\{[\s\S]*EXTERNAL_PROOF_TYPE_UNSPECIFIED\s*=\s*0;[\s\S]*EXTERNAL_PROOF_TYPE_JWT\s*=\s*1;[\s\S]*reserved\s+2;/m, `${rel} JWT-only + reserved 2 enum shape`);

  const enumBlockMatch = content.match(/enum\s+ExternalProofType\s*\{([\s\S]*?)\n\}/m);
  if (!enumBlockMatch) {
    fail(`${rel} missing ExternalProofType enum body`);
  } else {
    const members = [...enumBlockMatch[1].matchAll(/\b(EXTERNAL_PROOF_TYPE_[A-Z0-9_]+)\s*=\s*\d+\s*;/g)].map((m) => m[1]);
    const allowed = new Set(['EXTERNAL_PROOF_TYPE_UNSPECIFIED', 'EXTERNAL_PROOF_TYPE_JWT']);
    for (const member of members) {
      if (!allowed.has(member)) {
        fail(`${rel} has unsupported ExternalProofType member: ${member}`);
      }
    }
  }

  const specAuth = read('.nimi/spec/runtime/kernel/auth-service.md');
  expectRegex(specAuth, /##\s+K-AUTHSVC-013\b/m, 'K-AUTHSVC-013 rule definition');
  expectRegex(specAuth, /\bJWT\b/, 'K-AUTHSVC-013 JWT mention');
  expectRegex(specAuth, /(?:reserved[\s\S]*\b2\b|\b2\b[\s\S]*reserved)/m, 'K-AUTHSVC-013 reserved=2 mention');
}

function checkConnectorUpdateMaskAndPagination() {
  const rel = 'proto/runtime/v1/connector.proto';
  const content = read(rel);

  expectRegex(content, /optional\s+string\s+label\s*=\s*3\s*;/, `${rel} UpdateConnectorRequest.label optional`);
  expectRegex(content, /optional\s+string\s+endpoint\s*=\s*4\s*;/, `${rel} UpdateConnectorRequest.endpoint optional`);
  expectRegex(content, /optional\s+string\s+api_key\s*=\s*5\s*;/, `${rel} UpdateConnectorRequest.api_key optional`);
  expectRegex(content, /google\.protobuf\.FieldMask\s+update_mask\s*=\s*7\s*;/, `${rel} UpdateConnectorRequest.update_mask`);

  const listModelsReq = getProtoMessageBlock(content, 'ListConnectorModelsRequest', rel);
  const listModelsResp = getProtoMessageBlock(content, 'ListConnectorModelsResponse', rel);
  assertMessageHasFields(listModelsReq, 'ListConnectorModelsRequest', rel, ['page_size', 'page_token']);
  assertMessageHasFields(listModelsResp, 'ListConnectorModelsResponse', rel, ['next_page_token']);

  const specConnector = read('.nimi/spec/runtime/kernel/connector-contract.md');
  expectRegex(specConnector, /##\s+K-CONN-013\b/m, 'K-CONN-013 rule definition');
  expectRegex(specConnector, /\bupdate_mask\b/, 'K-CONN-013 update_mask mention');
  expectRegex(specConnector, /\blabel\b[\s\S]*\bendpoint\b[\s\S]*\bapi_key\b[\s\S]*\bstatus\b/m, 'K-CONN-013 allowed path set mention');
  expectRegex(specConnector, /(unknown path|未知路径)/i, 'K-CONN-013 unknown path handling');
  expectRegex(specConnector, /##\s+K-CONN-014\b/m, 'K-CONN-014 rule definition');
  expectRegex(specConnector, /\bpage_size\b[\s\S]*\bpage_token\b[\s\S]*\bnext_page_token\b/m, 'K-CONN-014 pagination fields mention');

  const connectorRules = YAML.parse(read('.nimi/spec/runtime/kernel/tables/connector-rpc-field-rules.yaml'));
  const rules = Array.isArray(connectorRules?.rules) ? connectorRules.rules : [];
  const updateMaskRules = rules.filter((item) => String(item?.rpc || '') === 'UpdateConnector' && String(item?.field || '').includes('update_mask'));
  if (updateMaskRules.length === 0) {
    fail('connector-rpc-field-rules.yaml missing UpdateConnector update_mask rules');
  }
  for (const rule of updateMaskRules) {
    if (String(rule?.source_rule || '') !== 'K-CONN-013') {
      fail(`connector-rpc-field-rules update_mask source must be K-CONN-013: ${JSON.stringify(rule)}`);
    }
  }
}

function checkGrantTokenChainEvolution() {
  const rel = 'proto/runtime/v1/grant.proto';
  const content = read(rel);

  const req = getProtoMessageBlock(content, 'ListTokenChainRequest', rel);
  const entry = getProtoMessageBlock(content, 'TokenChainEntry', rel);
  const resp = getProtoMessageBlock(content, 'ListTokenChainResponse', rel);

  assertMessageHasFields(req, 'ListTokenChainRequest', rel, ['include_revoked', 'page_size', 'page_token']);
  assertMessageHasFields(entry, 'TokenChainEntry', rel, [
    'principal_id',
    'effective_scopes',
    'revoked',
    'delegation_depth',
    'policy_version',
    'issued_scope_catalog_version',
  ]);
  assertMessageHasFields(resp, 'ListTokenChainResponse', rel, ['next_page_token', 'has_more']);

  const specGrant = read('.nimi/spec/runtime/kernel/grant-service.md');
  expectRegex(specGrant, /##\s+K-GRANT-011\b/m, 'K-GRANT-011 rule definition');
  expectRegex(specGrant, /##\s+K-GRANT-012\b/m, 'K-GRANT-012 rule definition');
  expectRegex(specGrant, /##\s+K-GRANT-013\b/m, 'K-GRANT-013 rule definition');
  for (const token of [
    'include_revoked',
    'next_page_token',
    'has_more',
    'delegation_depth',
    'effective_scopes',
    'policy_version',
    'issued_scope_catalog_version',
  ]) {
    if (!specGrant.includes(token)) {
      fail(`.nimi/spec/runtime/kernel/grant-service.md missing token: ${token}`);
    }
  }
}

function checkLocalPaginationAndAuditFields() {
  const rel = 'proto/runtime/v1/local_runtime package';
  const content = [
    read('proto/runtime/v1/local_runtime.proto'),
    read('proto/runtime/v1/local_runtime_types.proto'),
  ].join('\n');

  const localAssetRecord = getProtoMessageBlock(content, 'LocalAssetRecord', rel);
  assertMessageHasFields(localAssetRecord, 'LocalAssetRecord', rel, ['local_invoke_profile_id']);

  const localAuditEvent = getProtoMessageBlock(content, 'LocalAuditEvent', rel);
  assertMessageHasFields(localAuditEvent, 'LocalAuditEvent', rel, [
    'trace_id',
    'app_id',
    'domain',
    'operation',
    'subject_user_id',
  ]);

  const pagingPairs = [
    ['ListLocalAssetsRequest', 'ListLocalAssetsResponse'],
    ['ListVerifiedAssetsRequest', 'ListVerifiedAssetsResponse'],
    ['SearchCatalogModelsRequest', 'SearchCatalogModelsResponse'],
    ['ListLocalServicesRequest', 'ListLocalServicesResponse'],
    ['ListNodeCatalogRequest', 'ListNodeCatalogResponse'],
    ['ListLocalAuditsRequest', 'ListLocalAuditsResponse'],
  ];
  for (const [reqName, respName] of pagingPairs) {
    const req = getProtoMessageBlock(content, reqName, rel);
    const resp = getProtoMessageBlock(content, respName, rel);
    assertMessageHasFields(req, reqName, rel, ['page_size', 'page_token']);
    assertMessageHasFields(resp, respName, rel, ['next_page_token']);
  }

  const specLocal = read('.nimi/spec/runtime/kernel/local-category-capability.md');
  expectRegex(specLocal, /##\s+K-LOCAL-029\b/m, 'K-LOCAL-029 rule definition');
  expectRegex(specLocal, /##\s+K-LOCAL-030\b/m, 'K-LOCAL-030 rule definition');
  for (const token of ['trace_id', 'app_id', 'domain', 'operation', 'subject_user_id', 'local_invoke_profile_id']) {
    if (!specLocal.includes(token)) {
      fail(`.nimi/spec/runtime/kernel/local-category-capability.md missing token: ${token}`);
    }
  }

  const specPagination = read('.nimi/spec/runtime/kernel/pagination-filtering.md');
  for (const method of [
    'ListLocalAssets',
    'ListVerifiedAssets',
    'SearchCatalogModels',
    'ListLocalServices',
    'ListNodeCatalog',
    'ListLocalAudits',
  ]) {
    if (!specPagination.includes(method)) {
      fail(`.nimi/spec/runtime/kernel/pagination-filtering.md missing method: ${method}`);
    }
  }
}

function checkReasonCodes359To363Linkage() {
  const commonProto = read('proto/runtime/v1/common.proto');
  const expected = [
    ['AI_LOCAL_DOWNLOAD_FAILED', 359],
    ['AI_LOCAL_DOWNLOAD_HASH_MISMATCH', 360],
    ['AI_LOCAL_HF_REPO_INVALID', 361],
    ['AI_LOCAL_HF_SEARCH_FAILED', 362],
    ['AI_LOCAL_MANIFEST_SCHEMA_INVALID', 363],
  ];
  for (const [name, value] of expected) {
    expectRegex(commonProto, new RegExp(`\\b${name}\\s*=\\s*${value}\\s*;`), `common.proto ${name}=${value}`);
  }

  const reasonCodesDoc = YAML.parse(read('.nimi/spec/runtime/kernel/tables/reason-codes.yaml'));
  const codes = Array.isArray(reasonCodesDoc?.codes) ? reasonCodesDoc.codes : [];
  const byName = new Map(codes.map((item) => [String(item?.name || ''), item]));
  for (const [name, value] of expected) {
    const item = byName.get(name);
    if (!item) {
      fail(`reason-codes.yaml missing ${name}`);
      continue;
    }
    if (Number(item?.value) !== value) {
      fail(`reason-codes.yaml ${name} value mismatch: expected ${value}, got ${item?.value}`);
    }
    if (!String(item?.source_rule || '').startsWith('K-')) {
      fail(`reason-codes.yaml ${name} must have kernel source`);
    }
  }

  const mappingDoc = YAML.parse(read('.nimi/spec/runtime/kernel/tables/error-mapping-matrix.yaml'));
  const mappings = Array.isArray(mappingDoc?.mappings) ? mappingDoc.mappings : [];
  const mappedReasonCodes = new Set(mappings.map((item) => String(item?.reason_code || '')));
  for (const [name] of expected) {
    if (!mappedReasonCodes.has(name)) {
      fail(`error-mapping-matrix.yaml missing mapping for ${name}`);
    }
  }
}

function checkPagingPairsInConnectorAndGrantProto() {
  const connector = read('proto/runtime/v1/connector.proto');
  const grant = read('proto/runtime/v1/grant.proto');

  const connectorPairs = [
    ['ListConnectorsRequest', 'ListConnectorsResponse'],
    ['ListConnectorModelsRequest', 'ListConnectorModelsResponse'],
  ];
  for (const [reqName, respName] of connectorPairs) {
    const req = getProtoMessageBlock(connector, reqName, 'proto/runtime/v1/connector.proto');
    const resp = getProtoMessageBlock(connector, respName, 'proto/runtime/v1/connector.proto');
    assertMessageHasFields(req, reqName, 'proto/runtime/v1/connector.proto', ['page_size', 'page_token']);
    assertMessageHasFields(resp, respName, 'proto/runtime/v1/connector.proto', ['next_page_token']);
  }

  const grantReq = getProtoMessageBlock(grant, 'ListTokenChainRequest', 'proto/runtime/v1/grant.proto');
  const grantResp = getProtoMessageBlock(grant, 'ListTokenChainResponse', 'proto/runtime/v1/grant.proto');
  assertMessageHasFields(grantReq, 'ListTokenChainRequest', 'proto/runtime/v1/grant.proto', ['page_size', 'page_token']);
  assertMessageHasFields(grantResp, 'ListTokenChainResponse', 'proto/runtime/v1/grant.proto', ['next_page_token', 'has_more']);

  const paginationSpec = read('.nimi/spec/runtime/kernel/pagination-filtering.md');
  for (const method of ['ListConnectors', 'ListConnectorModels', 'ListTokenChain']) {
    if (!paginationSpec.includes(method)) {
      fail(`.nimi/spec/runtime/kernel/pagination-filtering.md missing pagination anchor for ${method}`);
    }
  }
}

function checkMemoryProtoAdmission() {
  const rel = 'proto/runtime/v1/memory.proto';
  const content = read(rel);
  const knowledge = read('proto/runtime/v1/knowledge.proto');
  const cognition = read('proto/runtime/v1/cognition.proto');

  if (/service\s+RuntimeMemoryService\s*\{/.test(content)) {
    fail(`${rel} must not publish retired RuntimeMemoryService`);
  }
  if (/service\s+RuntimeKnowledgeService\s*\{/.test(knowledge)) {
    fail('proto/runtime/v1/knowledge.proto must not publish retired RuntimeKnowledgeService');
  }
  if (/rpc\s+Reflect\s*\(/.test(content)) {
    fail(`${rel} must not publish retired Reflect RPC`);
  }
  expectRegex(cognition, /service\s+RuntimeCognitionService\s*\{[\s\S]*rpc\s+CreateBank\(CreateBankRequest\)\s+returns\s+\(CreateBankResponse\);[\s\S]*rpc\s+SubscribeMemoryEvents\(SubscribeMemoryEventsRequest\)\s+returns\s+\(stream\s+MemoryEvent\);[\s\S]*rpc\s+CreateKnowledgeBank\(CreateKnowledgeBankRequest\)\s+returns\s+\(CreateKnowledgeBankResponse\);[\s\S]*rpc\s+GetIngestTask\(GetIngestTaskRequest\)\s+returns\s+\(GetIngestTaskResponse\);[\s\S]*\}/m, 'proto/runtime/v1/cognition.proto RuntimeCognitionService method set');

  const locator = getProtoMessageBlock(content, 'MemoryBankLocator', rel);
  assertMessageHasFields(locator, 'MemoryBankLocator', rel, ['scope', 'agent_core', 'agent_dyadic', 'world_shared', 'app_private', 'workspace_private']);

  const publicLocator = getProtoMessageBlock(content, 'PublicMemoryBankLocator', rel);
  assertMessageHasFields(publicLocator, 'PublicMemoryBankLocator', rel, ['app_private', 'workspace_private']);

  const recordInput = getProtoMessageBlock(content, 'MemoryRecordInput', rel);
  assertMessageHasFields(recordInput, 'MemoryRecordInput', rel, ['kind', 'canonical_class', 'provenance', 'episodic', 'semantic', 'observational']);

  const replicationState = getProtoMessageBlock(content, 'MemoryReplicationState', rel);
  assertMessageHasFields(replicationState, 'MemoryReplicationState', rel, ['outcome', 'local_version', 'basis_version', 'pending', 'synced', 'conflict', 'invalidation']);

  const listBanksReq = getProtoMessageBlock(content, 'ListBanksRequest', rel);
  const listBanksResp = getProtoMessageBlock(content, 'ListBanksResponse', rel);
  assertMessageHasFields(listBanksReq, 'ListBanksRequest', rel, ['page_size', 'page_token']);
  assertMessageHasFields(listBanksResp, 'ListBanksResponse', rel, ['next_page_token']);

  const specMemory = read('.nimi/spec/runtime/kernel/runtime-memory-service-contract.md');
  for (const token of [
    'scope-typed bank locator family',
    'typed memory record family',
    'typed replication state',
    'infra-only locator branches',
  ]) {
    if (!specMemory.includes(token)) {
      fail(`.nimi/spec/runtime/kernel/runtime-memory-service-contract.md missing token: ${token}`);
    }
  }

  const paginationSpec = read('.nimi/spec/runtime/kernel/pagination-filtering.md');
  if (!paginationSpec.includes('ListBanks')) {
    fail('.nimi/spec/runtime/kernel/pagination-filtering.md missing pagination anchor for ListBanks');
  }
}

function checkRuntimeAgentServiceProtoAdmission() {
  const rel = 'proto/runtime/v1/agent_service.proto';
  const content = read(rel);

  expectRegex(content, /service\s+RuntimeAgentService\s*\{[\s\S]*rpc\s+InitializeAgent\(InitializeAgentRequest\)\s+returns\s+\(InitializeAgentResponse\);[\s\S]*rpc\s+SubscribeAgentEvents\(SubscribeAgentEventsRequest\)\s+returns\s+\(stream\s+AgentEvent\);[\s\S]*\}/m, `${rel} RuntimeAgentService method set`);

  const nextHookIntent = getProtoMessageBlock(content, 'NextHookIntent', rel);
  assertMessageHasFields(nextHookIntent, 'NextHookIntent', rel, ['trigger_kind', 'not_before', 'expires_at', 'turn_completed', 'scheduled_time', 'user_idle', 'chat_ended', 'state_condition', 'world_event', 'compound']);

  const hookOutcome = getProtoMessageBlock(content, 'HookExecutionOutcome', rel);
  assertMessageHasFields(hookOutcome, 'HookExecutionOutcome', rel, ['hook_id', 'status', 'trigger', 'observed_at', 'completed', 'failed', 'canceled', 'rescheduled', 'rejected']);

  const memoryCandidate = getProtoMessageBlock(content, 'CanonicalMemoryCandidate', rel);
  assertMessageHasFields(memoryCandidate, 'CanonicalMemoryCandidate', rel, ['canonical_class', 'target_bank', 'record', 'source_event_id', 'policy_reason']);

  const memoryView = getProtoMessageBlock(content, 'CanonicalMemoryView', rel);
  assertMessageHasFields(memoryView, 'CanonicalMemoryView', rel, ['canonical_class', 'source_bank', 'record', 'recall_score', 'policy_reason']);

  const stateMutation = getProtoMessageBlock(content, 'AgentStateMutation', rel);
  assertMessageHasFields(stateMutation, 'AgentStateMutation', rel, ['set_status_text', 'set_world_context', 'clear_world_context', 'set_dyadic_context', 'clear_dyadic_context', 'put_attribute', 'remove_attribute']);

  const agentEvent = getProtoMessageBlock(content, 'AgentEvent', rel);
  assertMessageHasFields(agentEvent, 'AgentEvent', rel, ['event_type', 'sequence', 'agent_id', 'timestamp', 'lifecycle', 'hook', 'memory', 'budget', 'replication']);

  const listAgentsReq = getProtoMessageBlock(content, 'ListAgentsRequest', rel);
  const listAgentsResp = getProtoMessageBlock(content, 'ListAgentsResponse', rel);
  const listHooksReq = getProtoMessageBlock(content, 'ListPendingHooksRequest', rel);
  const listHooksResp = getProtoMessageBlock(content, 'ListPendingHooksResponse', rel);
  assertMessageHasFields(listAgentsReq, 'ListAgentsRequest', rel, ['page_size', 'page_token']);
  assertMessageHasFields(listAgentsResp, 'ListAgentsResponse', rel, ['next_page_token']);
  assertMessageHasFields(listHooksReq, 'ListPendingHooksRequest', rel, ['page_size', 'page_token']);
  assertMessageHasFields(listHooksResp, 'ListPendingHooksResponse', rel, ['next_page_token']);

  const specAgentService = read('.nimi/spec/runtime/kernel/runtime-agent-service-contract.md');
  for (const token of [
    'typed trigger-detail and next-hook-intent families',
    'typed completed / failed / canceled / rescheduled / rejected families',
    'typed command/patch union',
  ]) {
    if (!specAgentService.includes(token)) {
      fail(`.nimi/spec/runtime/kernel/runtime-agent-service-contract.md missing token: ${token}`);
    }
  }

  const paginationSpec = read('.nimi/spec/runtime/kernel/pagination-filtering.md');
  for (const method of ['ListAgents', 'ListPendingHooks']) {
    if (!paginationSpec.includes(method)) {
      fail(`.nimi/spec/runtime/kernel/pagination-filtering.md missing pagination anchor for ${method}`);
    }
  }
}

function checkRequiredRuleDefinitions() {
  const requiredRuleIds = [
    'K-AUTHSVC-013',
    'K-CONN-013',
    'K-CONN-014',
    'K-CONN-015',
    'K-GRANT-011',
    'K-GRANT-012',
    'K-GRANT-013',
    'K-MEM-002',
    'K-MEM-003',
    'K-MEM-006',
    'K-MEM-008',
    'K-AGCORE-003',
    'K-AGCORE-006',
    'K-LOCAL-003',
    'K-LOCAL-029',
    'K-LOCAL-030',
    'K-PAGE-005',
  ];
  const definitions = collectRuntimeKernelRuleIds();
  for (const ruleId of requiredRuleIds) {
    if (!definitions.has(ruleId)) {
      fail(`missing runtime kernel rule definition: ${ruleId}`);
    }
  }
}

function main() {
  checkRequiredRuleDefinitions();
  checkAuthJWTOnlyAndReserved();
  checkConnectorUpdateMaskAndPagination();
  checkGrantTokenChainEvolution();
  checkLocalPaginationAndAuditFields();
  checkReasonCodes359To363Linkage();
  checkPagingPairsInConnectorAndGrantProto();
  checkMemoryProtoAdmission();
  checkRuntimeAgentServiceProtoAdmission();

  if (failed) {
    process.exit(1);
  }
  console.log('runtime-proto-spec-linkage: OK');
}

main();
