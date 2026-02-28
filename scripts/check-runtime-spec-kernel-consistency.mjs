#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const cwd = process.cwd();
const runtimeRoot = path.join(cwd, 'spec/runtime');
const sdkRoot = path.join(cwd, 'spec/sdk');
const protoRoot = path.join(cwd, 'proto/runtime/v1');

const kernelFiles = [
  'spec/runtime/kernel/index.md',
  'spec/runtime/kernel/rpc-surface.md',
  'spec/runtime/kernel/authz-ownership.md',
  'spec/runtime/kernel/authn-token-validation.md',
  'spec/runtime/kernel/auth-service.md',
  'spec/runtime/kernel/grant-service.md',
  'spec/runtime/kernel/key-source-routing.md',
  'spec/runtime/kernel/media-job-lifecycle.md',
  'spec/runtime/kernel/local-category-capability.md',
  'spec/runtime/kernel/endpoint-security.md',
  'spec/runtime/kernel/streaming-contract.md',
  'spec/runtime/kernel/error-model.md',
  'spec/runtime/kernel/pagination-filtering.md',
  'spec/runtime/kernel/audit-contract.md',
  'spec/runtime/kernel/tables/rpc-methods.yaml',
  'spec/runtime/kernel/tables/rpc-migration-map.yaml',
  'spec/runtime/kernel/tables/reason-codes.yaml',
  'spec/runtime/kernel/tables/error-mapping-matrix.yaml',
  'spec/runtime/kernel/tables/metadata-keys.yaml',
  'spec/runtime/kernel/tables/key-source-truth-table.yaml',
  'spec/runtime/kernel/tables/provider-catalog.yaml',
  'spec/runtime/kernel/tables/provider-capabilities.yaml',
  'spec/runtime/kernel/tables/connector-rpc-field-rules.yaml',
  'spec/runtime/kernel/tables/job-states.yaml',
  'spec/runtime/kernel/tables/state-transitions.yaml',
];

const domainFiles = [
  'spec/runtime/connector-auth.md',
  'spec/runtime/nimillm.md',
  'spec/runtime/local-model.md',
];

const allRuntimeSpecs = walk(runtimeRoot).filter(isSpecDocFile);
const runtimeMarkdownFiles = allRuntimeSpecs
  .filter((p) => p.endsWith('.md') && !p.includes(`${path.sep}generated${path.sep}`))
  .map((p) => path.relative(cwd, p));
const sdkSpecFiles = walk(sdkRoot).filter(isSpecDocFile).map((p) => path.relative(cwd, p));
const runtimeAndSdkSpecFiles = [
  ...allRuntimeSpecs.map((p) => path.relative(cwd, p)),
  ...sdkSpecFiles,
];

let failed = false;

function fail(msg) {
  failed = true;
  console.error(`ERROR: ${msg}`);
}

function read(rel) {
  return fs.readFileSync(path.join(cwd, rel), 'utf8');
}

function readYaml(rel) {
  return YAML.parse(read(rel));
}

for (const rel of kernelFiles) {
  if (!fs.existsSync(path.join(cwd, rel))) {
    fail(`missing kernel file: ${rel}`);
  }
}

for (const rel of domainFiles) {
  if (!fs.existsSync(path.join(cwd, rel))) {
    fail(`missing runtime domain file: ${rel}`);
    continue;
  }
  const content = read(rel);
  if (!content.includes('Normative Imports: `spec/runtime/kernel/*`')) {
    fail(`${rel} must declare kernel imports`);
  }
  if (!/\bK-[A-Z]+-\d{3}\b/.test(content)) {
    fail(`${rel} must reference at least one kernel Rule ID`);
  }
}

const kernelRuleDefinitions = collectKernelRuleDefinitions();

checkLegacyDesignReferenceDrift();
checkReasonCodeNumericAssignments();
checkBannedExternalRpcNames();
checkProviderTableParity();
checkConnectorRpcFieldRulesCoverage();
checkStateTransitionCoverage(kernelRuleDefinitions);
checkDomainProviderTableAnchors();
checkConnectorRpcRulesAgainstRpcSurface();
checkReasonCodeReferencesResolvable();
checkProviderReferencesResolvable();
checkRuleIdReferencesResolvable(kernelRuleDefinitions);
checkNoKernelRuleDefinitionsInImplementationDocs();
checkMetadataKeyContract();
checkKeySourceTruthTable();
checkErrorMappingMatrix();
checkRpcMigrationMapCoverage();

