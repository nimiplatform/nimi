#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { createCatalogChecks } from './runtime-spec-catalog-checks.mjs';
import { checkConfigOverrideTraceability } from './runtime-config-override-traceability.mjs';
import { readYamlWithFragments } from './read-yaml-with-fragments.mjs';

const cwd = process.cwd();
const runtimeRoot = path.join(cwd, 'spec/runtime');
const sdkRoot = path.join(cwd, 'spec/sdk');
const protoRoot = path.join(cwd, 'proto/runtime/v1');
const runtimeCatalogProvidersDir = path.join(cwd, 'runtime/catalog/providers');
const runtimeCatalogSourceProvidersDir = path.join(cwd, 'runtime/catalog/source/providers');
const {
  checkModelCatalogTables,
  checkProviderTableParity,
  checkSourceProviderCoverage,
  checkTtsProviderCapabilityMatrix,
} = createCatalogChecks({
  cwd,
  fail,
  fs,
  normalizeProviderName,
  path,
  readYaml,
  runtimeCatalogProvidersDir,
  runtimeCatalogSourceProvidersDir,
  YAML,
});

const kernelFiles = [
  'spec/runtime/kernel/index.md',
  'spec/runtime/kernel/rpc-surface.md',
  'spec/runtime/kernel/authz-ownership.md',
  'spec/runtime/kernel/authn-token-validation.md',
  'spec/runtime/kernel/auth-service.md',
  'spec/runtime/kernel/grant-service.md',
  'spec/runtime/kernel/key-source-routing.md',
  'spec/runtime/kernel/scenario-job-lifecycle.md',
  'spec/runtime/kernel/local-category-capability.md',
  'spec/runtime/kernel/local-engine-contract.md',
  'spec/runtime/kernel/device-profile-contract.md',
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
  'spec/runtime/kernel/tables/local-engine-catalog.yaml',
  'spec/runtime/kernel/tables/local-adapter-routing.yaml',
  // Phase 2 kernel files (daemon, provider, deferred services)
  'spec/runtime/kernel/daemon-lifecycle.md',
  'spec/runtime/kernel/provider-health-contract.md',
  'spec/runtime/kernel/workflow-contract.md',
  'spec/runtime/kernel/voice-contract.md',
  'spec/runtime/kernel/model-service-contract.md',
  'spec/runtime/kernel/knowledge-contract.md',
  'spec/runtime/kernel/runtime-memory-service-contract.md',
  'spec/runtime/kernel/runtime-memory-substrate-contract.md',
  'spec/runtime/kernel/runtime-agent-core-contract.md',
  'spec/runtime/kernel/app-messaging-contract.md',
  'spec/runtime/kernel/cli-onboarding-contract.md',
  'spec/runtime/kernel/tables/daemon-health-states.yaml',
  'spec/runtime/kernel/tables/interceptor-chain.yaml',
  'spec/runtime/kernel/tables/ai-timeout-defaults.yaml',
  'spec/runtime/kernel/tables/provider-probe-targets.yaml',
  'spec/runtime/kernel/tables/workflow-node-types.yaml',
  'spec/runtime/kernel/tables/workflow-states.yaml',
  'spec/runtime/kernel/tables/voice-enums.yaml',
  'spec/runtime/kernel/tables/tts-provider-capability-matrix.yaml',
  // Dedicated families migrated from domain-local IDs
  'spec/runtime/kernel/config-contract.md',
  'spec/runtime/kernel/connector-contract.md',
  'spec/runtime/kernel/nimillm-contract.md',
  'spec/runtime/kernel/model-catalog-contract.md',
  'spec/runtime/kernel/multimodal-provider-contract.md',
  'spec/runtime/kernel/delivery-gates-contract.md',
  'spec/runtime/kernel/proto-governance-contract.md',
  'spec/runtime/kernel/tables/multimodal-canonical-fields.yaml',
  'spec/runtime/kernel/tables/multimodal-artifact-fields.yaml',
  'spec/runtime/kernel/tables/scenario-types.yaml',
  'spec/runtime/kernel/tables/scenario-execution-matrix.yaml',
  'spec/runtime/kernel/tables/provider-extension-registry.yaml',
  'spec/runtime/kernel/tables/runtime-memory-bank-scope.yaml',
  'spec/runtime/kernel/tables/runtime-memory-hook-trigger.yaml',
  'spec/runtime/kernel/tables/runtime-memory-replication-outcome.yaml',
  'spec/runtime/kernel/tables/runtime-agent-core-typed-family.yaml',
  'spec/runtime/kernel/tables/scenario-profile-fields.yaml',
  'spec/runtime/kernel/tables/runtime-delivery-gates.yaml',
  'spec/runtime/kernel/tables/runtime-proto-governance-gates.yaml',
  'spec/runtime/kernel/tables/capability-vocabulary-mapping.yaml',
  'spec/runtime/kernel/tables/config-schema.yaml',
  'spec/runtime/kernel/tables/rule-evidence.yaml',
  // AI profile execution and scheduling
  'spec/runtime/kernel/ai-profile-execution-contract.md',
  'spec/runtime/kernel/scheduling-contract.md',
  'spec/runtime/kernel/world-evolution-engine-contract.md',
];

