#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

import YAML from 'yaml';

const root = process.cwd();
const failures = [];

function fail(message) {
  failures.push(message);
}

function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    fail(`${relativePath}: file is missing`);
    return '';
  }
  return fs.readFileSync(absolutePath, 'utf8');
}

function readYaml(relativePath) {
  const source = read(relativePath);
  if (!source) return {};
  try {
    return YAML.parse(source, { uniqueKeys: true });
  } catch (error) {
    fail(`${relativePath}: invalid YAML (${error.message})`);
    return {};
  }
}

function requireText(relativePath, requiredTexts) {
  const source = read(relativePath);
  for (const requiredText of requiredTexts) {
    if (!source.includes(requiredText)) {
      fail(`${relativePath}: missing required authority text ${JSON.stringify(requiredText)}`);
    }
  }
}

function exactSet(actualInput, expectedInput, label) {
  const actual = Array.isArray(actualInput) ? actualInput.map(String) : [];
  const expected = expectedInput.map(String);
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  if (actualSet.size !== actual.length) {
    fail(`${label}: duplicate values are forbidden`);
  }
  const missing = expected.filter((value) => !actualSet.has(value));
  const unexpected = actual.filter((value) => !expectedSet.has(value));
  if (missing.length || unexpected.length) {
    fail(`${label}: missing=[${missing.join(', ')}] unexpected=[${unexpected.join(', ')}]`);
  }
}

