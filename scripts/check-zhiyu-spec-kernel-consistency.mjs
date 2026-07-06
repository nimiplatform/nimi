#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const cwd = path.resolve(scriptDir, '..');
const zhiyuRoot = argValue('--zhiyu-root') || '.nimi/spec/zhiyu';
const kernelRoot = `${zhiyuRoot}/kernel`;
const tablesRoot = `${kernelRoot}/tables`;
const retiredZhiyuSpecRoot = 'apps/zhiyu/spec';

const contractFiles = [
  `${kernelRoot}/product-authority-contract.md`,
  `${kernelRoot}/authority-boundary-contract.md`,
  `${kernelRoot}/local-partner-center-state-contract.md`,
  `${kernelRoot}/partner-selection-handoff-contract.md`,
  `${kernelRoot}/conversation-surface-contract.md`,
  `${kernelRoot}/configuration-surface-contract.md`,
  `${kernelRoot}/memory-state-projection-contract.md`,
  `${kernelRoot}/avatar-voice-surface-contract.md`,
  `${kernelRoot}/creation-activity-contract.md`,
  `${kernelRoot}/main-ui-copy-contract.md`,
  `${kernelRoot}/diagnostics-dev-mode-contract.md`,
  `${kernelRoot}/testing-and-quarantine-contract.md`,
  `${kernelRoot}/incubation-release-contract.md`,
  `${kernelRoot}/local-persistence-boundary-contract.md`,
];

const tableFiles = [
  `${tablesRoot}/authority-owner-matrix.yaml`,
  `${tablesRoot}/product-state-machine.yaml`,
  `${tablesRoot}/storybook-trace.yaml`,
  `${tablesRoot}/registry-scope-posture.yaml`,
  `${tablesRoot}/capability-posture.yaml`,
  `${tablesRoot}/handoff-action-registry.yaml`,
  `${tablesRoot}/config-consumption-surface.yaml`,
  `${tablesRoot}/sdk-kit-consumption-surface.yaml`,
  `${tablesRoot}/agent-conversation-anchor-surface.yaml`,
  `${tablesRoot}/conversation-artifact-projection.yaml`,
  `${tablesRoot}/local-persistence-boundary.yaml`,
  `${tablesRoot}/test-quarantine-policy.yaml`,
  `${tablesRoot}/main-ui-vocabulary.yaml`,
  `${tablesRoot}/diagnostics-surface-registry.yaml`,
  `${tablesRoot}/acceptance-gates.yaml`,
  `${tablesRoot}/implementation-acceptance-matrix.yaml`,
  `${tablesRoot}/desktop-agent-chat-hardcut-checkpoint.yaml`,
  `${tablesRoot}/rule-evidence.yaml`,
  `${tablesRoot}/rule-evidence.catalog.yaml`,
  `${tablesRoot}/rule-evidence.rules-core.yaml`,
];

const requiredFiles = [
  `${zhiyuRoot}/index.md`,
  `${kernelRoot}/index.md`,
  ...contractFiles,
  ...tableFiles,
];

const rulePattern = /\bZ-(?:PROD|AUTH|STATE|PARTNER|CHAT|CONFIG|MEM|AV|ACT|COPY|DIAG|GATE|REL|PERSIST)-\d{3}\b/gu;
let failed = false;

function fail(message) {
  failed = true;
  console.error(`ERROR: ${message}`);
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : null;
}

function abs(rel) {
  if (path.isAbsolute(rel)) return rel;
  return path.join(cwd, rel);
}

function exists(rel) {
  return fs.existsSync(abs(rel));
}

function read(rel) {
  return fs.readFileSync(abs(rel), 'utf8');
}

function readYaml(rel) {
  try {
    return YAML.parse(read(rel));
  } catch (error) {
    fail(`${rel} must parse as YAML: ${error.message}`);
    return null;
  }
}

function requireIncludes(rel, needle, label = needle) {
  if (!exists(rel)) return;
  if (!read(rel).includes(needle)) {
    fail(`${rel} must include ${label}`);
  }
}