const domainFiles = listDomainMarkdownFiles('spec/runtime');

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
  return readYamlWithFragments(path.join(cwd, rel));
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
  if (!/\bK-[A-Z]+-\d{3}[a-z]?\b/.test(content)) {
    fail(`${rel} must reference at least one kernel Rule ID`);
  }
  checkNoLocalRuleIds(content, rel);
  checkNoRuleDefinitionHeadings(content, rel);
}
if (domainFiles.length === 0) {
  fail('runtime domain markdown files are empty');
}

const kernelRuleDefinitions = collectKernelRuleDefinitions();

checkLegacyDesignReferenceDrift();
checkReasonCodeNumericAssignments();
checkBannedExternalRpcNames();
checkProviderTableParity();
checkSourceProviderCoverage();
checkModelCatalogTables();
checkTtsProviderCapabilityMatrix(kernelRuleDefinitions);
checkRuntimeCatalogLoaderIsolation();
checkConnectorRpcFieldRulesCoverage();
checkStateTransitionCoverage(kernelRuleDefinitions);
checkDomainProviderTableAnchors();
checkConnectorRpcRulesAgainstRpcSurface();
checkReasonCodeReferencesResolvable();
checkProviderReferencesResolvable();
checkRuleIdReferencesResolvable(kernelRuleDefinitions);
checkNoKernelRuleDefinitionsInImplementationDocs();
checkMetadataKeyContract();
checkMetadataKeyCrossReferences();
checkKeySourceTruthTable();
checkErrorMappingMatrix();
checkRpcMigrationMapCoverage();
checkDomainSection0ImportsCoveredInBody();
checkDomainPrimaryRuleCoverage();
checkConfigPathConsistency();
checkConfigOverrideTraceabilityMain();
checkProbeTargetProviderCoverage();
checkRpcMethodsSourceTraceability(kernelRuleDefinitions);
checkProviderCatalogSourceTraceability(kernelRuleDefinitions);
checkReasonCodeSourceTraceability(kernelRuleDefinitions);
checkRuntimeDeliveryGateCoverage(kernelRuleDefinitions);
checkCapabilityVocabularyMapping(kernelRuleDefinitions);
checkOrphanRules(kernelRuleDefinitions);
checkRuleEvidence(kernelRuleDefinitions);

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
    const normalizedRel = rel.replaceAll('\\', '/');
    if (normalizedRel === 'spec/runtime/kernel/tables/reason-codes.yaml') continue;
    const txt = read(rel);
    if (/AI_[A-Z0-9_]+\s*=\s*\d+/.test(txt)) {
      fail(`ReasonCode numeric assignment must live only in reason-codes.yaml: ${normalizedRel}`);
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

function checkRuntimeDeliveryGateCoverage(kernelRuleSet) {
  const tablePath = 'spec/runtime/kernel/tables/runtime-delivery-gates.yaml';
  const table = readYaml(tablePath);
  const gates = Array.isArray(table?.gates) ? table.gates : [];
  if (gates.length === 0) {
    fail(`${tablePath} must define at least one gate`);
    return;
  }

  const gateMap = new Map();
  for (const gateEntry of gates) {
    const gate = String(gateEntry?.gate || '').trim();
    const command = String(gateEntry?.command || '').trim();
    const sourceRule = String(gateEntry?.source_rule || '').trim();
    if (!gate) {
      fail(`${tablePath} contains gate entry with empty gate id`);
      continue;
    }
    if (gateMap.has(gate)) {
      fail(`${tablePath} contains duplicate gate id: ${gate}`);
      continue;
    }
    gateMap.set(gate, gateEntry);
    if (!command) {
      fail(`${tablePath} gate ${gate} must declare command`);
    }
    if (!/^K-[A-Z]+-\d{3}[a-z]?$/u.test(sourceRule)) {
      fail(`${tablePath} gate ${gate} has invalid source_rule: ${sourceRule}`);
      continue;
    }
    if (!kernelRuleSet.has(sourceRule)) {
      fail(`${tablePath} gate ${gate} references undefined kernel Rule ID: ${sourceRule}`);
    }
  }

  const requiredGates = [
    ['G0', 'K-GATE-010', ['pnpm check:ai-scenario-hardcut-drift', 'pnpm check:runtime-spec-kernel-consistency', 'pnpm check:runtime-spec-kernel-docs-drift']],
    ['G1', 'K-GATE-020', ['pnpm proto:lint', 'pnpm proto:breaking', 'pnpm proto:drift-check']],
    ['G2', 'K-GATE-030', ['pnpm check:sdk-spec-kernel-consistency', 'pnpm check:sdk-spec-kernel-docs-drift', 'pnpm check:runtime-bridge-method-drift']],
    ['G3', 'K-GATE-040', ['pnpm check:runtime-go-coverage', 'pnpm check:no-legacy-cloud-provider-keys', 'pnpm check:runtime-ai-scenario-coverage', 'pnpm check:live-provider-invariants']],
    ['G4', 'K-GATE-050', ['go test ./internal/services/ai/ -run Test.*ScenarioJob -count=1']],
    ['G5', 'K-GATE-060', ['node scripts/run-live-test-matrix.mjs']],
    ['G6', 'K-GATE-070', ['go run ./cmd/runtime-compliance --gate']],
    ['G7', 'K-GATE-080', ['pnpm check:live-smoke-gate --require-release']],
  ];

  for (const [gate, expectedRule, expectedTokens] of requiredGates) {
    const gateEntry = gateMap.get(gate);
    if (!gateEntry) {
      fail(`${tablePath} missing required gate: ${gate}`);
      continue;
    }
    const sourceRule = String(gateEntry?.source_rule || '').trim();
    if (sourceRule !== expectedRule) {
      fail(`${tablePath} gate ${gate} must use source_rule ${expectedRule}, got ${sourceRule || '<empty>'}`);
    }
    const command = String(gateEntry?.command || '').trim();
    for (const token of expectedTokens) {
      if (!command.includes(token)) {
        fail(`${tablePath} gate ${gate} command must include: ${token}`);
      }
    }
  }

  const expectedLiveEvidenceRoute = 'config/live/live-gate-baseline.yaml,.local/report/**';
  for (const gate of ['G3', 'G5', 'G7']) {
    const evidenceRoute = String(gateMap.get(gate)?.evidence_route || '').trim();
    if (evidenceRoute !== expectedLiveEvidenceRoute) {
      fail(`${tablePath} gate ${gate} must use evidence_route ${expectedLiveEvidenceRoute}`);
    }
  }
}

function checkRuntimeCatalogLoaderIsolation() {
  const loaderFile = 'runtime/internal/aicatalog/loader.go';
  const content = read(loaderFile);

  if (/providers-draft/iu.test(content)) {
    fail(`${loaderFile} must not read runtime/catalog/providers-draft`);
  }
  if (!/ReadDir\(runtimecatalog\.DefaultProvidersFS,\s*"providers"\)/u.test(content)) {
    fail(`${loaderFile} must load built-in active providers directory only`);
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
    const source = String(item?.source_rule || '').trim();
    if (!source) {
      fail('connector-rpc-field-rules: each rule must include source_rule');
      continue;
    }
    if (!/^K-[A-Z]+-\d{3}[a-z]?$/u.test(source)) {
      fail(`connector-rpc-field-rules invalid source_rule: ${source}`);
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
    'scenario_job',
    'local_model_lifecycle',
    'local_service_lifecycle',
  ];
  for (const machineName of requiredMachines) {
    if (!machineMap.has(machineName)) {
      fail(`state-transitions missing machine: ${machineName}`);
    }
  }

  const scenarioMachine = machineMap.get('scenario_job');
  if (scenarioMachine) {
    const scenarioStates = new Set(
      (Array.isArray(scenarioMachine?.states) ? scenarioMachine.states : []).map((s) => String(s || '').trim()).filter(Boolean),
    );
    const jobStateSet = new Set(
      (Array.isArray(jobStates?.states) ? jobStates.states : []).map((item) => String(item?.state || '').trim()).filter(Boolean),
    );
    const missing = [...jobStateSet].filter((state) => !scenarioStates.has(state));
    const extra = [...scenarioStates].filter((state) => !jobStateSet.has(state));
    if (missing.length > 0) {
      fail(`state-transitions scenario_job missing states from job-states: ${missing.join(', ')}`);
    }
    if (extra.length > 0) {
      fail(`state-transitions scenario_job has unknown states: ${extra.join(', ')}`);
    }
  }

  for (const machine of machines) {
    const name = String(machine?.machine || '').trim() || '<unknown>';
    const edges = Array.isArray(machine?.transitions) ? machine.transitions : [];
    for (const edge of edges) {
      const source = String(edge?.source_rule || '').trim();
      if (!source) {
        fail(`state-transitions ${name} transition missing source_rule`);
        continue;
      }
      if (!/^K-[A-Z]+-\d{3}[a-z]?$/u.test(source)) {
        fail(`state-transitions ${name} transition has non-formal source_rule: ${source}`);
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
      file: 'spec/runtime/connector.md',
      mustInclude: ['kernel/tables/provider-catalog.yaml', 'kernel/tables/provider-capabilities.yaml'],
    },
    {
      file: 'spec/runtime/nimillm.md',
      mustInclude: ['kernel/tables/provider-catalog.yaml', 'kernel/tables/provider-capabilities.yaml'],
    },
    {
      file: 'spec/runtime/local-model.md',
      mustInclude: ['kernel/tables/local-engine-catalog.yaml', 'kernel/tables/local-adapter-routing.yaml'],
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
  const workflowNodeTypes = loadWorkflowNodeTypeSet();

  for (const rel of runtimeMarkdownFiles) {
    const content = read(rel);
    const refs = [...content.matchAll(/\b(?:AUTH_TOKEN_INVALID|AI_[A-Z]+_[A-Z0-9_]+)\b/g)];
    for (const ref of refs) {
      const reasonCode = ref[0];
      if (reasonCode.endsWith('_')) continue;
      if (workflowNodeTypes.has(reasonCode)) continue;
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
    const defs = [...content.matchAll(/^##\s+(K-[A-Z]+-\d{3}[a-z]?)\b/gmu)];
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
    const refs = [...content.matchAll(/\bK-[A-Z]+-\d{3}[a-z]?\b/g)];
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
    if (/^##\s+K-[A-Z]+-\d{3}[a-z]?\b/gmu.test(content)) {
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

  const authorization = byKey.get('authorization');
  if (!authorization) {
    fail('metadata-keys missing authorization');
  }
}

function checkMetadataKeyCrossReferences() {
  const table = readYaml('spec/runtime/kernel/tables/metadata-keys.yaml');
  const keys = Array.isArray(table?.keys) ? table.keys : [];
  const yamlKeys = new Set(
    keys.map((item) => String(item?.key || '').trim()).filter(Boolean),
  );

  // Scan all kernel + domain markdown for metadata key references
  const allMdFiles = [...runtimeMarkdownFiles, ...domainFiles];
  const keyRefPattern = /`(x-nimi-[a-z][a-z0-9-]*|authorization)`/g;

  for (const rel of allMdFiles) {
    if (!fs.existsSync(path.join(cwd, rel))) continue;
    const content = read(rel);
    for (const match of content.matchAll(keyRefPattern)) {
      const key = match[1];
      if (!yamlKeys.has(key)) {
        fail(`${rel} references metadata key "${key}" not found in metadata-keys.yaml`);
      }
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

    const source = String(item?.source_rule || '').trim();
    if (!source || !/^K-[A-Z]+-\d{3}[a-z]?$/u.test(source)) {
      fail(`key-source-truth-table case ${id} has invalid source_rule: ${source}`);
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
    const source = String(item?.source_rule || '').trim();
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
    if (!source || !/^K-[A-Z]+-\d{3}[a-z]?$/u.test(source)) {
      fail(`error-mapping-matrix ${reasonCode} has invalid source_rule: ${source}`);
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
    let braceDepth = 0;
    for (const line of lines) {
      const serviceMatch = line.match(/^\s*service\s+([A-Za-z0-9_]+)\s*\{/u);
      if (serviceMatch) {
        currentService = serviceMatch[1];
        braceDepth = 1;
        if (!out.has(currentService)) out.set(currentService, new Set());
        continue;
      }
      if (currentService) {
        const rpcMatch = line.match(/^\s*rpc\s+([A-Za-z0-9_]+)\s*\(/u);
        if (rpcMatch) {
          out.get(currentService)?.add(rpcMatch[1]);
        }
        for (const ch of line) {
          if (ch === '{') braceDepth++;
          else if (ch === '}') braceDepth--;
        }
        if (braceDepth <= 0) {
          currentService = '';
          braceDepth = 0;
        }
      }
    }
  }
  return out;
}

function checkDomainSection0ImportsCoveredInBody() {
  for (const rel of domainFiles) {
    if (!fs.existsSync(path.join(cwd, rel))) continue;
    const content = read(rel);
    const lines = content.split('\n');

    // Find Section 0 boundary (ends at first ## 1. or next ## N.)
    let section0End = lines.length;
    for (let i = 0; i < lines.length; i += 1) {
      if (/^##\s+1\.\s/.test(lines[i])) {
        section0End = i;
        break;
      }
    }

    const section0Text = lines.slice(0, section0End).join('\n');
    const bodyText = lines.slice(section0End).join('\n');

    // Extract K-<DOMAIN>-* wildcard imports from Section 0
    const wildcardImports = [...section0Text.matchAll(/K-([A-Z]+)-\*/g)];
    const importedDomains = new Set(wildcardImports.map((m) => m[1]));

    for (const domain of importedDomains) {
      const specificPattern = new RegExp(`\\bK-${domain}-\\d{3}[a-z]?\\b`);
      if (!specificPattern.test(bodyText)) {
        fail(`${rel} Section 0 imports K-${domain}-* but body has no specific K-${domain}-NNN reference`);
      }
    }

    // Reverse check: body wildcards must be declared in Section 0
    const bodyWildcards = [...bodyText.matchAll(/K-([A-Z]+)-\*/g)];
    const bodyWildcardDomains = new Set(bodyWildcards.map((m) => m[1]));
    for (const domain of bodyWildcardDomains) {
      if (!importedDomains.has(domain)) {
        fail(`${rel} body references K-${domain}-* but Section 0 does not import it`);
      }
    }
  }
}

function checkDomainPrimaryRuleCoverage() {
  const primaryMap = {
    'spec/runtime/cli.md': { kernel: 'spec/runtime/kernel/cli-onboarding-contract.md', prefix: 'K-CLI' },
    'spec/runtime/config.md': { kernel: 'spec/runtime/kernel/config-contract.md', prefix: 'K-CFG' },
    'spec/runtime/connector.md': { kernel: 'spec/runtime/kernel/connector-contract.md', prefix: 'K-CONN' },
    'spec/runtime/local-model.md': { kernel: 'spec/runtime/kernel/local-category-capability.md', prefix: 'K-LOCAL' },
    'spec/runtime/multimodal-delivery-gates.md': { kernel: 'spec/runtime/kernel/delivery-gates-contract.md', prefix: 'K-GATE' },
    'spec/runtime/multimodal-provider.md': { kernel: 'spec/runtime/kernel/multimodal-provider-contract.md', prefix: 'K-MMPROV' },
    'spec/runtime/nimillm.md': { kernel: 'spec/runtime/kernel/nimillm-contract.md', prefix: 'K-NIMI' },
    'spec/runtime/proto-governance.md': { kernel: 'spec/runtime/kernel/proto-governance-contract.md', prefix: 'K-PROTO' },
  };

  for (const [domainRel, { kernel: kernelRel, prefix }] of Object.entries(primaryMap)) {
    const kernelContent = read(kernelRel);
    const domainContent = read(domainRel);
    const kernelRules = new Set(
      [...kernelContent.matchAll(new RegExp(`^##\\s+(${prefix}-\\d{3}[a-z]?)\\b`, 'gmu'))]
        .map((match) => match[1]),
    );

    if (kernelRules.size === 0) {
      fail(`${kernelRel} must define at least one ${prefix}-* rule`);
      continue;
    }

    const coveredRules = collectReferencedRuntimeRuleIds(domainContent, kernelRules);
    const coverage = coveredRules.size / kernelRules.size;
    if (coverage < 0.5) {
      fail(`${domainRel} covers only ${coveredRules.size}/${kernelRules.size} (${Math.round(coverage * 100)}%) of ${prefix}-* rules from ${kernelRel}; minimum 50% required`);
    }
  }
}

function checkConfigPathConsistency() {
  // Detect ghost config.yaml paths in kernel markdown files
  const ghostPattern = /~\/\.nimi\/[^\s`]*config\.yaml/g;
  for (const rel of runtimeMarkdownFiles) {
    const content = read(rel);
    const matches = [...content.matchAll(ghostPattern)];
    for (const match of matches) {
      fail(`${rel} contains ghost config path (should be config.json): ${match[0]}`);
    }
  }
}

function checkConfigOverrideTraceabilityMain() {
  checkConfigOverrideTraceability({
    configSchemaPath: 'spec/runtime/kernel/tables/config-schema.yaml',
    fail,
    read,
    readYaml,
    runtimeMarkdownFiles,
  });
}

function checkProbeTargetProviderCoverage() {
  // Verify every probe target in provider-probe-targets.yaml has a provider type mapping in K-PROV-006
  const probeTargets = readYaml('spec/runtime/kernel/tables/provider-probe-targets.yaml');
  const targets = Array.isArray(probeTargets?.targets) ? probeTargets.targets : [];
  const targetNames = targets.map((t) => String(t?.name || '').trim()).filter(Boolean);

  const providerHealthContent = read('spec/runtime/kernel/provider-health-contract.md');

  // Check that K-PROV-006 section exists
  if (!providerHealthContent.includes('K-PROV-006')) {
    fail('provider-health-contract.md missing K-PROV-006 probe target mapping section');
    return;
  }

  // Extract probe target names from the K-PROV-006 mapping table
  const mappingTablePattern = /\|\s*`([a-z][a-z0-9-]*)`\s*\|/g;
  const prov006Start = providerHealthContent.indexOf('K-PROV-006');
  const prov006Section = providerHealthContent.slice(prov006Start);
  const mappedTargets = new Set();
  for (const match of prov006Section.matchAll(mappingTablePattern)) {
    mappedTargets.add(match[1]);
  }

  for (const targetName of targetNames) {
    if (!mappedTargets.has(targetName)) {
      fail(`provider-probe-targets.yaml target "${targetName}" has no mapping in K-PROV-006`);
    }
  }
}

function checkRpcMethodsSourceTraceability(kernelRuleSet) {
  const rpcTable = readYaml('spec/runtime/kernel/tables/rpc-methods.yaml');
  const services = Array.isArray(rpcTable?.services) ? rpcTable.services : [];
  for (const service of services) {
    const name = String(service?.name || '').trim();
    if (!name) continue;
    const source = String(service?.source_rule || '').trim();
    if (!source) {
      fail(`rpc-methods service ${name} missing source_rule`);
      continue;
    }
    if (!/^K-[A-Z]+-\d{3}[a-z]?$/u.test(source)) {
      fail(`rpc-methods service ${name} has invalid source_rule: ${source}`);
      continue;
    }
    if (!kernelRuleSet.has(source)) {
      fail(`rpc-methods service ${name} references undefined kernel rule: ${source}`);
    }
  }
}

function checkProviderCatalogSourceTraceability(kernelRuleSet) {
  const catalog = readYaml('spec/runtime/kernel/tables/provider-catalog.yaml');
  const providers = Array.isArray(catalog?.providers) ? catalog.providers : [];
  for (const item of providers) {
    const provider = String(item?.provider || '').trim();
    if (!provider) continue;
    const source = String(item?.source_rule || '').trim();
    if (!source) {
      fail(`provider-catalog provider ${provider} missing source_rule`);
      continue;
    }
    if (!/^K-[A-Z]+-\d{3}[a-z]?$/u.test(source)) {
      fail(`provider-catalog provider ${provider} has invalid source_rule: ${source}`);
      continue;
    }
    if (!kernelRuleSet.has(source)) {
      fail(`provider-catalog provider ${provider} references undefined kernel rule: ${source}`);
    }
  }
}

function checkReasonCodeSourceTraceability(kernelRuleSet) {
  const reasonTable = readYaml('spec/runtime/kernel/tables/reason-codes.yaml');
  const codes = Array.isArray(reasonTable?.codes) ? reasonTable.codes : [];
  for (const code of codes) {
    const name = String(code?.name || '').trim();
    if (!name) continue;
    const source = String(code?.source_rule || '').trim();
    if (!source) {
      fail(`reason-codes code ${name} missing source_rule`);
      continue;
    }
    if (!/^K-[A-Z]+-\d{3}[a-z]?$/u.test(source)) {
      fail(`reason-codes code ${name} has invalid source_rule: ${source}`);
      continue;
    }
    if (!kernelRuleSet.has(source)) {
      fail(`reason-codes code ${name} references undefined kernel rule: ${source}`);
    }
  }
}

function checkCapabilityVocabularyMapping(kernelRuleSet) {
  const rel = 'spec/runtime/kernel/tables/capability-vocabulary-mapping.yaml';
  const doc = readYaml(rel) || {};
  const canonicalTokens = new Set(
    (Array.isArray(doc?.canonical_tokens) ? doc.canonical_tokens : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  );
  const localTokens = new Set(
    (Array.isArray(doc?.local_manifest_tokens) ? doc.local_manifest_tokens : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  );
  const localCategories = new Set(
    (Array.isArray(doc?.local_categories) ? doc.local_categories : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  );
  const mappings = Array.isArray(doc?.local_to_canonical) ? doc.local_to_canonical : [];
  const canonicalOnly = Array.isArray(doc?.canonical_only) ? doc.canonical_only : [];

  if (canonicalTokens.size === 0) fail(`${rel} canonical_tokens must not be empty`);
  if (localTokens.size === 0) fail(`${rel} local_manifest_tokens must not be empty`);
  if (mappings.length === 0) fail(`${rel} local_to_canonical must not be empty`);

  const mappedLocalTokens = new Set();
  for (const entry of mappings) {
    const localToken = String(entry?.local_token || '').trim();
    const canonicalToken = String(entry?.canonical_token || '').trim();
    const localCategory = String(entry?.local_category || '').trim();
    const sourceRule = String(entry?.source_rule || '').trim();
    if (!localToken || !localTokens.has(localToken)) {
      fail(`${rel} mapping references unknown local_token: ${localToken || '<empty>'}`);
    }
    if (!canonicalToken || !canonicalTokens.has(canonicalToken)) {
      fail(`${rel} mapping references unknown canonical_token: ${canonicalToken || '<empty>'}`);
    }
    if (localCategory && !localCategories.has(localCategory)) {
      fail(`${rel} mapping ${localToken} uses unknown local_category: ${localCategory}`);
    }
    if (!/^K-[A-Z]+-\d{3}[a-z]?$/u.test(sourceRule) || !kernelRuleSet.has(sourceRule)) {
      fail(`${rel} mapping ${localToken} has invalid source_rule: ${sourceRule || '<empty>'}`);
    }
    mappedLocalTokens.add(localToken);
  }

  for (const token of localTokens) {
    if (!mappedLocalTokens.has(token)) {
      fail(`${rel} local token missing mapping: ${token}`);
    }
  }

  for (const entry of canonicalOnly) {
    const canonicalToken = String(entry?.canonical_token || '').trim();
    if (!canonicalToken || !canonicalTokens.has(canonicalToken)) {
      fail(`${rel} canonical_only references unknown canonical_token: ${canonicalToken || '<empty>'}`);
    }
  }
}

function checkOrphanRules(kernelRuleSet) {
  const files = [...new Set([
    ...runtimeMarkdownFiles,
    ...kernelFiles.filter((rel) => rel.endsWith('.yaml')),
    ...domainFiles,
  ])];
  const refCounts = new Map();
  for (const rel of files) {
    if (!fs.existsSync(path.join(cwd, rel))) continue;
    const content = read(rel);
    for (const ruleId of collectReferencedRuntimeRuleIds(content, kernelRuleSet)) {
      refCounts.set(ruleId, (refCounts.get(ruleId) || 0) + 1);
    }
  }

  const orphans = [...kernelRuleSet].filter((ruleId) => (refCounts.get(ruleId) || 0) <= 1);
  if (orphans.length > 0) {
    fail(`runtime orphan kernel rules detected: ${orphans.join(', ')}`);
  }
}

function collectReferencedRuntimeRuleIds(content, kernelRuleSet) {
  const refs = new Set();

  for (const match of content.matchAll(/\bK-[A-Z]+-\d{3}[a-z]?\b/g)) {
    if (kernelRuleSet.has(match[0])) {
      refs.add(match[0]);
    }
  }

  for (const match of content.matchAll(/\b(K-[A-Z]+)-\*/g)) {
    const prefix = `${match[1]}-`;
    for (const ruleId of kernelRuleSet) {
      if (ruleId.startsWith(prefix)) {
        refs.add(ruleId);
      }
    }
  }

  for (const match of content.matchAll(/\b(K-[A-Z]+)-(\d{3})[~–-](\d{3})\b/g)) {
    const prefix = `${match[1]}-`;
    const start = Number.parseInt(match[2], 10);
    const end = Number.parseInt(match[3], 10);
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    const lower = Math.min(start, end);
    const upper = Math.max(start, end);
    for (const ruleId of kernelRuleSet) {
      if (!ruleId.startsWith(prefix)) continue;
      const suffix = ruleId.slice(prefix.length);
      const numeric = Number.parseInt(suffix.slice(0, 3), 10);
      if (!Number.isNaN(numeric) && numeric >= lower && numeric <= upper) {
        refs.add(ruleId);
      }
    }
  }

  return refs;
}

function checkNoLocalRuleIds(content, rel) {
  const localRuleIdPattern = /\b(?<![KSDPRF]-)(?:[A-Z]{2,12}-){1,2}\d{3}[a-z]?\b/g;
  const allowed = new Set(['HTTP-401', 'HTTP-403', 'HTTP-404', 'HTTP-429', 'HTTP-500', 'HTTP-501']);
  for (const match of content.matchAll(localRuleIdPattern)) {
    const token = match[0];
    if (allowed.has(token)) continue;
    fail(`${rel} must not define local rule ID token: ${token}`);
  }
}

function checkNoRuleDefinitionHeadings(content, rel) {
  const bannedHeadingPattern = /^##\s+.*(?:领域不变量|验收门(?:禁)?|变更规则|变更策略|Domain Invariants|Acceptance Gate|Acceptance Gates|Change Rules|Change Policy)\b/gmu;
  let match;
  while ((match = bannedHeadingPattern.exec(content)) !== null) {
    fail(`${rel} contains rule-definition style heading not allowed for thin domain docs: ${match[0]}`);
  }
}

function checkRuleEvidence(kernelRuleSet) {
  const table = readYaml('spec/runtime/kernel/tables/rule-evidence.yaml');
  if (!table) { fail('rule-evidence.yaml: failed to parse'); return; }

  const catalog = table.evidence_catalog || {};
  const catalogKeys = new Set(Object.keys(catalog));
  const rules = Array.isArray(table.rules) ? table.rules : [];

  if (rules.length === 0) {
    fail('rule-evidence.yaml: rules list is empty');
    return;
  }

  const evidenceRuleIds = new Set();
  for (const entry of rules) {
    const rid = String(entry?.rule_id || '').trim();
    if (!rid) { fail('rule-evidence.yaml: entry missing rule_id'); continue; }
    if (!/^K-[A-Z]+-\d{3}[a-z]?$/u.test(rid)) {
      fail(`rule-evidence.yaml: invalid rule_id format: ${rid}`);
    }
    if (evidenceRuleIds.has(rid)) {
      fail(`rule-evidence.yaml: duplicate rule_id: ${rid}`);
    }
    evidenceRuleIds.add(rid);

    if (!kernelRuleSet.has(rid)) {
      fail(`rule-evidence.yaml: rule_id not found in kernel: ${rid}`);
    }

    const status = String(entry?.status || '').trim();
    if (!['covered', 'na', 'deferred'].includes(status)) {
      fail(`rule-evidence.yaml ${rid}: invalid status: ${status}`);
    }

    const refs = Array.isArray(entry?.evidence_refs) ? entry.evidence_refs : [];
    if (status === 'covered' && refs.length === 0) {
      fail(`rule-evidence.yaml ${rid}: covered rule must have at least one evidence_ref`);
    }
    for (const ref of refs) {
      if (!catalogKeys.has(String(ref))) {
        fail(`rule-evidence.yaml ${rid}: unknown evidence_ref: ${ref}`);
      }
    }
  }

  // Every kernel rule must appear in rule-evidence
  for (const kid of kernelRuleSet) {
    if (!evidenceRuleIds.has(kid)) {
      fail(`rule-evidence.yaml: missing coverage for kernel rule: ${kid}`);
    }
  }
}

function loadReasonCodeSet() {
  const reasonTable = readYaml('spec/runtime/kernel/tables/reason-codes.yaml');
  return new Set(
    (Array.isArray(reasonTable?.codes) ? reasonTable.codes : [])
      .map((item) => String(item?.name || '').trim())
      .filter(Boolean),
  );
}

function loadWorkflowNodeTypeSet() {
  const workflowTable = readYaml('spec/runtime/kernel/tables/workflow-node-types.yaml');
  return new Set(
    (Array.isArray(workflowTable?.node_types) ? workflowTable.node_types : [])
      .map((item) => String(item?.type || '').trim())
      .filter(Boolean),
  );
}

function normalizeProviderName(value) {
  return String(value || '').trim().toLowerCase();
}

function isSpecDocFile(file) {
  return file.endsWith('.md') || file.endsWith('.yaml');
}

function listDomainMarkdownFiles(domainDirRel) {
  const domainDir = path.join(cwd, domainDirRel);
  if (!fs.existsSync(domainDir)) return [];
  return fs.readdirSync(domainDir)
    .filter((name) => name.endsWith('.md'))
    .filter((name) => name !== 'index.md')
    .map((name) => path.posix.join(domainDirRel, name))
    .sort((a, b) => a.localeCompare(b));
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
