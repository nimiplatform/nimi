#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

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
  return YAML.parse(read(rel));
}

// --- Load tables ---

const errorCodesTable = readYaml('spec/platform/kernel/tables/protocol-error-codes.yaml');
const primitivesTable = readYaml('spec/platform/kernel/tables/protocol-primitives.yaml');
const complianceTable = readYaml('spec/platform/kernel/tables/compliance-test-matrix.yaml');
const auditTable = readYaml('spec/platform/kernel/tables/audit-events.yaml');
const presetsTable = readYaml('spec/platform/kernel/tables/app-authorization-presets.yaml');
const profilesTable = readYaml('spec/platform/kernel/tables/participant-profiles.yaml');
const errorCodeMappingTable = readYaml('spec/platform/kernel/tables/error-code-mapping.yaml');
const designTokensTable = readYaml('spec/platform/kernel/tables/nimi-ui-tokens.yaml');
const designPrimitivesTable = readYaml('spec/platform/kernel/tables/nimi-ui-primitives.yaml');
const designThemesTable = readYaml('spec/platform/kernel/tables/nimi-ui-themes.yaml');
const designAdoptionTable = readYaml('spec/platform/kernel/tables/nimi-ui-adoption.yaml');
const designCompositionsTable = readYaml('spec/platform/kernel/tables/nimi-ui-compositions.yaml');
const designAllowlistsTable = readYaml('spec/platform/kernel/tables/nimi-ui-allowlists.yaml');
const nimiKitRegistryTable = readYaml('spec/platform/kernel/tables/nimi-kit-registry.yaml');
const ruleEvidenceTable = readYaml('spec/platform/kernel/tables/rule-evidence.yaml');
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

// ========================================================
// Check 5: Authorization presets
// ========================================================

const presets = Array.isArray(presetsTable?.presets) ? presetsTable.presets : [];
const requiredPresets = new Set(['readOnly', 'full', 'delegate']);
const foundPresets = new Set();

for (const preset of presets) {
  const name = String(preset?.name || '').trim();
  if (!name) {
    fail('app-authorization-presets.yaml: entry missing name');
    continue;
  }
  foundPresets.add(name);

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

const kernelDir = path.join(cwd, 'spec', 'platform', 'kernel');
const requiredKernelFiles = [
  'index.md',
  'protocol-contract.md',
  'architecture-contract.md',
  'ai-last-mile-contract.md',
  'design-pattern-contract.md',
  'kit-contract.md',
  'governance-contract.md',
  'tables/nimi-kit-registry.yaml',
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
    fail(`kernel file missing: spec/platform/kernel/${file}`);
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
  'design-pattern-contract.md',
  'kit-contract.md',
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
checkNimiDesignTables(definedRuleIds);
checkRuleEvidenceTraceability(definedRuleIds);

// ========================================================
// Check 10: Domain document reference — all P-*-NNN refs
//           in domain docs must resolve to kernel headings
// ========================================================

const domainDocs = listDomainMarkdownFiles('spec/platform');
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
  if (!/\bP-[A-Z]+-\d{3}\b/u.test(content)) {
    fail(`${rel} must reference at least one platform kernel Rule ID`);
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
      .map((file) => path.posix.join('spec/platform/kernel', file)),
    ...domainDocs,
  ],
  [
    {
      label: 'Runtime',
      dir: 'spec/runtime/kernel',
      headingPattern: /^##\s+(K-[A-Z]+-\d{3}[a-z]?)\b/gmu,
      refPattern: /\bK-[A-Z]+-\d{3}[a-z]?\b/gu,
    },
    {
      label: 'Desktop',
      dir: 'spec/desktop/kernel',
      headingPattern: /^##\s+(D-[A-Z]+-\d{3}[a-z]?)\b/gmu,
      refPattern: /\bD-[A-Z]+-\d{3}[a-z]?\b/gu,
    },
  ],
);

checkOrphanRules(definedRuleIds, domainDocs);

if (failed) process.exit(1);
console.log('platform-spec-kernel-consistency: OK');

function checkErrorCodeMapping(definedRuleIds) {
  const rel = 'spec/platform/kernel/tables/error-code-mapping.yaml';
  const mappings = Array.isArray(errorCodeMappingTable?.mappings) ? errorCodeMappingTable.mappings : [];
  if (mappings.length === 0) {
    fail(`${rel} mappings must not be empty`);
    return;
  }

  for (const entry of mappings) {
    const platformError = String(entry?.platform_error || '').trim();
    const platformSource = String(entry?.platform_source || '').trim();
    const runtimeSource = String(entry?.runtime_source || '').trim();
    if (!platformError) {
      fail(`${rel} mapping missing platform_error`);
    }
    if (!/^P-[A-Z]{2,12}-\d{3}$/u.test(platformSource) || !definedRuleIds.has(platformSource)) {
      fail(`${rel} ${platformError || '<empty>'} has invalid platform_source: ${platformSource || '<empty>'}`);
    }
    if (runtimeSource && !/^K-[A-Z]+-\d{3}[a-z]?$/u.test(runtimeSource)) {
      fail(`${rel} ${platformError || '<empty>'} has invalid runtime_source: ${runtimeSource}`);
    }
  }
}

function checkRuleEvidenceTraceability(definedRuleIds) {
  const rel = 'spec/platform/kernel/tables/rule-evidence.yaml';
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
    const status = String(item?.status || '').trim().toLowerCase();
    const refs = Array.isArray(item?.evidence_refs) ? item.evidence_refs : [];
    const naReason = String(item?.na_reason || '').trim();
    const coverageNote = String(item?.coverage_note || '').trim();
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
    if (status !== 'covered' && status !== 'na') {
      fail(`${rel} ${ruleId} has invalid status: ${status || '<empty>'}`);
      continue;
    }
    if (status === 'na') {
      if (!naReason) fail(`${rel} ${ruleId} status=na requires na_reason`);
      continue;
    }
    if (refs.length === 0) {
      fail(`${rel} ${ruleId} status=covered requires non-empty evidence_refs`);
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
      if (!coverageNote) {
        fail(`${rel} ${ruleId} uses structural-only evidence and must declare coverage_note`);
        continue;
      }
      if (!/structural\s*-?\s*only/i.test(coverageNote)) {
        fail(`${rel} ${ruleId} coverage_note must explicitly state structural only scope`);
      }
    }
  }

  const missing = [...definedRuleIds].filter((ruleId) => !seen.has(ruleId));
  if (missing.length > 0) {
    fail(`${rel} missing evidence rows for rules: ${missing.join(', ')}`);
  }
}