if (failed) process.exit(1);
console.log('runtime-spec-kernel-consistency: OK');

function checkLegacyDesignReferenceDrift() {
  const legacyRefs = [
    /docs\/runtime\/design-/g,
    /design-connector-auth\.md/g,
    /design-nimillm\.md/g,
    /design-local-model\.md/g,
  ];
  for (const rel of runtimeAndSdkSpecFiles) {
    const abs = path.join(cwd, rel);
    if (!fs.existsSync(abs)) continue;
    const txt = fs.readFileSync(abs, 'utf8');
    for (const re of legacyRefs) {
      if (re.test(txt)) {
        fail(`legacy runtime design reference found in ${rel}`);
        break;
      }
    }
  }
}

function checkReasonCodeNumericAssignments() {
  for (const rel of allRuntimeSpecs.map((p) => path.relative(cwd, p))) {
    if (rel === 'spec/runtime/kernel/tables/reason-codes.yaml') continue;
    const txt = read(rel);
    if (/AI_[A-Z0-9_]+\s*=\s*\d+/.test(txt)) {
      fail(`ReasonCode numeric assignment must live only in reason-codes.yaml: ${rel}`);
    }
  }
}

function checkBannedExternalRpcNames() {
  const bannedMethodNames = new Set([
    'GenerateText',
    'StreamGenerateText',
    'SynthesizeSpeech',
    'ListTokenProviderModels',
    'CheckTokenProviderHealth',
  ]);
  const rpcTable = readYaml('spec/runtime/kernel/tables/rpc-methods.yaml');
  const services = Array.isArray(rpcTable?.services) ? rpcTable.services : [];
  for (const service of services) {
    const serviceName = String(service?.name || '').trim() || '<unknown>';
    const methods = Array.isArray(service?.methods) ? service.methods : [];
    for (const method of methods) {
      const methodName = String(method?.name || '').trim();
      if (!methodName) continue;
      if (bannedMethodNames.has(methodName)) {
        fail(`banned external RPC method appears in rpc-methods.yaml: ${serviceName}.${methodName}`);
      }
    }
  }
}

function checkProviderTableParity() {
  const catalog = readYaml('spec/runtime/kernel/tables/provider-catalog.yaml');
  const capabilities = readYaml('spec/runtime/kernel/tables/provider-capabilities.yaml');

  const catalogProviders = new Set(
    (Array.isArray(catalog?.providers) ? catalog.providers : [])
      .map((item) => String(item?.provider || '').trim())
      .filter(Boolean),
  );

  const capabilityProviders = Array.isArray(capabilities?.providers) ? capabilities.providers : [];
  const remoteCapabilities = capabilityProviders.filter((item) => String(item?.runtime_plane || '').trim() === 'remote');
  const remoteCapabilityProviders = new Set(
    remoteCapabilities.map((item) => String(item?.provider || '').trim()).filter(Boolean),
  );

  const missingInCapabilities = [...catalogProviders].filter((provider) => !remoteCapabilityProviders.has(provider));
  const extraInCapabilities = [...remoteCapabilityProviders].filter((provider) => !catalogProviders.has(provider));
  if (missingInCapabilities.length > 0) {
    fail(`provider-capabilities missing remote providers from provider-catalog: ${missingInCapabilities.join(', ')}`);
  }
  if (extraInCapabilities.length > 0) {
    fail(`provider-capabilities has unknown remote providers: ${extraInCapabilities.join(', ')}`);
  }

  const localEntries = capabilityProviders.filter((item) => String(item?.provider || '').trim() === 'local');
  if (localEntries.length !== 1) {
    fail('provider-capabilities must contain exactly one `local` entry');
  } else {
    const local = localEntries[0];
    if (String(local?.runtime_plane || '').trim() !== 'local') {
      fail('provider-capabilities local entry must use runtime_plane=local');
    }
    if (String(local?.execution_module || '').trim() !== 'local-model') {
      fail('provider-capabilities local entry must map execution_module=local-model');
    }
    if (local?.inline_supported === true) {
      fail('provider-capabilities local entry must not support inline');
    }
  }

  const catalogMap = new Map();
  for (const item of Array.isArray(catalog?.providers) ? catalog.providers : []) {
    const provider = String(item?.provider || '').trim();
    if (!provider) continue;
    catalogMap.set(provider, Boolean(item?.requires_explicit_endpoint));
  }
  for (const item of remoteCapabilities) {
    const provider = String(item?.provider || '').trim();
    if (!provider) continue;
    const explicitRequired = catalogMap.get(provider);
    const endpointRequirement = String(item?.endpoint_requirement || '').trim();
    if (explicitRequired && endpointRequirement !== 'explicit_required') {
      fail(`provider-capabilities ${provider} must use endpoint_requirement=explicit_required`);
    }
    if (!explicitRequired && endpointRequirement === 'explicit_required') {
      fail(`provider-capabilities ${provider} endpoint_requirement conflicts with provider-catalog default endpoint`);
    }
  }
}

