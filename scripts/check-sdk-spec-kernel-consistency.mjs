#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const cwd = path.resolve(scriptDir, '..');

const kernelFiles = [
  '.nimi/spec/sdk/kernel/index.md',
  '.nimi/spec/sdk/kernel/surface-contract.md',
  '.nimi/spec/sdk/kernel/transport-contract.md',
  '.nimi/spec/sdk/kernel/error-projection.md',
  '.nimi/spec/sdk/kernel/boundary-contract.md',
  '.nimi/spec/sdk/kernel/runtime-contract.md',
  '.nimi/spec/sdk/kernel/world-evolution-engine-projection-contract.md',
  '.nimi/spec/sdk/kernel/world-evolution-engine-consumer-contract.md',
  '.nimi/spec/sdk/kernel/realm-contract.md',
  '.nimi/spec/sdk/kernel/ai-provider-contract.md',
  '.nimi/spec/sdk/kernel/scope-contract.md',
  '.nimi/spec/sdk/kernel/mod-contract.md',
  '.nimi/spec/sdk/kernel/testing-gates-contract.md',
  '.nimi/spec/sdk/kernel/tables/sdk-surfaces.yaml',
  '.nimi/spec/sdk/kernel/tables/runtime-method-groups.yaml',
  '.nimi/spec/sdk/kernel/tables/import-boundaries.yaml',
  '.nimi/spec/sdk/kernel/tables/sdk-error-codes.yaml',
  '.nimi/spec/sdk/kernel/tables/sdk-runtime-behavioral-checks.yaml',
  '.nimi/spec/sdk/kernel/tables/sdk-realm-realtime-gates.yaml',
  '.nimi/spec/sdk/kernel/tables/sdk-testing-gates.yaml',
  '.nimi/spec/sdk/kernel/tables/rule-evidence.yaml',
];

const domainFiles = listDomainMarkdownFiles('.nimi/spec/sdk');

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

for (const rel of kernelFiles) {
  if (!fs.existsSync(path.join(cwd, rel))) fail(`missing sdk kernel file: ${rel}`);
}

for (const rel of domainFiles) {
  if (!fs.existsSync(path.join(cwd, rel))) {
    fail(`missing sdk domain file: ${rel}`);
    continue;
  }
  const content = read(rel);
  if (!content.includes('Normative Imports: `.nimi/spec/sdk/kernel/*`')) {
    fail(`${rel} must declare kernel imports`);
  }
  if (!/\bS-[A-Z]+-\d{3}\b/.test(content)) {
    fail(`${rel} must reference at least one sdk kernel Rule ID`);
  }
  checkNoLocalRuleIds(content, rel);
  checkNoRuleDefinitionHeadings(content, rel);
  if (/\b(listTokenProviderModels|checkTokenProviderHealth|TokenProvider[A-Za-z0-9_]*)\b/.test(content)) {
    fail(`${rel} must not expose token-provider legacy names`);
  }
}
if (domainFiles.length === 0) {
  fail('sdk domain markdown files are empty');
}

checkDomainSection0ImportsCoveredInBody();

for (const rel of ['.nimi/spec/sdk/scope.md', '.nimi/spec/sdk/mod.md']) {
  const content = read(rel);
  if (!content.includes('kernel/transport-contract.md')) {
    fail(`${rel} must import transport contract and declare stream applicability`);
  }
}

const allSdkSpecs = walk(path.join(cwd, '.nimi/spec/sdk')).filter((p) => p.endsWith('.md') || p.endsWith('.yaml'));
const sdkRuntimeSourceFiles = walk(path.join(cwd, 'sdk/src/runtime'))
  .filter((p) => p.endsWith('.ts'))
  .filter((p) => !p.includes(`${path.sep}generated${path.sep}`));
for (const abs of allSdkSpecs) {
  const rel = path.relative(cwd, abs);
  const txt = fs.readFileSync(abs, 'utf8');
  if (/docs\/runtime\/design-|design-connector-auth\.md|design-nimillm\.md|design-local-model\.md/.test(txt)) {
    fail(`legacy runtime design reference found in ${rel}`);
  }
}

