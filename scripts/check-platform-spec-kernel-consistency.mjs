#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { checkNimiDesignTables } from './lib/platform-spec-design-table-checks.mjs';
import { readYamlWithFragments } from './lib/read-yaml-with-fragments.mjs';

const cwd = process.cwd();

let failed = false;

function fail(msg) {
  failed = true;
  console.error(`ERROR: ${msg}`);
}

function warn(msg) {
  console.error(`WARNING: ${msg}`);
}

function read(rel) {
  return fs.readFileSync(path.join(cwd, rel), 'utf8');
}

function readYaml(rel) {
  return readYamlWithFragments(path.join(cwd, rel));
}

// --- Load tables ---

const errorCodesTable = readYaml('.nimi/spec/platform/kernel/tables/protocol-error-codes.yaml');
const primitivesTable = readYaml('.nimi/spec/platform/kernel/tables/protocol-primitives.yaml');
const complianceTable = readYaml('.nimi/spec/platform/kernel/tables/compliance-test-matrix.yaml');
const auditTable = readYaml('.nimi/spec/platform/kernel/tables/audit-events.yaml');
const presetsTable = readYaml('.nimi/spec/platform/kernel/tables/app-authorization-presets.yaml');
const profilesTable = readYaml('.nimi/spec/platform/kernel/tables/participant-profiles.yaml');
const errorCodeMappingTable = readYaml('.nimi/spec/platform/kernel/tables/error-code-mapping.yaml');
const runtimeReasonCodesTable = readYaml('.nimi/spec/runtime/kernel/tables/reason-codes.yaml');
const designTokensTable = readYaml('.nimi/spec/platform/kernel/tables/nimi-ui-tokens.yaml');
const designPrimitivesTable = readYaml('.nimi/spec/platform/kernel/tables/nimi-ui-primitives.yaml');
const designThemesTable = readYaml('.nimi/spec/platform/kernel/tables/nimi-ui-themes.yaml');
const designAdoptionTable = readYaml('.nimi/spec/platform/kernel/tables/nimi-ui-adoption.yaml');
const designCompositionsTable = readYaml('.nimi/spec/platform/kernel/tables/nimi-ui-compositions.yaml');
const designAllowlistsTable = readYaml('.nimi/spec/platform/kernel/tables/nimi-ui-allowlists.yaml');
const nimiKitRegistryTable = readYaml('.nimi/spec/platform/kernel/tables/nimi-kit-registry.yaml');
const appSliceAdmissionsTable = readYaml('.nimi/spec/platform/kernel/tables/app-slice-admissions.yaml');
const auditEvidenceRootsTable = readYaml('.nimi/spec/platform/kernel/tables/audit-evidence-roots.yaml');
const packageAuthorityAdmissionsTable = readYaml('.nimi/spec/platform/kernel/tables/package-authority-admissions.yaml');
const delegatedProjectionAdmissionsTable = readYaml('.nimi/spec/platform/kernel/tables/delegated-projection-admissions.yaml');
const aiProfileFactoryCatalogTable = readYaml('.nimi/spec/platform/kernel/tables/ai-profile-factory-catalog.yaml');
const nimiAppRegistryTable = readYaml('.nimi/spec/platform/kernel/tables/nimi-app-registry.yaml');
const nimiAppTrustTiersTable = readYaml('.nimi/spec/platform/kernel/tables/nimi-app-trust-tiers.yaml');
const ruleEvidenceTable = readYaml('.nimi/spec/platform/kernel/tables/rule-evidence.yaml');
const structuralOnlyCoverageRuleIds = new Set(
  (Array.isArray(complianceTable?.layers) ? complianceTable.layers : [])
    .filter((layer) => ['L3_almi', 'L3_arch'].includes(String(layer?.layer || '').trim()))
    .flatMap((layer) => Array.isArray(layer?.items) ? layer.items : [])
    .map((item) => String(item?.source_rule || '').trim())
    .filter(Boolean),
);

// ========================================================
// Check 1: Error code name uniqueness
// ========================================================

const codes = Array.isArray(errorCodesTable?.codes) ? errorCodesTable.codes : [];
const codeNames = new Set();
for (const code of codes) {
  const name = String(code?.name || '').trim();
  if (!name) {
    fail('protocol-error-codes.yaml: entry missing name');
    continue;
  }
  if (codeNames.has(name)) {
    fail(`protocol-error-codes.yaml: duplicate error code name: ${name}`);
  }
  codeNames.add(name);

  // Check source format: P-PROTO-NNN
  const source = String(code?.source_rule || '').trim();
  if (source && !/^P-[A-Z]{2,12}-\d{3}$/u.test(source)) {
    fail(`protocol-error-codes.yaml ${name}: invalid source_rule format: ${source}`);
  }

  // Check required fields
  if (!String(code?.group || '').trim()) {
    fail(`protocol-error-codes.yaml ${name}: missing required field: group`);
  }
}

// ========================================================
// Check 2: Primitive completeness
// ========================================================

const primitives = Array.isArray(primitivesTable?.primitives) ? primitivesTable.primitives : [];
const requiredPrimitives = new Set(['timeflow', 'social', 'economy', 'transit', 'context', 'presence']);
const foundPrimitives = new Set();

for (const prim of primitives) {
  const name = String(prim?.name || '').trim();
  if (!name) {
    fail('protocol-primitives.yaml: entry missing name');
    continue;
  }
  foundPrimitives.add(name);

  // Check source format
  const source = String(prim?.source_rule || '').trim();
  if (source && !/^P-[A-Z]{2,12}-\d{3}$/u.test(source)) {
    fail(`protocol-primitives.yaml ${name}: invalid source_rule format: ${source}`);
  }

  // Check fields exist
  const fields = Array.isArray(prim?.fields) ? prim.fields : [];
  if (fields.length === 0) {
    fail(`protocol-primitives.yaml ${name}: fields must not be empty`);
  }

  // Check rules exist
  const rules = Array.isArray(prim?.rules) ? prim.rules : [];
  if (rules.length === 0) {
    fail(`protocol-primitives.yaml ${name}: rules must not be empty`);
  }
}

for (const required of requiredPrimitives) {
  if (!foundPrimitives.has(required)) {
    fail(`protocol-primitives.yaml: missing required primitive: ${required}`);
  }
}

// ========================================================
// Check 3: Compliance matrix layer completeness
// ========================================================

const layers = Array.isArray(complianceTable?.layers) ? complianceTable.layers : [];
if (layers.length === 0) {
  fail('compliance-test-matrix.yaml: layers must not be empty');
}

