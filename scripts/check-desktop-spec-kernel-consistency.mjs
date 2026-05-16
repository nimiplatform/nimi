#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  checkNoLocalRuleIds,
  checkNoRuleDefinitionHeadings,
  cwd,
  desktopRoot,
  domainFiles,
  fileExists,
  kernelFiles,
  read,
  readYaml,
  sourceRoot,
  walkSync,
} from './lib/check-desktop-spec-kernel-consistency-shared.mjs';
import { checkRendererDesignTables } from './lib/check-desktop-renderer-design-tables.mjs';
import {
  checkDesktopFeatureCoverage,
  checkDesktopTestingGateCoverage,
} from './lib/check-desktop-feature-coverage.mjs';

let failed = false;

function fail(msg) {
  failed = true;
  console.error(`ERROR: ${msg}`);
}

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
  if (!content.includes('Normative Imports: `.nimi/spec/desktop/kernel/*`')) {
    fail(`${rel} must declare kernel imports`);
  }
  checkNoLocalRuleIds(content, rel, fail);
  checkNoRuleDefinitionHeadings(content, rel, fail);
}
if (domainFiles.length === 0) {
  fail('desktop domain markdown files are empty');
}

checkSourceRuleFormats();

const kernelRuleDefinitions = collectKernelRuleDefinitions();

checkUiSlotsConsistency();

checkTurnHookPointsConsistency();

checkModKernelStagesConsistency();

checkModLifecycleStatesConsistency();

checkModAccessModesConsistency();

checkAppTabsConsistency();

checkRetryStatusCodesConsistency();

checkDomainGuidesDoNotOwnRuleRefs();

checkSourceRuleReferentialIntegrity();

checkNoKernelRuleDefinitionsInDomainDocs();

checkRuleIdReferencesResolvable();

checkRendererDesignTables(fail);

checkCrossDomainRuleReferences(
  kernelFiles.filter((f) => f.endsWith('.md') && !f.includes('/generated/')),
  [
    {
      label: 'Runtime',
      dir: '.nimi/spec/runtime/kernel',
      headingPattern: /^##\s+(K-[A-Z]+-\d{3}[a-z]?)\b/gmu,
      refPattern: /\bK-[A-Z]+-\d{3}[a-z]?\b/gu,
    },
    {
      label: 'SDK',
      dir: '.nimi/spec/sdk/kernel',
      headingPattern: /^##\s+(S-[A-Z]+-\d{3}[a-z]?)\b/gmu,
      refPattern: /\bS-[A-Z]+-\d{3}[a-z]?\b/gu,
    },
  ],
);

checkCriticalReasonCodeCoverage();

checkStreamingRpcCoverage();

checkNoCredentialRefIdResidual();

checkNoConsoleLogInSource();

checkNoLegacyStoreImports();

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

checkDesktopTestingGateCoverage(fail, kernelRuleDefinitions);

// ── Check 27: desktop feature coverage table completeness ──

checkDesktopFeatureCoverage(fail, kernelRuleDefinitions);

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

  const slotsBody = resolveDesktopCapabilityArrayBody(capabilitiesPath, 'DEFAULT_UI_SLOTS');
  if (!slotsBody) {
    fail('could not parse DEFAULT_UI_SLOTS from source');
    return;
  }

  const sourceSlots = new Set(
    [...slotsBody.matchAll(/'([^']+)'/g)].map((m) => m[1]),
  );

  const yamlPath = '.nimi/spec/desktop/kernel/tables/ui-slots.yaml';
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

  const pointsBody = resolveDesktopCapabilityArrayBody(capabilitiesPath, 'DEFAULT_TURN_HOOK_POINTS');
  if (!pointsBody) {
    fail('could not parse DEFAULT_TURN_HOOK_POINTS from source');
    return;
  }

  const sourcePoints = new Set(
    [...pointsBody.matchAll(/'([^']+)'/g)].map((m) => m[1]),
  );

  const yamlPath = '.nimi/spec/desktop/kernel/tables/turn-hook-points.yaml';
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

function resolveDesktopCapabilityArrayBody(relPath, constName) {
  const localSource = read(relPath);
  const localMatch = localSource.match(new RegExp(`${constName}\\s*=\\s*\\[([^\\]]+)\\]`, 's'));
  if (localMatch) {
    return localMatch[1];
  }

  if (!new RegExp(`\\b${constName}\\b`).test(localSource)) {
    return null;
  }

  const sharedPath = 'kit/core/src/runtime-capabilities/capabilities.ts';
  if (!fileExists(sharedPath)) {
    return null;
  }
  const sharedSource = read(sharedPath);
  const sharedMatch = sharedSource.match(new RegExp(`${constName}\\s*=\\s*\\[([^\\]]+)\\]`, 's'));
  return sharedMatch ? sharedMatch[1] : null;
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

  const yamlPath = '.nimi/spec/desktop/kernel/tables/mod-kernel-stages.yaml';
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

  const yamlPath = '.nimi/spec/desktop/kernel/tables/mod-lifecycle-states.yaml';
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

  const yamlPath = '.nimi/spec/desktop/kernel/tables/mod-access-modes.yaml';
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

  const yamlPath = '.nimi/spec/desktop/kernel/tables/app-tabs.yaml';
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

  const yamlPath = '.nimi/spec/desktop/kernel/tables/retry-status-codes.yaml';
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

function checkDomainGuidesDoNotOwnRuleRefs() {
  for (const rel of domainFiles) {
    if (!fileExists(rel)) continue;
    const content = read(rel);
    const refs = [...content.matchAll(/\bD-[A-Z]+-\d{3}\b/g)].map((m) => m[0]);
    if (refs.length > 0) {
      fail(`${rel} must remain thin guidance and avoid direct D-* Rule ID references`);
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

  const errBoundaryPath = '.nimi/spec/desktop/kernel/error-boundary-contract.md';
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

  const strmPath = '.nimi/spec/desktop/kernel/streaming-consumption-contract.md';
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
  const tablePath = '.nimi/spec/desktop/kernel/tables/ipc-commands.yaml';
  const rustPath = 'apps/desktop/src-tauri/src/main_parts/app_bootstrap.rs';
  const tsPaths = [
    'apps/desktop/src/runtime/local-runtime/commands.ts',
    'apps/desktop/src/runtime/local-runtime/commands-assets.ts',
    'apps/desktop/src/runtime/local-runtime/commands-services.ts',
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
      // SDK-bridged commands declare coverage via comment markers (not direct Tauri invoke).
      ...content.matchAll(/^\s*\/\/\s+(runtime_local_[a-z0-9_]+)\s*$/gmu),
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
  const evidencePath = '.nimi/spec/desktop/kernel/tables/rule-evidence.yaml';
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
    const requirement = String(item?.evidence_requirement || '').trim().toLowerCase();
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

    if (requirement !== 'required' && requirement !== 'not_applicable') {
      fail(`${evidencePath} ${ruleId} has invalid evidence_requirement: ${requirement || '<empty>'} (allowed: required|not_applicable)`);
      continue;
    }

    if (requirement === 'not_applicable') {
      if (!naReason) {
        fail(`${evidencePath} ${ruleId} evidence_requirement=not_applicable requires na_reason`);
      }
      continue;
    }

    if (refs.length === 0) {
      fail(`${evidencePath} ${ruleId} evidence_requirement=required requires non-empty evidence_refs`);
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

function checkIpcCommandsContractProseCoverage() {
  const tablePath = '.nimi/spec/desktop/kernel/tables/ipc-commands.yaml';
  const contractPath = '.nimi/spec/desktop/kernel/bridge-ipc-contract.md';
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
