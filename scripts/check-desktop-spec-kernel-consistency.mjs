#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { readYamlWithFragments } from './lib/read-yaml-with-fragments.mjs';

const cwd = process.cwd();
const desktopRoot = path.join(cwd, 'spec/desktop');
const sourceRoot = path.join(cwd, 'apps/desktop/src');

const kernelFiles = [
  'spec/desktop/kernel/index.md',
  'spec/desktop/kernel/bootstrap-contract.md',
  'spec/desktop/kernel/bridge-ipc-contract.md',
  'spec/desktop/kernel/self-update-contract.md',
  'spec/desktop/kernel/state-contract.md',
  'spec/desktop/kernel/auth-session-contract.md',
  'spec/desktop/kernel/data-sync-contract.md',
  'spec/desktop/kernel/hook-capability-contract.md',
  'spec/desktop/kernel/mod-governance-contract.md',
  'spec/desktop/kernel/llm-adapter-contract.md',
  'spec/desktop/kernel/menu-bar-shell-contract.md',
  'spec/desktop/kernel/ui-shell-contract.md',
  'spec/desktop/kernel/error-boundary-contract.md',
  'spec/desktop/kernel/telemetry-contract.md',
  'spec/desktop/kernel/network-contract.md',
  'spec/desktop/kernel/security-contract.md',
  'spec/desktop/kernel/streaming-consumption-contract.md',
  'spec/desktop/kernel/codegen-contract.md',
  'spec/desktop/kernel/offline-degradation-contract.md',
  'spec/desktop/kernel/testing-gates-contract.md',
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
  'spec/desktop/kernel/tables/renderer-design-tokens.yaml',
  'spec/desktop/kernel/tables/renderer-design-surfaces.yaml',
  'spec/desktop/kernel/tables/renderer-design-overlays.yaml',
  'spec/desktop/kernel/tables/renderer-design-allowlists.yaml',
  'spec/desktop/kernel/tables/desktop-testing-gates.yaml',
  'spec/desktop/kernel/tables/desktop-feature-coverage.yaml',
  'spec/desktop/kernel/tables/rule-evidence.yaml',
  'spec/desktop/kernel/tables/codegen-import-allowlist.yaml',
  'spec/desktop/kernel/tables/codegen-capability-tiers.yaml',
  'spec/desktop/kernel/tables/codegen-static-scan-deny-patterns.yaml',
  'spec/desktop/kernel/tables/codegen-acceptance-gates.yaml',
];

const domainFiles = listDomainMarkdownFiles('spec/desktop');

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