for (const layer of layers) {
  const layerName = String(layer?.layer || '').trim();
  if (!layerName) {
    fail('compliance-test-matrix.yaml: layer entry missing layer name');
    continue;
  }
  const items = Array.isArray(layer?.items) ? layer.items : [];
  if (items.length === 0) {
    fail(`compliance-test-matrix.yaml ${layerName}: items must not be empty`);
  }
  for (const item of items) {
    const itemName = String(item?.item || '').trim();
    if (!itemName) {
      fail(`compliance-test-matrix.yaml ${layerName}: item missing name`);
    }
    const source = String(item?.source_rule || '').trim();
    if (source && !/^P-[A-Z]{2,12}-\d{3}$/u.test(source)) {
      fail(`compliance-test-matrix.yaml ${layerName}/${itemName}: invalid source_rule format: ${source}`);
    }
  }
}

// ========================================================
// Check 4: Audit events source format
// ========================================================

const events = Array.isArray(auditTable?.events) ? auditTable.events : [];
const eventNames = new Set();
for (const event of events) {
  const name = String(event?.name || '').trim();
  if (!name) {
    fail('audit-events.yaml: entry missing name');
    continue;
  }
  if (eventNames.has(name)) {
    fail(`audit-events.yaml: duplicate event name: ${name}`);
  }
  eventNames.add(name);

  const source = String(event?.source_rule || '').trim();
  if (source && !/^P-[A-Z]{2,12}-\d{3}$/u.test(source)) {
    fail(`audit-events.yaml ${name}: invalid source_rule format: ${source}`);
  }
}
checkAuditEventFieldSemantics(eventNames);

// ========================================================
// Check 5: Authorization presets
// ========================================================

const presets = Array.isArray(presetsTable?.presets) ? presetsTable.presets : [];
const requiredPresets = new Set(['readOnly', 'full', 'delegate']);
const foundPresets = new Set();
const presetsByName = new Map();

for (const preset of presets) {
  const name = String(preset?.name || '').trim();
  if (!name) {
    fail('app-authorization-presets.yaml: entry missing name');
    continue;
  }
  foundPresets.add(name);
  presetsByName.set(name, preset);

  const source = String(preset?.source_rule || '').trim();
  if (source && !/^P-[A-Z]{2,12}-\d{3}$/u.test(source)) {
    fail(`app-authorization-presets.yaml ${name}: invalid source_rule format: ${source}`);
  }
}

for (const required of requiredPresets) {
  if (!foundPresets.has(required)) {
    fail(`app-authorization-presets.yaml: missing required preset: ${required}`);
  }
}
checkAuthorizationPresetSemantics(presetsByName);

function checkAuditEventFieldSemantics(eventNames) {
  const rel = '.nimi/spec/platform/kernel/tables/audit-events.yaml';
  const baseFields = stringList(auditTable?.base_required_fields);
  if (baseFields.length === 0) {
    fail(`${rel}: base_required_fields must not be empty`);
  }
  checkUniqueList(baseFields, `${rel}: base_required_fields`);

  const groups = new Set(events.map((event) => String(event?.group || '').trim()).filter(Boolean));
  const groupContextFields = auditTable?.group_context_fields && typeof auditTable.group_context_fields === 'object'
    ? auditTable.group_context_fields
    : null;
  if (!groupContextFields) {
    fail(`${rel}: group_context_fields must be defined`);
  } else {
    for (const group of groups) {
      const fields = stringList(groupContextFields[group]);
      if (fields.length === 0) {
        fail(`${rel}: group_context_fields.${group} must list fields for declared event group`);
      }
      checkUniqueList(fields, `${rel}: group_context_fields.${group}`);
    }
    for (const group of Object.keys(groupContextFields)) {
      if (!groups.has(group)) {
        fail(`${rel}: group_context_fields.${group} has no declared event`);
      }
    }
  }

  const eventSpecificFields = auditTable?.event_specific_fields && typeof auditTable.event_specific_fields === 'object'
    ? auditTable.event_specific_fields
    : null;
  if (!eventSpecificFields) {
    fail(`${rel}: event_specific_fields must be defined`);
  } else {
    for (const [eventName, rawFields] of Object.entries(eventSpecificFields)) {
      if (!eventNames.has(eventName)) {
        fail(`${rel}: event_specific_fields.${eventName} is not a declared audit event`);
        continue;
      }
      const fields = stringList(rawFields);
      if (fields.length === 0) {
        fail(`${rel}: event_specific_fields.${eventName} must list fields`);
      }
      checkUniqueList(fields, `${rel}: event_specific_fields.${eventName}`);
    }
  }
}

function stringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

function checkUniqueList(values, label) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) {
      fail(`${label} contains duplicate item: ${value}`);
    }
    seen.add(value);
  }
}

// ========================================================
// Check 6: Participant profiles
// ========================================================

const profiles = Array.isArray(profilesTable?.profiles) ? profilesTable.profiles : [];
if (profiles.length === 0) {
  fail('participant-profiles.yaml: profiles must not be empty');
}

for (const profile of profiles) {
  const pid = String(profile?.participant_id || '').trim();
  if (!pid) {
    fail('participant-profiles.yaml: entry missing participant_id');
    continue;
  }

  const source = String(profile?.source_rule || '').trim();
  if (source && !/^P-[A-Z]{2,12}-\d{3}$/u.test(source)) {
    fail(`participant-profiles.yaml ${pid}: invalid source_rule format: ${source}`);
  }
}

// ========================================================
// Check 7: Cross-table source reference consistency
// ========================================================

// Collect all P-* rule IDs referenced across tables
const allSourceRefs = new Set();
for (const code of codes) {
  const source = String(code?.source_rule || '').trim();
  if (source) allSourceRefs.add(source);
}
for (const prim of primitives) {
  const source = String(prim?.source_rule || '').trim();
  if (source) allSourceRefs.add(source);
}
for (const event of events) {
  const source = String(event?.source_rule || '').trim();
  if (source) allSourceRefs.add(source);
}

// Verify all references match P-*-NNN format
for (const ref of allSourceRefs) {
  if (!/^P-[A-Z]{2,12}-\d{3}$/u.test(ref)) {
    fail(`cross-table: invalid P-* rule ID format: ${ref}`);
  }
}

// ========================================================
// Check 8: Kernel contract files exist
// ========================================================

const kernelDir = path.join(cwd, '.nimi', 'spec', 'platform', 'kernel');
const requiredKernelFiles = [
  'index.md',
  'protocol-contract.md',
  'architecture-contract.md',
  'ai-last-mile-contract.md',
  'ai-scope-contract.md',
  'design-pattern-contract.md',
  'kit-contract.md',
  'capability-catalog-contract.md',
  'app-slice-admission-contract.md',
  'web-release-contract.md',
  'package-authority-admission-contract.md',
  'ai-profile-selection-policy-contract.md',
  'nimi-home-contract.md',
  'nimi-self-update-contract.md',
  'nimi-package-release-contract.md',
  'cold-start-authority-contract.md',
  'nimi-app-admission-contract.md',
  'nimi-app-audit-pipeline-contract.md',
  'nimi-app-developer-workflow-contract.md',
  'nimi-app-scaffolding-contract.md',
  'mod-extension-retirement-contract.md',
  'agent-identity-floor-contract.md',
  'app-permission-contract.md',
  'nimi-first-party-integration-contract.md',
  'nimi-first-party-migration-contract.md',
  'nimi-ecosystem-contract.md',
  'governance-contract.md',
  'tables/nimi-kit-registry.yaml',
  'tables/canonical-capability-catalog.yaml',
  'tables/app-slice-admissions.yaml',
  'tables/audit-evidence-roots.yaml',
  'tables/package-authority-admissions.yaml',
  'tables/delegated-projection-admissions.yaml',
  'tables/ai-profile-factory-catalog.yaml',
  'tables/nimi-app-registry.yaml',
  'tables/nimi-app-trust-tiers.yaml',
  'tables/error-code-mapping.yaml',
  'tables/nimi-ui-tokens.yaml',
  'tables/nimi-ui-primitives.yaml',
  'tables/nimi-ui-themes.yaml',
  'tables/nimi-ui-adoption.yaml',
  'tables/nimi-ui-compositions.yaml',
  'tables/nimi-ui-allowlists.yaml',
  'tables/rule-evidence.yaml',
];