function checkConnectorRpcFieldRulesCoverage() {
  const table = readYaml('spec/runtime/kernel/tables/connector-rpc-field-rules.yaml');
  const rules = Array.isArray(table?.rules) ? table.rules : [];
  const requiredRpcs = new Set(['CreateConnector', 'UpdateConnector', 'DeleteConnector', 'TestConnector', 'ListConnectorModels']);
  const presentRpcs = new Set(rules.map((item) => String(item?.rpc || '').trim()).filter(Boolean));

  for (const rpc of requiredRpcs) {
    if (!presentRpcs.has(rpc)) {
      fail(`connector-rpc-field-rules missing RPC coverage: ${rpc}`);
    }
  }

  for (const item of rules) {
    const sourceRule = String(item?.source_rule || '').trim();
    if (!sourceRule) {
      fail('connector-rpc-field-rules: each rule must include source_rule');
      continue;
    }
    if (!/^K-[A-Z]+-\d{3}$/u.test(sourceRule)) {
      fail(`connector-rpc-field-rules invalid source_rule: ${sourceRule}`);
    }
  }
}

function checkStateTransitionCoverage(kernelRuleSet) {
  const transitions = readYaml('spec/runtime/kernel/tables/state-transitions.yaml');
  const jobStates = readYaml('spec/runtime/kernel/tables/job-states.yaml');

  const machines = Array.isArray(transitions?.machines) ? transitions.machines : [];
  const machineMap = new Map();
  for (const machine of machines) {
    const name = String(machine?.machine || '').trim();
    if (!name) continue;
    machineMap.set(name, machine);
  }

  const requiredMachines = [
    'connector_status',
    'remote_connector_delete_flow',
    'media_job',
    'local_model_lifecycle',
    'local_service_lifecycle',
  ];
  for (const machineName of requiredMachines) {
    if (!machineMap.has(machineName)) {
      fail(`state-transitions missing machine: ${machineName}`);
    }
  }

  const mediaMachine = machineMap.get('media_job');
  if (mediaMachine) {
    const mediaStates = new Set(
      (Array.isArray(mediaMachine?.states) ? mediaMachine.states : []).map((s) => String(s || '').trim()).filter(Boolean),
    );
    const jobStateSet = new Set(
      (Array.isArray(jobStates?.states) ? jobStates.states : []).map((item) => String(item?.state || '').trim()).filter(Boolean),
    );
    const missing = [...jobStateSet].filter((state) => !mediaStates.has(state));
    const extra = [...mediaStates].filter((state) => !jobStateSet.has(state));
    if (missing.length > 0) {
      fail(`state-transitions media_job missing states from job-states: ${missing.join(', ')}`);
    }
    if (extra.length > 0) {
      fail(`state-transitions media_job has unknown states: ${extra.join(', ')}`);
    }
  }

  for (const machine of machines) {
    const name = String(machine?.machine || '').trim() || '<unknown>';
    const edges = Array.isArray(machine?.transitions) ? machine.transitions : [];
    for (const edge of edges) {
      const source = String(edge?.source || '').trim();
      if (!source) {
        fail(`state-transitions ${name} transition missing source`);
        continue;
      }
      if (!/^K-[A-Z]+-\d{3}$/u.test(source)) {
        fail(`state-transitions ${name} transition has non-formal source: ${source}`);
        continue;
      }
      if (!kernelRuleSet.has(source)) {
        fail(`state-transitions ${name} references undefined kernel rule: ${source}`);
      }
    }
  }
}