function exactValue(actual, expected, label) {
  if (actual !== expected) {
    fail(`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

const contractPath = '.nimi/spec/platform/kernel/nimi-ecosystem-simulator-contract.md';
const contract = read(contractPath);
const ruleIds = [...contract.matchAll(/^## (P-SIM-\d{3})\b/gmu)].map((match) => match[1]);
const expectedRuleIds = Array.from({ length: 24 }, (_, index) => `P-SIM-${String(index + 1).padStart(3, '0')}`);
exactSet(ruleIds, expectedRuleIds, `${contractPath} rule headings`);
if (ruleIds.length !== expectedRuleIds.length) {
  fail(`${contractPath}: expected exactly 24 P-SIM rule headings, received ${ruleIds.length}`);
}

const tableSpecs = [
  ['simulator-authority-boundaries.yaml', 'owner_matrix', 'matrix_id', 'platform_simulator_authority_boundaries', 'P-SIM-001'],
  ['simulator-module-contract.yaml', 'protocol_surface', 'protocol_id', 'platform_simulator_module_contract', 'P-SIM-004'],
  ['simulator-source-policy.yaml', 'protocol_surface', 'protocol_id', 'platform_simulator_selected_source', 'P-SIM-003'],
  ['simulator-state-engine-policy.yaml', 'protocol_surface', 'protocol_id', 'platform_simulator_state_engine', 'P-SIM-010'],
  ['simulator-error-codes.yaml', 'closed_enum', 'enum_id', 'platform_simulator_error_codes', 'P-SIM-019'],
  ['simulator-mandatory-singletons.yaml', 'product_catalog', 'catalog_id', 'platform_simulator_mandatory_singletons', 'P-SIM-008'],
  ['simulator-browser-effects.yaml', 'protocol_surface', 'protocol_id', 'platform_simulator_browser_effects', 'P-SIM-018'],
  ['simulator-listener-families.yaml', 'protocol_surface', 'protocol_id', 'platform_simulator_listener_families', 'P-SIM-017'],
  ['simulator-performance-policy.yaml', 'simulator_performance_policy', 'catalog_id', 'platform_simulator_performance_policy', 'P-SIM-022'],
];
const tables = new Map();
for (const [fileName, family, identityField, identity, sourceRule] of tableSpecs) {
  const relativePath = `.nimi/spec/platform/kernel/tables/${fileName}`;
  const table = readYaml(relativePath);
  tables.set(fileName, table);
  exactValue(table.version, 1, `${relativePath} version`);
  exactValue(table.table_family, family, `${relativePath} table_family`);
  exactValue(table.owner, 'platform', `${relativePath} owner`);
  exactValue(table[identityField], identity, `${relativePath} ${identityField}`);
  exactValue(table.source_rule, sourceRule, `${relativePath} source_rule`);
}

const indexPath = '.nimi/spec/platform/kernel/index.md';
requireText(indexPath, [
  '| `SIM` |',
  '| `P-SIM-*` |',
  '`nimi-ecosystem-simulator-contract.md` | `P-SIM-*`',
  ...tableSpecs.map(([fileName]) => `tables/${fileName}`),
]);

const moduleContract = tables.get('simulator-module-contract.yaml');
exactValue(moduleContract.protocol_versions?.module, 'nimi.simulator.module/v1', 'module protocol version');
exactValue(moduleContract.protocol_versions?.operation, 'nimi.simulator.operation/v1', 'operation protocol version');
exactValue(moduleContract.protocol_versions?.interaction, 'nimi.simulator.interaction/v1', 'interaction protocol version');
exactValue(moduleContract.protocol_versions?.renderer_host, 'nimi.renderer.host/v1', 'renderer host protocol version');
exactValue(moduleContract.manifest?.path, 'nimi.simulator.yaml', 'Simulator Manifest path');
exactSet(moduleContract.surfaces, [
  'manifest',
  'canonical_renderer_factory',
  'renderer_module',
  'adapter',
  'interaction',
  'result',
], 'Simulator module surfaces');
exactSet(moduleContract.canonical_renderer_factory?.forbidden_inputs, [
  'hostKind',
  'isSimulator',
  'shellMode',
  'environment',
  'providerIdentity',
  'rawModuleId',
  'rawInstanceId',
  'rawEpoch',
], 'canonical renderer forbidden inputs');

const sourcePolicy = tables.get('simulator-source-policy.yaml');
exactValue(sourcePolicy.descriptor?.schema, 'nimi.simulator.selected-source/v1', 'selected-source descriptor schema');
exactSet(sourcePolicy.source_location?.kinds, ['workspace', 'external-repository'], 'selected-source location kinds');
exactValue(sourcePolicy.source_digest_v1?.algorithm, 'sha256', 'selected-source digest algorithm');
exactValue(sourcePolicy.resolver?.owner, 'simulator', 'selected-source resolver owner');
exactValue(sourcePolicy.resolved_registry?.generated_only, true, 'selected-module registry generation posture');

const statePolicy = tables.get('simulator-state-engine-policy.yaml');
exactValue(statePolicy.operation_queue?.ordering, 'FIFO_acceptance_sequence', 'State Engine queue ordering');
exactValue(statePolicy.operation_queue?.max_operations_per_drain, 10000, 'State Engine drain limit');
exactValue(statePolicy.transaction?.partial_commit, 'forbidden', 'State Engine partial commit posture');
exactValue(statePolicy.logical_clock?.real_time_affects_state, 'forbidden', 'State Engine wall-clock posture');
exactValue(statePolicy.random?.generator, 'xoshiro256ss-v1', 'State Engine random generator');
exactValue(statePolicy.instance_lifecycle?.watchdog_ms, 5000, 'instance cleanup watchdog');
exactValue(statePolicy.scenario_reset?.only_reset_operation, 'resetScenario', 'scenario reset operation');
exactValue(statePolicy.replay?.canonicalization, 'RFC-8785', 'replay canonicalization');
exactValue(statePolicy.replay?.digest, 'SHA-256', 'replay digest');

const expectedErrorCodes = [
  'SIMULATOR_INVALID_MANIFEST',
  'SIMULATOR_SOURCE_MISMATCH',
  'SIMULATOR_UNSUPPORTED',
  'SIMULATOR_CAPABILITY_DENIED',
  'SIMULATOR_RESOURCE_EXHAUSTED',
  'SIMULATOR_INVALID_PAYLOAD',
  'SIMULATOR_INVALID_LIFECYCLE',
  'SIMULATOR_STALE_EPOCH',
  'SIMULATOR_INSTANCE_DISPOSED',
  'SIMULATOR_INSTANCE_FAILED',
  'SIMULATOR_MODULE_FAILED',
  'SIMULATOR_EFFECT_FORBIDDEN',
  'SIMULATOR_INTEGRITY_FAILURE',
];
const errorCatalog = tables.get('simulator-error-codes.yaml');
exactSet(errorCatalog.values?.map((entry) => entry.value), expectedErrorCodes, 'Simulator error catalog');
exactValue(errorCatalog.sdk_reachability?.raw_simulator_code_in_public_nimi_error, 'forbidden', 'SDK Simulator error leakage');

const singletonCatalog = tables.get('simulator-mandatory-singletons.yaml');
exactSet(singletonCatalog.entries, [
  'react',
  'react-dom',
  'scheduler',
  '@nimiplatform/kit',
  '@nimiplatform/sdk',
  'i18next',
  'react-i18next',
  'react-router-dom',
  '@tanstack/react-query',
  'zustand',
], 'Simulator mandatory singleton catalog');
exactSet(singletonCatalog.packages?.map((entry) => entry.name), singletonCatalog.entries || [], 'Simulator singleton package rows');
exactValue(singletonCatalog.identity_contract?.app_lockfile, 'forbidden', 'selected App lockfile posture');

const effectCatalog = tables.get('simulator-browser-effects.yaml');
exactSet(effectCatalog.surfaces, [
  'effect_classification',
  'owner_and_phase_admission',
  'enforcement_and_proof',
], 'Simulator browser-effect protocol surfaces');
exactSet(effectCatalog.entries?.map((entry) => entry.id), [
  'network_fetch',
  'network_xhr',
  'network_socket',
  'network_event_source',
  'network_beacon',
  'persistent_web_storage',
  'session_web_storage',
  'indexed_database',
  'cache_storage',
  'cookie_storage',
  'origin_private_filesystem',
  'file_picker',
  'service_worker_registration',
  'worker_construction',
  'cross_context_channel',
  'top_level_navigation',
  'clipboard',
  'wall_clock',
  'nondeterministic_random',
  'timer_scheduling',
  'animation_frame',
  'global_listener',
  'global_dom_mutation',
  'overlay_portal',
  'layout_read',
  'layout_observer',
  'integrity_timing',
], 'Simulator browser-effect catalog');
exactValue(effectCatalog.enforcement?.violation_result, 'SIMULATOR_EFFECT_FORBIDDEN', 'browser-effect violation result');
for (const requiredForbidden of ['network_fetch', 'persistent_web_storage', 'worker_construction', 'wall_clock', 'nondeterministic_random']) {
  const row = effectCatalog.entries?.find((entry) => entry.id === requiredForbidden);
  exactValue(row?.classification, 'forbidden', `browser effect ${requiredForbidden} classification`);
}

const listenerCatalog = tables.get('simulator-listener-families.yaml');
exactSet(listenerCatalog.surfaces, [
  'global_listener_family_ownership',
  'subscriber_coordination',
  'lifecycle_cleanup_verification',
], 'Simulator listener protocol surfaces');
exactSet(listenerCatalog.families?.map((entry) => entry.id), [
  'keyboard',
  'pointer_dismissal',
  'focus',
  'route_history',
  'viewport',
  'document_visibility',
  'integrity_error',
], 'Simulator listener-family catalog');
exactValue(listenerCatalog.coordination_contract?.direct_selected_source_global_listener, 'forbidden', 'selected-source listener posture');
exactValue(listenerCatalog.verification?.violation_result, 'SIMULATOR_EFFECT_FORBIDDEN', 'listener violation result');

const performancePolicy = tables.get('simulator-performance-policy.yaml');
exactSet(performancePolicy.invariants?.map((entry) => entry.id), Array.from({ length: 9 }, (_, index) => `performance_invariant_${String(index + 1).padStart(2, '0')}`), 'Simulator performance invariants');
exactSet(performancePolicy.scenarios?.map((entry) => entry.id), Array.from({ length: 10 }, (_, index) => `PERF-S${index}`), 'Simulator performance scenarios');
exactValue(performancePolicy.measurement_contract?.release_numeric_threshold_authority, 'admitted_calibration_artifact', 'performance threshold authority');
exactValue(performancePolicy.measurement_contract?.threshold_before_calibration, 'forbidden', 'uncalibrated threshold posture');

const authorityBoundaries = tables.get('simulator-authority-boundaries.yaml');
exactSet(authorityBoundaries.rows?.map((entry) => entry.id), [
  'simulator-product',
  'platform-architecture',
  'web-release',
  'app-identity-admission',
  'ecosystem',
  'kit',
  'sdk',
  'app-tools',
  'desktop',
  'zhiyu',
  'tester',
  'runtime-realm',
  'app-messaging',
  'release-governance',
  'test-governance',
], 'Simulator authority boundary rows');

const ruleEvidence = readYaml('.nimi/spec/platform/kernel/tables/rule-evidence.rules-simulator.yaml');
exactSet(ruleEvidence.entries, expectedRuleIds, 'Simulator rule-evidence entries');
exactSet(ruleEvidence.rules?.map((entry) => entry.rule_id), expectedRuleIds, 'Simulator rule-evidence rows');
for (const row of ruleEvidence.rules || []) {
  exactValue(row.evidence_requirement, 'structural_required', `${row.rule_id} evidence requirement`);
  exactSet(row.evidence_refs, ['platform_kernel_consistency', 'simulator_authority_gate'], `${row.rule_id} evidence refs`);
  if (!/structural-only/iu.test(String(row.evidence_scope_note || ''))) {
    fail(`${row.rule_id}: structural-only scope note is required`);
  }
}
const ruleEvidenceRoot = readYaml('.nimi/spec/platform/kernel/tables/rule-evidence.yaml');
if (!ruleEvidenceRoot.fragments?.rules?.includes('rule-evidence.rules-simulator.yaml')) {
  fail('rule-evidence.yaml: Simulator rule fragment is not registered');
}
const evidenceCatalog = readYaml('.nimi/spec/platform/kernel/tables/rule-evidence.catalog.yaml');
if (!evidenceCatalog.entries?.includes('simulator_authority_gate')) {
  fail('rule-evidence.catalog.yaml: simulator_authority_gate is not registered');
}
exactValue(evidenceCatalog.simulator_authority_gate?.command, 'pnpm check:simulator-authority', 'Simulator evidence command');

const appSliceAdmissions = readYaml('.nimi/spec/platform/kernel/tables/app-slice-admissions.yaml');
const testerAdmission = appSliceAdmissions.admissions?.find((entry) => entry.app_id === 'tester');
exactValue(testerAdmission?.owner_domain, 'tester', 'Tester app-slice owner');
exactValue(testerAdmission?.admission_posture, 'active', 'Tester app-slice posture');
exactValue(testerAdmission?.authority_root, 'apps/tester/spec', 'Tester app-slice root');
exactSet(testerAdmission?.may_not_override, [
  '.nimi/spec/runtime/**',
  '.nimi/spec/sdks/**',
  '.nimi/spec/realm/**',
  '.nimi/spec/platform/**',
  '.nimi/spec/desktop/**',
  '.nimi/spec/cognition/**',
  '.nimi/spec/avatar/**',
], 'Tester app-slice authority fences');
requireText('apps/tester/spec/index.md', ['P-APP-001..006', 'T-SIM-*']);
requireText('apps/tester/spec/kernel/simulator-integration-contract.md', [
  'T-SIM-001',
  'T-SIM-008',
  'nimi.renderer.host/v1',
  'nimi-app doctor --conformance simulator --json',
]);

const ownerRequirements = new Map([
  ['.nimi/spec/platform/kernel/web-release-contract.md', ['apps/simulator/**', 'not a third Desktop shell mode', 'own Cloudflare static-site configuration']],
  ['.nimi/spec/platform/kernel/kit-contract.md', ['./shell/renderer/host', 'nimi.renderer.host/v1', 'host discriminator']],
  ['.nimi/spec/platform/kernel/nimi-app-scaffolding-contract.md', ['nimi-app doctor --conformance simulator --json', 'canonical renderer factory reachability', 'final resolver']],
  ['.nimi/spec/sdks/kernel/boundary-contract.md', ['@nimiplatform/sdk/testing', 'deterministic in-process harness', 'Simulator State Engine']],
  ['.nimi/spec/sdks/kernel/transport-contract.md', ['not a Runtime transport', '@nimiplatform/sdk/testing']],
  ['.nimi/spec/sdks/kernel/error-projection.md', ['SIMULATOR_*', 'must not synthesize', 'minimum shape']],
  ['.nimi/spec/sdks/kernel/package-governance-contract.md', ['already public `@nimiplatform/sdk/testing` subpath', 'Simulator-specific SDK package']],
  ['.nimi/spec/desktop/kernel/bootstrap-contract.md', ['App-owned canonical renderer', 'same factory', 'Simulator Adapter']],
  ['.nimi/spec/desktop/kernel/ui-shell-contract.md', ["exactly `'desktop' | 'web'`", 'canonical renderer factory', 'forked CSS']],
  ['.nimi/spec/desktop/kernel/state-contract.md', ['createAppStore()', 'fresh factory result per instance', 'No instance may observe another instance']],
  ['.nimi/spec/desktop/kernel/error-boundary-contract.md', ['Simulator never', 'SIMULATOR_*']],
  ['.nimi/spec/desktop/kernel/testing-gates-contract.md', ['two-instance', 'nimi-app doctor --conformance simulator --json']],
  ['.nimi/spec/zhiyu/kernel/product-authority-contract.md', ['canonical renderer factory', 'App-owned Simulator Adapter']],
  ['.nimi/spec/zhiyu/kernel/local-partner-center-state-contract.md', ['deterministic presentation state', 'Zhiyu persistence.']],
  ['.nimi/spec/zhiyu/kernel/authority-boundary-contract.md', ['apps/zhiyu/src/simulator/**', 'same canonical renderer factory', 'success-shaped mock']],
  ['.nimi/spec/zhiyu/kernel/local-persistence-boundary-contract.md', ['Simulator scenario snapshots', 'Simulator replay']],
  ['.nimi/spec/zhiyu/kernel/testing-contract.md', ['canonical factory equality', 'App-tools produces App-source']],
]);
for (const [relativePath, requiredTexts] of ownerRequirements) {
  requireText(relativePath, requiredTexts);
}

const rootPackage = JSON.parse(read('package.json') || '{}');
exactValue(rootPackage.scripts?.['check:simulator-authority'], 'node scripts/check-simulator-authority.mjs', 'root Simulator authority command');

const releaseRegistry = readYaml('.nimi/spec/platform/kernel/tables/release-gate-registry.yaml');
const releaseGate = releaseRegistry.gates?.find((entry) => entry.id === 'gate.spec-governance.simulator-authority');
exactValue(releaseGate?.command, 'pnpm check:simulator-authority', 'Simulator release gate command');
exactSet(releaseGate?.tiers, ['fast', 'release'], 'Simulator release gate tiers');
exactSet(releaseGate?.targets, ['any'], 'Simulator release gate targets');

const auditEvidenceRoots = readYaml('.nimi/spec/platform/kernel/tables/audit-evidence-roots.yaml');
const simulatorEvidenceRoot = auditEvidenceRoots.roots?.find((entry) => entry.id === 'platform-simulator-authority');
exactValue(simulatorEvidenceRoot?.owner_domain, 'platform', 'Simulator audit evidence owner');
exactValue(simulatorEvidenceRoot?.source_rule, 'P-SIM-020', 'Simulator audit evidence source rule');
exactSet(simulatorEvidenceRoot?.evidence_roots, ['scripts/check-simulator-authority.mjs', 'package.json'], 'Simulator structural evidence roots');

if (failures.length > 0) {
  console.error(`Simulator authority check failed with ${failures.length} violation(s):`);
  for (const message of failures) console.error(`- ${message}`);
  process.exit(1);
}

console.log('Simulator authority check passed.');
