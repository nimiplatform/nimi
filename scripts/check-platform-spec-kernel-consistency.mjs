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

function readYaml(rel) {
  const content = fs.readFileSync(path.join(cwd, rel), 'utf8');
  return YAML.parse(content);
}

// --- Load tables ---

const errorCodesTable = readYaml('spec/platform/kernel/tables/protocol-error-codes.yaml');
const primitivesTable = readYaml('spec/platform/kernel/tables/protocol-primitives.yaml');
const complianceTable = readYaml('spec/platform/kernel/tables/compliance-test-matrix.yaml');
const auditTable = readYaml('spec/platform/kernel/tables/audit-events.yaml');
const presetsTable = readYaml('spec/platform/kernel/tables/app-authorization-presets.yaml');
const profilesTable = readYaml('spec/platform/kernel/tables/participant-profiles.yaml');

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
  const source = String(code?.source || '').trim();
  if (source && !/^P-[A-Z]{2,12}-\d{3}$/u.test(source)) {
    fail(`protocol-error-codes.yaml ${name}: invalid source format: ${source}`);
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
  const source = String(prim?.source || '').trim();
  if (source && !/^P-[A-Z]{2,12}-\d{3}$/u.test(source)) {
    fail(`protocol-primitives.yaml ${name}: invalid source format: ${source}`);
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
    const source = String(item?.source || '').trim();
    if (source && !/^P-[A-Z]{2,12}-\d{3}$/u.test(source)) {
      fail(`compliance-test-matrix.yaml ${layerName}/${itemName}: invalid source format: ${source}`);
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

  const source = String(event?.source || '').trim();
  if (source && !/^P-[A-Z]{2,12}-\d{3}$/u.test(source)) {
    fail(`audit-events.yaml ${name}: invalid source format: ${source}`);
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

  const source = String(preset?.source || '').trim();
  if (source && !/^P-[A-Z]{2,12}-\d{3}$/u.test(source)) {
    fail(`app-authorization-presets.yaml ${name}: invalid source format: ${source}`);
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

  const source = String(profile?.source || '').trim();
  if (source && !/^P-[A-Z]{2,12}-\d{3}$/u.test(source)) {
    fail(`participant-profiles.yaml ${pid}: invalid source format: ${source}`);
  }
}

// ========================================================
// Check 7: Cross-table source reference consistency
// ========================================================

// Collect all P-* rule IDs referenced across tables
const allSourceRefs = new Set();
for (const code of codes) {
  const source = String(code?.source || '').trim();
  if (source) allSourceRefs.add(source);
}
for (const prim of primitives) {
  const source = String(prim?.source || '').trim();
  if (source) allSourceRefs.add(source);
}
for (const event of events) {
  const source = String(event?.source || '').trim();
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
  'governance-contract.md',
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
          if (key === 'source' && typeof value === 'string') {
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
];

for (const table of yamlTables) {
  const sources = collectYamlSources(table.data, table.name);
  for (const source of sources) {
    if (!definedRuleIds.has(source)) {
      fail(`${table.name}: source "${source}" not found in any kernel contract heading`);
    }
  }
}

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

if (failed) process.exit(1);
console.log('platform-spec-kernel-consistency: OK');

function listDomainMarkdownFiles(domainDirRel) {
  const domainDir = path.join(cwd, domainDirRel);
  if (!fs.existsSync(domainDir)) return [];
  return fs.readdirSync(domainDir)
    .filter((name) => name.endsWith('.md'))
    .filter((name) => name !== 'index.md')
    .map((name) => path.posix.join(domainDirRel, name))
    .sort((a, b) => a.localeCompare(b));
}