function checkDomainProviderTableAnchors() {
  const requirements = [
    {
      file: 'spec/runtime/connector-auth.md',
      mustInclude: ['kernel/tables/provider-catalog.yaml', 'kernel/tables/provider-capabilities.yaml'],
    },
    {
      file: 'spec/runtime/nimillm.md',
      mustInclude: ['kernel/tables/provider-catalog.yaml', 'kernel/tables/provider-capabilities.yaml'],
    },
    {
      file: 'spec/runtime/local-model.md',
      mustInclude: ['kernel/tables/provider-capabilities.yaml'],
    },
  ];

  for (const requirement of requirements) {
    const content = read(requirement.file);
    for (const token of requirement.mustInclude) {
      if (!content.includes(token)) {
        fail(`${requirement.file} must reference ${token}`);
      }
    }
  }
}

function checkConnectorRpcRulesAgainstRpcSurface() {
  const rpcTable = readYaml('spec/runtime/kernel/tables/rpc-methods.yaml');
  const connectorRules = readYaml('spec/runtime/kernel/tables/connector-rpc-field-rules.yaml');

  const services = Array.isArray(rpcTable?.services) ? rpcTable.services : [];
  const allRpcMethods = new Set();
  let connectorMethods = new Set();
  for (const service of services) {
    const serviceName = String(service?.name || '').trim();
    const methods = Array.isArray(service?.methods) ? service.methods : [];
    const methodNames = methods.map((m) => String(m?.name || '').trim()).filter(Boolean);
    for (const methodName of methodNames) allRpcMethods.add(methodName);
    if (serviceName === 'ConnectorService') {
      connectorMethods = new Set(methodNames);
    }
  }

  const rules = Array.isArray(connectorRules?.rules) ? connectorRules.rules : [];
  for (const item of rules) {
    const rpc = String(item?.rpc || '').trim();
    if (!rpc) continue;
    if (!allRpcMethods.has(rpc)) {
      fail(`connector-rpc-field-rules references unknown RPC method: ${rpc}`);
      continue;
    }
    if (!connectorMethods.has(rpc)) {
      fail(`connector-rpc-field-rules RPC is not under ConnectorService: ${rpc}`);
    }
  }
}

function checkReasonCodeReferencesResolvable() {
  const reasonCodes = loadReasonCodeSet();

  for (const rel of runtimeMarkdownFiles) {
    const content = read(rel);
    const refs = [...content.matchAll(/\b(?:AUTH_TOKEN_INVALID|AI_[A-Z0-9_]+)\b/g)];
    for (const ref of refs) {
      const reasonCode = ref[0];
      if (reasonCode.endsWith('_')) continue;
      if (!reasonCodes.has(reasonCode)) {
        fail(`${rel} references unknown ReasonCode: ${reasonCode}`);
      }
    }
  }
}

function checkProviderReferencesResolvable() {
  const catalog = readYaml('spec/runtime/kernel/tables/provider-catalog.yaml');
  const providerSet = new Set(
    ['local'].concat(
      (Array.isArray(catalog?.providers) ? catalog.providers : [])
        .map((item) => String(item?.provider || '').trim())
        .filter(Boolean),
    ),
  );

  for (const rel of domainFiles) {
    const content = read(rel);
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const bulletMatch = line.match(/^\s*-\s+`([a-z][a-z0-9_]*)`\s*$/u);
      if (!bulletMatch) continue;
      const token = bulletMatch[1];

      const windowStart = Math.max(0, i - 3);
      const windowEnd = Math.min(lines.length - 1, i + 1);
      const context = lines.slice(windowStart, windowEnd + 1).join('\n');
      if (!/provider/iu.test(context)) continue;
      if (!providerSet.has(token)) {
        fail(`${rel}:${i + 1} lists unknown provider value: ${token}`);
      }
    }
  }
}

