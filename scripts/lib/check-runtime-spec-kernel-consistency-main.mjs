#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { createCatalogChecks } from './runtime-spec-catalog-checks.mjs';
import { checkConfigOverrideTraceability } from './runtime-config-override-traceability.mjs';
import { checkRpcMigrationMapCoverage as checkRpcMigrationMapCoverageImpl } from './runtime-spec-rpc-migration-checks.mjs';
import { readYamlWithFragments } from './read-yaml-with-fragments.mjs';
import {
  collectReferencedRuntimeRuleIds,
  createRuntimeSpecTraceabilityChecks,
} from './runtime-spec-traceability-checks.mjs';

const cwd = process.cwd();
const runtimeRoot = path.join(cwd, '.nimi/spec/runtime');
const sdkRoot = path.join(cwd, '.nimi/spec/sdks');
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

const kernelFiles = listRuntimeKernelFiles();

const domainFiles = listDomainMarkdownFiles('.nimi/spec/runtime');

const allRuntimeSpecs = walk(runtimeRoot).filter(isSpecDocFile);
const runtimeMarkdownFiles = allRuntimeSpecs
  .filter((p) => p.endsWith('.md') && !p.includes(`${path.sep}generated${path.sep}`))
  .map((p) => path.relative(cwd, p));
const sdkSpecFiles = walk(sdkRoot).filter(isSpecDocFile).map((p) => path.relative(cwd, p));
const runtimeAndSdkSpecFiles = [
  ...allRuntimeSpecs.map((p) => path.relative(cwd, p)),
  ...sdkSpecFiles,
];