for (const file of requiredKernelFiles) {
  if (!fs.existsSync(path.join(kernelDir, file))) {
    fail(`kernel file missing: .nimi/spec/platform/kernel/${file}`);
  }
}

// ========================================================
// Check 9: Rule ID existence — all YAML source refs must
//          resolve to a ## P-<DOMAIN>-NNN heading in kernel
// ========================================================

const kernelContracts = [
  'protocol-contract.md',
  'architecture-contract.md',
  'ai-last-mile-contract.md',
  'ai-scope-contract.md',
  'design-pattern-contract.md',
  'kit-contract.md',
  'capability-catalog-contract.md',
  'app-slice-admission-contract.md',
  'web-release-contract.md',
  'package-authority-admission-contract.md',
  'ai-profile-selection-policy-contract.md',
  'nimi-home-contract.md',
  'nimi-self-update-contract.md',
  'nimi-package-release-contract.md',
  'cold-start-authority-contract.md',
  'nimi-app-admission-contract.md',
  'nimi-app-audit-pipeline-contract.md',
  'nimi-app-developer-workflow-contract.md',
  'nimi-app-scaffolding-contract.md',
  'mod-extension-retirement-contract.md',
  'agent-identity-floor-contract.md',
  'app-permission-contract.md',
  'nimi-first-party-integration-contract.md',
  'nimi-first-party-migration-contract.md',
  'nimi-ecosystem-contract.md',
  'governance-contract.md',
];

const definedRuleIds = new Set();

for (const file of kernelContracts) {
  const filePath = path.join(kernelDir, file);
  if (!fs.existsSync(filePath)) continue;
  const content = fs.readFileSync(filePath, 'utf8');
  // Match headings like: ## P-PROTO-001 — ...
  const headingPattern = /^##\s+(P-[A-Z]{2,12}-\d{3})\b/gmu;
  let match;
  while ((match = headingPattern.exec(content)) !== null) {
    definedRuleIds.add(match[1]);
  }
}

// Collect all source references from all 6 YAML tables
function collectYamlSources(data, filePath) {
  const sources = [];
  const collectFromObj = (obj) => {
    if (obj && typeof obj === 'object') {
      if (Array.isArray(obj)) {
        for (const item of obj) collectFromObj(item);
      } else {
        for (const [key, value] of Object.entries(obj)) {
          if (key === 'source_rule' && typeof value === 'string') {
            const s = value.trim();
            if (/^P-[A-Z]{2,12}-\d{3}$/u.test(s)) {
              sources.push(s);
            }
          } else {
            collectFromObj(value);
          }
        }
      }
    }
  };
  collectFromObj(data);
  return sources;
}

const yamlTables = [
  { name: 'protocol-error-codes.yaml', data: errorCodesTable },
  { name: 'protocol-primitives.yaml', data: primitivesTable },
  { name: 'compliance-test-matrix.yaml', data: complianceTable },
  { name: 'audit-events.yaml', data: auditTable },
  { name: 'app-authorization-presets.yaml', data: presetsTable },
  { name: 'participant-profiles.yaml', data: profilesTable },
  { name: 'nimi-ui-tokens.yaml', data: designTokensTable },
  { name: 'nimi-ui-primitives.yaml', data: designPrimitivesTable },
  { name: 'nimi-ui-themes.yaml', data: designThemesTable },
  { name: 'nimi-ui-adoption.yaml', data: designAdoptionTable },
  { name: 'nimi-ui-compositions.yaml', data: designCompositionsTable },
  { name: 'nimi-ui-allowlists.yaml', data: designAllowlistsTable },
  { name: 'nimi-kit-registry.yaml', data: nimiKitRegistryTable },
  { name: 'app-slice-admissions.yaml', data: appSliceAdmissionsTable },
  { name: 'audit-evidence-roots.yaml', data: auditEvidenceRootsTable },
  { name: 'package-authority-admissions.yaml', data: packageAuthorityAdmissionsTable },
  { name: 'delegated-projection-admissions.yaml', data: delegatedProjectionAdmissionsTable },
  { name: 'ai-profile-factory-catalog.yaml', data: aiProfileFactoryCatalogTable },
  { name: 'nimi-app-registry.yaml', data: nimiAppRegistryTable },
  { name: 'nimi-app-trust-tiers.yaml', data: nimiAppTrustTiersTable },
];

for (const table of yamlTables) {
  const sources = collectYamlSources(table.data, table.name);
  for (const source of sources) {
    if (!definedRuleIds.has(source)) {
      fail(`${table.name}: source_rule "${source}" not found in any kernel contract heading`);
    }
  }
}

checkErrorCodeMapping(definedRuleIds);
checkNimiDesignTables({
  cwd,
  definedRuleIds,
  designAdoptionTable,
  designAllowlistsTable,
  designCompositionsTable,
  designPrimitivesTable,
  designThemesTable,
  designTokensTable,
  fail,
  fs,
  path,
  read,
});
checkAppSliceAdmissions(definedRuleIds);
checkAuditEvidenceRoots(definedRuleIds);
checkPackageAuthorityAdmissions(definedRuleIds);
checkDelegatedProjectionAdmissions(definedRuleIds);
checkRuleEvidenceTraceability(definedRuleIds);

// ========================================================
// Check 10: Domain document reference — all P-*-NNN refs
//           in domain docs must resolve to kernel headings
// ========================================================

const domainDocs = listDomainMarkdownFiles('.nimi/spec/platform');
if (domainDocs.length === 0) {
  fail('platform domain markdown files are empty');
}

