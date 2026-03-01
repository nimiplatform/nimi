#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const cwd = process.cwd();
const desktopRoot = path.join(cwd, 'spec/desktop');
const sourceRoot = path.join(cwd, 'apps/desktop/src');

const kernelFiles = [
  'spec/desktop/kernel/index.md',
  'spec/desktop/kernel/bootstrap-contract.md',
  'spec/desktop/kernel/bridge-ipc-contract.md',
  'spec/desktop/kernel/state-contract.md',
  'spec/desktop/kernel/auth-session-contract.md',
  'spec/desktop/kernel/data-sync-contract.md',
  'spec/desktop/kernel/hook-capability-contract.md',
  'spec/desktop/kernel/mod-governance-contract.md',
  'spec/desktop/kernel/llm-adapter-contract.md',
  'spec/desktop/kernel/ui-shell-contract.md',
  'spec/desktop/kernel/error-boundary-contract.md',
  'spec/desktop/kernel/telemetry-contract.md',
  'spec/desktop/kernel/network-contract.md',
  'spec/desktop/kernel/security-contract.md',
  'spec/desktop/kernel/streaming-consumption-contract.md',
  'spec/desktop/kernel/tables/bootstrap-phases.yaml',
  'spec/desktop/kernel/tables/ipc-commands.yaml',
  'spec/desktop/kernel/tables/app-tabs.yaml',
  'spec/desktop/kernel/tables/store-slices.yaml',
  'spec/desktop/kernel/tables/hook-subsystems.yaml',
  'spec/desktop/kernel/tables/hook-capability-allowlists.yaml',
  'spec/desktop/kernel/tables/ui-slots.yaml',
  'spec/desktop/kernel/tables/turn-hook-points.yaml',
  'spec/desktop/kernel/tables/mod-kernel-stages.yaml',
  'spec/desktop/kernel/tables/mod-lifecycle-states.yaml',
  'spec/desktop/kernel/tables/mod-access-modes.yaml',
  'spec/desktop/kernel/tables/feature-flags.yaml',
  'spec/desktop/kernel/tables/data-sync-flows.yaml',
  'spec/desktop/kernel/tables/retry-status-codes.yaml',
  'spec/desktop/kernel/tables/error-codes.yaml',
  'spec/desktop/kernel/tables/log-areas.yaml',
  'spec/desktop/kernel/tables/build-chunks.yaml',
];