const {
  checkCapabilityVocabularyMapping,
  checkOrphanRules,
  checkProviderCatalogSourceTraceability,
  checkReasonCodeSourceTraceability,
  checkRpcMethodsSourceTraceability,
  checkRuleEvidence,
} = createRuntimeSpecTraceabilityChecks({
  cwd,
  domainFiles,
  fail,
  fs,
  kernelFiles,
  path,
  read,
  readYaml,
  runtimeMarkdownFiles,
});

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
  if (!content.includes('Normative Imports: `.nimi/spec/runtime/kernel/*`')) {
    fail(`${rel} must declare kernel imports`);
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
checkReasonCodeUniqueness();
checkBannedExternalRpcNames();
checkStreamingContractSurfaceCoverage();
checkProviderTableParity();
checkSourceProviderCoverage();
checkModelCatalogTables();
checkTtsProviderCapabilityMatrix(kernelRuleDefinitions);
checkRuntimeCatalogLoaderIsolation();
checkConnectorRpcFieldRulesCoverage();
checkStateTransitionCoverage(kernelRuleDefinitions);
checkDomainProviderTableAnchors();
checkLocalEngineCatalogImplementationParity();
checkConnectorRpcRulesAgainstRpcSurface();
checkReasonCodeReferencesResolvable();
checkProviderReferencesResolvable();
checkRuleIdReferencesResolvable(kernelRuleDefinitions);
checkNoKernelRuleDefinitionsInImplementationDocs();
checkMetadataKeyContract();
checkMetadataKeyCrossReferences();
checkKeySourceTruthTable();
checkErrorMappingMatrix();
checkRpcMigrationMapCoverageImpl({ fail, fs, protoRoot, readYaml, walk });
checkA2AFutureSeamNegativeGates();
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
checkLocalAppKernelTables();

if (failed) process.exit(1);
console.log('runtime-spec-kernel-consistency: OK');

function checkLocalAppKernelTables() {
  const principalRel = '.nimi/spec/runtime/kernel/tables/local-app-principal-record-schema.yaml';
  const grantRel = '.nimi/spec/runtime/kernel/tables/local-app-grant-binding-schema.yaml';
  const presenceRel = '.nimi/spec/runtime/kernel/tables/local-app-presence-protocol.yaml';
  const principalDoc = readYaml(principalRel) || {};
  const grantDoc = readYaml(grantRel) || {};
  const presenceDoc = readYaml(presenceRel) || {};

  if (String(principalDoc?.local_os_user_anchor?.windows_source || '').trim() !== 'verified_interactive_user_sid') {
    fail(`${principalRel}: Windows local_os_user_anchor must derive from verified_interactive_user_sid`);
  }
  if (String(principalDoc?.principal?.store_identity || '').trim() !== 'local_app_principals') {
    fail(`${principalRel}: principal.store_identity must be local_app_principals`);
  }
  if (String(principalDoc?.record?.store_identity || '').trim() !== 'local_app_records') {
    fail(`${principalRel}: record.store_identity must be local_app_records`);
  }
  const principalFields = new Set((Array.isArray(principalDoc?.principal?.fields) ? principalDoc.principal.fields : []).map(String));
  const recordFields = new Set((Array.isArray(principalDoc?.record?.fields) ? principalDoc.record.fields : []).map(String));
  for (const field of ['local_os_user_anchor', 'local_app_principal_id', 'immutable_lineage_id']) {
    if (!principalFields.has(field)) fail(`${principalRel}: principal fields missing ${field}`);
  }
  for (const field of [
    'local_app_principal_id',
    'provenance_attestation_refs',
    'provenance_revision',
    'execution_profile_ref',
    'host_executable_digest',
    'payload_root_digest',
  ]) {
    if (!recordFields.has(field)) fail(`${principalRel}: record fields missing ${field}`);
  }
  const immutableLineage = Array.isArray(principalDoc?.principal_lineage_binding?.immutable)
    ? principalDoc.principal_lineage_binding.immutable.map(String)
    : [];
  const developmentLineage = Array.isArray(principalDoc?.principal_lineage_binding?.development)
    ? principalDoc.principal_lineage_binding.development.map(String)
    : [];
  if (!immutableLineage.includes('immutable_lineage_id')
    || !developmentLineage.includes('development_authorization_id')
    || !developmentLineage.includes('canonical_project_file_id')
    || principalDoc?.principal_lineage_binding?.exactly_one_branch_required !== true) {
    fail(`${principalRel}: principal lineage must be an exact immutable-or-development union`);
  }
  if (principalDoc?.store_separation?.shared_serialized_record !== 'forbidden'
    || principalDoc?.store_separation?.app_id_positive_key !== 'forbidden') {
    fail(`${principalRel}: principal/record stores must be separate and forbid app-id positive keys`);
  }
  if (principalDoc?.package_seam?.immutable_positive_operations_before_0p !== 'typed_unavailable'
    || principalDoc?.package_seam?.['0p_may_reshape_schema'] !== false) {
    fail(`${principalRel}: immutable package seam must be typed unavailable and non-reshapeable in 0K`);
  }

  if (String(grantDoc?.current_admission?.store_identity || '').trim() !== 'absent_pre_admission'
    || String(grantDoc?.current_admission?.positive_mutation_path || '').trim() !== 'absent') {
    fail(`${grantRel}: current permission persistence and positive mutation path must be absent before admission`);
  }
  const grantKey = Array.isArray(grantDoc?.future_owner_lifecycle?.key) ? grantDoc.future_owner_lifecycle.key.map(String) : [];
  const expectedGrantKey = ['local_os_user_anchor', 'account_id', 'local_app_principal_id', 'permission_id', 'owner_selector_digest'];
  if (grantKey.length !== expectedGrantKey.length || expectedGrantKey.some((field) => !grantKey.includes(field))) {
    fail(`${grantRel}: future owner lifecycle key must bind OS-user anchor, account, principal, public permission, and owner selector`);
  }
  const grantInvariants = new Set((Array.isArray(grantDoc?.future_owner_lifecycle?.invariants) ? grantDoc.future_owner_lifecycle.invariants : []).map(String));
  for (const invariant of [
    'catalog_row_alone_is_not_authority',
    'lifecycle_mutation_does_not_rotate_identity_session',
    'no_app_id_only_positive_lookup',
    'no_base_entitlement_permission_row',
    'no_app_owned_authority_permission_row',
  ]) {
    if (!grantInvariants.has(invariant)) fail(`${grantRel}: future owner lifecycle missing invariant ${invariant}`);
  }

  const outcomeEnum = new Set((Array.isArray(presenceDoc?.outcome_enum) ? presenceDoc.outcome_enum : []).map(String));
  const expectedOutcomes = ['none', 'user_decision_presence', 'operation_presence', 'bounded_lease'];
  if (outcomeEnum.size !== expectedOutcomes.length || expectedOutcomes.some((value) => !outcomeEnum.has(value))) {
    fail(`${presenceRel}: outcome_enum must be the four-mode presence protocol`);
  }
  const expectedPresenceAssignments = {
    developer_project_first_authorization: 'user_decision_presence',
    remembered_project_reactivation: 'user_decision_presence',
    development_capability_expansion: 'user_decision_presence',
    base_entitlement_operation: 'none',
    ordinary_admitted_user_permission_operation: 'none',
    domain_high_impact_operation: 'owner_supplied_operation_presence_or_bounded_lease',
    immutable_import_or_capability_expansion: 'reserved_for_0p',
  };
  for (const [assignment, expected] of Object.entries(expectedPresenceAssignments)) {
    if (presenceDoc?.assignments?.[assignment] !== expected) {
      fail(`${presenceRel}: assignment ${assignment} must be ${expected}`);
    }
  }
}

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
    if (normalizedRel === '.nimi/spec/runtime/kernel/tables/reason-codes.yaml') continue;
    const txt = read(rel);
    if (/AI_[A-Z0-9_]+\s*=\s*\d+/.test(txt)) {
      fail(`ReasonCode numeric assignment must live only in reason-codes.yaml: ${normalizedRel}`);
    }
  }
}