function fileExists(rel) {
  return fs.existsSync(path.join(cwd, rel));
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
  checkNoLocalRuleIds(content, rel);
  checkNoRuleDefinitionHeadings(content, rel);
}
if (domainFiles.length === 0) {
  fail('desktop domain markdown files are empty');
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

// ── Check 14b: Renderer design tables + domain anchors ──

checkRendererDesignTables();
checkDesignDomainAnchors();

// ── Check 15: Cross-domain upstream rule references exist in Runtime/SDK spec ──

checkCrossDomainRuleReferences(
  kernelFiles.filter((f) => f.endsWith('.md') && !f.includes('/generated/')),
  [
    {
      label: 'Runtime',
      dir: 'spec/runtime/kernel',
      headingPattern: /^##\s+(K-[A-Z]+-\d{3}[a-z]?)\b/gmu,
      refPattern: /\bK-[A-Z]+-\d{3}[a-z]?\b/gu,
    },
    {
      label: 'SDK',
      dir: 'spec/sdk/kernel',
      headingPattern: /^##\s+(S-[A-Z]+-\d{3}[a-z]?)\b/gmu,
      refPattern: /\bS-[A-Z]+-\d{3}[a-z]?\b/gu,
    },
  ],
);

// ── Check 16: D-ERR-007 critical ReasonCode coverage ──

checkCriticalReasonCodeCoverage();

// ── Check 17: D-STRM RPC coverage (streaming RPCs have consumption rules) ──

checkStreamingRpcCoverage();

// ── Check 18: No credentialRefId residual in source (D-LLM-003) ──

checkNoCredentialRefIdResidual();

// ── Check 19: No console.log/warn/error in source except telemetry fallback (D-TEL-003) ──

checkNoConsoleLogInSource();

// ── Check 20: No legacy store imports (D-STATE-001) ──

checkNoLegacyStoreImports();

// ── Check 21: Retry jitter presence (D-NET-002) ──

checkRetryJitterPresence();

// ── Check 22: Store slice count = 4 (D-STATE-001) ──

checkStoreSliceCount();

// ── Check 23: D-ERR-007 ReasonCode coverage in source bridge invoke ──

checkBridgeReasonCodeCoverage();

// ── Check 24: local-runtime IPC spec ↔ Tauri invoke handler ↔ TS wrapper parity ──

checkLocalRuntimeIpcConsistency();

// ── Check 25: D-* rule evidence full traceability (rules ↔ evidence ↔ files) ──

checkRuleEvidenceTraceability();

// ── Check 26: desktop testing gates table completeness ──

checkDesktopTestingGateCoverage();

// ── Check 27: desktop feature coverage table completeness ──

checkDesktopFeatureCoverage();

// ── Check 28: IPC commands YAML → contract prose coverage ──

checkIpcCommandsContractProseCoverage();

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

function checkRendererDesignTables() {
  const rendererRoot = path.join(sourceRoot, 'shell/renderer');
  const tokensPath = 'spec/desktop/kernel/tables/renderer-design-tokens.yaml';
  const surfacesPath = 'spec/desktop/kernel/tables/renderer-design-surfaces.yaml';
  const overlaysPath = 'spec/desktop/kernel/tables/renderer-design-overlays.yaml';
  const allowlistsPath = 'spec/desktop/kernel/tables/renderer-design-allowlists.yaml';

  const allowedTokenCategories = new Set(['brand', 'surface', 'text', 'radius', 'elevation', 'z', 'motion']);
  const allowedSurfaceProfiles = new Set(['baseline', 'secondary', 'exception']);
  const allowedExceptionPolicies = new Set(['none', 'allowlisted_arbitrary', 'controlled']);
  const allowedOverlayKinds = new Set(['dialog', 'drawer', 'popover', 'tooltip']);
  const allowedSurfaceTones = new Set(['canvas', 'panel', 'card', 'hero', 'overlay']);
  const allowedElevations = new Set(['base', 'raised', 'floating', 'modal']);
  const allowedPatternTypes = new Set(['raw_color', 'token_bypass', 'class_pattern', 'inline_style', 'overlay_local_shell']);

  const tokensDoc = readYaml(tokensPath) || {};
  const tokens = Array.isArray(tokensDoc?.tokens) ? tokensDoc.tokens : [];
  if (tokens.length === 0) {
    fail(`${tokensPath} must define at least one token row`);
  }
  for (const item of tokens) {
    const id = String(item?.id || '').trim();
    const category = String(item?.category || '').trim();
    const name = String(item?.name || '').trim();
    const cssVar = String(item?.css_var || '').trim();
    const alias = String(item?.tailwind_alias || '').trim();
    const scope = String(item?.scope || '').trim();
    if (!id || !category || !name || !cssVar || !alias || !scope) {
      fail(`${tokensPath} token rows require id/category/name/css_var/tailwind_alias/scope`);
      continue;
    }
    if (!allowedTokenCategories.has(category)) {
      fail(`${tokensPath} token ${id} has invalid category: ${category}`);
    }
  }

  const surfacesDoc = readYaml(surfacesPath) || {};
  const surfaces = Array.isArray(surfacesDoc?.surfaces) ? surfacesDoc.surfaces : [];
  if (surfaces.length === 0) {
    fail(`${surfacesPath} must define at least one surface row`);
  }
  const baselineModules = new Set();
  let hasWorldException = false;
  for (const item of surfaces) {
    const id = String(item?.id || '').trim();
    const module = String(item?.module || '').trim();
    const role = String(item?.role || '').trim();
    const profile = String(item?.surface_profile || '').trim();
    const exceptionPolicy = String(item?.exception_policy || '').trim();
    if (!id || !module || !role || !profile || !exceptionPolicy) {
      fail(`${surfacesPath} surface rows require id/module/role/surface_profile/exception_policy`);
      continue;
    }
    if (!allowedSurfaceProfiles.has(profile)) {
      fail(`${surfacesPath} surface ${id} has invalid surface_profile: ${profile}`);
    }
    if (!allowedExceptionPolicies.has(exceptionPolicy)) {
      fail(`${surfacesPath} surface ${id} has invalid exception_policy: ${exceptionPolicy}`);
    }
    if (!fs.existsSync(path.join(rendererRoot, module))) {
      fail(`${surfacesPath} surface ${id} module does not exist under renderer root: ${module}`);
    }
    if (profile === 'baseline') {
      baselineModules.add(module);
    }
    if (profile === 'exception' && module.includes('world-detail')) {
      hasWorldException = true;
    }
  }
  for (const requiredModule of ['features/chats/chat-list.tsx', 'features/explore/explore-view.tsx', 'features/contacts/contacts-view.tsx']) {
    if (!baselineModules.has(requiredModule)) {
      fail(`${surfacesPath} missing baseline module: ${requiredModule}`);
    }
  }
  if (!hasWorldException) {
    fail(`${surfacesPath} must declare a controlled world-detail exception row`);
  }

  const overlaysDoc = readYaml(overlaysPath) || {};
  const overlays = Array.isArray(overlaysDoc?.overlays) ? overlaysDoc.overlays : [];
  if (overlays.length === 0) {
    fail(`${overlaysPath} must define at least one overlay row`);
  }
  for (const item of overlays) {
    const id = String(item?.id || '').trim();
    const kind = String(item?.kind || '').trim();
    const tone = String(item?.surface_tone || '').trim();
    const elevation = String(item?.elevation || '').trim();
    const zToken = String(item?.z_token || '').trim();
    if (!id || !kind || !tone || !elevation || !zToken) {
      fail(`${overlaysPath} overlay rows require id/kind/surface_tone/elevation/z_token`);
      continue;
    }
    if (!allowedOverlayKinds.has(kind)) {
      fail(`${overlaysPath} overlay ${id} has invalid kind: ${kind}`);
    }
    if (!allowedSurfaceTones.has(tone)) {
      fail(`${overlaysPath} overlay ${id} has invalid surface_tone: ${tone}`);
    }
    if (!allowedElevations.has(elevation)) {
      fail(`${overlaysPath} overlay ${id} has invalid elevation: ${elevation}`);
    }
    if (typeof item?.testid_required !== 'boolean') {
      fail(`${overlaysPath} overlay ${id} must declare boolean testid_required`);
    }
    if (typeof item?.reduced_motion !== 'boolean') {
      fail(`${overlaysPath} overlay ${id} must declare boolean reduced_motion`);
    }
  }

  const allowlistsDoc = readYaml(allowlistsPath) || {};
  const patterns = Array.isArray(allowlistsDoc?.patterns) ? allowlistsDoc.patterns : [];
  if (patterns.length === 0) {
    fail(`${allowlistsPath} must define at least one allowlist row`);
  }
  for (const item of patterns) {
    const id = String(item?.id || '').trim();
    const patternType = String(item?.pattern_type || '').trim();
    const pattern = String(item?.pattern || '').trim();
    const scope = String(item?.scope || '').trim();
    const reason = String(item?.reason || '').trim();
    if (!id || !patternType || !pattern || !scope || !reason) {
      fail(`${allowlistsPath} allowlist rows require id/pattern_type/pattern/scope/reason`);
      continue;
    }
    if (!allowedPatternTypes.has(patternType)) {
      fail(`${allowlistsPath} allowlist ${id} has invalid pattern_type: ${patternType}`);
    }
    if (!fileExists(scope)) {
      fail(`${allowlistsPath} allowlist ${id} scope path does not exist: ${scope}`);
    }
  }
}

function checkDesignDomainAnchors() {
  const requiredAnchors = [
    ['spec/desktop/chat.md', 'D-SHELL-019'],
    ['spec/desktop/explore.md', 'D-SHELL-019'],
    ['spec/desktop/contacts.md', 'D-SHELL-019'],
    ['spec/desktop/home.md', 'D-SHELL-015'],
    ['spec/desktop/notification.md', 'D-SHELL-015'],
    ['spec/desktop/profile.md', 'D-SHELL-015'],
    ['spec/desktop/world-detail.md', 'D-SHELL-020'],
  ];
  for (const [rel, ruleId] of requiredAnchors) {
    if (!fileExists(rel)) continue;
    const content = read(rel);
    if (!content.includes(ruleId)) {
      fail(`${rel} must reference ${ruleId} for desktop design pilot anchoring`);
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

function checkCrossDomainRuleReferences(files, targets) {
  for (const target of targets) {
    const targetDir = path.join(cwd, target.dir);
    if (!fs.existsSync(targetDir)) continue;

    const definitions = new Set();
    for (const name of fs.readdirSync(targetDir).filter((entry) => entry.endsWith('.md'))) {
      const filePath = path.join(targetDir, name);
      if (!fs.statSync(filePath).isFile()) continue;
      const content = fs.readFileSync(filePath, 'utf8');
      for (const match of content.matchAll(target.headingPattern)) {
        definitions.add(match[1]);
      }
    }
    if (definitions.size === 0) continue;

    for (const rel of files) {
      const filePath = path.join(cwd, rel);
      if (!fs.existsSync(filePath)) continue;
      const content = fs.readFileSync(filePath, 'utf8');
      for (const ref of new Set([...content.matchAll(target.refPattern)].map((match) => match[0]))) {
        if (!definitions.has(ref)) {
          fail(`${rel} references undefined ${target.label} Rule ID: ${ref}`);
        }
      }
    }
  }
}

function checkCriticalReasonCodeCoverage() {
  // Critical ReasonCodes that must be explicitly mapped in D-ERR-007
  const criticalCodes = [
    'AI_PROVIDER_TIMEOUT',
    'AI_PROVIDER_UNAVAILABLE',
    'AI_STREAM_BROKEN',
    'AI_MEDIA_IDEMPOTENCY_CONFLICT',
    'AI_LOCAL_MODEL_UNAVAILABLE',
    'AI_FINISH_LENGTH',
    'AI_FINISH_CONTENT_FILTER',
    'SESSION_EXPIRED',
    'AUTH_TOKEN_INVALID',
    'AI_PROVIDER_AUTH_FAILED',
    'AI_MEDIA_SPEC_INVALID',
    'AI_MEDIA_JOB_NOT_CANCELLABLE',
    'APP_MODE_DOMAIN_FORBIDDEN',
  ];

  const errBoundaryPath = 'spec/desktop/kernel/error-boundary-contract.md';
  if (!fileExists(errBoundaryPath)) return;

  const content = read(errBoundaryPath);
  const missing = criticalCodes.filter((code) => !content.includes(code));

  if (missing.length > 0) {
    fail(`D-ERR-007 missing critical ReasonCode mappings: ${missing.join(', ')}`);
  }
}

function checkStreamingRpcCoverage() {
  // Streaming RPCs from K-STREAM-001 that must have D-STRM consumption rules
  const streamingRpcs = [
    'StreamScenario',
    'SubscribeScenarioJobEvents',
  ];

  // Mode D long-lived subscription flows (K-STREAM-010) — must have consumption
  // rules or explicit IPC equivalence declaration in streaming-consumption-contract.md
  const modeDRpcs = [
    'SubscribeRuntimeHealthEvents',
    'SubscribeAIProviderHealthEvents',
  ];

  const strmPath = 'spec/desktop/kernel/streaming-consumption-contract.md';
  if (!fileExists(strmPath)) return;

  const content = read(strmPath);
  const missing = streamingRpcs.filter((rpc) => !content.includes(rpc));

  if (missing.length > 0) {
    fail(`streaming-consumption-contract.md missing consumption rules for streaming RPCs: ${missing.join(', ')}`);
  }

  const missingModeD = modeDRpcs.filter((rpc) => !content.includes(rpc));
  if (missingModeD.length > 0) {
    fail(`streaming-consumption-contract.md missing Mode D consumption/equivalence rules for: ${missingModeD.join(', ')}`);
  }
}

function checkNoCredentialRefIdResidual() {
  const srcDir = path.join(cwd, 'apps/desktop/src');
  if (!fs.existsSync(srcDir)) return;

  const files = walkSync(srcDir, ['.ts', '.tsx']);
  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8');
    if (content.includes('credentialRefId')) {
      const rel = path.relative(cwd, filePath);
      fail(`D-LLM-003 violation: credentialRefId found in ${rel}`);
    }
  }
}

function checkNoConsoleLogInSource() {
  const srcDir = path.join(cwd, 'apps/desktop/src');
  if (!fs.existsSync(srcDir)) return;

  const allowedFiles = ['runtime/telemetry/logger.ts'];
  const files = walkSync(srcDir, ['.ts', '.tsx']);
  const consolePattern = /\bconsole\.(log|warn|error)\b/;

  for (const filePath of files) {
    const rel = path.relative(path.join(cwd, 'apps/desktop/src'), filePath);
    if (allowedFiles.some((allowed) => rel.replace(/\\/g, '/').endsWith(allowed))) {
      continue;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    if (consolePattern.test(content)) {
      fail(`D-TEL-003 violation: console.* found in apps/desktop/src/${rel.replace(/\\/g, '/')}`);
    }
  }
}

function checkNoLegacyStoreImports() {
  const srcDir = path.join(cwd, 'apps/desktop/src');
  if (!fs.existsSync(srcDir)) return;

  const files = walkSync(srcDir, ['.ts', '.tsx']);
  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8');
    if (content.includes("from '@runtime/state'") || content.includes("from '@runtime/state/")) {
      const rel = path.relative(cwd, filePath);
      fail(`D-STATE-001 violation: legacy store import in ${rel}`);
    }
  }
}

function checkRetryJitterPresence() {
  const retryPath = 'apps/desktop/src/runtime/net/request-with-retry.ts';
  if (!fileExists(retryPath)) return;

  const content = read(retryPath);
  if (!content.includes('Math.random')) {
    fail('D-NET-002 violation: request-with-retry.ts missing jitter (Math.random)');
  }
}

function checkStoreSliceCount() {
  const storePath = 'apps/desktop/src/shell/renderer/app-shell/providers/app-store.ts';
  if (!fileExists(storePath)) return;

  const content = read(storePath);
  const sliceImports = content.match(/create\w+Slice/g) || [];
  const uniqueSlices = new Set(sliceImports);

  if (uniqueSlices.size !== 4) {
    fail(`D-STATE-001 expects exactly 4 store slices, found ${uniqueSlices.size}: ${[...uniqueSlices].join(', ')}`);
  }
}

function checkBridgeReasonCodeCoverage() {
  const invokePath = 'apps/desktop/src/shell/renderer/bridge/runtime-bridge/invoke.ts';
  if (!fileExists(invokePath)) return;

  const content = read(invokePath);

  const phase1CriticalCodes = [
    'AI_PROVIDER_TIMEOUT',
    'AI_PROVIDER_UNAVAILABLE',
    'AI_STREAM_BROKEN',
    'AI_CONNECTOR_CREDENTIAL_MISSING',
    'AI_MODEL_NOT_FOUND',
    'AI_MEDIA_IDEMPOTENCY_CONFLICT',
    'AI_LOCAL_MODEL_UNAVAILABLE',
    'AUTH_TOKEN_INVALID',
    'SESSION_EXPIRED',
    'RUNTIME_UNAVAILABLE',
  ];

  const missing = phase1CriticalCodes.filter((code) => !content.includes(code));
  if (missing.length > 0) {
    fail(`D-ERR-007 bridge invoke.ts missing Phase 1 ReasonCodes: ${missing.join(', ')}`);
  }
}

function checkLocalRuntimeIpcConsistency() {
  const tablePath = 'spec/desktop/kernel/tables/ipc-commands.yaml';
  const rustPath = 'apps/desktop/src-tauri/src/main_parts/app_bootstrap.rs';
  const tsPaths = [
    'apps/desktop/src/runtime/local-runtime/commands.ts',
    'apps/desktop/src/runtime/local-runtime/commands-pickers.ts',
  ];
  if (!fileExists(tablePath) || !fileExists(rustPath) || tsPaths.some((rel) => !fileExists(rel))) {
    fail(`local-runtime IPC parity inputs missing: ${[tablePath, rustPath, ...tsPaths].filter((rel) => !fileExists(rel)).join(', ')}`);
    return;
  }

  const table = readYaml(tablePath) || {};
  const specCommands = new Set(
    (Array.isArray(table?.commands) ? table.commands : [])
      .filter((entry) => String(entry?.module || '').trim() === 'local-runtime')
      .map((entry) => String(entry?.command || '').trim())
      .filter((command) => /^runtime_local_[a-z0-9_]+$/u.test(command)),
  );
  if (specCommands.size === 0) {
    fail(`${tablePath} has no local-runtime commands`);
    return;
  }

  const rustCommands = new Set(
    [...read(rustPath).matchAll(/local_runtime::commands::(runtime_local_[a-z0-9_]+)/gu)]
      .map((match) => match[1]),
  );
  const tsCommandMatches = tsPaths.flatMap((rel) => {
    const content = read(rel);
    return [
      ...content.matchAll(/\binvokeLocalAiCommand(?:<[^>]+>)?\(\s*'((?:runtime_local_[a-z0-9_]+))'/gu),
      ...content.matchAll(/\binvokeLocalRuntimeCommand(?:<[^>]+>)?\(\s*'((?:runtime_local_[a-z0-9_]+))'/gu),
      ...content.matchAll(/\btauriInvoke(?:<[^>]+>)?\(\s*'((?:runtime_local_[a-z0-9_]+))'/gu),
    ];
  });
  const tsCommands = new Set(tsCommandMatches.map((match) => match[1]));
  const tsLabel = tsPaths.join(', ');

  compareCommandSets(`${tablePath} vs ${rustPath}`, specCommands, rustCommands);
  compareCommandSets(`${tablePath} vs ${tsLabel}`, specCommands, tsCommands);
  compareCommandSets(`${rustPath} vs ${tsLabel}`, rustCommands, tsCommands);
}

function compareCommandSets(label, expected, actual) {
  const missing = [...expected].filter((command) => !actual.has(command));
  const extra = [...actual].filter((command) => !expected.has(command));
  if (missing.length > 0) {
    fail(`${label} missing commands: ${missing.join(', ')}`);
  }
  if (extra.length > 0) {
    fail(`${label} has extra commands: ${extra.join(', ')}`);
  }
}

function checkRuleEvidenceTraceability() {
  const evidencePath = 'spec/desktop/kernel/tables/rule-evidence.yaml';
  if (!fileExists(evidencePath)) {
    fail(`missing rule evidence table: ${evidencePath}`);
    return;
  }

  const doc = readYaml(evidencePath) || {};
  const catalog = doc.evidence_catalog && typeof doc.evidence_catalog === 'object'
    ? doc.evidence_catalog
    : null;
  if (!catalog) {
    fail(`${evidencePath} missing evidence_catalog map`);
    return;
  }

  const catalogEntries = Object.entries(catalog);
  if (catalogEntries.length === 0) {
    fail(`${evidencePath} evidence_catalog must not be empty`);
  }

  for (const [ref, item] of catalogEntries) {
    const record = item && typeof item === 'object' ? item : null;
    if (!record) {
      fail(`${evidencePath} evidence_catalog.${ref} must be an object`);
      continue;
    }
    const type = String(record.type || '').trim();
    const command = String(record.command || '').trim();
    const targetPath = String(record.path || '').trim();
    if (!type) {
      fail(`${evidencePath} evidence_catalog.${ref} missing type`);
    }
    if (!command) {
      fail(`${evidencePath} evidence_catalog.${ref} missing command`);
    }
    if (!targetPath) {
      fail(`${evidencePath} evidence_catalog.${ref} missing path`);
      continue;
    }
    if (!fileExists(targetPath)) {
      fail(`${evidencePath} evidence_catalog.${ref} path does not exist: ${targetPath}`);
    }
  }

  const rules = Array.isArray(doc.rules) ? doc.rules : [];
  if (rules.length === 0) {
    fail(`${evidencePath} rules must not be empty`);
    return;
  }

  const seen = new Set();
  for (const item of rules) {
    const ruleId = String(item?.rule_id || '').trim();
    const status = String(item?.status || '').trim().toLowerCase();
    const refs = Array.isArray(item?.evidence_refs) ? item.evidence_refs : [];
    const naReason = String(item?.na_reason || '').trim();

    if (!/^D-[A-Z]+-\d{3}$/.test(ruleId)) {
      fail(`${evidencePath} has invalid rule_id format: ${ruleId || '<empty>'}`);
      continue;
    }
    if (seen.has(ruleId)) {
      fail(`${evidencePath} has duplicate rule_id entry: ${ruleId}`);
      continue;
    }
    seen.add(ruleId);

    if (!kernelRuleDefinitions.has(ruleId)) {
      fail(`${evidencePath} references unknown desktop kernel rule: ${ruleId}`);
    }

    if (status !== 'covered' && status !== 'na') {
      fail(`${evidencePath} ${ruleId} has invalid status: ${status || '<empty>'} (allowed: covered|na)`);
      continue;
    }

    if (status === 'na') {
      if (!naReason) {
        fail(`${evidencePath} ${ruleId} status=na requires na_reason`);
      }
      continue;
    }

    if (refs.length === 0) {
      fail(`${evidencePath} ${ruleId} status=covered requires non-empty evidence_refs`);
      continue;
    }

    for (const rawRef of refs) {
      const ref = String(rawRef || '').trim();
      if (!ref) {
        fail(`${evidencePath} ${ruleId} contains empty evidence_refs item`);
        continue;
      }
      if (!Object.prototype.hasOwnProperty.call(catalog, ref)) {
        fail(`${evidencePath} ${ruleId} references undefined evidence ref: ${ref}`);
      }
    }
  }

  const missing = [...kernelRuleDefinitions].filter((ruleId) => !seen.has(ruleId));
  if (missing.length > 0) {
    fail(`${evidencePath} missing evidence rows for rules: ${missing.join(', ')}`);
  }
}

function checkDesktopTestingGateCoverage() {
  const tablePath = 'spec/desktop/kernel/tables/desktop-testing-gates.yaml';
  if (!fileExists(tablePath)) {
    fail(`missing desktop testing gate table: ${tablePath}`);
    return;
  }

  const doc = readYaml(tablePath) || {};
  const gates = Array.isArray(doc?.gates) ? doc.gates : [];
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
    if (!/^D-[A-Z]+-\d{3}$/u.test(sourceRule)) {
      fail(`${tablePath} gate ${gate} has invalid source_rule: ${sourceRule}`);
      continue;
    }
    if (!kernelRuleDefinitions.has(sourceRule)) {
      fail(`${tablePath} gate ${gate} references undefined desktop kernel Rule ID: ${sourceRule}`);
    }
  }

  const requiredGates = [
    ['unit_contract_mock', 'D-GATE-010', ['pnpm --filter @nimiplatform/desktop test']],
    ['rust_tauri_integration', 'D-GATE-020', ['cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml', 'cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets']],
    ['desktop_e2e_smoke', 'D-GATE-030', ['pnpm check:desktop-e2e-smoke']],
    ['desktop_e2e_journeys', 'D-GATE-040', ['pnpm check:desktop-e2e-journeys']],
    ['selector_testability', 'D-GATE-050', ['pnpm --filter @nimiplatform/desktop lint', 'pnpm check:desktop-e2e-smoke']],
    ['os_matrix', 'D-GATE-060', ['linux:PR+release', 'windows:release', 'macos:manual-smoke']],
    ['release_parity', 'D-GATE-070', ['pnpm check:desktop-e2e-smoke', 'pnpm check:desktop-e2e-journeys']],
    ['spec_consistency', 'D-GATE-080', ['pnpm check:desktop-spec-kernel-consistency']],
    ['docs_drift', 'D-GATE-080', ['pnpm check:desktop-spec-kernel-docs-drift']],
    ['design_contract', 'D-GATE-090', ['pnpm check:desktop-design-contract']],
    ['design_adoption', 'D-GATE-091', ['pnpm check:desktop-design-contract']],
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
}

function checkDesktopFeatureCoverage() {
  const tablePath = 'spec/desktop/kernel/tables/desktop-feature-coverage.yaml';
  if (!fileExists(tablePath)) {
    fail(`missing desktop feature coverage table: ${tablePath}`);
    return;
  }

  const doc = readYaml(tablePath) || {};
  const features = Array.isArray(doc?.features) ? doc.features : [];
  if (features.length === 0) {
    fail(`${tablePath} must define at least one feature`);
    return;
  }

  const featureMap = new Map();
  for (const featureEntry of features) {
    const feature = String(featureEntry?.feature || '').trim();
    const riskTier = String(featureEntry?.risk_tier || '').trim();
    const requiredLayers = Array.isArray(featureEntry?.required_layers) ? featureEntry.required_layers : [];
    const coversTabs = Array.isArray(featureEntry?.covers_tabs) ? featureEntry.covers_tabs : [];
    const coversBootstrapPhases = Array.isArray(featureEntry?.covers_bootstrap_phases) ? featureEntry.covers_bootstrap_phases : [];
    const coversIpcCommands = Array.isArray(featureEntry?.covers_ipc_commands) ? featureEntry.covers_ipc_commands : [];
    const coversRuntimePages = Array.isArray(featureEntry?.covers_runtime_pages) ? featureEntry.covers_runtime_pages : [];
    const scenarios = Array.isArray(featureEntry?.scenarios) ? featureEntry.scenarios : [];
    if (!feature) {
      fail(`${tablePath} contains feature entry with empty feature id`);
      continue;
    }
    if (featureMap.has(feature)) {
      fail(`${tablePath} contains duplicate feature id: ${feature}`);
      continue;
    }
    featureMap.set(feature, featureEntry);
    if (!['P0', 'P1', 'P2'].includes(riskTier)) {
      fail(`${tablePath} feature ${feature} has invalid risk_tier: ${riskTier || '<empty>'}`);
    }
    if ((riskTier === 'P0' || riskTier === 'P1') && !requiredLayers.some((value) => String(value).startsWith('desktop_e2e_'))) {
      fail(`${tablePath} feature ${feature} risk_tier=${riskTier} must declare desktop_e2e_* coverage`);
    }
    for (const field of ['covers_tabs', 'covers_bootstrap_phases', 'covers_ipc_commands', 'covers_runtime_pages']) {
      if (!Array.isArray(featureEntry?.[field])) {
        fail(`${tablePath} feature ${feature} must declare array field ${field}`);
      }
    }
    if (scenarios.length === 0) {
      fail(`${tablePath} feature ${feature} must define at least one scenario`);
      continue;
    }
    for (const scenario of scenarios) {
      const scenarioId = String(scenario?.scenario_id || '').trim();
      const sourceRule = String(scenario?.source_rule || '').trim();
      const specPath = String(scenario?.spec_path || '').trim();
      if (!/^[a-z0-9]+(?:\.[a-z0-9-]+)+$/u.test(scenarioId)) {
        fail(`${tablePath} feature ${feature} has invalid scenario_id: ${scenarioId || '<empty>'}`);
      }
      if (!/^D-[A-Z]+-\d{3}$/u.test(sourceRule)) {
        fail(`${tablePath} feature ${feature} scenario ${scenarioId || '<empty>'} has invalid source_rule: ${sourceRule || '<empty>'}`);
      } else if (!kernelRuleDefinitions.has(sourceRule)) {
        fail(`${tablePath} feature ${feature} scenario ${scenarioId} references undefined desktop kernel Rule ID: ${sourceRule}`);
      }
      if (!specPath) {
        fail(`${tablePath} feature ${feature} scenario ${scenarioId || '<empty>'} missing spec_path`);
        continue;
      }
      if (!fileExists(specPath)) {
        fail(`${tablePath} feature ${feature} scenario ${scenarioId} spec_path does not exist: ${specPath}`);
        continue;
      }
      const specContent = read(specPath);
      if (!specContent.includes(scenarioId)) {
        fail(`${tablePath} feature ${feature} scenario ${scenarioId} spec file must contain scenario id`);
      }
    }
  }

  const requiredFeatures = [
    'boot-startup',
    'shell-navigation',
    'offline-recovery',
    'settings-release-preferences',
    'chat-core',
    'contacts-core',
    'explore-entry',
    'runtime-config',
    'local-ai-entry',
    'external-agent-entry',
    'mods-panel',
  ];
  for (const feature of requiredFeatures) {
    if (!featureMap.has(feature)) {
      fail(`${tablePath} missing required feature coverage entry: ${feature}`);
    }
  }

  const appTabsPath = 'spec/desktop/kernel/tables/app-tabs.yaml';
  if (fileExists(appTabsPath)) {
    const appTabsDoc = readYaml(appTabsPath) || {};
    const tabs = Array.isArray(appTabsDoc?.tabs) ? appTabsDoc.tabs : [];
    const requiredTabIds = tabs
      .filter((item) => ['core', 'mod-nav'].includes(String(item?.nav_group || '').trim()))
      .map((item) => String(item?.id || '').trim())
      .filter(Boolean);
    const coveredTabIds = new Set(
      features.flatMap((item) => Array.isArray(item?.covers_tabs) ? item.covers_tabs : []).map((value) => String(value || '').trim()).filter(Boolean),
    );
    for (const tabId of requiredTabIds) {
      if (!coveredTabIds.has(tabId)) {
        fail(`${tablePath} must cover app tab via covers_tabs: ${tabId}`);
      }
    }
  }

  const bootstrapPath = 'spec/desktop/kernel/tables/bootstrap-phases.yaml';
  if (fileExists(bootstrapPath)) {
    const bootstrapDoc = readYaml(bootstrapPath) || {};
    const phases = Array.isArray(bootstrapDoc?.phases) ? bootstrapDoc.phases : [];
    const requiredPhases = phases.map((item) => String(item?.phase || '').trim()).filter(Boolean);
    const coveredPhases = new Set(
      features.flatMap((item) => Array.isArray(item?.covers_bootstrap_phases) ? item.covers_bootstrap_phases : []).map((value) => String(value || '').trim()).filter(Boolean),
    );
    for (const phase of requiredPhases) {
      if (!coveredPhases.has(phase)) {
        fail(`${tablePath} must cover bootstrap phase via covers_bootstrap_phases: ${phase}`);
      }
    }
  }

  const ipcPath = 'spec/desktop/kernel/tables/ipc-commands.yaml';
  if (fileExists(ipcPath)) {
    const ipcDoc = readYaml(ipcPath) || {};
    const commands = Array.isArray(ipcDoc?.commands) ? ipcDoc.commands : [];
    const criticalCommands = ['runtime_defaults', 'runtime_bridge_status', 'desktop_release_info_get'];
    const declaredCommands = new Set(commands.map((item) => String(item?.command || '').trim()).filter(Boolean));
    const coveredCommands = new Set(
      features.flatMap((item) => Array.isArray(item?.covers_ipc_commands) ? item.covers_ipc_commands : []).map((value) => String(value || '').trim()).filter(Boolean),
    );
    for (const command of criticalCommands) {
      if (declaredCommands.has(command) && !coveredCommands.has(command)) {
        fail(`${tablePath} must cover critical IPC command via covers_ipc_commands: ${command}`);
      }
    }
  }
}

function checkIpcCommandsContractProseCoverage() {
  const tablePath = 'spec/desktop/kernel/tables/ipc-commands.yaml';
  const contractPath = 'spec/desktop/kernel/bridge-ipc-contract.md';
  if (!fileExists(tablePath) || !fileExists(contractPath)) {
    fail(`IPC contract prose coverage inputs missing: ${[tablePath, contractPath].filter((rel) => !fileExists(rel)).join(', ')}`);
    return;
  }

  const table = readYaml(tablePath) || {};
  const commands = (Array.isArray(table?.commands) ? table.commands : [])
    .map((entry) => String(entry?.command || '').trim())
    .filter(Boolean);
  if (commands.length === 0) {
    fail(`${tablePath} has no commands`);
    return;
  }

  const contractContent = read(contractPath);
  const missing = commands.filter((cmd) => !contractContent.includes(cmd));
  if (missing.length > 0) {
    fail(`${tablePath} commands not mentioned in ${contractPath}: ${missing.join(', ')}`);
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

function walkSync(dir, extensions) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') {
        continue;
      }
      results.push(...walkSync(fullPath, extensions));
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      results.push(fullPath);
    }
  }
  return results;
}