const domainFiles = [
  'spec/desktop/chat.md',
  'spec/desktop/contacts.md',
  'spec/desktop/profile.md',
  'spec/desktop/economy.md',
  'spec/desktop/explore.md',
  'spec/desktop/runtime-config.md',
  'spec/desktop/settings.md',
  'spec/desktop/marketplace.md',
  'spec/desktop/mod-workspace.md',
  'spec/desktop/external-agent.md',
  'spec/desktop/local-ai.md',
  'spec/desktop/web-adapter.md',
  'spec/desktop/home.md',
  'spec/desktop/notification.md',
  'spec/desktop/auth.md',
  'spec/desktop/agent-detail.md',
  'spec/desktop/world-detail.md',
  'spec/desktop/legal.md',
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

function fileExists(rel) {
  return fs.existsSync(path.join(cwd, rel));
}

// ── Check 1: File existence ──

for (const rel of kernelFiles) {
  if (!fileExists(rel)) {
    fail(`missing kernel file: ${rel}`);
  }
}

for (const rel of domainFiles) {
  if (!fileExists(rel)) {
    fail(`missing desktop domain file: ${rel}`);
    continue;
  }
  const content = read(rel);
  if (!content.includes('Normative Imports: `spec/desktop/kernel/*`')) {
    fail(`${rel} must declare kernel imports`);
  }
  if (!/\bD-[A-Z]+-\d{3}\b/.test(content)) {
    fail(`${rel} must reference at least one kernel Rule ID`);
  }
}

// ── Check 2: source_rule format validation ──

checkSourceRuleFormats();

// ── Check 3: Rule ID uniqueness ──

const kernelRuleDefinitions = collectKernelRuleDefinitions();

// ── Check 4: UI slots vs source code ──

checkUiSlotsConsistency();

// ── Check 5: Turn hook points vs source code ──

checkTurnHookPointsConsistency();

// ── Check 6: Mod kernel stages vs source code ──

checkModKernelStagesConsistency();

// ── Check 7: Mod lifecycle states vs source code ──

checkModLifecycleStatesConsistency();

// ── Check 8: Mod access modes vs source code ──

checkModAccessModesConsistency();

// ── Check 9: App tabs vs navigation config ──

checkAppTabsConsistency();

// ── Check 10: Retry status codes vs source code ──

checkRetryStatusCodesConsistency();

// ── Check 11: Domain Section 0 imports covered in body ──

checkDomainSection0ImportsCoveredInBody();

// ── Check 12: source_rule referential integrity ──

checkSourceRuleReferentialIntegrity();

// ── Check 13: No kernel rule definitions in domain docs ──

checkNoKernelRuleDefinitionsInDomainDocs();

// ── Check 14: Rule ID references resolvable ──

checkRuleIdReferencesResolvable();

// ── Result ──

if (failed) process.exit(1);
console.log('desktop-spec-kernel-consistency: OK');

// ── Helper Functions ──

function checkSourceRuleFormats() {
  const yamlFiles = kernelFiles.filter((f) => f.endsWith('.yaml'));
  for (const rel of yamlFiles) {
    if (!fileExists(rel)) continue;
    const content = read(rel);
    const sourceRuleMatches = content.match(/source_rule:\s*(.+)/g) || [];
    for (const match of sourceRuleMatches) {
      const value = match.replace(/source_rule:\s*/, '').trim();
      if (!/^D-[A-Z]+-\d{3}$/.test(value)) {
        fail(`${rel} has invalid source_rule format: ${value}`);
      }
    }
  }
}

function collectKernelRuleDefinitions() {
  const ruleIdPattern = /\bD-[A-Z]+-\d{3}\b/g;
  const kernelMdFiles = kernelFiles.filter(
    (f) => f.endsWith('.md') && !f.includes('/generated/'),
  );
  const definitionMap = new Map();

  for (const rel of kernelMdFiles) {
    if (!fileExists(rel)) continue;
    const content = read(rel);
    const headingPattern = /^##\s+(D-[A-Z]+-\d{3})\b/gm;
    let headingMatch;
    while ((headingMatch = headingPattern.exec(content)) !== null) {
      const ruleId = headingMatch[1];
      if (definitionMap.has(ruleId)) {
        fail(`duplicate kernel Rule ID definition: ${ruleId} in ${rel} (first defined in ${definitionMap.get(ruleId)})`);
      } else {
        definitionMap.set(ruleId, rel);
      }
    }
  }

  return new Set(definitionMap.keys());
}

function checkUiSlotsConsistency() {
  const capabilitiesPath = 'apps/desktop/src/runtime/hook/contracts/capabilities.ts';
  if (!fileExists(capabilitiesPath)) {
    fail(`source file not found: ${capabilitiesPath}`);
    return;
  }

  const source = read(capabilitiesPath);
  const slotsMatch = source.match(/DEFAULT_UI_SLOTS\s*=\s*\[([^\]]+)\]/s);
  if (!slotsMatch) {
    fail('could not parse DEFAULT_UI_SLOTS from source');
    return;
  }

  const sourceSlots = new Set(
    [...slotsMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]),
  );

  const yamlPath = 'spec/desktop/kernel/tables/ui-slots.yaml';
  if (!fileExists(yamlPath)) return;
  const doc = readYaml(yamlPath);
  const yamlSlots = new Set(
    (Array.isArray(doc?.slots) ? doc.slots : [])
      .map((item) => String(item?.slot || '').trim())
      .filter(Boolean),
  );

  const missingInYaml = [...sourceSlots].filter((s) => !yamlSlots.has(s));
  const extraInYaml = [...yamlSlots].filter((s) => !sourceSlots.has(s));

  if (missingInYaml.length > 0) {
    fail(`ui-slots.yaml missing slots from source: ${missingInYaml.join(', ')}`);
  }
  if (extraInYaml.length > 0) {
    fail(`ui-slots.yaml has unknown slots: ${extraInYaml.join(', ')}`);
  }
}