for (const rel of domainDocs) {
  const docPath = path.join(cwd, rel);
  if (!fs.existsSync(docPath)) {
    fail(`platform domain doc missing: ${rel}`);
    continue;
  }
  const content = fs.readFileSync(docPath, 'utf8');
  if (!/^##\s+0\.\s+Normative Imports\b/mu.test(content)) {
    fail(`${rel} must define Section 0 Normative Imports`);
  }
  if (/^##\s+P-[A-Z]+-\d{3}\b/gmu.test(content)) {
    fail(`${rel} must not define kernel Rule IDs directly`);
  }
  checkNoLocalRuleIds(content, rel);
  checkNoRuleDefinitionHeadings(content, rel);

  // Match individual P-*-NNN references (not ranges like P-PROTO-001–105)
  const refPattern = /\bP-[A-Z]{2,12}-(\d{3})\b/gu;
  let match;
  while ((match = refPattern.exec(content)) !== null) {
    const ref = match[0];
    // Skip references that are part of a range (e.g., P-PROTO-001–105, P-ARCH-001–030)
    const afterRef = content.slice(match.index + ref.length, match.index + ref.length + 4);
    if (/^[–\-]\d/.test(afterRef)) continue;
    // Skip references that are the end of a range (preceded by –NNN pattern)
    const beforeRef = content.slice(Math.max(0, match.index - 4), match.index);
    if (/[–\-]\s*$/.test(beforeRef)) continue;

    if (!definedRuleIds.has(ref)) {
      fail(`${rel}: reference "${ref}" not found in any kernel contract heading`);
    }
  }
}

// ── Check: Cross-domain K-* references exist in Runtime spec ──
checkCrossDomainRuleReferences(
  [
    ...requiredKernelFiles
      .filter((file) => file.endsWith('.md'))
      .map((file) => path.posix.join('.nimi/spec/platform/kernel', file)),
    ...domainDocs,
  ],
  [
    {
      label: 'Runtime',
      dir: '.nimi/spec/runtime/kernel',
      headingPattern: /^##\s+(K-[A-Z]+-\d{3}[a-z]?)\b/gmu,
      refPattern: /\bK-[A-Z]+-\d{3}[a-z]?\b/gu,
    },
    {
      label: 'Desktop',
      dir: '.nimi/spec/desktop/kernel',
      headingPattern: /^##\s+(D-[A-Z]+-\d{3}[a-z]?)\b/gmu,
      refPattern: /\bD-[A-Z]+-\d{3}[a-z]?\b/gu,
    },
  ],
);

checkOrphanRules(definedRuleIds, domainDocs);

if (failed) process.exit(1);
console.log('platform-spec-kernel-consistency: OK');

function checkErrorCodeMapping(definedRuleIds) {
  const rel = '.nimi/spec/platform/kernel/tables/error-code-mapping.yaml';
  const mappings = Array.isArray(errorCodeMappingTable?.mappings) ? errorCodeMappingTable.mappings : [];
  const protocolErrors = new Set(codes.map((code) => String(code?.name || '').trim()).filter(Boolean));
  const runtimeReasons = new Map(
    (Array.isArray(runtimeReasonCodesTable?.codes) ? runtimeReasonCodesTable.codes : [])
      .map((code) => [String(code?.name || '').trim(), code])
      .filter(([name]) => Boolean(name)),
  );
  const allowedCategories = new Set(['mapped', 'realm_only', 'unmapped_v1']);
  if (mappings.length === 0) {
    fail(`${rel} mappings must not be empty`);
    return;
  }

  for (const entry of mappings) {
    const platformError = String(entry?.platform_error || '').trim();
    const platformSource = String(entry?.platform_source || '').trim();
    const runtimeReasonCode = String(entry?.runtime_reason_code || '').trim();
    const runtimeCodeNumber = entry?.runtime_code_number;
    const runtimeSource = String(entry?.runtime_source || '').trim();
    const category = String(entry?.category || '').trim();
    if (!platformError) {
      fail(`${rel} mapping missing platform_error`);
    } else if (!protocolErrors.has(platformError)) {
      fail(`${rel} ${platformError}: platform_error not found in protocol-error-codes.yaml`);
    }
    if (!/^P-[A-Z]{2,12}-\d{3}$/u.test(platformSource) || !definedRuleIds.has(platformSource)) {
      fail(`${rel} ${platformError || '<empty>'} has invalid platform_source: ${platformSource || '<empty>'}`);
    }
    if (!allowedCategories.has(category)) {
      fail(`${rel} ${platformError || '<empty>'} has invalid category: ${category || '<empty>'}`);
      continue;
    }
    if (runtimeSource && !/^K-[A-Z]+-\d{3}[a-z]?$/u.test(runtimeSource)) {
      fail(`${rel} ${platformError || '<empty>'} has invalid runtime_source: ${runtimeSource}`);
    }
    if (category === 'mapped') {
      if (!runtimeReasonCode) {
        fail(`${rel} ${platformError || '<empty>'} category=mapped requires runtime_reason_code`);
        continue;
      }
      if (!Number.isInteger(runtimeCodeNumber)) {
        fail(`${rel} ${platformError || '<empty>'} category=mapped requires integer runtime_code_number`);
      }
      if (!runtimeSource) {
        fail(`${rel} ${platformError || '<empty>'} category=mapped requires runtime_source`);
      }
      const runtimeReason = runtimeReasons.get(runtimeReasonCode);
      if (!runtimeReason) {
        fail(`${rel} ${platformError || '<empty>'} runtime_reason_code not found in runtime reason-codes.yaml: ${runtimeReasonCode}`);
        continue;
      }
      if (Number.isInteger(runtimeCodeNumber) && Number(runtimeReason.value) !== runtimeCodeNumber) {
        fail(`${rel} ${platformError || '<empty>'} runtime_code_number ${runtimeCodeNumber} does not match runtime reason ${runtimeReasonCode} value ${runtimeReason.value}`);
      }
      const actualRuntimeSource = String(runtimeReason.source_rule || '').trim();
      if (runtimeSource && actualRuntimeSource !== runtimeSource) {
        fail(`${rel} ${platformError || '<empty>'} runtime_source ${runtimeSource} does not match runtime reason ${runtimeReasonCode} source_rule ${actualRuntimeSource || '<empty>'}`);
      }
    } else {
      if (runtimeReasonCode || runtimeCodeNumber != null || runtimeSource) {
        fail(`${rel} ${platformError || '<empty>'} category=${category} must omit runtime_reason_code, runtime_code_number, and runtime_source`);
      }
    }
  }
}