function checkReasonCodeUniqueness() {
  const tablePath = '.nimi/spec/runtime/kernel/tables/reason-codes.yaml';
  const table = readYaml(tablePath);
  const codes = Array.isArray(table?.codes) ? table.codes : [];
  const names = new Map();
  const values = new Map();

  for (const [index, code] of codes.entries()) {
    const name = String(code?.name || '').trim();
    const value = Number(code?.value);
    const label = name || `<entry ${index + 1}>`;
    if (!name) {
      fail(`${tablePath} reason code entry ${index + 1} missing name`);
      continue;
    }
    if (!Number.isInteger(value)) {
      fail(`${tablePath} ${label} has non-integer value`);
      continue;
    }
    if (names.has(name)) {
      const previous = names.get(name);
      fail(`${tablePath} duplicate ReasonCode name ${name}: values ${previous.value} and ${value}`);
    } else {
      names.set(name, { index, value });
    }
    if (values.has(value)) {
      const previous = values.get(value);
      fail(`${tablePath} duplicate ReasonCode value ${value}: names ${previous.name} and ${name}`);
    } else {
      values.set(value, { index, name });
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
  const rpcTable = readYaml('.nimi/spec/runtime/kernel/tables/rpc-methods.yaml');
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

function checkStreamingContractSurfaceCoverage() {
  const streamingContract = read('.nimi/spec/runtime/kernel/streaming-contract.md');
  const protoFiles = walk(protoRoot).filter((file) => file.endsWith('.proto'));
  const streamingMethods = new Set();
  const streamingRpcPattern = /\brpc\s+([A-Za-z0-9_]+)\s*\([^)]*\)\s+returns\s+\(\s*stream\s+[A-Za-z0-9_.]+\s*\)\s*;/gu;
  for (const protoFile of protoFiles) {
    const proto = fs.readFileSync(protoFile, 'utf8');
    for (const match of proto.matchAll(streamingRpcPattern)) {
      streamingMethods.add(match[1]);
    }
  }
  for (const methodName of [...streamingMethods].sort((a, b) => a.localeCompare(b))) {
    if (!streamingContract.includes(`\`${methodName}\``)) {
      fail(`streaming-contract.md must classify server-streaming RPC ${methodName}`);
    }
  }
}

function checkRuntimeDeliveryGateCoverage(kernelRuleSet) {
  const tablePath = '.nimi/spec/runtime/kernel/tables/runtime-delivery-gates.yaml';
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
    ['G0', 'K-GATE-010', ['pnpm check:ai-scenario-hardcut-drift', 'pnpm exec nimicoding validate-spec-governance --profile nimi --scope runtime-consistency', 'pnpm exec nimicoding generate-spec-derived-docs --profile nimi --scope runtime --check']],
    ['G1', 'K-GATE-020', ['pnpm proto:lint', 'pnpm proto:breaking', 'pnpm proto:drift-check']],
    ['G2', 'K-GATE-030', ['pnpm exec nimicoding validate-spec-governance --profile nimi --scope sdks-consistency', 'pnpm exec nimicoding generate-spec-derived-docs --profile nimi --scope sdks --check', 'pnpm check:runtime-bridge-generated-drift']],
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

function checkA2AFutureSeamNegativeGates() {
  const sourceFiles = [
    ...walkA2ANegativeGateTree(path.join(cwd, 'runtime')),
    ...walkA2ANegativeGateTree(path.join(cwd, 'sdks/typescript')),
    ...walkA2ANegativeGateTree(path.join(cwd, 'apps')),
  ]
    .map((abs) => path.relative(cwd, abs))
    .filter(isA2ANegativeGateSourceFile);

  for (const rel of sourceFiles) {
    const content = read(rel);
    if (!containsA2AProductionToken(content)) continue;
    fail(`K-DELEG-128 forbids production A2A/agent2agent code or claims in ${rel}`);
  }

  const runtimeAgentProjectionFiles = sourceFiles.filter((rel) => {
    const normalized = rel.replaceAll('\\', '/');
    return normalized.startsWith('runtime/') || normalized.startsWith('sdks/typescript/') || normalized.startsWith('apps/');
  });
  for (const rel of runtimeAgentProjectionFiles) {
    const content = read(rel);
    if (containsA2AProductionToken(content) && /runtime\.agent\./iu.test(content)) {
      fail(`K-DELEG-128 forbids projecting A2A task payloads into runtime.agent.* in ${rel}`);
    }
  }

  for (const rel of collectDependencyManifests()) {
    if (!fs.existsSync(path.join(cwd, rel))) continue;
    if (rel.endsWith('package.json')) {
      checkPackageManifestForA2ADependencies(rel);
      continue;
    }
    checkTextManifestForA2ADependencies(rel);
  }
}

function isA2ANegativeGateSourceFile(rel) {
  const normalized = rel.replaceAll('\\', '/');
  if (normalized.includes('/node_modules/') ||
    normalized.includes('/dist/') ||
    normalized.includes('/build/') ||
    normalized.includes('/generated/') ||
    normalized.includes('/gen/') ||
    normalized.endsWith('.md') ||
    normalized.endsWith('.yaml') ||
    normalized.endsWith('.yml') ||
    normalized.endsWith('.lock')) {
    return false;
  }
  if (normalized.startsWith('apps/')) {
    if (!normalized.includes('/src/') && !normalized.includes('/src-tauri/')) return false;
  }
  return /\.(?:go|rs|ts|tsx|js|jsx|mjs|cjs|json)$/u.test(normalized);
}

function collectDependencyManifests() {
  const roots = [
    'package.json',
    'runtime/go.mod',
    'runtime/go.sum',
    'sdks/typescript/package.json',
    ...walkA2ANegativeGateTree(path.join(cwd, 'apps'))
      .map((abs) => path.relative(cwd, abs))
      .filter((rel) => rel.replaceAll('\\', '/').endsWith('/package.json')),
  ];
  return [...new Set(roots)];
}

function walkA2ANegativeGateTree(root) {
  if (!fs.existsSync(root)) return [];
  const out = [];
  const stack = [root];
  const seen = new Set();
  const ignoredDirs = new Set([
    '.git',
    '.next',
    '.tmp',
    '.turbo',
    '.vite',
    'build',
    'coverage',
    'dist',
    'gen',
    'generated',
    'node_modules',
    'target',
  ]);
  while (stack.length > 0) {
    const dir = stack.pop();
    let realDir;
    try {
      realDir = fs.realpathSync.native(dir);
    } catch (err) {
      if (err && err.code === 'ENOENT') continue;
      throw err;
    }
    if (seen.has(realDir)) continue;
    seen.add(realDir);
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch (err) {
      if (err && err.code === 'ENOENT') continue;
      throw err;
    }
    for (const name of names) {
      if (ignoredDirs.has(name)) continue;
      const full = path.join(dir, name);
      let st;
      try {
        st = fs.lstatSync(full);
      } catch (err) {
        if (err && err.code === 'ENOENT') continue;
        throw err;
      }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        stack.push(full);
      } else {
        out.push(full);
      }
    }
  }
  return out;
}

function checkPackageManifestForA2ADependencies(rel) {
  let manifest;
  try {
    manifest = JSON.parse(read(rel));
  } catch (err) {
    fail(`${rel} must be valid JSON for K-DELEG-128 dependency scanning: ${err.message}`);
    return;
  }
  const sections = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
  for (const section of sections) {
    const deps = manifest?.[section];
    if (!deps || typeof deps !== 'object' || Array.isArray(deps)) continue;
    for (const depName of Object.keys(deps)) {
      if (isA2ADependencyName(depName)) {
        fail(`K-DELEG-128 forbids production A2A dependency ${depName} in ${rel}#${section}`);
      }
    }
  }
}

function checkTextManifestForA2ADependencies(rel) {
  const lines = read(rel).split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line || line.startsWith('//') || line.startsWith('#')) continue;
    if (containsA2AProductionToken(line)) {
      fail(`K-DELEG-128 forbids A2A dependency token in ${rel}:${i + 1}`);
    }
  }
}