function checkTurnHookPointsConsistency() {
  const capabilitiesPath = 'apps/desktop/src/runtime/hook/contracts/capabilities.ts';
  if (!fileExists(capabilitiesPath)) return;

  const source = read(capabilitiesPath);
  const pointsMatch = source.match(/DEFAULT_TURN_HOOK_POINTS\s*=\s*\[([^\]]+)\]/s);
  if (!pointsMatch) {
    fail('could not parse DEFAULT_TURN_HOOK_POINTS from source');
    return;
  }

  const sourcePoints = new Set(
    [...pointsMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]),
  );

  const yamlPath = 'spec/desktop/kernel/tables/turn-hook-points.yaml';
  if (!fileExists(yamlPath)) return;
  const doc = readYaml(yamlPath);
  const yamlPoints = new Set(
    (Array.isArray(doc?.points) ? doc.points : [])
      .map((item) => String(item?.point || '').trim())
      .filter(Boolean),
  );

  const missingInYaml = [...sourcePoints].filter((p) => !yamlPoints.has(p));
  const extraInYaml = [...yamlPoints].filter((p) => !sourcePoints.has(p));

  if (missingInYaml.length > 0) {
    fail(`turn-hook-points.yaml missing points from source: ${missingInYaml.join(', ')}`);
  }
  if (extraInYaml.length > 0) {
    fail(`turn-hook-points.yaml has unknown points: ${extraInYaml.join(', ')}`);
  }
}

function checkModKernelStagesConsistency() {
  const typesPath = 'apps/desktop/src/runtime/execution-kernel/contracts/types.ts';
  if (!fileExists(typesPath)) {
    fail(`source file not found: ${typesPath}`);
    return;
  }

  const source = read(typesPath);
  const stageMatch = source.match(/type\s+KernelStage\s*=([^;]+);/s);
  if (!stageMatch) {
    fail('could not parse KernelStage from source');
    return;
  }

  const sourceStages = new Set(
    [...stageMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]),
  );

  const yamlPath = 'spec/desktop/kernel/tables/mod-kernel-stages.yaml';
  if (!fileExists(yamlPath)) return;
  const doc = readYaml(yamlPath);
  const yamlStages = new Set(
    (Array.isArray(doc?.stages) ? doc.stages : [])
      .map((item) => String(item?.stage || '').trim())
      .filter(Boolean),
  );

  const missingInYaml = [...sourceStages].filter((s) => !yamlStages.has(s));
  const extraInYaml = [...yamlStages].filter((s) => !sourceStages.has(s));

  if (missingInYaml.length > 0) {
    fail(`mod-kernel-stages.yaml missing stages from source: ${missingInYaml.join(', ')}`);
  }
  if (extraInYaml.length > 0) {
    fail(`mod-kernel-stages.yaml has unknown stages: ${extraInYaml.join(', ')}`);
  }
}

function checkModLifecycleStatesConsistency() {
  const typesPath = 'apps/desktop/src/runtime/execution-kernel/contracts/types.ts';
  if (!fileExists(typesPath)) return;

  const source = read(typesPath);
  const stateMatch = source.match(/type\s+LifecycleState\s*=([^;]+);/s);
  if (!stateMatch) {
    fail('could not parse LifecycleState from source');
    return;
  }

  const sourceStates = new Set(
    [...stateMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]),
  );

  const yamlPath = 'spec/desktop/kernel/tables/mod-lifecycle-states.yaml';
  if (!fileExists(yamlPath)) return;
  const doc = readYaml(yamlPath);
  const yamlStates = new Set(
    (Array.isArray(doc?.states) ? doc.states : [])
      .map((item) => String(item?.state || '').trim())
      .filter(Boolean),
  );

  const missingInYaml = [...sourceStates].filter((s) => !yamlStates.has(s));
  const extraInYaml = [...yamlStates].filter((s) => !sourceStates.has(s));

  if (missingInYaml.length > 0) {
    fail(`mod-lifecycle-states.yaml missing states from source: ${missingInYaml.join(', ')}`);
  }
  if (extraInYaml.length > 0) {
    fail(`mod-lifecycle-states.yaml has unknown states: ${extraInYaml.join(', ')}`);
  }
}