function collectRuleDefinitions() {
  const definitions = new Map();
  const headingPattern = /^##\s+(Z-(?:PROD|AUTH|STATE|PARTNER|CHAT|CONFIG|MEM|AV|ACT|COPY|DIAG|GATE|REL|PERSIST)-\d{3})\b/gmu;

  for (const rel of contractFiles) {
    if (!exists(rel)) continue;
    const content = read(rel);
    let count = 0;
    for (const match of content.matchAll(headingPattern)) {
      count += 1;
      const ruleID = match[1];
      if (definitions.has(ruleID)) {
        fail(`duplicate Zhiyu rule definition: ${ruleID} in ${rel} and ${definitions.get(ruleID)}`);
        continue;
      }
      definitions.set(ruleID, rel);
    }
    if (count === 0) {
      fail(`${rel} must define at least one Zhiyu rule heading`);
    }
  }

  return definitions;
}

function checkRuleReferences(definitions) {
  for (const rel of requiredFiles) {
    if (!exists(rel)) continue;
    const content = read(rel);
    for (const match of content.matchAll(rulePattern)) {
      const ruleID = match[0];
      if (!definitions.has(ruleID)) {
        fail(`${rel} references undefined Zhiyu rule ${ruleID}`);
      }
    }
  }
}

function checkTableEnvelope(rel, parsed) {
  if (!parsed || typeof parsed !== 'object') return;
  if (parsed.version !== 1) {
    fail(`${rel} must declare version: 1`);
  }
  if (!String(parsed.table_family || '').trim()) {
    fail(`${rel} must declare table_family`);
  }
  if (parsed.owner !== 'zhiyu') {
    fail(`${rel} must declare owner: zhiyu`);
  }
}

function expectSetContains(rel, values, requiredValues, label) {
  const set = new Set((Array.isArray(values) ? values : []).map((value) => String(value)));
  for (const value of requiredValues) {
    if (!set.has(value)) {
      fail(`${rel} ${label} must include ${value}`);
    }
  }
}

function rowsOfKind(parsed, kind) {
  return (Array.isArray(parsed?.rows) ? parsed.rows : []).filter((row) => row?.kind === kind);
}

function catalogEntry(parsed, id) {
  return (Array.isArray(parsed?.entries) ? parsed.entries : []).find((row) => row?.id === id);
}

function checkConfigConsumption() {
  const rel = `${tablesRoot}/config-consumption-surface.yaml`;
  const parsed = readYaml(rel);
  const surfaces = (parsed?.rows || []).map((row) => row?.surface);
  expectSetContains(rel, surfaces, [
    'runtime_ai_model_config',
    'live2d_vrm_resource_import',
    'live2d_vrm_selection',
    'avatar_launch',
  ], 'entries.surface');
}

function checkSdkKitConsumption() {
  const rel = `${tablesRoot}/sdk-kit-consumption-surface.yaml`;
  const parsed = readYaml(rel);
  const requiredSymbols = rowsOfKind(parsed, 'required_surface').map((row) => row?.symbol);
  const forbiddenSymbols = rowsOfKind(parsed, 'forbidden_surface').map((row) => row?.symbol);
  expectSetContains(rel, requiredSymbols, [
    'createNimiRuntimeAgentClient',
    'runNimiRuntimeAgentTurn',
    'createNimiRuntimeAgentTurnsModule',
    'streamRuntimeAgentTurnRunnerPartsAsConversationEvents',
    'reduceRuntimeAgentConversationProjectionEvent',
  ], 'rows[kind=required_surface].symbol');
  expectSetContains(rel, forbiddenSymbols, [
    'useAppAiChatSession',
    'createAppAiChatComposerAdapter',
    'streamNimiTextResponse',
    'runNimiTextGenerate',
    'sendAppMessage_to_runtime_agent_raw',
    'client.writeMemory',
    'renderVoice',
  ], 'rows[kind=forbidden_surface].symbol');
}