function containsA2AProductionToken(value) {
  const normalized = stripA2ANegativeGateGuardTokens(String(value || ''));
  return /(^|[^A-Za-z0-9])(?:a2a|agent2agent)([^A-Za-z0-9]|$)/iu.test(normalized);
}

function isA2ADependencyName(value) {
  return /(^|[@/._-])(?:a2a|agent2agent)(?:$|[/._-])/iu.test(String(value || ''));
}

function stripA2ANegativeGateGuardTokens(value) {
  return value
    .replace(/(['"`])raw_a2a\1/giu, '')
    // K-AGCORE-065 closed axis identifiers: EXTERNAL_A2A_AGENT (identity
    // source) and PARTICIPATION_EXTERNAL_PROTOCOL_KIND_A2A are admitted
    // spec-table mirrors whose runtime entry stays fail-closed
    // (agent-participation-external-entry-boundaries production claim is
    // MCP-only). Registering the closed enum is not a production A2A
    // implementation or claim, so the identifiers are guard tokens.
    .replace(/[A-Za-z0-9_.]*EXTERNAL_A2A_(?:AGENT|PAYLOAD)[A-Za-z0-9_.]*/giu, '')
    .replace(/[A-Za-z0-9_.]*PROTOCOL_KIND_A2A[A-Za-z0-9_.]*/giu, '')
    // protobuf-ts strips the shared enum prefix, so the closed
    // ParticipationExternalProtocolKind member surfaces as `A2A = <n>` in
    // generated TypeScript; same admitted-spec-mirror reasoning as above.
    .replace(/\bA2A = \d+\b/gu, '');
}

function checkConnectorRpcFieldRulesCoverage() {
  const table = readYaml('.nimi/spec/runtime/kernel/tables/connector-rpc-field-rules.yaml');
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
  const transitions = readYaml('.nimi/spec/runtime/kernel/tables/state-transitions.yaml');
  const jobStates = readYaml('.nimi/spec/runtime/kernel/tables/job-states.yaml');

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
    '.nimi/spec/runtime/kernel/tables/provider-catalog.yaml',
    '.nimi/spec/runtime/kernel/tables/provider-capabilities.yaml',
    '.nimi/spec/runtime/kernel/tables/local-engine-catalog.yaml',
    '.nimi/spec/runtime/kernel/tables/local-adapter-routing.yaml',
  ];
  for (const rel of requirements) {
    if (!fs.existsSync(path.join(cwd, rel))) {
      fail(`missing runtime authority table: ${rel}`);
    }
  }
}

function checkLocalEngineCatalogImplementationParity() {
  const catalog = readYaml('.nimi/spec/runtime/kernel/tables/local-engine-catalog.yaml');
  const catalogEngines = uniqueStrings(
    (Array.isArray(catalog?.engines) ? catalog.engines : [])
      .map((item) => String(item?.engine || '').trim())
      .filter(Boolean),
  );
  const source = read('runtime/internal/localrouting/localrouting.go');
  const match = source.match(/func\s+knownProviders\(\)\s+\[\]string\s*\{\s*return\s+\[\]string\{([^}]*)\}/su);
  if (!match) {
    fail('runtime/internal/localrouting/localrouting.go missing parseable knownProviders() engine list');
    return;
  }
  const implementationEngines = uniqueStrings(
    [...String(match[1] || '').matchAll(/"([^"]+)"/g)]
      .map((item) => String(item[1] || '').trim())
      .filter(Boolean),
  );
  if (catalogEngines.join('\n') !== implementationEngines.join('\n')) {
    fail(`localrouting knownProviders drift from local-engine-catalog.yaml: spec=[${catalogEngines.join(', ')}] implementation=[${implementationEngines.join(', ')}]`);
  }
}

function checkConnectorRpcRulesAgainstRpcSurface() {
  const rpcTable = readYaml('.nimi/spec/runtime/kernel/tables/rpc-methods.yaml');
  const connectorRules = readYaml('.nimi/spec/runtime/kernel/tables/connector-rpc-field-rules.yaml');

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
  const catalog = readYaml('.nimi/spec/runtime/kernel/tables/provider-catalog.yaml');
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
  const table = readYaml('.nimi/spec/runtime/kernel/tables/metadata-keys.yaml');
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
  const table = readYaml('.nimi/spec/runtime/kernel/tables/metadata-keys.yaml');
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
  const table = readYaml('.nimi/spec/runtime/kernel/tables/key-source-truth-table.yaml');
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
  const table = readYaml('.nimi/spec/runtime/kernel/tables/error-mapping-matrix.yaml');
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
    '.nimi/spec/runtime/cli.md': { kernel: '.nimi/spec/runtime/kernel/cli-onboarding-contract.md', prefix: 'K-CLI' },
    '.nimi/spec/runtime/config.md': { kernel: '.nimi/spec/runtime/kernel/config-contract.md', prefix: 'K-CFG' },
    '.nimi/spec/runtime/connector.md': { kernel: '.nimi/spec/runtime/kernel/connector-contract.md', prefix: 'K-CONN' },
    '.nimi/spec/runtime/local-model.md': {
      kernels: [
        '.nimi/spec/runtime/kernel/local-category-capability.md',
        '.nimi/spec/runtime/kernel/local-profile-application-contract.md',
        '.nimi/spec/runtime/kernel/local-catalog-recommendation-contract.md',
        '.nimi/spec/runtime/kernel/local-asset-storage-manifest-contract.md',
      ],
      prefix: 'K-LOCAL',
    },
    '.nimi/spec/runtime/multimodal-delivery-gates.md': { kernel: '.nimi/spec/runtime/kernel/delivery-gates-contract.md', prefix: 'K-GATE' },
    '.nimi/spec/runtime/multimodal-provider.md': { kernel: '.nimi/spec/runtime/kernel/multimodal-provider-contract.md', prefix: 'K-MMPROV' },
    '.nimi/spec/runtime/nimillm.md': { kernel: '.nimi/spec/runtime/kernel/nimillm-contract.md', prefix: 'K-NIMI' },
    '.nimi/spec/runtime/proto-governance.md': { kernel: '.nimi/spec/runtime/kernel/proto-governance-contract.md', prefix: 'K-PROTO' },
  };

  for (const [domainRel, { kernel: kernelRel, kernels: kernelRelsRaw, prefix }] of Object.entries(primaryMap)) {
    const kernelRels = kernelRelsRaw ?? [kernelRel];
    const kernelContent = kernelRels.map((rel) => read(rel)).join('\n');
    const kernelLabel = kernelRels.join(', ');
    const domainContent = read(domainRel);
    const kernelRules = new Set(
      [...kernelContent.matchAll(new RegExp(`^##\\s+(${prefix}-\\d{3}[a-z]?)\\b`, 'gmu'))]
        .map((match) => match[1]),
    );

    if (kernelRules.size === 0) {
      fail(`${kernelLabel} must define at least one ${prefix}-* rule`);
      continue;
    }

    const coveredRules = collectReferencedRuntimeRuleIds(domainContent, kernelRules);
    const coverage = coveredRules.size / kernelRules.size;
    if (coverage < 0.5) {
      fail(`${domainRel} covers only ${coveredRules.size}/${kernelRules.size} (${Math.round(coverage * 100)}%) of ${prefix}-* rules from ${kernelLabel}; minimum 50% required`);
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
    configSchemaPath: '.nimi/spec/runtime/kernel/tables/config-schema.yaml',
    fail,
    read,
    readYaml,
    runtimeMarkdownFiles,
  });
}

function checkProbeTargetProviderCoverage() {
  // Verify every probe target in provider-probe-targets.yaml has a provider type mapping in K-PROV-006
  const probeTargets = readYaml('.nimi/spec/runtime/kernel/tables/provider-probe-targets.yaml');
  const targets = Array.isArray(probeTargets?.targets) ? probeTargets.targets : [];
  const targetNames = targets.map((t) => String(t?.name || '').trim()).filter(Boolean);

  const providerHealthContent = read('.nimi/spec/runtime/kernel/provider-health-contract.md');

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

function loadReasonCodeSet() {
  const reasonTable = readYaml('.nimi/spec/runtime/kernel/tables/reason-codes.yaml');
  return new Set(
    (Array.isArray(reasonTable?.codes) ? reasonTable.codes : [])
      .map((item) => String(item?.name || '').trim())
      .filter(Boolean),
  );
}

function loadWorkflowNodeTypeSet() {
  const workflowTable = readYaml('.nimi/spec/runtime/kernel/tables/workflow-node-types.yaml');
  return new Set(
    (Array.isArray(workflowTable?.node_types) ? workflowTable.node_types : [])
      .map((item) => String(item?.type || '').trim())
      .filter(Boolean),
  );
}

function normalizeProviderName(value) {
  return String(value || '').trim().toLowerCase();
}

function uniqueStrings(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function listRuntimeKernelFiles() {
  return walk(path.join(cwd, '.nimi/spec/runtime/kernel'))
    .filter(isSpecDocFile)
    .map((absPath) => path.relative(cwd, absPath).split(path.sep).join('/'))
    .filter((rel) => !rel.includes('/kernel/generated/'))
    .filter((rel) => !rel.includes('/kernel/companion/'))
    .sort();
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

function walk(dir, seen = new Set()) {
  if (!fs.existsSync(dir)) return [];
  const realDir = fs.realpathSync.native(dir);
  if (seen.has(realDir)) return [];
  seen.add(realDir);
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.lstatSync(full);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) out.push(...walk(full, seen));
    else out.push(full);
  }
  return out;
}
