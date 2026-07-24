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
  `${kernelRoot}/testing-contract.md`,
  `${kernelRoot}/incubation-release-contract.md`,
  `${kernelRoot}/local-persistence-boundary-contract.md`,
];

const tableFiles = [
  `${tablesRoot}/authority-owner-matrix.yaml`,
  `${tablesRoot}/product-state-machine.yaml`,
  `${tablesRoot}/storybook-trace.yaml`,
  `${tablesRoot}/permission-posture.yaml`,
  `${tablesRoot}/capability-posture.yaml`,
  `${tablesRoot}/handoff-action-registry.yaml`,
  `${tablesRoot}/config-consumption-surface.yaml`,
  `${tablesRoot}/sdk-kit-consumption-surface.yaml`,
  `${tablesRoot}/agent-conversation-anchor-surface.yaml`,
  `${tablesRoot}/conversation-artifact-projection.yaml`,
  `${tablesRoot}/local-persistence-boundary.yaml`,
  `${tablesRoot}/main-ui-vocabulary.yaml`,
  `${tablesRoot}/diagnostics-surface-registry.yaml`,
  `${tablesRoot}/acceptance-gates.yaml`,
  `${tablesRoot}/implementation-acceptance-matrix.yaml`,
  `${tablesRoot}/desktop-agent-chat-hardcut-checkpoint.yaml`,
  // S6 domain-1 removed input: rule-evidence registry family.
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

function checkPermissionPosture() {
  const rel = `${tablesRoot}/permission-posture.yaml`;
  const parsed = readYaml(rel);
  const requirements = parsed?.manifest_permission_requirements;
  if (requirements?.source !== 'apps/zhiyu/nimi.app.yaml#permissions'
    || requirements?.reserved_or_unknown_id !== 'reject_before_project_approval'
    || requirements?.creates_permission_decision !== false
    || !Array.isArray(requirements?.current_values)
    || requirements.current_values.length !== 0
    || !Array.isArray(requirements?.admitted_public_permission_ids)
    || requirements.admitted_public_permission_ids.length !== 0) {
    fail(`${rel} manifest_permission_requirements must preserve the current empty admitted set`);
  }
  const classifications = parsed?.authority_classifications || {};
  for (const [field, authorityClass] of [
    ['account_session_posture', 'base_entitlement'],
    ['app_private_storage', 'base_entitlement'],
    ['ai_metering', 'base_entitlement'],
    ['ai_route_profile_consumption', 'base_entitlement'],
    ['app_sqlite_media_settings_routes_cache_and_exact_native_commands', 'app_owned_authority'],
    ['microphone_and_external_filesystem', 'os_right'],
  ]) {
    if (classifications?.[field]?.authority_class !== authorityClass) {
      fail(`${rel} authority_classifications.${field} must be ${authorityClass}`);
    }
  }
  const productAuthority = parsed?.runtime_agent_product_authority;
  if (productAuthority?.current_local_development_positive_carrier !== 'not_admitted'
    || productAuthority?.current_posture !== 'fail_closed') {
    fail(`${rel} Runtime Agent product authority must fail closed without an attested first-party carrier`);
  }
  expectSetContains(rel, productAuthority?.forbidden_positive_sources, [
    'display_app_id',
    'mutable_manifest',
    'local_project_approval',
    'account_session',
    'public_permission_scope',
  ], 'runtime_agent_product_authority.forbidden_positive_sources');
}

function checkCapabilityPosture() {
  const rel = `${tablesRoot}/capability-posture.yaml`;
  const parsed = readYaml(rel);
  const capabilities = parsed?.capabilities || {};
  for (const field of [
    'conversation',
    'ai_model_config',
    'avatar_config_launch',
    'memory_projection',
    'revisit_continuity_projection',
    'relationship_state_projection',
    'voice',
    'runtime_image_artifact_display',
  ]) {
    if (capabilities?.[field]?.posture !== 'product_contract_admitted_carrier_pending'
      || capabilities?.[field]?.current_local_development_carrier !== 'fail_closed_not_admitted') {
      fail(`${rel} ${field} must expose the product-contract/carrier-pending split`);
    }
  }
  if (capabilities?.proactive_notification?.posture !== 'deferred_v1_out_of_scope') {
    fail(`${rel} proactive_notification posture must be deferred_v1_out_of_scope`);
  }
  if (capabilities?.image_creation?.posture !== 'removed_from_zhiyu_v1') {
    fail(`${rel} image_creation posture must be removed_from_zhiyu_v1`);
  }
}

function checkTestTopologyBinding() {
  const rel = `${kernelRoot}/testing-contract.md`;
  // S6 domain-1 removed input: platform test-governance and Zhiyu quarantine policies.
  requireIncludes(rel, 'pnpm check:test-inventory', 'executable topology gate');
}

function checkAcceptanceGates() {
  const rel = `${tablesRoot}/acceptance-gates.yaml`;
  const parsed = readYaml(rel);
  const requiredGates = [
    'spec_consistency',
    'spec_negative_fixture',
    'docs_drift',
    'acceptance_matrix',
    'first_party_carrier_consumption',
    'sdk_kit_turn_consumption',
    'bounded_context_projection',
    'no_duplicate_turn_reducer',
    'config_boundary',
    'no_direct_ai_consumption',
    'artifact_boundary',
    'local_persistence_boundary',
    'test_topology',
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
checkPermissionPosture();
checkCapabilityPosture();
checkTestTopologyBinding();
checkAcceptanceGates();
checkAdmissionAndGovernance();

if (failed) {
  process.exit(1);
}

console.log('zhiyu-spec-kernel-consistency: OK');