function checkAuthorizationPresetSemantics(presetsByName) {
  const rel = '.nimi/spec/platform/kernel/tables/app-authorization-presets.yaml';
  const expected = {
    readOnly: {
      default_scopes_pattern: 'app.<appId>.*.read',
      can_delegate: false,
      max_delegation_depth: 0,
      source_rule: 'P-PROTO-030',
    },
    full: {
      default_scopes_pattern: 'app.<appId>.*.read, app.<appId>.*.write',
      can_delegate: false,
      max_delegation_depth: 0,
      source_rule: 'P-PROTO-030',
    },
    delegate: {
      default_scopes_pattern: 'app.<appId>.*.read, app.<appId>.*.write',
      can_delegate: true,
      max_delegation_depth: 1,
      source_rule: 'P-PROTO-035',
    },
  };

  for (const [name, rules] of Object.entries(expected)) {
    const preset = presetsByName.get(name);
    if (!preset) continue;
    for (const [field, expectedValue] of Object.entries(rules)) {
      if (preset?.[field] !== expectedValue) {
        fail(`${rel} ${name}: ${field} must be ${JSON.stringify(expectedValue)}`);
      }
    }
  }

  const delegationRules = Array.isArray(presetsTable?.delegation_rules) ? presetsTable.delegation_rules : [];
  if (delegationRules.length === 0) {
    fail(`${rel}: delegation_rules must not be empty`);
    return;
  }
  const text = delegationRules.map((entry) => String(entry?.rule || '')).join('\n');
  for (const entry of delegationRules) {
    const source = String(entry?.source_rule || '').trim();
    if (source !== 'P-PROTO-035') {
      fail(`${rel}: delegation rule must use source_rule P-PROTO-035`);
    }
  }
  const requiredDelegationSemantics = [
    [/canDelegate=true/u, 'parent token must require canDelegate=true'],
    [/scopes[\s\S]*子集/u, 'child token scopes must be parent subset'],
    [/expiresAt[\s\S]*早/u, 'child token expiresAt must be earlier than parent'],
    [/撤销[\s\S]*级联失效/u, 'parent revocation must cascade to child token'],
    [/maxDelegationDepth=1/u, 'delegate preset must default maxDelegationDepth=1'],
    [/resourceSelectors[\s\S]*子集/u, 'child token resourceSelectors must be parent subset'],
  ];
  for (const [pattern, description] of requiredDelegationSemantics) {
    if (!pattern.test(text)) {
      fail(`${rel}: delegation_rules missing semantic guardrail: ${description}`);
    }
  }
}

function checkRuleEvidenceTraceability(definedRuleIds) {
  const rel = '.nimi/spec/platform/kernel/tables/rule-evidence.yaml';
  const catalog = ruleEvidenceTable?.evidence_catalog && typeof ruleEvidenceTable.evidence_catalog === 'object'
    ? ruleEvidenceTable.evidence_catalog
    : null;
  if (!catalog) {
    fail(`${rel} missing evidence_catalog map`);
    return;
  }
  for (const [ref, item] of Object.entries(catalog)) {
    const record = item && typeof item === 'object' ? item : null;
    if (!record) {
      fail(`${rel} evidence_catalog.${ref} must be an object`);
      continue;
    }
    const command = String(record.command || '').trim();
    const targetPath = String(record.path || '').trim();
    if (!String(record.type || '').trim()) fail(`${rel} evidence_catalog.${ref} missing type`);
    if (!command) fail(`${rel} evidence_catalog.${ref} missing command`);
    if (!targetPath) {
      fail(`${rel} evidence_catalog.${ref} missing path`);
      continue;
    }
    if (!fs.existsSync(path.join(cwd, targetPath))) {
      fail(`${rel} evidence_catalog.${ref} path does not exist: ${targetPath}`);
    }
  }

  const rules = Array.isArray(ruleEvidenceTable?.rules) ? ruleEvidenceTable.rules : [];
  const seen = new Set();
  for (const item of rules) {
    const ruleId = String(item?.rule_id || '').trim();
    const requirement = String(item?.evidence_requirement || '').trim().toLowerCase();
    const refs = Array.isArray(item?.evidence_refs) ? item.evidence_refs : [];
    const naReason = String(item?.na_reason || '').trim();
    const evidenceScopeNote = String(item?.evidence_scope_note || '').trim();
    if (!/^P-[A-Z]{2,12}-\d{3}$/u.test(ruleId)) {
      fail(`${rel} has invalid rule_id format: ${ruleId || '<empty>'}`);
      continue;
    }
    if (seen.has(ruleId)) {
      fail(`${rel} has duplicate rule_id entry: ${ruleId}`);
      continue;
    }
    seen.add(ruleId);
    if (!definedRuleIds.has(ruleId)) {
      fail(`${rel} references unknown platform kernel rule: ${ruleId}`);
    }
    if (requirement !== 'required' && requirement !== 'structural_required' && requirement !== 'not_applicable') {
      fail(`${rel} ${ruleId} has invalid evidence_requirement: ${requirement || '<empty>'}`);
      continue;
    }
    if (requirement === 'not_applicable') {
      if (!naReason) fail(`${rel} ${ruleId} evidence_requirement=not_applicable requires na_reason`);
      continue;
    }
    if (refs.length === 0) {
      fail(`${rel} ${ruleId} evidence_requirement=${requirement} requires non-empty evidence_refs`);
      continue;
    }
    for (const rawRef of refs) {
      const ref = String(rawRef || '').trim();
      if (!ref) {
        fail(`${rel} ${ruleId} contains empty evidence_refs item`);
        continue;
      }
      if (!Object.prototype.hasOwnProperty.call(catalog, ref)) {
        fail(`${rel} ${ruleId} references undefined evidence ref: ${ref}`);
      }
    }

    const allStructural = refs.length > 0 && refs.every((rawRef) => {
      const ref = String(rawRef || '').trim();
      const record = catalog[ref];
      return String(record?.evidence_type || '').trim() === 'structural';
    });
    if (allStructural && structuralOnlyCoverageRuleIds.has(ruleId)) {
      if (requirement !== 'structural_required') {
        fail(`${rel} ${ruleId} uses structural-only evidence and must use evidence_requirement=structural_required`);
      }
      if (!evidenceScopeNote) {
        fail(`${rel} ${ruleId} uses structural-only evidence and must declare evidence_scope_note`);
        continue;
      }
      if (!/structural\s*-?\s*only/i.test(evidenceScopeNote)) {
        fail(`${rel} ${ruleId} evidence_scope_note must explicitly state structural only scope`);
      }
    }
    if (/structural\s*-?\s*only/i.test(evidenceScopeNote) && requirement !== 'structural_required') {
      fail(`${rel} ${ruleId} declares structural-only evidence_scope_note and must use evidence_requirement=structural_required`);
    }
  }

  const missing = [...definedRuleIds].filter((ruleId) => !seen.has(ruleId));
  if (missing.length > 0) {
    fail(`${rel} missing evidence rows for rules: ${missing.join(', ')}`);
  }
}

