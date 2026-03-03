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
  'spec/desktop/kernel/codegen-contract.md',
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
  return YAML.parse(read(rel));
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

// ── Check 15: Cross-domain K-* references exist in Runtime spec ──

checkCrossDomainKRuleReferences();

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

// ── Check 24: D-* rule evidence full traceability (rules ↔ evidence ↔ files) ──

checkRuleEvidenceTraceability();

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

function checkCrossDomainKRuleReferences() {
  // Collect all K-* Rule ID definitions from Runtime kernel spec
  const runtimeKernelDir = path.join(cwd, 'spec/runtime/kernel');
  if (!fs.existsSync(runtimeKernelDir)) return;

  const runtimeRuleDefinitions = new Set();
  const runtimeMdFiles = fs.readdirSync(runtimeKernelDir)
    .filter((f) => f.endsWith('.md') && !f.startsWith('generated'))
    .map((f) => path.join(runtimeKernelDir, f));

  for (const filePath of runtimeMdFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    const headingPattern = /^##\s+(K-[A-Z]+-\d{3})\b/gm;
    let match;
    while ((match = headingPattern.exec(content)) !== null) {
      runtimeRuleDefinitions.add(match[1]);
    }
  }

  if (runtimeRuleDefinitions.size === 0) return; // No runtime spec to check against

  // Check Desktop kernel files for K-* references
  const kRefPattern = /\bK-[A-Z]+-\d{3}\b/g;
  const kernelMdFiles = kernelFiles.filter(
    (f) => f.endsWith('.md') && !f.includes('/generated/'),
  );

  for (const rel of kernelMdFiles) {
    if (!fileExists(rel)) continue;
    const content = read(rel);
    const refs = new Set([...content.matchAll(kRefPattern)].map((m) => m[0]));
    for (const ref of refs) {
      if (!runtimeRuleDefinitions.has(ref)) {
        fail(`${rel} references undefined Runtime Rule ID: ${ref}`);
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
    'StreamGenerate',
    'SynthesizeSpeechStream',
    'SubscribeMediaJobEvents',
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