const runtimeMethodGroups = readYaml('.nimi/spec/sdk/kernel/tables/runtime-method-groups.yaml');
const runtimeRpcMethods = readYaml('.nimi/spec/runtime/kernel/tables/rpc-methods.yaml');
const sdkKernelRules = kernelRuleSet();
const runtimeServices = new Map(
  (Array.isArray(runtimeRpcMethods?.services) ? runtimeRpcMethods.services : []).map((service) => {
    const serviceName = String(service?.name || '').trim();
    const methodSet = new Set(
      (Array.isArray(service?.methods) ? service.methods : [])
        .map((method) => String(method?.name || '').trim())
        .filter(Boolean),
    );
    return [serviceName, methodSet];
  }).filter(([serviceName]) => Boolean(serviceName)),
);
const coveredServices = new Set();
for (const group of Array.isArray(runtimeMethodGroups?.groups) ? runtimeMethodGroups.groups : []) {
  const groupName = String(group?.group || '').trim();
  const sourceRule = String(group?.source_rule || '').trim();
  const serviceName = String(group?.service || '').trim();
  if (!/^S-[A-Z]+-\d{3}$/u.test(sourceRule)) {
    fail(`runtime-method-groups invalid source_rule: ${sourceRule}`);
  } else if (!sdkKernelRules.has(sourceRule)) {
    fail(`runtime-method-groups references undefined sdk kernel Rule ID: ${sourceRule}`);
  }
  if (group?.phase == null || ![1, 2].includes(group.phase)) {
    fail(`runtime-method-groups group ${groupName || '(unnamed)'} must declare phase (1 or 2)`);
  }
  const validStatuses = ['active', 'blocked', 'deferred'];
  const status = String(group?.status || '').trim();
  if (!status) {
    fail(`runtime-method-groups group ${groupName || '(unnamed)'} must declare status (active, blocked, or deferred)`);
  } else if (!validStatuses.includes(status)) {
    fail(`runtime-method-groups group ${groupName || '(unnamed)'} has invalid status: ${status} (must be one of: ${validStatuses.join(', ')})`);
  }
  if (status === 'blocked') {
    const blockedReason = String(group?.blocked_reason || '').trim();
    if (!blockedReason) {
      fail(`runtime-method-groups group ${groupName || '(unnamed)'} has status=blocked but missing blocked_reason`);
    }
  }
  if (!serviceName) {
    fail(`runtime-method-groups group ${groupName || '(unnamed)'} must declare service`);
    continue;
  }
  const serviceMethods = runtimeServices.get(serviceName);
  if (!serviceMethods) {
    fail(`runtime-method-groups group ${groupName || '(unnamed)'} references unknown runtime service: ${serviceName}`);
    continue;
  }
  coveredServices.add(serviceName);
  const methods = Array.isArray(group?.methods) ? group.methods : [];
  for (const method of methods.map((v) => String(v).trim()).filter(Boolean)) {
    if (!serviceMethods.has(method)) {
      fail(`runtime-method-groups ${groupName || '(unnamed)'} references unknown ${serviceName} method: ${method}`);
    }
  }
}
for (const serviceName of runtimeServices.keys()) {
  if (!coveredServices.has(serviceName)) {
    fail(`runtime-method-groups missing projection for runtime service: ${serviceName}`);
  }
}

for (const rel of [
  '.nimi/spec/sdk/kernel/tables/import-boundaries.yaml',
  '.nimi/spec/sdk/kernel/tables/sdk-error-codes.yaml',
  '.nimi/spec/sdk/kernel/tables/sdk-surfaces.yaml',
]) {
  const doc = readYaml(rel);
  const values = JSON.stringify(doc);
  const refs = [...values.matchAll(/\bS-[A-Z]+-\d{3}\b/g)];
  for (const ref of refs) {
    const ruleId = ref[0];
    if (!sdkKernelRules.has(ruleId)) {
      fail(`${rel} references undefined sdk kernel Rule ID: ${ruleId}`);
    }
  }
}

