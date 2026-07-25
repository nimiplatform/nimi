#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { readYamlWithFragments } from './lib/read-yaml-with-fragments.mjs';

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

function readYaml(relPath) {
  return readYamlWithFragments(path.join(cwd, relPath));
}

function exists(relPath) {
  return fs.existsSync(path.join(cwd, relPath));
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

function expectRegex(content, pattern, label) {
  if (!pattern.test(content)) {
    fail(`missing ${label}`);
  }
}

function expectNotRegex(content, pattern, label) {
  if (pattern.test(content)) {
    fail(`found ${label}`);
  }
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

function getProtoServiceBlock(protoContent, serviceName, relPath) {
  const pattern = new RegExp(`service\\s+${serviceName}\\s*\\{([\\s\\S]*?)\\n\\}`, 'm');
  const match = protoContent.match(pattern);
  if (!match) {
    fail(`${relPath} missing service ${serviceName}`);
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

  // S6 domain-3 W4: connector contract migrated to canonical authority; the
  // verbatim prose (K-CONN rule text) now lives in the rationale document.

  const connectorRules = YAML.parse(read('config/spec-frozen/runtime/tables/connector-rpc-field-rules.yaml'));
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

function checkGrantServiceHardcutAndLocalAppPermissionProjection() {
  const protoRoot = path.join(cwd, 'proto/runtime/v1');
  const protoCorpus = walk(protoRoot)
    .filter((file) => file.endsWith('.proto'))
    .map((file) => read(toRel(file)))
    .join('\n');
  for (const retiredSymbol of [
    'RuntimeGrantService',
    'PolicyMode',
    'AuthorizationPreset',
    'AuthorizeExternalPrincipalRequest',
    'AuthorizeExternalPrincipalResponse',
    'ValidateAppAccessTokenRequest',
    'ValidateAppAccessTokenResponse',
    'RevokeAppAccessTokenRequest',
    'IssueDelegatedAccessTokenRequest',
    'IssueDelegatedAccessTokenResponse',
    'ListTokenChainRequest',
    'TokenChainEntry',
    'ListTokenChainResponse',
    'GetLocalAppGrantStatus',
    'RequestLocalAppGrant',
    'DecideLocalAppGrant',
    'RevokeLocalAppGrant',
    'LocalAppGrantProjection',
    'LocalAppGrantState',
  ]) {
    if (new RegExp(`\\b${retiredSymbol}\\b`).test(protoCorpus)) {
      fail(`proto/runtime/v1 still publishes removed public Grant symbol: ${retiredSymbol}`);
    }
  }

  const accountRel = 'proto/runtime/v1/account.proto';
  const account = read(accountRel);
  const projection = getProtoMessageBlock(account, 'LocalAppPermissionProjection', accountRel);
  assertMessageHasFields(projection, 'LocalAppPermissionProjection', accountRel, [
    'permission_id',
    'posture',
    'can_request',
    'reason_code',
  ]);
  const localAppPermissionMessages = [
    ['GetLocalAppPermissionStatusRequest', ['permission_id']],
    ['GetLocalAppPermissionStatusResponse', ['projection']],
    ['RequestLocalAppPermissionRequest', ['permission_id', 'reason']],
    ['RequestLocalAppPermissionResponse', ['projection']],
  ];
  for (const [messageName, fields] of localAppPermissionMessages) {
    const block = getProtoMessageBlock(account, messageName, accountRel);
    assertMessageHasFields(block, messageName, accountRel, fields);
    if (/\b(?:bearer|secret|token|session_proof|principal_id|account_id|app_id)\b/i.test(block)) {
      fail(`${accountRel} ${messageName} exposes caller-selectable identity or portable credential material`);
    }
  }
  if (/\b(?:bearer|secret|token|session_proof)\b/i.test(projection)) {
    fail(`${accountRel} LocalAppPermissionProjection exposes portable credential material`);
  }

  const accountService = getProtoServiceBlock(account, 'RuntimeAccountService', accountRel);
  const permissionMethods = [
    'GetLocalAppPermissionStatus',
    'RequestLocalAppPermission',
  ];
  for (const method of permissionMethods) {
    expectRegex(accountService, new RegExp(`\\brpc\\s+${method}\\s*\\(`), `${accountRel} RuntimeAccountService.${method}`);
  }

  const grantSpecRel = '.nimi/spec/runtime/security-core.authority.yaml';
  const grantSpec = YAML.parse(read(grantSpecRel));
  const grantRuleIds = new Set((grantSpec?.units ?? []).map((unit) => String(unit?.id ?? '')));
  for (const ruleId of [
    'rule.nimi.runtime.security-core.r037',
    'rule.nimi.runtime.security-core.r038',
    'rule.nimi.runtime.security-core.r039',
    'rule.nimi.runtime.security-core.r040',
    'rule.nimi.runtime.security-core.r041',
    'rule.nimi.runtime.security-core.r042',
    'rule.nimi.runtime.security-core.r043',
    'rule.nimi.runtime.security-core.r044',
    'rule.nimi.runtime.security-core.r045',
    'rule.nimi.runtime.security-core.r046',
    'rule.nimi.runtime.security-core.r047',
  ]) {
    if (!grantRuleIds.has(ruleId)) fail(`${grantSpecRel} missing ${ruleId} rule definition`);
  }

  const schemaRel = 'config/spec-frozen/runtime/tables/local-app-grant-binding-schema.yaml';
  const schema = readYaml(schemaRel);
  if (String(schema?.source_rule || '') !== 'K-GRANT-014') {
    fail(`${schemaRel} source_rule must be K-GRANT-014`);
  }
  if (String(schema?.current_admission?.store_identity || '') !== 'absent_pre_admission'
    || String(schema?.current_admission?.positive_mutation_path || '') !== 'absent') {
    fail(`${schemaRel} must keep permission persistence and positive mutation absent before admission`);
  }
  const key = Array.isArray(schema?.future_owner_lifecycle?.key) ? schema.future_owner_lifecycle.key.map(String) : [];
  for (const required of ['local_os_user_anchor', 'account_id', 'local_app_principal_id', 'permission_id', 'owner_selector_digest']) {
    if (!key.includes(required)) fail(`${schemaRel} future_owner_lifecycle.key missing ${required}`);
  }
  const fields = Array.isArray(schema?.future_owner_lifecycle?.minimum_fields) ? schema.future_owner_lifecycle.minimum_fields.map(String) : [];
  for (const required of ['permission_decision_id', 'permission_id', 'decision_generation', 'decision_revision', 'state', 'user_decision_evidence_ref']) {
    if (!fields.includes(required)) fail(`${schemaRel} future_owner_lifecycle.minimum_fields missing ${required}`);
  }
  const invariants = Array.isArray(schema?.future_owner_lifecycle?.invariants) ? schema.future_owner_lifecycle.invariants.map(String) : [];
  for (const required of [
    'catalog_row_alone_is_not_authority',
    'account_switch_never_transfers_permission',
    'lifecycle_mutation_does_not_rotate_identity_session',
    'every_protected_operation_reads_current_owner_decision',
    'no_app_id_only_positive_lookup',
    'no_base_entitlement_permission_row',
    'no_app_owned_authority_permission_row',
  ]) {
    if (!invariants.includes(required)) fail(`${schemaRel} future_owner_lifecycle.invariants missing ${required}`);
  }
  const forbiddenOutputs = Array.isArray(schema?.forbidden_public_fields) ? schema.forbidden_public_fields.map(String) : [];
  for (const required of ['capability_scope', 'resource_scope', 'owner_selector_digest', 'permission_decision_id', 'bearer', 'token', 'session_proof']) {
    if (!forbiddenOutputs.includes(required)) fail(`${schemaRel} forbidden_public_fields missing ${required}`);
  }

  const authorityTables = [
    'config/runtime-rpc-methods.yaml',
    'config/spec-frozen/runtime/tables/rpc-migration-map/methods-identity-app.yaml',
    'config/spec-frozen/runtime/tables/runtime-rpc-auth-posture/identity-access.yaml',
    'config/spec-frozen/runtime/tables/protected-local-rpc-transport-matrix.yaml',
    'config/sdks-runtime-method-groups.yaml',
  ];
  const authorityCorpus = authorityTables.map(read).join('\n');
  if (/\bRuntimeGrantService\b/.test(authorityCorpus)) {
    fail('active Runtime/SDK authority tables still publish removed RuntimeGrantService');
  }
  for (const method of permissionMethods) {
    const methodId = `/nimi.runtime.v1.RuntimeAccountService/${method}`;
    if (!authorityCorpus.includes(methodId) && !authorityCorpus.includes(`- ${method}`)) {
      fail(`active Runtime/SDK authority tables missing local-app permission method: ${method}`);
    }
  }

  const rpcMethods = readYaml('config/runtime-rpc-methods.yaml');
  const rpcAccount = (Array.isArray(rpcMethods?.services) ? rpcMethods.services : [])
    .find((item) => String(item?.name || '') === 'RuntimeAccountService');
  const rpcAccountMethods = Array.isArray(rpcAccount?.methods) ? rpcAccount.methods : [];
  for (const method of permissionMethods) {
    const row = rpcAccountMethods.find((item) => String(item?.name || '') === method);
    const methodId = `/nimi.runtime.v1.RuntimeAccountService/${method}`;
    if (!row || String(row?.type || '') !== 'unary' || String(row?.protected_transport_ref || '') !== methodId) {
      fail(`rpc-methods.yaml missing protected RuntimeAccountService.${method}`);
    }
  }

  const authPosture = readYaml('config/spec-frozen/runtime/tables/runtime-rpc-auth-posture/identity-access.yaml');
  const authRows = Array.isArray(authPosture?.methods) ? authPosture.methods : [];
  for (const method of permissionMethods) {
    const methodId = `/nimi.runtime.v1.RuntimeAccountService/${method}`;
    const row = authRows.find((item) => String(item?.method_id || '') === methodId);
    const refs = Array.isArray(row?.kernel_refs) ? row.kernel_refs.map(String) : [];
    if (!row || String(row?.posture || '') !== 'protected_origin_required' || !refs.includes('P-PERM-007')) {
      fail(`runtime-rpc-auth-posture/identity-access.yaml missing protected P-PERM-007 row for ${methodId}`);
    }
  }

  const sdkGroups = readYaml('config/sdks-runtime-method-groups.yaml');
  const sdkAccount = (Array.isArray(sdkGroups?.groups) ? sdkGroups.groups : [])
    .find((item) => String(item?.service || '') === 'RuntimeAccountService');
  const sdkMethods = Array.isArray(sdkAccount?.methods) ? sdkAccount.methods.map(String) : [];
  for (const method of permissionMethods) {
    if (!sdkMethods.includes(method)) {
      fail(`runtime-method-groups.yaml RuntimeAccountService group missing ${method}`);
    }
  }

  const migration = readYaml('config/spec-frozen/runtime/tables/rpc-migration-map/methods-identity-app.yaml');
  const mappings = Array.isArray(migration?.method_mappings) ? migration.method_mappings : [];
  for (const method of permissionMethods) {
    const row = mappings.find((item) => String(item?.design_service || '') === 'RuntimeAccountService' && String(item?.design_method || '') === method);
    if (!row || String(row?.proto_service || '') !== 'RuntimeAccountService' || String(row?.proto_method || '') !== method || String(row?.mapping_posture || '') !== 'aligned') {
      fail(`methods-identity-app.yaml missing aligned RuntimeAccountService.${method} mapping`);
    }
  }

  const transport = readYaml('config/spec-frozen/runtime/tables/protected-local-rpc-transport-matrix.yaml');
  const transportRows = Array.isArray(transport?.methods) ? transport.methods : [];
  for (const method of permissionMethods) {
    const methodId = `/nimi.runtime.v1.RuntimeAccountService/${method}`;
    const row = transportRows.find((item) => String(item?.method_id || '') === methodId);
    if (!row || String(row?.source_rule || '') !== 'P-PERM-007' || row?.portable_session_allowed !== false || String(row?.public_tcp_disposition || '') !== 'deny') {
      fail(`protected-local-rpc-transport-matrix.yaml missing fail-closed P-PERM-007 row for ${methodId}`);
    }
  }
}

function checkDesktopProductControlProtectedAuthorityLinkage() {
  const methodNames = [
    'CollectDeviceProfile',
    'ResolveLocalEnvironmentPlan',
    'ListLocalEnvironmentDependencyJobs',
    'StartLocalEnvironmentDependencyJob',
    'CancelLocalEnvironmentDependencyJob',
    'RetryLocalEnvironmentDependencyJob',
    'RepairLocalEnvironmentDependency',
    'ResolveRuntimeBaselineReadiness',
    'MintRuntimeBaselineReadiness',
    'ResolveFirstRunExecutionEvidence',
    'MintFirstRunExecutionEvidence',
    'GetProductControlRecord',
    'GetProductControlSelectedDataRoot',
    'EnsureProductControlRecordCreated',
    'SelectProductControlDataRoot',
    'SetProductControlFirstRunInstallLevel',
    'CompleteProductControlFirstRunDeviceEnvironmentScan',
    'AdmitProductControlReadyForUse',
    'RecordProductControlAccountDefaultProfileEvidence',
    'RecordProductControlFirstRunLocalAiReadyEvidence',
    'ReconcileProductControlFirstRunSetupState',
  ];
  const expectedMethodIds = methodNames
    .map((method) => `/nimi.runtime.v1.RuntimeLocalService/${method}`)
    .sort();
  const transport = readYaml('config/spec-frozen/runtime/tables/protected-local-rpc-transport-matrix.yaml');
  const transportRows = Array.isArray(transport?.methods) ? transport.methods : [];
  const desktopRows = transportRows.filter((row) => String(row?.operation_class || '') === 'desktop_product_control');
  const actualMethodIds = desktopRows.map((row) => String(row?.method_id || '')).sort();
  if (JSON.stringify(actualMethodIds) !== JSON.stringify(expectedMethodIds)) {
    fail(`protected-local-rpc-transport-matrix.yaml desktop_product_control set mismatch: ${actualMethodIds.join(', ')}`);
  }

  const posture = readYaml('config/spec-frozen/runtime/tables/runtime-rpc-auth-posture/local-connector-model.yaml');
  const postureRows = Array.isArray(posture?.methods) ? posture.methods : [];
  const rpcMethods = readYaml('config/runtime-rpc-methods.yaml');
  const runtimeLocal = (Array.isArray(rpcMethods?.services) ? rpcMethods.services : [])
    .find((service) => String(service?.name || '') === 'RuntimeLocalService');
  const runtimeLocalMethods = Array.isArray(runtimeLocal?.methods) ? runtimeLocal.methods : [];

  for (const methodName of methodNames) {
    const methodId = `/nimi.runtime.v1.RuntimeLocalService/${methodName}`;
    const route = desktopRows.find((row) => String(row?.method_id || '') === methodId);
    const postureRow = postureRows.find((row) => String(row?.method_id || '') === methodId);
    const rpcRow = runtimeLocalMethods.find((row) => String(row?.name || '') === methodName);
    const kernelRefs = Array.isArray(postureRow?.kernel_refs) ? postureRow.kernel_refs.map(String) : [];
    if (!route
      || JSON.stringify(route.allowed_transport_classes) !== JSON.stringify(['desktop_control'])
      || JSON.stringify(route.required_origin_roles) !== JSON.stringify(['verified_desktop_process'])
      || route.request_may_select_role !== false
      || route.portable_session_allowed !== false
      || String(route.public_tcp_disposition || '') !== 'deny'
      || String(route.source_rule || '') !== 'K-RPC-004') {
      fail(`protected-local-rpc-transport-matrix.yaml missing exact K-RPC-004 desktop_product_control row for ${methodId}`);
    }
    if (!postureRow
      || String(postureRow?.posture || '') !== 'protected_origin_required'
      || !kernelRefs.includes('K-RPC-004')) {
      fail(`runtime-rpc-auth-posture/local-connector-model.yaml missing protected K-RPC-004 row for ${methodId}`);
    }
    if (!rpcRow
      || String(rpcRow?.type || '') !== 'unary'
      || String(rpcRow?.protected_transport_ref || '') !== methodId) {
      fail(`rpc-methods.yaml missing protected RuntimeLocalService.${methodName}`);
    }
  }
}

function checkLocalPaginationAndAuditFields() {
  const rel = 'proto/runtime/v1/local_runtime package';
  const content = [
    read('proto/runtime/v1/local_runtime.proto'),
    read('proto/runtime/v1/local_runtime_asset_catalog.proto'),
    read('proto/runtime/v1/local_runtime_recommendation.proto'),
    read('proto/runtime/v1/local_runtime_device_environment.proto'),
    read('proto/runtime/v1/local_runtime_execution_profile.proto'),
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

  const reasonCodesDoc = readYaml('config/runtime-reason-codes.yaml');
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

  const mappingDoc = readYaml('config/spec-frozen/runtime/tables/error-mapping-matrix.yaml');
  const mappings = Array.isArray(mappingDoc?.mappings) ? mappingDoc.mappings : [];
  const mappedReasonCodes = new Set(mappings.map((item) => String(item?.reason_code || '')));
  for (const [name] of expected) {
    if (!mappedReasonCodes.has(name)) {
      fail(`error-mapping-matrix.yaml missing mapping for ${name}`);
    }
  }
}

function checkPagingPairsInConnectorProto() {
  const connector = read('proto/runtime/v1/connector.proto');

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


}

function checkRuntimeMemorySdkProjection() {
  const manifestRel = 'sdks/typescript/core-generated/runtime-core.manifest.json';
  const manifest = JSON.parse(read(manifestRel));
  const methodIds = new Set(Array.isArray(manifest.method_ids)
    ? manifest.method_ids.map((methodId) => String(methodId))
    : []);
  if (methodIds.size === 0) {
    fail(`${manifestRel} missing method_ids`);
  }
  const runtimeTypedClientRel = 'sdks/typescript/core-generated/runtime-typed-client.ts';
  const runtimeTypedClient = read(runtimeTypedClientRel);
  if (/RuntimeMemoryService/.test(runtimeTypedClient)) {
    fail(`${runtimeTypedClientRel} must not point at retired RuntimeMemoryService`);
  }
  for (const rpcMethod of [
    'CreateBank',
    'GetBank',
    'ListBanks',
    'DeleteBank',
    'Retain',
    'Recall',
    'History',
    'DeleteMemory',
    'InspectMemoryEmbeddingRuntime',
    'RequestMemoryEmbeddingRuntimeBind',
    'RequestMemoryEmbeddingRuntimeCutover',
    'SubscribeMemoryEvents',
  ]) {
    const methodId = `/nimi.runtime.v1.RuntimeCognitionService/${rpcMethod}`;
    if (!methodIds.has(methodId)) {
      fail(`${manifestRel} missing ${methodId}`);
    }
    if (!runtimeTypedClient.includes(`methodId: "${methodId}"`)) {
      fail(`${runtimeTypedClientRel} missing generated call for ${methodId}`);
    }
  }

  const methodGroupsRel = 'config/sdks-runtime-method-groups.yaml';
  const methodGroups = YAML.parse(read(methodGroupsRel));
  const memoryGroup = methodGroups?.groups?.find((group) => group?.group === 'memory_service_projection');
  if (!memoryGroup) {
    fail(`${methodGroupsRel} missing memory_service_projection group`);
  } else {
    for (const method of [
      'InspectMemoryEmbeddingRuntime',
      'RequestMemoryEmbeddingRuntimeBind',
      'RequestMemoryEmbeddingRuntimeCutover',
    ]) {
      if (!Array.isArray(memoryGroup.methods) || !memoryGroup.methods.includes(method)) {
        fail(`${methodGroupsRel} memory_service_projection missing ${method}`);
      }
    }
  }

  const desktopProductionRoots = [
    'apps/desktop/src/shell/renderer',
    'apps/desktop/src/runtime',
  ];
  const forbiddenDirectWrites = /\bruntime\.memory\.(?:retain|deleteMemory|createBank|deleteBank)\s*\(/;
  for (const root of desktopProductionRoots) {
    for (const absPath of walk(path.join(cwd, root))) {
      if (!/\.(?:ts|tsx)$/.test(absPath)) continue;
      const rel = toRel(absPath);
      const content = read(rel);
      if (forbiddenDirectWrites.test(content)) {
        fail(`${rel} must not call canonical runtime.memory write/admin methods directly; use runtime.agent-owned memory projection`);
      }
    }
  }
}

function checkRuntimeAgentServiceProtoAdmission() {
  const rel = 'proto/runtime/v1/agent_service.proto';
  const content = read(rel);

  expectRegex(content, /service\s+RuntimeAgentService\s*\{[\s\S]*rpc\s+InitializeAgent\(InitializeAgentRequest\)\s+returns\s+\(InitializeAgentResponse\);[\s\S]*rpc\s+SubscribeAgentEvents\(SubscribeAgentEventsRequest\)\s+returns\s+\(stream\s+AgentEvent\);[\s\S]*\}/m, `${rel} RuntimeAgentService method set`);

  // K-AGCORE-041 narrow-admit HookIntent. Implementation-facing transport must
  // expose typed trigger-detail and hook-intent families on this admitted shape.
  // Wider trigger families (turn_completed, scheduled_time absolute,
  // state_condition, world_event, compound) are explicitly NOT admitted and
  // must not be reintroduced by an implementation rename.
  const hookIntent = getProtoMessageBlock(content, 'HookIntent', rel);
  assertMessageHasFields(hookIntent, 'HookIntent', rel, ['intent_id', 'agent_id', 'trigger_family', 'trigger_detail', 'effect', 'admission_state', 'not_before', 'expires_at']);

  const hookTriggerDetail = getProtoMessageBlock(content, 'HookTriggerDetail', rel);
  assertMessageHasFields(hookTriggerDetail, 'HookTriggerDetail', rel, ['time', 'event_user_idle', 'event_chat_ended']);

  // K-AGCORE-041 trigger family is limited to time and event. Non-admitted
  // families must not appear in HookTriggerFamily enum.
  const hookTriggerFamilyEnum = content.match(/enum\s+HookTriggerFamily\s*\{([\s\S]*?)\n\}/m);
  if (!hookTriggerFamilyEnum) {
    fail(`${rel} missing enum HookTriggerFamily`);
  } else {
    const members = [...hookTriggerFamilyEnum[1].matchAll(/\b(HOOK_TRIGGER_FAMILY_[A-Z0-9_]+)\s*=\s*\d+\s*;/g)].map((m) => m[1]);
    const allowed = new Set(['HOOK_TRIGGER_FAMILY_UNSPECIFIED', 'HOOK_TRIGGER_FAMILY_TIME', 'HOOK_TRIGGER_FAMILY_EVENT']);
    for (const member of members) {
      if (!allowed.has(member)) {
        fail(`${rel} has non-admitted HookTriggerFamily member: ${member}`);
      }
    }
  }

  // K-AGCORE-041 admitted effect is limited to follow-up-turn.
  const hookEffectEnum = content.match(/enum\s+HookEffect\s*\{([\s\S]*?)\n\}/m);
  if (!hookEffectEnum) {
    fail(`${rel} missing enum HookEffect`);
  } else {
    const members = [...hookEffectEnum[1].matchAll(/\b(HOOK_EFFECT_[A-Z0-9_]+)\s*=\s*\d+\s*;/g)].map((m) => m[1]);
    const allowed = new Set(['HOOK_EFFECT_UNSPECIFIED', 'HOOK_EFFECT_FOLLOW_UP_TURN']);
    for (const member of members) {
      if (!allowed.has(member)) {
        fail(`${rel} has non-admitted HookEffect member: ${member}`);
      }
    }
  }

  // K-AGCORE-041 admission states must remain reconstructable. Enum content is
  // pinned to the eight admission states declared by the contract.
  const hookAdmissionStateEnum = content.match(/enum\s+HookAdmissionState\s*\{([\s\S]*?)\n\}/m);
  if (!hookAdmissionStateEnum) {
    fail(`${rel} missing enum HookAdmissionState`);
  } else {
    for (const member of [
      'HOOK_ADMISSION_STATE_PROPOSED',
      'HOOK_ADMISSION_STATE_PENDING',
      'HOOK_ADMISSION_STATE_REJECTED',
      'HOOK_ADMISSION_STATE_RUNNING',
      'HOOK_ADMISSION_STATE_COMPLETED',
      'HOOK_ADMISSION_STATE_FAILED',
      'HOOK_ADMISSION_STATE_CANCELED',
      'HOOK_ADMISSION_STATE_RESCHEDULED',
    ]) {
      if (!new RegExp(`\\b${member}\\s*=\\s*\\d+\\s*;`).test(hookAdmissionStateEnum[1])) {
        fail(`${rel} HookAdmissionState missing admitted state: ${member}`);
      }
    }
  }

  // HookExecutionOutcome carries a single admission-state transition; per-state
  // distinction lives on intent.admission_state and AgentHookEventDetail.family.
  const hookOutcome = getProtoMessageBlock(content, 'HookExecutionOutcome', rel);
  assertMessageHasFields(hookOutcome, 'HookExecutionOutcome', rel, ['intent', 'observed_at', 'reason_code', 'message', 'reason']);

  // PendingHook embeds the admitted HookIntent rather than a parallel trigger /
  // next-intent shape (closeout-wave-1: NextHookIntent is no longer canonical
  // public/runtime truth).
  const pendingHook = getProtoMessageBlock(content, 'PendingHook', rel);
  assertMessageHasFields(pendingHook, 'PendingHook', rel, ['intent', 'scheduled_for', 'admitted_at']);

  // AgentHookEventDetail must keep the admission-state family discriminator
  // wired to runtime.agent.hook.* projection (K-AGCORE-042).
  const agentHookEventDetail = getProtoMessageBlock(content, 'AgentHookEventDetail', rel);
  assertMessageHasFields(agentHookEventDetail, 'AgentHookEventDetail', rel, ['family', 'intent', 'observed_at']);

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


  // K-AGCORE-040..043 narrow-admit HookIntent authority must be referenced by
  // name from the agent-hook-intent contract authority document.

  // K-AGCORE-006 typed-family registry must declare HOOK_INTENT (steady-state
  // canonical name; NEXT_HOOK_INTENT is retired per closeout-wave-1).
  const typedFamilyTable = YAML.parse(read('config/spec-frozen/runtime/tables/runtime-agent-service-typed-family.yaml'));
  const families = Array.isArray(typedFamilyTable?.families) ? typedFamilyTable.families : [];
  const familyNames = families.map((item) => String(item?.family || ''));
  const requiredFamilies = ['HOOK_INTENT', 'HOOK_OUTCOME', 'CANONICAL_MEMORY_CANDIDATE', 'CANONICAL_MEMORY_VIEW', 'CONSTRAINED_STATE_MUTATION', 'AGENT_EVENT'];
  for (const required of requiredFamilies) {
    if (!familyNames.includes(required)) {
      fail(`config/spec-frozen/runtime/tables/runtime-agent-service-typed-family.yaml missing family: ${required}`);
    }
  }
  if (familyNames.includes('NEXT_HOOK_INTENT')) {
    fail('config/spec-frozen/runtime/tables/runtime-agent-service-typed-family.yaml must not declare retired NEXT_HOOK_INTENT family (K-AGCORE-041 admits HookIntent only)');
  }

}

function checkAvatarPackageProjectionProtoRetirement() {
  const serviceRel = 'proto/runtime/v1/agent_service.proto';
  const serviceContent = read(serviceRel);
  const messageRel = 'proto/runtime/v1/avatar_package.proto';

  if (exists(messageRel)) {
    fail(`${messageRel} must remain deleted; Avatar package projection retired with Asset Market`);
  }
  if (serviceContent.includes('import "runtime/v1/avatar_package.proto";')) {
    fail(`${serviceRel} must not import retired avatar_package.proto`);
  }
  expectNotRegex(
    serviceContent,
    /rpc\s+ResolveAvatarPackageLaunchProjection\s*\(/m,
    `${serviceRel} retired ResolveAvatarPackageLaunchProjection RPC`,
  );
  for (const messageName of [
    'ResolveAvatarPackageLaunchProjectionRequest',
    'ResolveAvatarPackageLaunchProjectionResponse',
    'RuntimeAvatarPackageCompatibilityDiagnostic',
    'RuntimeAvatarPackageModelLayout',
    'RuntimeAvatarPackageProvenance',
  ]) {
    if (serviceContent.includes(`message ${messageName}`)) {
      fail(`${serviceRel} must not inline retired ${messageName}`);
    }
  }

  const contractRel = '.nimi/spec/runtime/kernel/avatar-package-projection-contract.md';
  if (exists(contractRel)) {
    fail(`${contractRel} must remain deleted; retirement semantics live in canonical runtime authority`);
  }

  const rpcMethods = read('config/runtime-rpc-methods.yaml');
  if (rpcMethods.includes('ResolveAvatarPackageLaunchProjection')) {
    fail('rpc-methods.yaml must not list retired ResolveAvatarPackageLaunchProjection');
  }
  const authPosture = read('config/spec-frozen/runtime/tables/runtime-rpc-auth-posture/agent-ai-cognition.yaml');
  for (const retiredToken of [
    '/nimi.runtime.v1.RuntimeAgentService/ResolveAvatarPackageLaunchProjection',
    'runtime.agent.avatar_package.read',
  ]) {
    if (authPosture.includes(retiredToken)) {
      fail(`runtime-rpc-auth-posture/agent-ai-cognition.yaml must not include retired token: ${retiredToken}`);
    }
  }
}

function main() {
  checkAuthJWTOnlyAndReserved();
  checkConnectorUpdateMaskAndPagination();
  checkGrantServiceHardcutAndLocalAppPermissionProjection();
  checkDesktopProductControlProtectedAuthorityLinkage();
  checkLocalPaginationAndAuditFields();
  checkReasonCodes359To363Linkage();
  checkPagingPairsInConnectorProto();
  checkMemoryProtoAdmission();
  checkRuntimeMemorySdkProjection();
  checkRuntimeAgentServiceProtoAdmission();
  checkAvatarPackageProjectionProtoRetirement();

  if (failed) {
    process.exit(1);
  }
  console.log('runtime-proto-spec-linkage: OK');
}

main();