function checkAppSliceAdmissions(definedRuleIds) {
  const rel = '.nimi/spec/platform/kernel/tables/app-slice-admissions.yaml';
  const admissions = Array.isArray(appSliceAdmissionsTable?.admissions) ? appSliceAdmissionsTable.admissions : [];
  if (admissions.length === 0) {
    return;
  }
  const seen = new Set();
  const allowedPosture = new Set(['active', 'inactive']);
  const requiredMayNotOverride = [
    '.nimi/spec/runtime/**',
    '.nimi/spec/sdks/**',
    '.nimi/spec/realm/**',
    '.nimi/spec/platform/**',
    '.nimi/spec/desktop/**',
    '.nimi/spec/cognition/**',
    '.nimi/spec/avatar/**',
  ];
  for (const row of admissions) {
    const appId = String(row?.app_id || '').trim();
    const ownerDomain = String(row?.owner_domain || '').trim();
    const admissionPosture = String(row?.admission_posture || '').trim();
    const authorityRoot = String(row?.authority_root || '').trim();
    const source = String(row?.source_rule || '').trim();
    const evidenceRoots = Array.isArray(row?.evidence_roots) ? row.evidence_roots.map((item) => String(item || '').trim()).filter(Boolean) : [];
    const mayNotOverride = Array.isArray(row?.may_not_override) ? row.may_not_override.map((item) => String(item || '').trim()).filter(Boolean) : [];
    if (!appId || seen.has(appId)) {
      fail(`${rel}: admissions require unique app_id`);
      continue;
    }
    seen.add(appId);
    if (appId === 'avatar') {
      fail(`${rel}: avatar is promoted to .nimi/spec/avatar and must not be admitted as an app-local spec slice`);
      continue;
    }
    if (!ownerDomain) fail(`${rel}: ${appId} missing owner_domain`);
    if (!allowedPosture.has(admissionPosture)) fail(`${rel}: ${appId} has invalid admission_posture ${admissionPosture || '<empty>'}`);
    if (authorityRoot !== `apps/${appId}/spec`) {
      fail(`${rel}: ${appId} authority_root must be apps/${appId}/spec`);
    } else if (!fs.existsSync(path.join(cwd, authorityRoot))) {
      fail(`${rel}: ${appId} authority_root does not exist: ${authorityRoot}`);
    }
    if (evidenceRoots.length === 0) {
      fail(`${rel}: ${appId} must declare evidence_roots`);
    }
    for (const rootRef of evidenceRoots) {
      if (!rootRef.startsWith(`apps/${appId}`)) {
        fail(`${rel}: ${appId} evidence root escapes app slice: ${rootRef}`);
      }
    }
    if (mayNotOverride.length === 0) {
      fail(`${rel}: ${appId} must declare may_not_override`);
    } else if (!sameStringSet(mayNotOverride, requiredMayNotOverride)) {
      fail(`${rel}: ${appId} may_not_override must exactly match kernel authority fence set: ${requiredMayNotOverride.join(', ')}`);
    }
    if (!definedRuleIds.has(source)) {
      fail(`${rel}: ${appId} references unknown source_rule ${source || '<empty>'}`);
    }
  }
}

function sameStringSet(actual, expected) {
  if (actual.length !== expected.length) return false;
  const actualSet = new Set(actual);
  return expected.every((entry) => actualSet.has(entry));
}

function isProductAuthorityRef(ref) {
  return ref.startsWith('.nimi/spec/');
}

function isPackageSourceRef(ref) {
  return ref === 'package://@nimiplatform/nimi-coding'
    || ref.startsWith('package://@nimiplatform/nimi-coding/');
}

function isExternalPackageRef(ref) {
  return ref === 'package://@nimiplatform/nimi-coding'
    || ref.startsWith('package://@nimiplatform/nimi-coding/');
}

function isAllowedHostProjectionRef(ref) {
  return ref.startsWith('.nimi/config/')
    || ref.startsWith('.nimi/contracts/')
    || ref.startsWith('.nimi/methodology/')
    || ref.startsWith('.nimi/spec/');
}

function isAllowedPackageProjectionRef(ref) {
  return ref.startsWith('package://@nimiplatform/nimi-coding/config/')
    || ref.startsWith('package://@nimiplatform/nimi-coding/contracts/')
    || ref.startsWith('package://@nimiplatform/nimi-coding/methodology/')
    || ref.startsWith('package://@nimiplatform/nimi-coding/spec/');
}

function checkAuditEvidenceRoots(definedRuleIds) {
  const rel = '.nimi/spec/platform/kernel/tables/audit-evidence-roots.yaml';
  const roots = Array.isArray(auditEvidenceRootsTable?.roots) ? auditEvidenceRootsTable.roots : [];
  if (roots.length === 0) {
    fail(`${rel} roots must not be empty`);
    return;
  }
  const seen = new Set();
  for (const row of roots) {
    const id = String(row?.id || '').trim();
    const ownerDomain = String(row?.owner_domain || '').trim();
    const authorityRefs = Array.isArray(row?.authority_refs) ? row.authority_refs.map((item) => String(item || '').trim()).filter(Boolean) : [];
    const evidenceRoots = Array.isArray(row?.evidence_roots) ? row.evidence_roots.map((item) => String(item || '').trim()).filter(Boolean) : [];
    const source = String(row?.source_rule || '').trim();
    if (!id || seen.has(id)) {
      fail(`${rel}: roots require unique id`);
      continue;
    }
    seen.add(id);
    if (!ownerDomain) fail(`${rel}: ${id} missing owner_domain`);
    if (authorityRefs.length === 0) fail(`${rel}: ${id} must declare authority_refs`);
    if (evidenceRoots.length === 0) fail(`${rel}: ${id} must declare evidence_roots`);
    for (const authorityRef of authorityRefs) {
      if (isPackageSourceRef(authorityRef)) {
        fail(`${rel}: ${id} package source ref must be evidence_root or package authority admission, not authority_ref: ${authorityRef}`);
      } else if (!isProductAuthorityRef(authorityRef) || !fs.existsSync(path.join(cwd, authorityRef))) {
        fail(`${rel}: ${id} invalid authority_ref ${authorityRef}`);
      }
    }
    for (const evidenceRoot of evidenceRoots) {
      if (isExternalPackageRef(evidenceRoot)) {
        continue;
      }
      if (evidenceRoot.startsWith('.nimi/spec/') || evidenceRoot.includes('..') || path.isAbsolute(evidenceRoot) || !fs.existsSync(path.join(cwd, evidenceRoot))) {
        fail(`${rel}: ${id} invalid evidence_root ${evidenceRoot}`);
      }
    }
    if (!definedRuleIds.has(source)) {
      fail(`${rel}: ${id} references unknown source_rule ${source || '<empty>'}`);
    }
  }
}