function collectKernelRuleDefinitions() {
  const kernelMarkdown = kernelFiles.filter((rel) => rel.endsWith('.md') && !rel.includes('/generated/'));
  const ruleToFile = new Map();
  for (const rel of kernelMarkdown) {
    const content = read(rel);
    const defs = [...content.matchAll(/^##\s+(K-[A-Z]+-\d{3})\b/gmu)];
    for (const match of defs) {
      const ruleId = match[1];
      const prev = ruleToFile.get(ruleId);
      if (prev && prev !== rel) {
        fail(`kernel Rule ID defined in multiple files: ${ruleId} (${prev}, ${rel})`);
        continue;
      }
      ruleToFile.set(ruleId, rel);
    }
  }

  if (ruleToFile.size === 0) {
    fail('no kernel Rule ID definitions found');
  }
  return new Set(ruleToFile.keys());
}

function checkRuleIdReferencesResolvable(kernelRuleSet) {
  const files = allRuntimeSpecs
    .filter((abs) => !abs.includes(`${path.sep}generated${path.sep}`))
    .map((abs) => path.relative(cwd, abs));

  for (const rel of files) {
    const content = read(rel);
    const refs = [...content.matchAll(/\bK-[A-Z]+-\d{3}\b/g)];
    for (const ref of refs) {
      const ruleId = ref[0];
      if (!kernelRuleSet.has(ruleId)) {
        fail(`${rel} references undefined kernel Rule ID: ${ruleId}`);
      }
    }
  }
}

function checkNoKernelRuleDefinitionsInImplementationDocs() {
  const implementationMarkdown = [
    ...domainFiles,
    ...sdkSpecFiles.filter((rel) => rel.endsWith('.md')),
  ];

  for (const rel of implementationMarkdown) {
    if (!fs.existsSync(path.join(cwd, rel))) continue;
    const content = read(rel);
    if (/^##\s+K-[A-Z]+-\d{3}\b/gmu.test(content)) {
      fail(`implementation doc must not define kernel Rule IDs: ${rel}`);
    }
  }
}

function checkMetadataKeyContract() {
  const table = readYaml('spec/runtime/kernel/tables/metadata-keys.yaml');
  const keys = Array.isArray(table?.keys) ? table.keys : [];
  const byKey = new Map(
    keys.map((item) => [String(item?.key || '').trim(), item]).filter(([key]) => Boolean(key)),
  );

  const keySource = byKey.get('x-nimi-key-source');
  if (!keySource) {
    fail('metadata-keys missing x-nimi-key-source');
    return;
  }
  const allowed = new Set((Array.isArray(keySource?.allowed_values) ? keySource.allowed_values : []).map((v) => String(v)));
  for (const required of ['inline', 'managed']) {
    if (!allowed.has(required)) {
      fail(`metadata-keys x-nimi-key-source must include allowed value: ${required}`);
    }
  }
}

function checkKeySourceTruthTable() {
  const table = readYaml('spec/runtime/kernel/tables/key-source-truth-table.yaml');
  const cases = Array.isArray(table?.cases) ? table.cases : [];
  const reasonCodes = loadReasonCodeSet();

  if (cases.length === 0) {
    fail('key-source-truth-table must include at least one case');
    return;
  }

  const byId = new Map();
  for (const item of cases) {
    const id = String(item?.id || '').trim();
    if (!id) {
      fail('key-source-truth-table case missing id');
      continue;
    }
    if (byId.has(id)) {
      fail(`key-source-truth-table duplicate case id: ${id}`);
    }
    byId.set(id, item);

    const sourceRule = String(item?.source_rule || '').trim();
    if (!sourceRule || !/^K-[A-Z]+-\d{3}$/u.test(sourceRule)) {
      fail(`key-source-truth-table case ${id} has invalid source_rule: ${sourceRule}`);
    }

    const reasonCode = String(item?.reason_code || '').trim();
    const valid = Boolean(item?.valid);
    if (!valid) {
      if (!reasonCode) {
        fail(`key-source-truth-table invalid case ${id} must include reason_code`);
      } else if (!reasonCodes.has(reasonCode)) {
        fail(`key-source-truth-table case ${id} uses unknown reason_code: ${reasonCode}`);
      }
    }
  }

  const requiredCaseIds = [
    'managed_with_connector_id',
    'managed_missing_connector_id',
    'inline_complete_with_default_endpoint',
    'inline_missing_provider_type',
    'inline_missing_api_key',
    'inline_missing_required_endpoint',
    'conflict_connector_and_inline',
  ];
  for (const id of requiredCaseIds) {
    if (!byId.has(id)) {
      fail(`key-source-truth-table missing required case: ${id}`);
    }
  }
}

function checkErrorMappingMatrix() {
  const table = readYaml('spec/runtime/kernel/tables/error-mapping-matrix.yaml');
  const mappings = Array.isArray(table?.mappings) ? table.mappings : [];
  const reasonCodes = loadReasonCodeSet();

  if (mappings.length === 0) {
    fail('error-mapping-matrix must include at least one mapping');
    return;
  }

  const covered = new Set();

  for (const item of mappings) {
    const reasonCode = String(item?.reason_code || '').trim();
    const grpcCode = String(item?.grpc_code || '').trim();
    const sourceRule = String(item?.source_rule || '').trim();
    if (!reasonCode) {
      fail('error-mapping-matrix mapping missing reason_code');
      continue;
    }
    if (!grpcCode) {
      fail(`error-mapping-matrix ${reasonCode} missing grpc_code`);
    }
    if (!reasonCodes.has(reasonCode)) {
      fail(`error-mapping-matrix references unknown reason_code: ${reasonCode}`);
    }
    if (!sourceRule || !/^K-[A-Z]+-\d{3}$/u.test(sourceRule)) {
      fail(`error-mapping-matrix ${reasonCode} has invalid source_rule: ${sourceRule}`);
    }
    covered.add(reasonCode);
  }

  for (const code of reasonCodes) {
    if (!covered.has(code)) {
      fail(`error-mapping-matrix missing required reason_code coverage: ${code}`);
    }
  }
}

function checkRpcMigrationMapCoverage() {
  const rpcMethods = readYaml('spec/runtime/kernel/tables/rpc-methods.yaml');
  const migration = readYaml('spec/runtime/kernel/tables/rpc-migration-map.yaml');
  const protoMap = parseProtoServiceMethodMap();

  const services = Array.isArray(rpcMethods?.services) ? rpcMethods.services : [];
  const serviceMethodMap = new Map();
  for (const service of services) {
    const serviceName = String(service?.name || '').trim();
    if (!serviceName) continue;
    const methods = new Set(
      (Array.isArray(service?.methods) ? service.methods : [])
        .map((m) => String(m?.name || '').trim())
        .filter(Boolean),
    );
    serviceMethodMap.set(serviceName, methods);
  }

  const serviceMappings = Array.isArray(migration?.service_mappings) ? migration.service_mappings : [];
  const methodMappings = Array.isArray(migration?.method_mappings) ? migration.method_mappings : [];
  const excludedProtoMethods = Array.isArray(migration?.excluded_proto_methods) ? migration.excluded_proto_methods : [];

  const serviceMappingByDesign = new Map();
  for (const item of serviceMappings) {
    const designService = String(item?.design_service || '').trim();
    if (!designService) {
      fail('rpc-migration-map service_mappings entry missing design_service');
      continue;
    }
    if (serviceMappingByDesign.has(designService)) {
      fail(`rpc-migration-map duplicate service mapping: ${designService}`);
      continue;
    }
    serviceMappingByDesign.set(designService, item);
  }

  for (const designService of serviceMethodMap.keys()) {
    if (!serviceMappingByDesign.has(designService)) {
      fail(`rpc-migration-map missing service mapping for ${designService}`);
    }
  }

  for (const [designService, mapping] of serviceMappingByDesign.entries()) {
    const protoService = String(mapping?.proto_service || '').trim();
    const status = String(mapping?.mapping_status || '').trim();
    if (!protoService) {
      if (status !== 'design_only_pending_proto') {
        fail(`rpc-migration-map ${designService} has empty proto_service but status is ${status}`);
      }
      continue;
    }
    if (!protoMap.has(protoService)) {
      fail(`rpc-migration-map ${designService} references unknown proto service: ${protoService}`);
    }
  }

  const methodMappingByDesignMethod = new Map();
  for (const item of methodMappings) {
    const designService = String(item?.design_service || '').trim();
    const designMethod = String(item?.design_method || '').trim();
    if (!designService || !designMethod) {
      fail('rpc-migration-map method_mappings entry missing design_service/design_method');
      continue;
    }
    const key = `${designService}.${designMethod}`;
    if (methodMappingByDesignMethod.has(key)) {
      fail(`rpc-migration-map duplicate method mapping: ${key}`);
      continue;
    }
    methodMappingByDesignMethod.set(key, item);

    const protoService = String(item?.proto_service || '').trim();
    const protoMethod = String(item?.proto_method || '').trim();
    const status = String(item?.mapping_status || '').trim();
    if (!protoService || !protoMethod) {
      if (status !== 'planned') {
        fail(`rpc-migration-map ${key} has empty proto target but status is ${status}`);
      }
      continue;
    }
    const protoMethods = protoMap.get(protoService);
    if (!protoMethods) {
      fail(`rpc-migration-map ${key} references unknown proto service: ${protoService}`);
      continue;
    }
    if (!protoMethods.has(protoMethod)) {
      fail(`rpc-migration-map ${key} references unknown proto method: ${protoService}.${protoMethod}`);
    }
  }

  for (const [designService, methods] of serviceMethodMap.entries()) {
    for (const method of methods) {
      const key = `${designService}.${method}`;
      if (!methodMappingByDesignMethod.has(key)) {
        fail(`rpc-migration-map missing method mapping for ${key}`);
      }
    }
  }

  const excludedSet = new Set();
  for (const item of excludedProtoMethods) {
    const protoService = String(item?.proto_service || '').trim();
    const protoMethod = String(item?.proto_method || '').trim();
    if (!protoService || !protoMethod) {
      fail('rpc-migration-map excluded_proto_methods entry missing proto_service/proto_method');
      continue;
    }
    const key = `${protoService}.${protoMethod}`;
    if (excludedSet.has(key)) {
      fail(`rpc-migration-map duplicate excluded proto method: ${key}`);
      continue;
    }
    excludedSet.add(key);
    const protoMethods = protoMap.get(protoService);
    if (!protoMethods || !protoMethods.has(protoMethod)) {
      fail(`rpc-migration-map excluded proto method does not exist: ${key}`);
    }
  }

  for (const [designService, mapping] of serviceMappingByDesign.entries()) {
    const protoService = String(mapping?.proto_service || '').trim();
    if (!protoService) continue;
    const protoMethods = protoMap.get(protoService);
    if (!protoMethods) continue;

    const mappedProtoMethods = new Set();
    for (const item of methodMappings) {
      const serviceName = String(item?.design_service || '').trim();
      const methodProtoService = String(item?.proto_service || '').trim();
      const methodProtoName = String(item?.proto_method || '').trim();
      if (serviceName !== designService) continue;
      if (!methodProtoService || !methodProtoName) continue;
      mappedProtoMethods.add(methodProtoName);
    }

    const status = String(mapping?.mapping_status || '').trim();
    for (const protoMethod of protoMethods) {
      if (mappedProtoMethods.has(protoMethod)) continue;
      if (status === 'aligned') {
        fail(`rpc-migration-map aligned service ${designService} leaves proto method unmapped: ${protoService}.${protoMethod}`);
        continue;
      }
      const excludedKey = `${protoService}.${protoMethod}`;
      if (!excludedSet.has(excludedKey)) {
        fail(`rpc-migration-map missing excluded_proto_methods entry for ${excludedKey}`);
      }
    }
  }
}

function parseProtoServiceMethodMap() {
  const out = new Map();
  const files = walk(protoRoot).filter((p) => p.endsWith('.proto'));
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    let currentService = '';
    for (const line of lines) {
      const serviceMatch = line.match(/^\s*service\s+([A-Za-z0-9_]+)\s*\{/u);
      if (serviceMatch) {
        currentService = serviceMatch[1];
        if (!out.has(currentService)) out.set(currentService, new Set());
        continue;
      }
      if (currentService) {
        const rpcMatch = line.match(/^\s*rpc\s+([A-Za-z0-9_]+)\s*\(/u);
        if (rpcMatch) {
          out.get(currentService)?.add(rpcMatch[1]);
          continue;
        }
        if (/^\s*\}\s*$/u.test(line)) {
          currentService = '';
        }
      }
    }
  }
  return out;
}

function loadReasonCodeSet() {
  const reasonTable = readYaml('spec/runtime/kernel/tables/reason-codes.yaml');
  return new Set(
    (Array.isArray(reasonTable?.codes) ? reasonTable.codes : [])
      .map((item) => String(item?.name || '').trim())
      .filter(Boolean),
  );
}

function isSpecDocFile(file) {
  return file.endsWith('.md') || file.endsWith('.yaml');
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