function checkRegistryScopePosture() {
  const rel = `${tablesRoot}/registry-scope-posture.yaml`;
  const parsed = readYaml(rel);
  const scopeNames = Object.keys(parsed?.scopes || {});
  expectSetContains(rel, scopeNames, [
    'account.session.read',
    'agent.identity.project',
    'ai.spend.meter',
    'ai_profile.selection.consume',
    'memory.read.bounded',
    'memory.write.admitted',
    'notification.subscribe',
    'audit.read.scoped',
  ], 'scopes');
  expectSetContains(rel, parsed?.runtime_turn_authority?.required_scopes, [
    'runtime.agent.turn.read',
    'runtime.agent.turn.write',
  ], 'runtime_turn_authority.required_scopes');
  if (parsed?.runtime_turn_authority?.source !== 'runtime_scoped_binding') {
    fail(`${rel} runtime_turn_authority.source must be runtime_scoped_binding`);
  }
}

function checkCapabilityPosture() {
  const rel = `${tablesRoot}/capability-posture.yaml`;
  const parsed = readYaml(rel);
  const capabilities = parsed?.capabilities || {};
  if (capabilities?.conversation?.posture !== 'v1_admitted_via_runtime_agent_turn') {
    fail(`${rel} conversation posture must be v1_admitted_via_runtime_agent_turn`);
  }
  if (capabilities?.ai_model_config?.posture !== 'v1_required_operation_surface') {
    fail(`${rel} ai_model_config posture must be v1_required_operation_surface`);
  }
  if (capabilities?.avatar_config_launch?.posture !== 'v1_required_operation_surface_launch_only_carrier') {
    fail(`${rel} avatar_config_launch posture must be v1_required_operation_surface_launch_only_carrier`);
  }
  if (capabilities?.memory_projection?.posture !== 'v1_read_only_projection') {
    fail(`${rel} memory_projection posture must be v1_read_only_projection`);
  }
  if (capabilities?.proactive_notification?.posture !== 'deferred_v1_out_of_scope') {
    fail(`${rel} proactive_notification posture must be deferred_v1_out_of_scope`);
  }
  if (capabilities?.voice?.posture !== 'deferred_v1_out_of_scope') {
    fail(`${rel} voice posture must be deferred_v1_out_of_scope`);
  }
  if (capabilities?.image_creation?.posture !== 'removed_from_zhiyu_v1') {
    fail(`${rel} image_creation posture must be removed_from_zhiyu_v1`);
  }
  if (capabilities?.runtime_image_artifact_display?.posture !== 'v1_display_projection_only') {
    fail(`${rel} runtime_image_artifact_display posture must be v1_display_projection_only`);
  }
}

function checkTestQuarantine() {
  const rel = `${tablesRoot}/test-quarantine-policy.yaml`;
  const parsed = readYaml(rel);
  const defaults = catalogEntry(parsed, 'default_status')?.semantics || {};
  for (const key of ['apps/zhiyu/test', 'check:zhiyu-bootstrap', 'release_evidence']) {
    if (defaults[key] !== 'non_authoritative_until_inventory') {
      fail(`${rel} entries[id=default_status].semantics.${key} must be non_authoritative_until_inventory`);
    }
  }
  if (catalogEntry(parsed, 'classification')) {
    fail(`${rel} must not define a local classification vocabulary`);
  }
  const vocabularyRef = catalogEntry(parsed, 'classification_vocabulary_ref')?.semantics || {};
  if (vocabularyRef.source_policy !== '.nimi/spec/platform/kernel/tables/test-governance-policy.yaml') {
    fail(`${rel} entries[id=classification_vocabulary_ref].semantics.source_policy must reference the platform test-governance policy`);
  }
  if (vocabularyRef.source_catalog_id !== 'platform_test_governance_policy') {
    fail(`${rel} entries[id=classification_vocabulary_ref].semantics.source_catalog_id must be platform_test_governance_policy`);
  }
  if (vocabularyRef.source_entry !== 'classification_vocabulary') {
    fail(`${rel} entries[id=classification_vocabulary_ref].semantics.source_entry must be classification_vocabulary`);
  }
  if (vocabularyRef.source_rule !== 'P-TEST-002') {
    fail(`${rel} entries[id=classification_vocabulary_ref].semantics.source_rule must be P-TEST-002`);
  }
  if (vocabularyRef.inventory_support_input !== 'config/zhiyu-test-inventory.yaml') {
    fail(`${rel} entries[id=classification_vocabulary_ref].semantics.inventory_support_input must be config/zhiyu-test-inventory.yaml`);
  }
  if (vocabularyRef.local_classification_values !== 'forbidden') {
    fail(`${rel} entries[id=classification_vocabulary_ref].semantics.local_classification_values must be forbidden`);
  }
}