const sdkSurfaces = readYaml('.nimi/spec/sdk/kernel/tables/sdk-surfaces.yaml');
const importBoundaries = readYaml('.nimi/spec/sdk/kernel/tables/import-boundaries.yaml');
const expectedBoundarySurfaces = new Set(
  (Array.isArray(sdkSurfaces?.surfaces) ? sdkSurfaces.surfaces : [])
    .map((item) => String(item?.package_subpath || '').trim())
    .filter((subpath) => subpath.startsWith('@nimiplatform/sdk/'))
    .map((subpath) => subpath.replace('@nimiplatform/sdk/', '')),
);
const actualBoundarySurfaces = new Set(
  (Array.isArray(importBoundaries?.rules) ? importBoundaries.rules : [])
    .map((rule) => String(rule?.surface || '').trim())
    .filter(Boolean),
);
for (const surface of expectedBoundarySurfaces) {
  if (!actualBoundarySurfaces.has(surface)) {
    fail(`import-boundaries missing surface rule for: ${surface}`);
  }
}
for (const rule of Array.isArray(importBoundaries?.rules) ? importBoundaries.rules : []) {
  const surface = String(rule?.surface || '').trim();
  const ruleIds = boundarySourceRules(rule);
  if (!surface) {
    fail('import-boundaries contains empty surface name');
    continue;
  }
  if (ruleIds.length === 0) {
    fail(`import-boundaries surface ${surface} must declare source_rules`);
    continue;
  }
  for (const ruleId of ruleIds) {
    if (!/^S-[A-Z]+-\d{3}$/u.test(ruleId)) {
      fail(`import-boundaries surface ${surface} contains invalid rule id: ${ruleId}`);
      continue;
    }
    if (!sdkKernelRules.has(ruleId)) {
      fail(`import-boundaries surface ${surface} references undefined sdk kernel Rule ID: ${ruleId}`);
    }
  }
  if (!ruleIds.includes('S-BOUNDARY-001')) {
    fail(`import-boundaries surface ${surface} must include baseline S-BOUNDARY-001`);
  }
  if ((surface === 'runtime' || surface === 'realm') && !ruleIds.includes('S-BOUNDARY-002')) {
    fail(`import-boundaries surface ${surface} must include S-BOUNDARY-002`);
  }
  if (surface === 'mod' && !ruleIds.includes('S-BOUNDARY-003')) {
    fail('import-boundaries surface mod must include S-BOUNDARY-003');
  }
}

const sdkErrorCodes = readYaml('.nimi/spec/sdk/kernel/tables/sdk-error-codes.yaml');
const hasRealmErrorFamily = (Array.isArray(sdkErrorCodes?.codes) ? sdkErrorCodes.codes : [])
  .some((item) => String(item?.family || '').trim() === 'SDK_REALM');
if (!hasRealmErrorFamily) {
  fail('sdk-error-codes must include at least one SDK_REALM family code');
}
checkSdkLocalReasonCodesRegistered(sdkErrorCodes);

// ── Check: testing-gates provider names vs provider-catalog alignment ──
checkSdkTestingGateCoverage(sdkKernelRules);
checkProviderNameAlignment();

// ── Check: Cross-domain references exist in upstream specs ──
checkCrossDomainRuleReferences();

// ── Check: S-* rule evidence full traceability ──
checkRuleEvidenceTraceability(sdkKernelRules);

// ── Check: Orphan detection (rules defined but never referenced) ──
checkOrphanRules();

if (failed) process.exit(1);
console.log('sdk-spec-kernel-consistency: OK');

function checkCrossDomainRuleReferences() {
  const checks = [
    {
      label: 'Runtime',
      dir: '.nimi/spec/runtime/kernel',
      headingPattern: /^##\s+(K-[A-Z]+-\d{3}[a-z]?)\b/gm,
      refPattern: /\bK-[A-Z]+-\d{3}[a-z]?\b/g,
    },
    {
      label: 'Desktop',
      dir: '.nimi/spec/desktop/kernel',
      headingPattern: /^##\s+(D-[A-Z]+-\d{3}[a-z]?)\b/gm,
      refPattern: /\bD-[A-Z]+-\d{3}[a-z]?\b/g,
    },
  ];

  for (const check of checks) {
    const root = path.join(cwd, check.dir);
    if (!fs.existsSync(root)) continue;
    const definitions = new Set();
    for (const f of fs.readdirSync(root).filter((name) => name.endsWith('.md'))) {
      const filePath = path.join(root, f);
      if (!fs.statSync(filePath).isFile()) continue;
      const content = fs.readFileSync(filePath, 'utf8');
      for (const match of content.matchAll(check.headingPattern)) {
        definitions.add(match[1]);
      }
    }
    if (definitions.size === 0) continue;

    for (const rel of kernelFiles.filter((f) => f.endsWith('.md'))) {
      if (!fs.existsSync(path.join(cwd, rel))) continue;
      const content = read(rel);
      for (const ref of new Set([...content.matchAll(check.refPattern)].map((match) => match[0]))) {
        if (!definitions.has(ref)) {
          fail(`${rel} references undefined ${check.label} Rule ID: ${ref}`);
        }
      }
    }
  }
}