function checkModAccessModesConsistency() {
  const typesPath = 'apps/desktop/src/runtime/execution-kernel/contracts/types.ts';
  if (!fileExists(typesPath)) return;

  const source = read(typesPath);
  const modeMatch = source.match(/type\s+AccessMode\s*=([^;]+);/s);
  if (!modeMatch) {
    fail('could not parse AccessMode from source');
    return;
  }

  const sourceModes = new Set(
    [...modeMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]),
  );

  const yamlPath = 'spec/desktop/kernel/tables/mod-access-modes.yaml';
  if (!fileExists(yamlPath)) return;
  const doc = readYaml(yamlPath);
  const yamlModes = new Set(
    (Array.isArray(doc?.modes) ? doc.modes : [])
      .map((item) => String(item?.mode || '').trim())
      .filter(Boolean),
  );

  const missingInYaml = [...sourceModes].filter((m) => !yamlModes.has(m));
  const extraInYaml = [...yamlModes].filter((m) => !sourceModes.has(m));

  if (missingInYaml.length > 0) {
    fail(`mod-access-modes.yaml missing modes from source: ${missingInYaml.join(', ')}`);
  }
  if (extraInYaml.length > 0) {
    fail(`mod-access-modes.yaml has unknown modes: ${extraInYaml.join(', ')}`);
  }
}

function checkAppTabsConsistency() {
  const navConfigPath = 'apps/desktop/src/shell/renderer/app-shell/layouts/navigation-config.tsx';
  if (!fileExists(navConfigPath)) {
    fail(`source file not found: ${navConfigPath}`);
    return;
  }

  const source = read(navConfigPath);

  // Extract core nav item IDs — match from opening [ to closing ];
  const coreMatch = source.match(/BASE_CORE_NAV_ITEMS[^[]*\[([\s\S]*?)\];/);
  const coreIds = coreMatch
    ? new Set([...coreMatch[1].matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1]))
    : new Set();

  // Extract quick nav item IDs
  const quickMatch = source.match(/BASE_QUICK_NAV_ITEMS[^[]*\[([\s\S]*?)\];/);
  const quickIds = quickMatch
    ? new Set([...quickMatch[1].matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1]))
    : new Set();

  const yamlPath = 'spec/desktop/kernel/tables/app-tabs.yaml';
  if (!fileExists(yamlPath)) return;
  const doc = readYaml(yamlPath);
  const yamlTabs = Array.isArray(doc?.tabs) ? doc.tabs : [];

  const yamlCoreTabs = new Set(
    yamlTabs
      .filter((t) => String(t?.nav_group || '').trim() === 'core')
      .map((t) => String(t?.id || '').trim())
      .filter(Boolean),
  );
  const yamlQuickTabs = new Set(
    yamlTabs
      .filter((t) => String(t?.nav_group || '').trim() === 'quick')
      .map((t) => String(t?.id || '').trim())
      .filter(Boolean),
  );

  const missingCore = [...coreIds].filter((id) => !yamlCoreTabs.has(id));
  const extraCore = [...yamlCoreTabs].filter((id) => !coreIds.has(id));
  const missingQuick = [...quickIds].filter((id) => !yamlQuickTabs.has(id));
  const extraQuick = [...yamlQuickTabs].filter((id) => !quickIds.has(id));

  if (missingCore.length > 0) {
    fail(`app-tabs.yaml missing core tabs from navigation-config: ${missingCore.join(', ')}`);
  }
  if (extraCore.length > 0) {
    fail(`app-tabs.yaml has unknown core tabs: ${extraCore.join(', ')}`);
  }
  if (missingQuick.length > 0) {
    fail(`app-tabs.yaml missing quick tabs from navigation-config: ${missingQuick.join(', ')}`);
  }
  if (extraQuick.length > 0) {
    fail(`app-tabs.yaml has unknown quick tabs: ${extraQuick.join(', ')}`);
  }
}