function checkNimiDesignTables(definedRuleIds) {
  const tokensRel = 'spec/platform/kernel/tables/nimi-ui-tokens.yaml';
  const primitivesRel = 'spec/platform/kernel/tables/nimi-ui-primitives.yaml';
  const themesRel = 'spec/platform/kernel/tables/nimi-ui-themes.yaml';
  const adoptionRel = 'spec/platform/kernel/tables/nimi-ui-adoption.yaml';
  const compositionsRel = 'spec/platform/kernel/tables/nimi-ui-compositions.yaml';
  const allowlistsRel = 'spec/platform/kernel/tables/nimi-ui-allowlists.yaml';

  const tokens = Array.isArray(designTokensTable?.tokens) ? designTokensTable.tokens : [];
  const allowedCategories = new Set([
    'surface',
    'text',
    'action',
    'overlay',
    'sidebar',
    'field',
    'status',
    'radius',
    'spacing',
    'typography',
    'stroke',
    'elevation',
    'motion',
    'z',
    'sizing',
    'border',
    'opacity',
    'focus',
    'scrollbar',
  ]);
  const allowedThemeLayers = new Set(['foundation', 'accent']);
  const tokenIds = new Set();
  const accentTokenIds = new Set();
  for (const token of tokens) {
    const id = String(token?.id || '').trim();
    const category = String(token?.category || '').trim();
    const cssVar = String(token?.css_var || '').trim();
    const family = String(token?.primitive_family || '').trim();
    const source = String(token?.source_rule || '').trim();
    const themeLayer = String(token?.theme_layer || '').trim() || 'foundation';
    if (!id) fail(`${tokensRel}: token missing id`);
    if (tokenIds.has(id)) fail(`${tokensRel}: duplicate token id ${id}`);
    tokenIds.add(id);
    if (!allowedCategories.has(category)) fail(`${tokensRel}: ${id} has invalid category ${category}`);
    if (!cssVar.startsWith('--nimi-')) fail(`${tokensRel}: ${id} css_var must start with --nimi-`);
    if (!family) fail(`${tokensRel}: ${id} missing primitive_family`);
    if (!allowedThemeLayers.has(themeLayer)) fail(`${tokensRel}: ${id} has invalid theme_layer ${themeLayer}`);
    if (themeLayer === 'accent') accentTokenIds.add(id);
    if (!definedRuleIds.has(source)) fail(`${tokensRel}: ${id} references unknown source_rule ${source}`);
  }

  const primitives = Array.isArray(designPrimitivesTable?.primitives) ? designPrimitivesTable.primitives : [];
  for (const primitive of primitives) {
    const id = String(primitive?.id || '').trim();
    const family = String(primitive?.family || '').trim();
    const component = String(primitive?.component || '').trim();
    const source = String(primitive?.source_rule || '').trim();
    if (!id || !family || !component) fail(`${primitivesRel}: primitive rows require id, family, component`);
    const slotIds = new Set();
    for (const slot of Array.isArray(primitive?.slots) ? primitive.slots : []) {
      const slotId = String(slot?.id || '').trim();
      const className = String(slot?.class_name || '').trim();
      const selector = String(slot?.selector || '').trim();
      if (!slotId) fail(`${primitivesRel}: ${id} slots require id`);
      if (slotIds.has(slotId)) fail(`${primitivesRel}: ${id} duplicate slot id ${slotId}`);
      slotIds.add(slotId);
      if (!className && !selector) fail(`${primitivesRel}: ${id} slot ${slotId} requires class_name or selector`);
    }
    const classGroups = primitive?.class_groups && typeof primitive.class_groups === 'object' ? primitive.class_groups : {};
    for (const [groupId, entries] of Object.entries(classGroups)) {
      const groupEntries = Array.isArray(entries) ? entries : [];
      const seen = new Set();
      for (const entry of groupEntries) {
        const entryId = String(entry?.id || '').trim();
        const className = String(entry?.class_name || '').trim();
        const selector = String(entry?.selector || '').trim();
        if (!entryId) fail(`${primitivesRel}: ${id} class group ${groupId} entry missing id`);
        if (seen.has(entryId)) fail(`${primitivesRel}: ${id} class group ${groupId} duplicate entry ${entryId}`);
        seen.add(entryId);
        if (!className && !selector) fail(`${primitivesRel}: ${id} class group ${groupId} entry ${entryId} requires class_name or selector`);
      }
    }
    if (!definedRuleIds.has(source)) fail(`${primitivesRel}: ${id} references unknown source_rule ${source}`);
  }

  const themes = Array.isArray(designThemesTable?.packs) ? designThemesTable.packs : [];
  const themeCoverage = new Map();
  const themeKinds = new Map();
  for (const row of themes) {
    const themeId = String(row?.theme_id || '').trim();
    const packKind = String(row?.pack_kind || '').trim();
    const source = String(row?.source_rule || '').trim();
    const values = row?.values && typeof row.values === 'object' ? row.values : {};
    if (!themeId || !packKind) fail(`${themesRel}: theme packs require theme_id and pack_kind`);
    if (!allowedThemeLayers.has(packKind)) fail(`${themesRel}: ${themeId} has invalid pack_kind ${packKind}`);
    if (!definedRuleIds.has(source)) fail(`${themesRel}: ${themeId} references unknown source_rule ${source}`);
    if (!themeCoverage.has(themeId)) themeCoverage.set(themeId, new Set());
    for (const tokenId of Object.keys(values)) {
      if (!tokenIds.has(tokenId)) fail(`${themesRel}: ${themeId} references unknown token_id ${tokenId}`);
      themeCoverage.get(themeId).add(tokenId);
    }
    if (!themeKinds.has(themeId)) themeKinds.set(themeId, packKind);
    if (themeKinds.get(themeId) !== packKind) fail(`${themesRel}: ${themeId} mixes multiple pack_kind values`);
  }
  for (const [themeId, coverage] of themeCoverage) {
    const packKind = themeKinds.get(themeId);
    if (packKind === 'foundation') {
      for (const tokenId of tokenIds) {
        if (accentTokenIds.has(tokenId)) continue;
        if (!coverage.has(tokenId)) fail(`${themesRel}: foundation pack ${themeId} missing token ${tokenId}`);
      }
      continue;
    }
    for (const tokenId of accentTokenIds) {
      if (!coverage.has(tokenId)) fail(`${themesRel}: accent pack ${themeId} missing token ${tokenId}`);
    }
    for (const tokenId of coverage) {
      if (!accentTokenIds.has(tokenId)) fail(`${themesRel}: accent pack ${themeId} must not redefine foundation token ${tokenId}`);
    }
  }

  const modules = Array.isArray(designAdoptionTable?.modules) ? designAdoptionTable.modules : [];
  for (const row of modules) {
    const id = String(row?.id || '').trim();
    const relModule = String(row?.module || '').trim();
    const schemeSupport = Array.isArray(row?.scheme_support) ? row.scheme_support.map((item) => String(item || '').trim()).filter(Boolean) : [];
    const defaultScheme = String(row?.default_scheme || '').trim();
    const accentPack = String(row?.accent_pack || '').trim();
    const source = String(row?.source_rule || '').trim();
    if (!id || !relModule || !defaultScheme || !accentPack) fail(`${adoptionRel}: adoption rows require id, module, default_scheme, accent_pack`);
    if (schemeSupport.length === 0) fail(`${adoptionRel}: ${id} must declare non-empty scheme_support`);
    if (!schemeSupport.every((scheme) => scheme === 'light' || scheme === 'dark')) fail(`${adoptionRel}: ${id} has invalid scheme_support values`);
    if (!schemeSupport.includes(defaultScheme)) fail(`${adoptionRel}: ${id} default_scheme must be included in scheme_support`);
    if (!themeCoverage.has(`nimi-${defaultScheme}`)) fail(`${adoptionRel}: ${id} references unknown foundation scheme nimi-${defaultScheme}`);
    if (themeKinds.get(accentPack) !== 'accent') fail(`${adoptionRel}: ${id} references unknown accent pack ${accentPack}`);
    if (!fs.existsSync(path.join(cwd, relModule))) fail(`${adoptionRel}: ${id} module does not exist ${relModule}`);
    if (!definedRuleIds.has(source)) fail(`${adoptionRel}: ${id} references unknown source_rule ${source}`);
  }

  const components = Array.isArray(designCompositionsTable?.components) ? designCompositionsTable.components : [];
  const allowedClassification = new Set(['thin_wrapper', 'app_owned_composition']);
  for (const row of components) {
    const id = String(row?.id || '').trim();
    const app = String(row?.app || '').trim();
    const relModule = String(row?.module || '').trim();
    const component = String(row?.component || '').trim();
    const classification = String(row?.classification || '').trim();
    const sharedTargets = Array.isArray(row?.shared_targets) ? row.shared_targets.map((item) => String(item || '').trim()).filter(Boolean) : [];
    const source = String(row?.source_rule || '').trim();
    if (!id || !app || !relModule || !component || !classification) {
      fail(`${compositionsRel}: composition rows require id, app, module, component, classification`);
      continue;
    }
    if (!allowedClassification.has(classification)) {
      fail(`${compositionsRel}: ${id} has invalid classification ${classification}`);
    }
    if (!fs.existsSync(path.join(cwd, relModule))) {
      fail(`${compositionsRel}: ${id} module does not exist ${relModule}`);
      continue;
    }
    const content = read(relModule);
    const componentPattern = new RegExp(`export\\s+(?:const|function)\\s+${component}\\b`, 'u');
    if (!componentPattern.test(content)) {
      fail(`${compositionsRel}: ${id} component ${component} not found in ${relModule}`);
    }
    if (classification === 'thin_wrapper' && sharedTargets.length === 0) {
      fail(`${compositionsRel}: ${id} thin_wrapper rows require non-empty shared_targets`);
    }
    if (classification === 'app_owned_composition' && sharedTargets.length > 0) {
      fail(`${compositionsRel}: ${id} app_owned_composition must not declare shared_targets`);
    }
    if (!definedRuleIds.has(source)) fail(`${compositionsRel}: ${id} references unknown source_rule ${source}`);
  }

  const allowlists = Array.isArray(designAllowlistsTable?.items) ? designAllowlistsTable.items : [];
  for (const item of allowlists) {
    const id = String(item?.id || '').trim();
    const pattern = String(item?.pattern || '').trim();
    const scope = String(item?.scope || '').trim();
    const source = String(item?.source_rule || '').trim();
    if (!id || !pattern || !scope) fail(`${allowlistsRel}: allowlist rows require id, pattern, scope`);
    if (!definedRuleIds.has(source)) fail(`${allowlistsRel}: ${id} references unknown source_rule ${source}`);
  }

  if (!tokenIds.has('motion.slow')) {
    fail(`${tokensRel}: toolkit token taxonomy must define motion.slow`);
  }

  const desktopTokenTableRel = 'spec/desktop/kernel/tables/renderer-design-tokens.yaml';
  const desktopTokenTableRaw = read(desktopTokenTableRel);
  if (desktopTokenTableRaw.includes('motion.base') || desktopTokenTableRaw.includes('--nimi-motion-base')) {
    fail(`${desktopTokenTableRel}: downstream desktop design tokens must align to motion.slow and must not retain motion.base aliases`);
  }
}

function checkOrphanRules(definedRuleIds, domainDocs) {
  const refs = new Map();
  const files = [...new Set([
    ...requiredKernelFiles.map((file) => path.posix.join('spec/platform/kernel', file)),
    ...yamlTables.map((table) => path.posix.join('spec/platform/kernel/tables', table.name)),
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
