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

checkNoRetiredDesktopExtensionExecutionKernel();

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
      dir: '.nimi/spec/sdks/kernel',
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

// ── Check 22: Store slice table matches app store composition (D-STATE-001) ──

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

// ── Check 28: IPC commands YAML ↔ active Tauri registration coverage ──

checkIpcCommandsMatchRegisteredTauriCommands();

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

function checkNoRetiredDesktopExtensionExecutionKernel() {
  const retiredRoots = [
    'apps/desktop/src/runtime/execution-kernel',
    'apps/desktop/src/runtime/control-plane',
  ];
  for (const relRoot of retiredRoots) {
    const fullRoot = path.join(cwd, relRoot);
    if (!fs.existsSync(fullRoot)) continue;
    const files = walkSync(fullRoot, ['.ts', '.tsx', '.js', '.mjs'])
      .map((file) => path.relative(cwd, file).replaceAll(path.sep, '/'));
    if (files.length > 0) {
      fail(`retired Desktop extension execution/control-plane files must not exist: ${files.join(', ')}`);
    }
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
  const retryPath = 'sdks/typescript/types/network-retry.ts';
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
  const retryPath = 'sdks/typescript/types/network-retry.ts';
  if (!fileExists(retryPath)) return;

  const content = read(retryPath);
  if (!content.includes('Math.random')) {
    fail('D-NET-002 violation: sdks/typescript/types/network-retry.ts missing jitter (Math.random)');
  }
}

function checkStoreSliceCount() {
  const storePath = 'apps/desktop/src/shell/renderer/app-shell/providers/app-store.ts';
  if (!fileExists(storePath)) return;

  const content = read(storePath);
  const sliceImports = content.match(/create\w+Slice/g) || [];
  const uniqueSlices = new Set(sliceImports);
  const yamlPath = '.nimi/spec/desktop/kernel/tables/store-slices.yaml';
  if (!fileExists(yamlPath)) {
    fail(`D-STATE-001 missing store slices table: ${yamlPath}`);
    return;
  }
  const doc = readYaml(yamlPath);
  const expectedSlices = new Set(
    (Array.isArray(doc?.slices) ? doc.slices : [])
      .map((item) => String(item?.factory || '').trim())
      .filter(Boolean),
  );

  const missingInSource = [...expectedSlices].filter((slice) => !uniqueSlices.has(slice));
  const extraInSource = [...uniqueSlices].filter((slice) => !expectedSlices.has(slice));
  if (missingInSource.length > 0 || extraInSource.length > 0) {
    fail(
      `D-STATE-001 store slices mismatch: missing source factories [${missingInSource.join(', ')}], unknown source factories [${extraInSource.join(', ')}]`,
    );
  }
}

function checkBridgeReasonCodeCoverage() {
  const invokePath = 'apps/desktop/src/shell/renderer/bridge/runtime-bridge/invoke.ts';
  const sdkReasonProjectionPath = 'sdks/typescript/runtime/reason-messages.ts';
  const kitBridgeProjectionPath = 'kit/shell/renderer/src/bridge/nimi-error.ts';
  if (!fileExists(invokePath) || !fileExists(sdkReasonProjectionPath) || !fileExists(kitBridgeProjectionPath)) return;

  const invokeContent = read(invokePath);
  const sdkReasonProjectionContent = read(sdkReasonProjectionPath);
  const kitBridgeProjectionContent = read(kitBridgeProjectionPath);

  if (!invokeContent.includes('getShellBridgeUserMessageProjection')) {
    fail('D-ERR-007 bridge invoke.ts must consume the Kit shell bridge reason projection');
  }
  if (!kitBridgeProjectionContent.includes('getNimiRuntimeReasonCodeMessage')) {
    fail('D-ERR-007 Kit shell bridge must consume the SDK Runtime reason-code projection');
  }

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

  const missing = phase1CriticalCodes.filter((code) => !sdkReasonProjectionContent.includes(code));
  if (missing.length > 0) {
    fail(`D-ERR-007 SDK Runtime reason-code projection missing Phase 1 ReasonCodes: ${missing.join(', ')}`);
  }

  const invokeOwnedRuntimeMappings = phase1CriticalCodes.filter((code) =>
    new RegExp(`(^|[\\s,{])${code}\\s*:`, 'm').test(invokeContent),
  );
  if (invokeOwnedRuntimeMappings.length > 0) {
    fail(`D-ERR-007 bridge invoke.ts must not re-own Runtime ReasonCode mappings: ${invokeOwnedRuntimeMappings.join(', ')}`);
  }
}

function checkLocalRuntimeIpcConsistency() {
  const tablePath = '.nimi/spec/desktop/kernel/tables/ipc-commands.yaml';
  const rustPath = 'apps/desktop/src-tauri/src/main_parts/app_bootstrap.rs';
  const tsPaths = [
    'apps/desktop/src/shell/renderer/bridge/runtime-bridge/local-runtime-os-helpers.ts',
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
      ...content.matchAll(/\binvokeChecked(?:<[^>]+>)?\(\s*'((?:runtime_local_[a-z0-9_]+))'/gu),
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

function checkIpcCommandsMatchRegisteredTauriCommands() {
  const tablePath = '.nimi/spec/desktop/kernel/tables/ipc-commands.yaml';
  const rustPath = 'apps/desktop/src-tauri/src/main_parts/app_bootstrap.rs';
  const kitRegistrationPath = 'kit/shell/tauri/src/command_registration.rs';
  if (!fileExists(tablePath) || !fileExists(rustPath) || !fileExists(kitRegistrationPath)) {
    fail(`IPC registration parity inputs missing: ${[tablePath, rustPath, kitRegistrationPath].filter((rel) => !fileExists(rel)).join(', ')}`);
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

  const seen = new Set();
  const duplicates = [];
  for (const command of commands) {
    if (seen.has(command)) duplicates.push(command);
    seen.add(command);
  }
  if (duplicates.length > 0) {
    fail(`${tablePath} has duplicate commands: ${[...new Set(duplicates)].join(', ')}`);
  }

  let registeredCommands = [];
  try {
    registeredCommands = parseDesktopRegisteredTauriCommands(rustPath, kitRegistrationPath);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    return;
  }
  compareCommandSets(`${tablePath} vs ${rustPath}`, new Set(commands), new Set(registeredCommands));
}

function parseDesktopRegisteredTauriCommands(rustPath, kitRegistrationPath) {
  const source = read(rustPath);
  const macroNames = [
    'nimi_shell_tauri_oauth_runtime_bridge_handler',
    'nimi_shell_tauri_runtime_bridge_handler',
  ];
  for (const macroName of macroNames) {
    const marker = `nimi_shell_tauri::${macroName}!`;
    const markerIndex = source.indexOf(marker);
    if (markerIndex < 0) continue;
    const body = extractBracketBodyAfterMarker(source, marker, markerIndex, rustPath, macroName);
    const runtimeDefaultsMatch = body.match(/@with_runtime_defaults\s+([^;]+);/u);
    const runtimeDefaultsRef = runtimeDefaultsMatch
      ? runtimeDefaultsMatch[1].trim()
      : 'nimi_shell_tauri::runtime_defaults::runtime_defaults';
    const runtimeDefaultsName = parseRustCommandRefName(runtimeDefaultsRef, rustPath, 'runtime defaults entry');
    const appCommandBody = runtimeDefaultsMatch
      ? body.slice(runtimeDefaultsMatch.index + runtimeDefaultsMatch[0].length)
      : body;
    return [
      runtimeDefaultsName,
      ...parseKitMacroBuiltins(kitRegistrationPath, macroName),
      ...parseRustCommandRefs(appCommandBody, rustPath, macroName),
    ];
  }
  const directMarker = 'tauri::generate_handler!';
  const directIndex = source.indexOf(directMarker);
  if (directIndex >= 0) {
    return parseRustCommandRefs(
      extractBracketBodyAfterMarker(source, directMarker, directIndex, rustPath, 'generate_handler'),
      rustPath,
      'generate_handler',
    );
  }
  throw new Error(`${rustPath} missing tauri::generate_handler! or admitted Kit shell handler macro`);
}

function parseKitMacroBuiltins(kitRegistrationPath, macroName) {
  const source = read(kitRegistrationPath);
  const macroIndex = source.indexOf(`macro_rules! ${macroName}`);
  if (macroIndex < 0) {
    throw new Error(`${kitRegistrationPath} missing macro_rules! ${macroName}`);
  }
  const handlerIndex = source.indexOf('tauri::generate_handler!', macroIndex);
  if (handlerIndex < 0) {
    throw new Error(`${kitRegistrationPath} ${macroName} missing tauri::generate_handler!`);
  }
  return parseRustCommandRefs(
    extractBracketBodyAfterMarker(source, 'tauri::generate_handler!', handlerIndex, kitRegistrationPath, macroName),
    kitRegistrationPath,
    macroName,
  ).filter((command) => command !== 'runtime_defaults');
}

function parseRustCommandRefs(body, rel, context) {
  const withoutComments = body
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/\/\/.*$/gmu, '');
  const commands = [];
  for (const raw of withoutComments.split(',')) {
    const ref = raw.trim();
    if (!ref) continue;
    if (ref === '*' || ref.startsWith('$runtime_defaults') || ref.startsWith('$(')) continue;
    commands.push(parseRustCommandRefName(ref, rel, context));
  }
  return commands;
}

function parseRustCommandRefName(ref, rel, context) {
  const match = ref.match(/(?:^|::)([a-z][a-z0-9_]*)$/u);
  if (!match) {
    throw new Error(`${rel} contains unparsable ${context} entry: ${ref}`);
  }
  return match[1];
}

function extractBracketBodyAfterMarker(source, marker, markerIndex, rel, label) {
  const openIndex = source.indexOf('[', markerIndex + marker.length);
  if (openIndex < 0) {
    throw new Error(`${rel} missing ${label} opening bracket`);
  }

  let depth = 0;
  let closeIndex = -1;
  let state = 'code';
  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];
    if (state === 'line_comment') {
      if (ch === '\n') state = 'code';
      continue;
    }
    if (state === 'block_comment') {
      if (ch === '*' && next === '/') {
        state = 'code';
        i += 1;
      }
      continue;
    }
    if (state === 'string') {
      if (ch === '\\') i += 1;
      else if (ch === '"') state = 'code';
      continue;
    }
    if (state === 'char') {
      if (ch === '\\') i += 1;
      else if (ch === "'") state = 'code';
      continue;
    }
    if (ch === '/' && next === '/') {
      state = 'line_comment';
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      state = 'block_comment';
      i += 1;
      continue;
    }
    if (ch === '"') {
      state = 'string';
      continue;
    }
    if (ch === "'") {
      state = 'char';
      continue;
    }
    if (ch === '[') depth += 1;
    if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        closeIndex = i;
        break;
      }
    }
  }
  if (closeIndex < 0) {
    throw new Error(`${rel} ${label} bracket parse did not close`);
  }
  return source.slice(openIndex + 1, closeIndex);
}
