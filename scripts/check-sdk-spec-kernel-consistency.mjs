#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const cwd = process.cwd();

const kernelFiles = [
  'spec/sdk/kernel/index.md',
  'spec/sdk/kernel/surface-contract.md',
  'spec/sdk/kernel/transport-contract.md',
  'spec/sdk/kernel/error-projection.md',
  'spec/sdk/kernel/boundary-contract.md',
  'spec/sdk/kernel/tables/sdk-surfaces.yaml',
  'spec/sdk/kernel/tables/runtime-method-groups.yaml',
  'spec/sdk/kernel/tables/import-boundaries.yaml',
  'spec/sdk/kernel/tables/sdk-error-codes.yaml',
];

const domainFiles = listDomainMarkdownFiles('spec/sdk');

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
  if (!content.includes('Normative Imports: `spec/sdk/kernel/*`')) {
    fail(`${rel} must declare kernel imports`);
  }
  if (!/\bS-[A-Z]+-\d{3}\b/.test(content)) {
    fail(`${rel} must reference at least one sdk kernel Rule ID`);
  }
  if (/\b(listTokenProviderModels|checkTokenProviderHealth|TokenProvider[A-Za-z0-9_]*)\b/.test(content)) {
    fail(`${rel} must not expose token-provider legacy names`);
  }
}
if (domainFiles.length === 0) {
  fail('sdk domain markdown files are empty');
}

checkDomainSection0ImportsCoveredInBody();

for (const rel of ['spec/sdk/scope.md', 'spec/sdk/mod.md']) {
  const content = read(rel);
  if (!content.includes('kernel/transport-contract.md')) {
    fail(`${rel} must import transport contract and declare stream applicability`);
  }
}

const sdkTestingGates = read('spec/sdk/testing-gates.md');
if (!sdkTestingGates.includes('check:sdk-realm-legacy-clean')) {
  fail('spec/sdk/testing-gates.md must include check:sdk-realm-legacy-clean in SDKTEST-030');
}

const allSdkSpecs = walk(path.join(cwd, 'spec/sdk')).filter((p) => p.endsWith('.md') || p.endsWith('.yaml'));
for (const abs of allSdkSpecs) {
  const rel = path.relative(cwd, abs);
  const txt = fs.readFileSync(abs, 'utf8');
  if (/docs\/runtime\/design-|design-connector-auth\.md|design-nimillm\.md|design-local-model\.md/.test(txt)) {
    fail(`legacy runtime design reference found in ${rel}`);
  }
}

const runtimeMethodGroups = readYaml('spec/sdk/kernel/tables/runtime-method-groups.yaml');
const runtimeRpcMethods = readYaml('spec/runtime/kernel/tables/rpc-methods.yaml');
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
  'spec/sdk/kernel/tables/import-boundaries.yaml',
  'spec/sdk/kernel/tables/sdk-error-codes.yaml',
  'spec/sdk/kernel/tables/sdk-surfaces.yaml',
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

const sdkSurfaces = readYaml('spec/sdk/kernel/tables/sdk-surfaces.yaml');
const importBoundaries = readYaml('spec/sdk/kernel/tables/import-boundaries.yaml');
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

const sdkErrorCodes = readYaml('spec/sdk/kernel/tables/sdk-error-codes.yaml');
const hasRealmErrorFamily = (Array.isArray(sdkErrorCodes?.codes) ? sdkErrorCodes.codes : [])
  .some((item) => String(item?.family || '').trim() === 'SDK_REALM');
if (!hasRealmErrorFamily) {
  fail('sdk-error-codes must include at least one SDK_REALM family code');
}

// ── Check: testing-gates provider names vs provider-catalog alignment ──
checkProviderNameAlignment();

if (failed) process.exit(1);
console.log('sdk-spec-kernel-consistency: OK');

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
  // Verify testing-gates SDKTEST-070 references provider-catalog or has a name mapping
  const testingGatesPath = 'spec/sdk/testing-gates.md';
  const providerCatalogPath = 'spec/runtime/kernel/tables/provider-catalog.yaml';
  const mappingReportPath = 'dev/report/sdk-provider-compatibility.md';

  if (!fs.existsSync(path.join(cwd, testingGatesPath))) return;
  if (!fs.existsSync(path.join(cwd, providerCatalogPath))) return;

  const testingGates = read(testingGatesPath);

  // SDKTEST-070 must reference provider-catalog.yaml or maintain a name mapping
  if (!testingGates.includes('provider-catalog.yaml')) {
    fail('SDKTEST-070 must reference provider-catalog.yaml for provider name alignment');
  }

  // If the mapping report exists, verify it references provider-catalog.yaml
  if (fs.existsSync(path.join(cwd, mappingReportPath))) {
    const mappingReport = read(mappingReportPath);
    if (!mappingReport.includes('provider-catalog.yaml')) {
      fail('dev/report/sdk-provider-compatibility.md must reference provider-catalog.yaml');
    }
  }
}