function checkRuleEvidenceTraceability(sdkKernelRules) {
  const evidencePath = '.nimi/spec/sdk/kernel/tables/rule-evidence.yaml';
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
    if (!type) fail(`${evidencePath} evidence_catalog.${ref} missing type`);
    if (!command) fail(`${evidencePath} evidence_catalog.${ref} missing command`);
    if (!targetPath) {
      fail(`${evidencePath} evidence_catalog.${ref} missing path`);
      continue;
    }
    if (!fs.existsSync(path.join(cwd, targetPath))) {
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
    if (!/^S-[A-Z]+-\d{3}[a-z]?$/u.test(ruleId)) {
      fail(`${evidencePath} has invalid rule_id format: ${ruleId || '<empty>'}`);
      continue;
    }
    if (seen.has(ruleId)) {
      fail(`${evidencePath} has duplicate rule_id entry: ${ruleId}`);
      continue;
    }
    seen.add(ruleId);
    if (!sdkKernelRules.has(ruleId)) {
      fail(`${evidencePath} references unknown sdk kernel rule: ${ruleId}`);
    }
    if (status !== 'covered' && status !== 'na') {
      fail(`${evidencePath} ${ruleId} has invalid status: ${status || '<empty>'} (allowed: covered|na)`);
      continue;
    }
    if (status === 'na') {
      if (!naReason) fail(`${evidencePath} ${ruleId} status=na requires na_reason`);
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

  const missing = [...sdkKernelRules].filter((ruleId) => !seen.has(ruleId));
  if (missing.length > 0) {
    fail(`${evidencePath} missing evidence rows for rules: ${missing.join(', ')}`);
  }
}

function checkSdkLocalReasonCodesRegistered(sdkErrorCodesTable) {
  const registeredCodes = new Set(
    (Array.isArray(sdkErrorCodesTable?.codes) ? sdkErrorCodesTable.codes : [])
      .map((item) => String(item?.name || '').trim())
      .filter(Boolean),
  );

  const discoveredCodes = new Map();
  const localReasonCodePattern = /['"`](SDK_[A-Z0-9_]+)['"`]/g;

  for (const abs of sdkRuntimeSourceFiles) {
    const rel = path.relative(cwd, abs);
    const content = fs.readFileSync(abs, 'utf8');
    for (const match of content.matchAll(localReasonCodePattern)) {
      const code = String(match[1] || '').trim();
      if (!code) continue;
      const refs = discoveredCodes.get(code) || new Set();
      refs.add(rel);
      discoveredCodes.set(code, refs);
    }
  }

  for (const [code, refs] of discoveredCodes.entries()) {
    if (!registeredCodes.has(code)) {
      fail(`sdk-error-codes missing SDK local reason code used in runtime source: ${code} (${[...refs].sort().join(', ')})`);
    }
  }
}

function checkOrphanRules() {
  const allRefs = [];
  for (const rel of [...kernelFiles, ...domainFiles]) {
    if (!fs.existsSync(path.join(cwd, rel))) continue;
    if (rel.endsWith('rule-evidence.yaml')) continue;
    const content = read(rel);
    for (const m of content.matchAll(/\bS-[A-Z]+-\d{3}[a-z]?\b/g)) {
      allRefs.push(m[0]);
    }
  }
  const orphans = [...sdkKernelRules].filter((id) => {
    let count = 0;
    for (const ref of allRefs) {
      if (ref === id) count++;
    }
    return count <= 1; // Only the definition heading itself
  });
  if (orphans.length > 0) {
    fail(`sdk orphan kernel rules detected: ${orphans.join(', ')}`);
  }
}

function kernelRuleSet() {
  const out = new Set();
  for (const rel of kernelFiles.filter((f) => f.endsWith('.md'))) {
    const txt = read(rel);
    const defs = [...txt.matchAll(/^##\s+(S-[A-Z]+-\d{3})\b/gmu)];
    for (const m of defs) out.add(m[1]);
  }
  return out;
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

function listDomainMarkdownFiles(domainDirRel) {
  const domainDir = path.join(cwd, domainDirRel);
  if (!fs.existsSync(domainDir)) return [];
  return fs.readdirSync(domainDir)
    .filter((name) => name.endsWith('.md'))
    .filter((name) => name !== 'index.md')
    .map((name) => path.posix.join(domainDirRel, name))
    .sort((a, b) => a.localeCompare(b));
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

    // Extract S-<DOMAIN>-* wildcard imports from Section 0
    const wildcardImports = [...section0Text.matchAll(/S-([A-Z]+)-\*/g)];
    const importedDomains = new Set(wildcardImports.map((m) => m[1]));

    for (const domain of importedDomains) {
      const specificPattern = new RegExp(`\\bS-${domain}-\\d{3}\\b`);
      if (!specificPattern.test(bodyText)) {
        fail(`${rel} Section 0 imports S-${domain}-* but body has no specific S-${domain}-NNN reference`);
      }
    }

    // Reverse check: body wildcards must be declared in Section 0
    const bodyWildcards = [...bodyText.matchAll(/S-([A-Z]+)-\*/g)];
    const bodyWildcardDomains = new Set(bodyWildcards.map((m) => m[1]));
    for (const domain of bodyWildcardDomains) {
      if (!importedDomains.has(domain)) {
        fail(`${rel} body references S-${domain}-* but Section 0 does not import it`);
      }
    }
  }
}

function boundarySourceRules(rule) {
  const fromArray = Array.isArray(rule?.source_rules)
    ? rule.source_rules.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  if (fromArray.length > 0) return fromArray;
  const fromSingle = String(rule?.source_rule || '').trim();
  return fromSingle ? [fromSingle] : [];
}

function checkProviderNameAlignment() {
  // Verify testing-gates S-GATE-070 references provider-catalog or has a name mapping
  const testingGatesPath = '.nimi/spec/sdk/testing-gates.md';
  const providerCatalogPath = '.nimi/spec/runtime/kernel/tables/provider-catalog.yaml';
  const mappingReportPath = '.local/report/sdk-provider-compatibility.md';

  if (!fs.existsSync(path.join(cwd, testingGatesPath))) return;
  if (!fs.existsSync(path.join(cwd, providerCatalogPath))) return;

  const testingGates = read(testingGatesPath);

  // S-GATE-070 must reference provider-catalog.yaml or maintain a name mapping
  if (!testingGates.includes('provider-catalog.yaml')) {
    fail('S-GATE-070 must reference provider-catalog.yaml for provider name alignment');
  }

  // If the mapping report exists, verify it references provider-catalog.yaml
  if (fs.existsSync(path.join(cwd, mappingReportPath))) {
    const mappingReport = read(mappingReportPath);
    if (!mappingReport.includes('provider-catalog.yaml')) {
      fail('.local/report/sdk-provider-compatibility.md must reference provider-catalog.yaml');
    }
  }
}

function checkSdkTestingGateCoverage(sdkKernelRules) {
  const tablePath = '.nimi/spec/sdk/kernel/tables/sdk-testing-gates.yaml';
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
    if (!/^S-[A-Z]+-\d{3}$/u.test(sourceRule)) {
      fail(`${tablePath} gate ${gate} has invalid source_rule: ${sourceRule}`);
      continue;
    }
    if (!sdkKernelRules.has(sourceRule)) {
      fail(`${tablePath} gate ${gate} references undefined sdk kernel Rule ID: ${sourceRule}`);
    }
  }

  const requiredGates = [
    ['unit_module', 'S-GATE-010', ['pnpm --filter @nimiplatform/sdk test']],
    ['consumer_smoke', 'S-GATE-010', ['pnpm check:sdk-consumer-smoke']],
    ['boundary_checks', 'S-GATE-020', ['pnpm check:sdk-import-boundary', 'pnpm check:sdk-public-naming']],
    ['vnext_matrix', 'S-GATE-030', ['pnpm check:sdk-vnext-matrix']],
    ['mod_scope', 'S-GATE-040', ['pnpm check:mods-no-runtime-sdk']],
    ['runtime_projection', 'S-GATE-050', ['pnpm check:runtime-bridge-method-drift']],
    ['coverage', 'S-GATE-060', ['pnpm check:sdk-coverage']],
    ['provider_alignment', 'S-GATE-070', ['pnpm check:live-provider-invariants']],
    ['live_smoke', 'S-GATE-080', ['node scripts/run-live-test-matrix.mjs', 'pnpm check:live-smoke-gate']],
    ['version_matrix', 'S-GATE-090', ['pnpm check:sdk-version-matrix']],
    ['release_parity', 'S-GATE-090', ['pnpm check:live-smoke-gate --require-release']],
    ['spec_consistency', 'S-GATE-091', ['pnpm check:sdk-spec-kernel-consistency']],
    ['docs_drift', 'S-GATE-091', ['pnpm check:sdk-spec-kernel-docs-drift']],
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