function checkPackageAuthorityAdmissions(definedRuleIds) {
  const rel = '.nimi/spec/platform/kernel/tables/package-authority-admissions.yaml';
  const admissions = Array.isArray(packageAuthorityAdmissionsTable?.admissions) ? packageAuthorityAdmissionsTable.admissions : [];
  if (admissions.length === 0) {
    fail(`${rel} admissions must not be empty`);
    return;
  }
  const seen = new Set();
  const allowedPosture = new Set(['active', 'inactive']);
  const requiredMayNotOverride = [
    '.nimi/spec/runtime/**',
    '.nimi/spec/sdks/**',
    '.nimi/spec/realm/**',
    '.nimi/spec/platform/**',
    '.nimi/spec/desktop/**',
    '.nimi/spec/cognition/**',
    '.nimi/spec/avatar/**',
  ];
  for (const row of admissions) {
    const id = String(row?.id || '').trim();
    const ownerDomain = String(row?.owner_domain || '').trim();
    const admissionPosture = String(row?.admission_posture || '').trim();
    const authorityRoot = String(row?.authority_root || '').trim();
    const source = String(row?.source_rule || '').trim();
    const evidenceRoots = Array.isArray(row?.evidence_roots) ? row.evidence_roots.map((item) => String(item || '').trim()).filter(Boolean) : [];
    const mayNotOverride = Array.isArray(row?.may_not_override) ? row.may_not_override.map((item) => String(item || '').trim()).filter(Boolean) : [];
    const projectionBoundary = row?.projection_boundary && typeof row.projection_boundary === 'object' ? row.projection_boundary : null;
    if (!id || seen.has(id)) {
      fail(`${rel}: admissions require unique id`);
      continue;
    }
    seen.add(id);
    if (!ownerDomain) fail(`${rel}: ${id} missing owner_domain`);
    if (!allowedPosture.has(admissionPosture)) fail(`${rel}: ${id} has invalid admission_posture ${admissionPosture || '<empty>'}`);
    if (!authorityRoot || authorityRoot.startsWith('.nimi/spec/') || authorityRoot.includes('..') || path.isAbsolute(authorityRoot) || !authorityRoot.endsWith('/spec')) {
      fail(`${rel}: ${id} invalid authority_root ${authorityRoot || '<empty>'}`);
    } else if (!isExternalPackageRef(authorityRoot) && !fs.existsSync(path.join(cwd, authorityRoot))) {
      fail(`${rel}: ${id} authority_root does not exist: ${authorityRoot}`);
    }
    if (evidenceRoots.length === 0) {
      fail(`${rel}: ${id} must declare evidence_roots`);
    }
    for (const evidenceRoot of evidenceRoots) {
      if (isExternalPackageRef(evidenceRoot)) {
        if (authorityRoot && !authorityRoot.startsWith(`${evidenceRoot.replace(/\/$/u, '')}/`)) {
          fail(`${rel}: ${id} evidence root ${evidenceRoot} must contain authority_root ${authorityRoot}`);
        }
        continue;
      }
      if (evidenceRoot.startsWith('.nimi/spec/') || evidenceRoot.includes('..') || path.isAbsolute(evidenceRoot) || !fs.existsSync(path.join(cwd, evidenceRoot))) {
        fail(`${rel}: ${id} invalid evidence_root ${evidenceRoot}`);
      } else if (authorityRoot && !authorityRoot.startsWith(`${evidenceRoot.replace(/\/$/u, '')}/`)) {
        fail(`${rel}: ${id} evidence root ${evidenceRoot} must contain authority_root ${authorityRoot}`);
      }
    }
    if (mayNotOverride.length === 0) {
      fail(`${rel}: ${id} must declare may_not_override`);
    } else if (!sameStringSet(mayNotOverride, requiredMayNotOverride)) {
      fail(`${rel}: ${id} may_not_override must exactly match product authority fence set: ${requiredMayNotOverride.join(', ')}`);
    }
    if (!projectionBoundary) {
      fail(`${rel}: ${id} must declare projection_boundary`);
    } else {
      const ownerRef = String(projectionBoundary.host_project_admission_owner || '').trim();
      const packageRoot = String(projectionBoundary.package_truth_root || '').trim();
      const hostRoots = Array.isArray(projectionBoundary.host_local_projection_roots)
        ? projectionBoundary.host_local_projection_roots.map((item) => String(item || '').trim()).filter(Boolean)
        : [];
      const hostAuthorityProjectionRefs = Array.isArray(projectionBoundary.host_authority_projection_refs)
        ? projectionBoundary.host_authority_projection_refs
        : [];
      if (!ownerRef.startsWith('.nimi/spec/') || !fs.existsSync(path.join(cwd, ownerRef))) {
        fail(`${rel}: ${id} invalid projection_boundary.host_project_admission_owner ${ownerRef || '<empty>'}`);
      }
      if (packageRoot !== authorityRoot) {
        fail(`${rel}: ${id} projection_boundary.package_truth_root must match authority_root`);
      }
      for (const hostRoot of hostRoots) {
        if (!hostRoot.startsWith('.nimi/') || hostRoot.startsWith('.nimi/spec/') || !fs.existsSync(path.join(cwd, hostRoot))) {
          fail(`${rel}: ${id} invalid host_local_projection_root ${hostRoot}`);
        }
      }
      const seenHostProjectionRefs = new Set();
      for (const projectionRef of hostAuthorityProjectionRefs) {
        const hostRef = String(projectionRef?.host_ref || '').trim();
        const packageRef = String(projectionRef?.package_ref || '').trim();
        if (!isAllowedHostProjectionRef(hostRef) || hostRef.includes('..') || path.isAbsolute(hostRef) || !fs.existsSync(path.join(cwd, hostRef))) {
          fail(`${rel}: ${id} invalid host_authority_projection_refs host_ref ${hostRef || '<empty>'}`);
        }
        if (!isAllowedPackageProjectionRef(packageRef) || packageRef.includes('..') || path.isAbsolute(packageRef)) {
          fail(`${rel}: ${id} invalid host_authority_projection_refs package_ref ${packageRef || '<empty>'}`);
        }
        if (seenHostProjectionRefs.has(hostRef)) {
          fail(`${rel}: ${id} duplicate host_authority_projection_refs host_ref ${hostRef}`);
        }
        seenHostProjectionRefs.add(hostRef);
      }
    }
    if (!definedRuleIds.has(source)) {
      fail(`${rel}: ${id} references unknown source_rule ${source || '<empty>'}`);
    }
  }
}

function isDelegatedSourceRef(ref) {
  return ref.startsWith('package://') || ref.startsWith('external-projection://') || ref.startsWith('external-authority://');
}

function isDelegatedEvidencePrefix(ref) {
  return [
    'realm-implementation://',
    'realm-test-evidence://',
    'realm-openapi://',
    'realm-schema://',
  ].includes(ref);
}

function isSafeRelativePathRef(ref) {
  return Boolean(ref)
    && !ref.includes('..')
    && !path.isAbsolute(ref);
}