function checkRetryStatusCodesConsistency() {
  const retryPath = 'apps/desktop/src/runtime/net/request-with-retry.ts';
  if (!fileExists(retryPath)) {
    fail(`source file not found: ${retryPath}`);
    return;
  }

  const source = read(retryPath);
  const codesMatch = source.match(/RETRYABLE_STATUS_CODES\s*=\s*new\s+Set\(\[([^\]]+)\]\)/s);
  if (!codesMatch) {
    fail('could not parse RETRYABLE_STATUS_CODES from source');
    return;
  }

  const sourceCodes = new Set(
    [...codesMatch[1].matchAll(/(\d+)/g)].map((m) => Number(m[1])),
  );

  const yamlPath = 'spec/desktop/kernel/tables/retry-status-codes.yaml';
  if (!fileExists(yamlPath)) return;
  const doc = readYaml(yamlPath);
  const yamlCodes = new Set(
    (Array.isArray(doc?.codes) ? doc.codes : [])
      .map((item) => Number(item?.code))
      .filter((n) => !Number.isNaN(n)),
  );

  const missingInYaml = [...sourceCodes].filter((c) => !yamlCodes.has(c));
  const extraInYaml = [...yamlCodes].filter((c) => !sourceCodes.has(c));

  if (missingInYaml.length > 0) {
    fail(`retry-status-codes.yaml missing codes from source: ${missingInYaml.join(', ')}`);
  }
  if (extraInYaml.length > 0) {
    fail(`retry-status-codes.yaml has unknown codes: ${extraInYaml.join(', ')}`);
  }
}

function checkDomainSection0ImportsCoveredInBody() {
  for (const rel of domainFiles) {
    if (!fileExists(rel)) continue;
    const content = read(rel);

    // Extract D-* references from Kernel References sections
    const ruleRefs = new Set(
      [...content.matchAll(/\bD-[A-Z]+-\d{3}\b/g)].map((m) => m[0]),
    );

    if (ruleRefs.size === 0) {
      fail(`${rel} has no D-* Rule ID references`);
    }
  }
}

function checkSourceRuleReferentialIntegrity() {
  const yamlFiles = kernelFiles.filter((f) => f.endsWith('.yaml'));
  for (const rel of yamlFiles) {
    if (!fileExists(rel)) continue;
    const content = read(rel);
    const sourceRuleMatches = content.match(/source_rule:\s*(.+)/g) || [];
    for (const match of sourceRuleMatches) {
      const value = match.replace(/source_rule:\s*/, '').trim();
      if (/^D-[A-Z]+-\d{3}$/.test(value) && !kernelRuleDefinitions.has(value)) {
        fail(`${rel} references undefined kernel Rule ID: ${value}`);
      }
    }
  }
}

function checkNoKernelRuleDefinitionsInDomainDocs() {
  const headingPattern = /^##\s+(D-[A-Z]+-\d{3})\b/gm;
  for (const rel of domainFiles) {
    if (!fileExists(rel)) continue;
    const content = read(rel);
    let match;
    while ((match = headingPattern.exec(content)) !== null) {
      fail(`${rel} defines kernel Rule ID ${match[1]} — rule definitions belong in kernel contracts only`);
    }
  }
}

function checkRuleIdReferencesResolvable() {
  const ruleRefPattern = /\bD-[A-Z]+-\d{3}\b/g;
  for (const rel of domainFiles) {
    if (!fileExists(rel)) continue;
    const content = read(rel);
    const refs = new Set([...content.matchAll(ruleRefPattern)].map((m) => m[0]));
    for (const ref of refs) {
      if (!kernelRuleDefinitions.has(ref)) {
        fail(`${rel} references undefined kernel Rule ID: ${ref}`);
      }
    }
  }
}