function checkAcceptanceGates() {
  const rel = `${tablesRoot}/acceptance-gates.yaml`;
  const parsed = readYaml(rel);
  const requiredGates = [
    'spec_consistency',
    'spec_negative_fixture',
    'docs_drift',
    'acceptance_matrix',
    'binding_only_consumption',
    'sdk_kit_turn_consumption',
    'no_duplicate_turn_reducer',
    'config_boundary',
    'no_direct_ai_consumption',
    'artifact_boundary',
    'local_persistence_boundary',
    'test_quarantine',
  ];
  const gates = new Set();
  for (const row of parsed?.gates || []) {
    const gate = String(row?.id || '').trim();
    if (!gate) {
      fail(`${rel} gates row must declare id`);
      continue;
    }
    if (gates.has(gate)) {
      fail(`${rel} gates duplicate id ${gate}`);
    }
    gates.add(gate);
  }
  expectSetContains(rel, [...gates], requiredGates, 'gates.id');
  for (const gate of gates) {
    if (!requiredGates.includes(gate)) {
      fail(`${rel} gates includes unexpected id ${gate}`);
    }
  }
}

function checkAdmissionAndGovernance() {
  requireIncludes('.nimi/spec/INDEX.md', '- `zhiyu`', 'Zhiyu active product domain entry');
  requireIncludes('.nimi/contracts/domain-admission.schema.yaml', 'domain_id: zhiyu', 'Zhiyu domain admission');
  requireIncludes('.nimi/contracts/domain-admission.schema.yaml', 'zhiyu_authority_reset_zs1', 'Zhiyu admission batch id');
  requireIncludes('.nimi/config/governance.yaml', 'zhiyu:', 'Zhiyu governance scope');
  requireIncludes('package.json', 'check:zhiyu-spec-consistency', 'Zhiyu package check script');
  checkPackageGateScripts();
}

function checkPackageGateScripts() {
  const packageRel = 'package.json';
  if (!exists(packageRel)) return;
  let packageJson;
  try {
    packageJson = JSON.parse(read(packageRel));
  } catch (error) {
    fail(`${packageRel} must parse as JSON: ${error.message}`);
    return;
  }
  const scripts = packageJson?.scripts && typeof packageJson.scripts === 'object'
    ? packageJson.scripts
    : {};
  const gates = readYaml(`${tablesRoot}/acceptance-gates.yaml`)?.gates || [];
  for (const gate of Array.isArray(gates) ? gates : []) {
    const command = String(gate?.command || '').trim();
    if (!command.startsWith('check:')) continue;
    if (!Object.prototype.hasOwnProperty.call(scripts, command)) {
      fail(`${packageRel} must define package script for Zhiyu gate command ${command}`);
    }
  }
}

for (const rel of [zhiyuRoot, kernelRoot, tablesRoot]) {
  if (!exists(rel) || !fs.statSync(abs(rel)).isDirectory()) {
    fail(`missing Zhiyu spec directory: ${rel}`);
  }
}

if (exists(retiredZhiyuSpecRoot)) {
  fail(`${retiredZhiyuSpecRoot} must not exist; Zhiyu authority lives under .nimi/spec/zhiyu`);
}

for (const rel of requiredFiles) {
  if (!exists(rel)) {
    fail(`missing Zhiyu spec file: ${rel}`);
  }
}

const definitions = collectRuleDefinitions();
if (definitions.size === 0) {
  fail('Zhiyu kernel defines no rules');
}
checkRuleReferences(definitions);

for (const rel of tableFiles) {
  if (!exists(rel)) continue;
  checkTableEnvelope(rel, readYaml(rel));
}

checkConfigConsumption();
checkSdkKitConsumption();
checkRegistryScopePosture();
checkCapabilityPosture();
checkTestQuarantine();
checkAcceptanceGates();
checkAdmissionAndGovernance();

if (failed) {
  process.exit(1);
}

console.log('zhiyu-spec-kernel-consistency: OK');