function checkDelegatedProjectionAdmissions(definedRuleIds) {
  const rel = '.nimi/spec/platform/kernel/tables/delegated-projection-admissions.yaml';
  const admissions = Array.isArray(delegatedProjectionAdmissionsTable?.admissions) ? delegatedProjectionAdmissionsTable.admissions : [];
  if (admissions.length === 0) {
    fail(`${rel} admissions must not be empty`);
    return;
  }
  const seen = new Set();
  const allowedPosture = new Set(['active', 'inactive']);
  for (const row of admissions) {
    const id = String(row?.id || '').trim();
    const ownerDomain = String(row?.owner_domain || '').trim();
    const admissionPosture = String(row?.admission_posture || '').trim();
    const authorityRoot = String(row?.authority_root || '').trim();
    const sourceAuthorityRoot = String(row?.source_authority_root || '').trim();
    const source = String(row?.source_rule || '').trim();
    const localProjectionEvidenceRoots = Array.isArray(row?.local_projection_evidence_roots)
      ? row.local_projection_evidence_roots.map((item) => String(item || '').trim()).filter(Boolean)
      : [];
    const delegatedEvidenceRoots = Array.isArray(row?.delegated_evidence_roots)
      ? row.delegated_evidence_roots.map((item) => String(item || '').trim()).filter(Boolean)
      : [];
    const delegatedPrefixes = Array.isArray(row?.delegated_declared_evidence_prefixes)
      ? row.delegated_declared_evidence_prefixes.map((item) => String(item || '').trim()).filter(Boolean)
      : [];
    const hostOwnedRelativePaths = Array.isArray(row?.host_owned_relative_paths)
      ? row.host_owned_relative_paths.map((item) => String(item || '').trim()).filter(Boolean)
      : [];
    const requiredCommands = Array.isArray(row?.required_verification_commands)
      ? row.required_verification_commands.map((item) => String(item || '').trim()).filter(Boolean)
      : [];
    if (!id || seen.has(id)) {
      fail(`${rel}: admissions require unique id`);
      continue;
    }
    seen.add(id);
    if (!ownerDomain) fail(`${rel}: ${id} missing owner_domain`);
    if (!allowedPosture.has(admissionPosture)) fail(`${rel}: ${id} has invalid admission_posture ${admissionPosture || '<empty>'}`);
    if (!authorityRoot.startsWith('.nimi/spec/') || authorityRoot.includes('..') || path.isAbsolute(authorityRoot) || !fs.existsSync(path.join(cwd, authorityRoot))) {
      fail(`${rel}: ${id} invalid authority_root ${authorityRoot || '<empty>'}`);
    }
    if (!isDelegatedSourceRef(sourceAuthorityRoot)) {
      fail(`${rel}: ${id} source_authority_root must use package:// or external-projection://`);
    }
    if (localProjectionEvidenceRoots.length === 0) {
      fail(`${rel}: ${id} must declare local_projection_evidence_roots`);
    }
    for (const evidenceRoot of localProjectionEvidenceRoots) {
      if (evidenceRoot.startsWith('.nimi/spec/') || evidenceRoot.includes('..') || path.isAbsolute(evidenceRoot) || !fs.existsSync(path.join(cwd, evidenceRoot))) {
        fail(`${rel}: ${id} invalid local_projection_evidence_root ${evidenceRoot}`);
      }
    }
    if (delegatedEvidenceRoots.length === 0) {
      fail(`${rel}: ${id} must declare delegated_evidence_roots`);
    }
    for (const delegatedRoot of delegatedEvidenceRoots) {
      if (!isDelegatedSourceRef(delegatedRoot)) {
        fail(`${rel}: ${id} delegated_evidence_root must use package:// or external-projection://: ${delegatedRoot}`);
      }
    }
    if (delegatedPrefixes.length === 0) {
      fail(`${rel}: ${id} must declare delegated_declared_evidence_prefixes`);
    }
    for (const prefix of delegatedPrefixes) {
      if (!isDelegatedEvidencePrefix(prefix)) {
        fail(`${rel}: ${id} invalid delegated_declared_evidence_prefix ${prefix}`);
      }
    }
    for (const hostOwnedPath of hostOwnedRelativePaths) {
      if (!isSafeRelativePathRef(hostOwnedPath)) {
        fail(`${rel}: ${id} invalid host_owned_relative_path ${hostOwnedPath}`);
        continue;
      }
      if (authorityRoot && !fs.existsSync(path.join(cwd, authorityRoot, hostOwnedPath))) {
        fail(`${rel}: ${id} host_owned_relative_path does not exist under authority_root: ${hostOwnedPath}`);
      }
    }
    if (requiredCommands.length === 0) {
      fail(`${rel}: ${id} must declare required_verification_commands`);
    }
    for (const command of requiredCommands) {
      if (!command.startsWith('external-verifier://') && !command.startsWith('local-guard://')) {
        fail(`${rel}: ${id} required_verification_command must be an explicit external verifier or local guard locator: ${command}`);
      }
    }
    if (!definedRuleIds.has(source)) {
      fail(`${rel}: ${id} references unknown source_rule ${source || '<empty>'}`);
    }
  }
}

function checkOrphanRules(definedRuleIds, domainDocs) {
  const refs = new Map();
  const files = [...new Set([
    ...requiredKernelFiles.map((file) => path.posix.join('.nimi/spec/platform/kernel', file)),
    ...yamlTables.map((table) => path.posix.join('.nimi/spec/platform/kernel/tables', table.name)),
    ...domainDocs,
  ])].filter((rel) => !rel.endsWith('rule-evidence.yaml'));

  for (const rel of files) {
    if (!fs.existsSync(path.join(cwd, rel))) continue;
    const content = read(rel);
    for (const ruleId of collectReferencedPlatformRuleIds(content, definedRuleIds)) {
      refs.set(ruleId, (refs.get(ruleId) || 0) + 1);
    }
  }

  const orphans = [...definedRuleIds].filter((ruleId) => (refs.get(ruleId) || 0) <= 1);
  if (orphans.length > 0) {
    fail(`platform orphan kernel rules detected: ${orphans.join(', ')}`);
  }
}

function collectReferencedPlatformRuleIds(content, definedRuleIds) {
  const refs = new Set();

  for (const match of content.matchAll(/\bP-[A-Z]{2,12}-\d{3}\b/g)) {
    refs.add(match[0]);
  }

  for (const match of content.matchAll(/\b(P-[A-Z]{2,12})-\*/g)) {
    const prefix = `${match[1]}-`;
    for (const ruleId of definedRuleIds) {
      if (ruleId.startsWith(prefix)) {
        refs.add(ruleId);
      }
    }
  }

  for (const match of content.matchAll(/\b(P-[A-Z]{2,12})-(\d{3})[–-](\d{3})\b/g)) {
    const prefix = `${match[1]}-`;
    const start = Number.parseInt(match[2], 10);
    const end = Number.parseInt(match[3], 10);
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    const lower = Math.min(start, end);
    const upper = Math.max(start, end);
    for (const ruleId of definedRuleIds) {
      if (!ruleId.startsWith(prefix)) continue;
      const numeric = Number.parseInt(ruleId.slice(prefix.length), 10);
      if (!Number.isNaN(numeric) && numeric >= lower && numeric <= upper) {
        refs.add(ruleId);
      }
    }
  }

  return refs;
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

function listDomainMarkdownFiles(domainDirRel) {
  const domainDir = path.join(cwd, domainDirRel);
  if (!fs.existsSync(domainDir)) return [];
  return fs.readdirSync(domainDir)
    .filter((name) => name.endsWith('.md'))
    .filter((name) => name !== 'index.md')
    .map((name) => path.posix.join(domainDirRel, name))
    .sort((a, b) => a.localeCompare(b));
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
