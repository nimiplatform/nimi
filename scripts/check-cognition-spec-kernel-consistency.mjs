#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const cwd = path.resolve(scriptDir, '..');

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

const requiredFiles = [
  '.nimi/spec/cognition/index.md',
  '.nimi/spec/cognition/kernel/index.md',
  '.nimi/spec/cognition/kernel/coverage-review.md',
  '.nimi/spec/cognition/kernel/cognition-contract.md',
  '.nimi/spec/cognition/kernel/family-contract.md',
  '.nimi/spec/cognition/kernel/surface-contract.md',
  '.nimi/spec/cognition/kernel/runtime-bridge-contract.md',
  '.nimi/spec/cognition/kernel/runtime-upgrade-contract.md',
  '.nimi/spec/cognition/kernel/memory-service-contract.md',
  '.nimi/spec/cognition/kernel/knowledge-service-contract.md',
  '.nimi/spec/cognition/kernel/skill-service-contract.md',
  '.nimi/spec/cognition/kernel/reference-contract.md',
  '.nimi/spec/cognition/kernel/prompt-serving-contract.md',
  '.nimi/spec/cognition/kernel/completion-contract.md',
  '.nimi/spec/cognition/kernel/tables/artifact-families.yaml',
  '.nimi/spec/cognition/kernel/tables/public-surface.yaml',
  '.nimi/spec/cognition/kernel/tables/runtime-bridge-boundary.yaml',
  '.nimi/spec/cognition/kernel/tables/runtime-capability-upgrade-matrix.yaml',
  '.nimi/spec/cognition/kernel/tables/memory-service-operations.yaml',
  '.nimi/spec/cognition/kernel/tables/knowledge-service-operations.yaml',
  '.nimi/spec/cognition/kernel/tables/skill-service-operations.yaml',
  '.nimi/spec/cognition/kernel/tables/admitted-reference-matrix.yaml',
  '.nimi/spec/cognition/kernel/tables/prompt-serving-lanes.yaml',
  '.nimi/spec/cognition/kernel/tables/completion-gates.yaml',
  '.nimi/spec/cognition/kernel/tables/rule-evidence.yaml',
];

for (const rel of requiredFiles) {
  if (!fs.existsSync(path.join(cwd, rel))) {
    fail(`missing cognition kernel file: ${rel}`);
  }
}

const domainFiles = listDomainMarkdownFiles('.nimi/spec/cognition');
if (domainFiles.length === 0) {
  fail('cognition domain markdown files are empty');
}

for (const rel of domainFiles) {
  const content = read(rel);
  if (!content.includes('Normative Imports: `.nimi/spec/cognition/kernel/*`')) {
    fail(`${rel} must declare cognition kernel imports`);
  }
  if (!/\bC-COG-\d{3}\b/u.test(content)) {
    fail(`${rel} must reference at least one cognition kernel Rule ID`);
  }
  checkNoLocalRuleIds(content, rel);
  checkNoRuleDefinitionHeadings(content, rel);
}

const definitionMap = collectRuleDefinitions([
  '.nimi/spec/cognition/kernel/cognition-contract.md',
  '.nimi/spec/cognition/kernel/family-contract.md',
  '.nimi/spec/cognition/kernel/surface-contract.md',
  '.nimi/spec/cognition/kernel/runtime-bridge-contract.md',
  '.nimi/spec/cognition/kernel/runtime-upgrade-contract.md',
  '.nimi/spec/cognition/kernel/memory-service-contract.md',
  '.nimi/spec/cognition/kernel/knowledge-service-contract.md',
  '.nimi/spec/cognition/kernel/skill-service-contract.md',
  '.nimi/spec/cognition/kernel/reference-contract.md',
  '.nimi/spec/cognition/kernel/prompt-serving-contract.md',
  '.nimi/spec/cognition/kernel/completion-contract.md',
]);

if (definitionMap.size === 0) {
  fail('cognition contract defines no cognition rules');
}

const familyTable = readYaml('.nimi/spec/cognition/kernel/tables/artifact-families.yaml');
checkSourceRuleTable(
  '.nimi/spec/cognition/kernel/tables/artifact-families.yaml',
  familyTable?.families,
  'family_id',
  definitionMap,
);
const registeredFamilies = new Set(
  (Array.isArray(familyTable?.families) ? familyTable.families : [])
    .map((row) => String(row?.family_id || '').trim())
    .filter(Boolean),
);

const publicSurfaceTable = readYaml('.nimi/spec/cognition/kernel/tables/public-surface.yaml');
checkSourceRuleTable(
  '.nimi/spec/cognition/kernel/tables/public-surface.yaml',
  publicSurfaceTable?.surfaces,
  'surface_id',
  definitionMap,
);

const bridgeBoundaryTable = readYaml('.nimi/spec/cognition/kernel/tables/runtime-bridge-boundary.yaml');
checkSourceRuleTable(
  '.nimi/spec/cognition/kernel/tables/runtime-bridge-boundary.yaml',
  bridgeBoundaryTable?.boundaries,
  'concern_id',
  definitionMap,
);

const upgradeMatrixRel = '.nimi/spec/cognition/kernel/tables/runtime-capability-upgrade-matrix.yaml';
const upgradeMatrix = readYaml(upgradeMatrixRel);
checkSourceRuleTable(upgradeMatrixRel, upgradeMatrix?.capabilities, 'concern_id', definitionMap);
validateRuntimeUpgradeMatrix(upgradeMatrix?.capabilities, upgradeMatrixRel);

const memoryOpsRel = '.nimi/spec/cognition/kernel/tables/memory-service-operations.yaml';
const memoryOpsTable = readYaml(memoryOpsRel);
checkSourceRuleTable(memoryOpsRel, memoryOpsTable?.operations, 'operation_id', definitionMap);

const knowledgeOpsRel = '.nimi/spec/cognition/kernel/tables/knowledge-service-operations.yaml';
const knowledgeOpsTable = readYaml(knowledgeOpsRel);
checkSourceRuleTable(knowledgeOpsRel, knowledgeOpsTable?.operations, 'operation_id', definitionMap);

const skillOpsRel = '.nimi/spec/cognition/kernel/tables/skill-service-operations.yaml';
const skillOpsTable = readYaml(skillOpsRel);
checkSourceRuleTable(skillOpsRel, skillOpsTable?.operations, 'operation_id', definitionMap);

const referenceMatrixRel = '.nimi/spec/cognition/kernel/tables/admitted-reference-matrix.yaml';
const referenceMatrix = readYaml(referenceMatrixRel);
checkSourceRuleTable(referenceMatrixRel, referenceMatrix?.families, 'family_id', definitionMap);
validateReferenceMatrix(referenceMatrix?.families, referenceMatrixRel, registeredFamilies);

const promptLanesRel = '.nimi/spec/cognition/kernel/tables/prompt-serving-lanes.yaml';
const promptLanes = readYaml(promptLanesRel);
checkSourceRuleTable(promptLanesRel, promptLanes?.lanes, 'lane_id', definitionMap);
validatePromptLanes(promptLanes?.lanes, promptLanesRel, registeredFamilies);

const completionGatesRel = '.nimi/spec/cognition/kernel/tables/completion-gates.yaml';
const completionGates = readYaml(completionGatesRel);
checkSourceRuleTable(completionGatesRel, completionGates?.gates, 'gate_id', definitionMap);
validateCompletionGates(completionGates?.gates, completionGatesRel);

validatePublicSurfaceCapabilityMappings(publicSurfaceTable?.surfaces, upgradeMatrix?.capabilities, '.nimi/spec/cognition/kernel/tables/public-surface.yaml');

const evidenceTableRel = '.nimi/spec/cognition/kernel/tables/rule-evidence.yaml';
const evidenceTable = readYaml(evidenceTableRel);
checkRuleEvidence(definitionMap, evidenceTable, evidenceTableRel);
validateSQLiteOnlyBackendFreeze();
validateSupportDocsAlignment();
validateCorePublicSurface(publicSurfaceTable?.surfaces);

if (failed) process.exit(1);
console.log('cognition-spec-kernel-consistency: OK');

function listDomainMarkdownFiles(domainDirRel) {
  const domainDir = path.join(cwd, domainDirRel);
  if (!fs.existsSync(domainDir)) return [];
  return fs.readdirSync(domainDir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => path.posix.join(domainDirRel, name))
    .sort((a, b) => a.localeCompare(b));
}

function checkNoLocalRuleIds(content, rel) {
  const localRuleIdPattern = /\b(?<![KCSDPRF]-)(?:[A-Z]{2,12}-){1,2}\d{3}[a-z]?\b/g;
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

function collectRuleDefinitions(files) {
  const definitionMap = new Map();
  const ruleHeadingPattern = /^##\s+(C-COG-\d{3})\b/gmu;
  for (const rel of files) {
    const content = read(rel);
    for (const match of content.matchAll(ruleHeadingPattern)) {
      const ruleID = match[1];
      if (definitionMap.has(ruleID)) {
        fail(`duplicate cognition Rule ID definition: ${ruleID} in ${rel}`);
        continue;
      }
      definitionMap.set(ruleID, rel);
    }
  }
  return definitionMap;
}

function checkSourceRuleTable(rel, entries, idField, definitionMap) {
  const rows = Array.isArray(entries) ? entries : [];
  if (rows.length === 0) {
    fail(`${rel} must define at least one entry`);
    return;
  }
  const seen = new Set();
  for (const row of rows) {
    const rowID = String(row?.[idField] || '').trim();
    if (!rowID) {
      fail(`${rel} contains entry with empty ${idField}`);
      continue;
    }
    if (seen.has(rowID)) {
      fail(`${rel} duplicates ${idField}: ${rowID}`);
      continue;
    }
    seen.add(rowID);
    const sourceRule = String(row?.source_rule || '').trim();
    if (!sourceRule) {
      fail(`${rel} entry ${rowID} must declare source_rule`);
      continue;
    }
    if (!definitionMap.has(sourceRule)) {
      fail(`${rel} entry ${rowID} references undefined source_rule: ${sourceRule}`);
    }
  }
}

function checkRuleEvidence(definitionMap, doc, rel) {
  const totalRules = Number(doc?.rule_compliance?.total_c_rules);
  if (!Number.isInteger(totalRules)) {
    fail(`${rel} must declare integer rule_compliance.total_c_rules`);
  } else if (totalRules !== definitionMap.size) {
    fail(`${rel} total_c_rules=${totalRules} does not match defined cognition rules=${definitionMap.size}`);
  }

  const catalog = doc?.evidence_catalog;
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
    fail(`${rel} must declare evidence_catalog map`);
    return;
  }
  const catalogRefs = new Set(Object.keys(catalog));

  const rules = Array.isArray(doc?.rules) ? doc.rules : [];
  if (rules.length !== definitionMap.size) {
    fail(`${rel} must contain one rule-evidence entry per cognition rule`);
  }
  const allowedStatuses = new Set(['covered', 'deferred', 'na']);

  const seenRules = new Set();
  for (const entry of rules) {
    const ruleID = String(entry?.rule_id || '').trim();
    if (!ruleID) {
      fail(`${rel} contains rule-evidence entry with empty rule_id`);
      continue;
    }
    if (!definitionMap.has(ruleID)) {
      fail(`${rel} references undefined cognition rule in evidence table: ${ruleID}`);
    }
    if (seenRules.has(ruleID)) {
      fail(`${rel} duplicates rule-evidence entry for ${ruleID}`);
    }
    seenRules.add(ruleID);

    const status = String(entry?.status || '').trim();
    if (!status) {
      fail(`${rel} rule ${ruleID} must declare status`);
    } else if (!allowedStatuses.has(status)) {
      fail(`${rel} rule ${ruleID} uses illegal status: ${status}`);
    }

    const evidenceRefs = Array.isArray(entry?.evidence_refs) ? entry.evidence_refs : [];
    if (evidenceRefs.length === 0) {
      fail(`${rel} rule ${ruleID} must declare at least one evidence_ref`);
    }
    for (const evidenceRef of evidenceRefs) {
      const ref = String(evidenceRef || '').trim();
      if (!catalogRefs.has(ref)) {
        fail(`${rel} rule ${ruleID} references unknown evidence ref: ${ref}`);
      }
    }
  }

  for (const ruleID of definitionMap.keys()) {
    if (!seenRules.has(ruleID)) {
      fail(`${rel} is missing rule-evidence entry for ${ruleID}`);
    }
  }
}

function validateRuntimeUpgradeMatrix(entries, rel) {
  const rows = Array.isArray(entries) ? entries : [];
  const requiredConcerns = new Set([
    'memory_artifact_mutation',
    'memory_retrieval_recall',
    'memory_history_lineage',
    'memory_delete_visibility',
    'memory_derived_serving_view',
    'memory_failure_model',
    'knowledge_page_lifecycle',
    'knowledge_lexical_retrieval',
    'knowledge_hybrid_retrieval',
    'knowledge_relation_graph',
    'knowledge_ingest_progress',
    'knowledge_delete_update_visibility',
    'knowledge_failure_model',
  ]);
  const allowedParityModes = new Set(['parity', 'upgrade', 'explicitly_out_of_scope']);
  const seen = new Set();
  for (const row of rows) {
    const concernID = String(row?.concern_id || '').trim();
    if (!concernID) continue;
    seen.add(concernID);
    const parityMode = String(row?.parity_mode || '').trim();
    if (!allowedParityModes.has(parityMode)) {
      fail(`${rel} concern ${concernID} uses illegal parity_mode: ${parityMode}`);
    }
    for (const field of ['runtime_source_contract', 'runtime_capability', 'cognition_owner_surface', 'required_floor', 'admitted_shape', 'forbidden_downgrade']) {
      const value = String(row?.[field] || '').trim();
      if (!value) {
        fail(`${rel} concern ${concernID} must declare ${field}`);
      }
    }
    if (parityMode === 'explicitly_out_of_scope' && !String(row?.out_of_scope_reason || '').trim()) {
      fail(`${rel} concern ${concernID} with parity_mode=explicitly_out_of_scope must declare out_of_scope_reason`);
    }
  }
  for (const concernID of requiredConcerns) {
    if (!seen.has(concernID)) {
      fail(`${rel} is missing required overlap concern: ${concernID}`);
    }
  }
}

function validatePublicSurfaceCapabilityMappings(entries, capabilityEntries, rel) {
  const surfaces = Array.isArray(entries) ? entries : [];
  const capabilityRows = Array.isArray(capabilityEntries) ? capabilityEntries : [];
  const capabilityMap = new Map();
  for (const row of capabilityRows) {
    const concernID = String(row?.concern_id || '').trim();
    if (!concernID) continue;
    capabilityMap.set(concernID, row);
  }

  const mappedConcerns = new Set();
  for (const surface of surfaces) {
    const surfaceID = String(surface?.surface_id || '').trim();
    const familyScope = String(surface?.family_scope || '').trim();
    const surfaceKind = String(surface?.surface_kind || '').trim();
    const capabilityConcerns = Array.isArray(surface?.capability_concerns) ? surface.capability_concerns : [];
    if ((familyScope === 'memory_substrate' || familyScope === 'knowledge_projections') && surfaceKind === 'service_method') {
      if (capabilityConcerns.length === 0) {
        fail(`${rel} overlap surface ${surfaceID} must declare capability_concerns`);
      }
    }
    for (const concern of capabilityConcerns) {
      const concernID = String(concern || '').trim();
      if (!capabilityMap.has(concernID)) {
        fail(`${rel} surface ${surfaceID} references unknown capability concern: ${concernID}`);
        continue;
      }
      mappedConcerns.add(concernID);
    }
  }

  for (const [concernID, row] of capabilityMap.entries()) {
    const parityMode = String(row?.parity_mode || '').trim();
    if (parityMode === 'explicitly_out_of_scope') continue;
    if (!mappedConcerns.has(concernID)) {
      fail(`${rel} does not map public overlap capability concern: ${concernID}`);
    }
  }
}

function validateReferenceMatrix(entries, rel, registeredFamilies) {
  const rows = Array.isArray(entries) ? entries : [];
  const seen = new Set();
  for (const row of rows) {
    const familyID = String(row?.family_id || '').trim();
    if (!familyID) continue;
    seen.add(familyID);
    if (!registeredFamilies.has(familyID)) {
      fail(`${rel} references unregistered family: ${familyID}`);
    }
    for (const field of ['allowed_outgoing_refs', 'allowed_incoming_refs', 'forbidden_cross_family_refs']) {
      const values = Array.isArray(row?.[field]) ? row[field] : [];
      for (const value of values) {
        const refFamily = String(value || '').trim();
        if (!registeredFamilies.has(refFamily)) {
          fail(`${rel} family ${familyID} references unknown family in ${field}: ${refFamily}`);
        }
      }
    }
    for (const field of ['missing_target_on_save', 'missing_target_on_archive', 'missing_target_on_remove']) {
      if (!String(row?.[field] || '').trim()) {
        fail(`${rel} family ${familyID} must declare ${field}`);
      }
    }
  }
  for (const familyID of registeredFamilies) {
    if (!seen.has(familyID)) {
      fail(`${rel} is missing registered family row: ${familyID}`);
    }
  }
}

function validatePromptLanes(entries, rel, registeredFamilies) {
  const rows = Array.isArray(entries) ? entries : [];
  for (const row of rows) {
    const laneID = String(row?.lane_id || '').trim();
    for (const family of Array.isArray(row?.admitted_families) ? row.admitted_families : []) {
      const familyID = String(family || '').trim();
      if (!registeredFamilies.has(familyID)) {
        fail(`${rel} lane ${laneID} references unknown family: ${familyID}`);
      }
    }
  }
}

function validateCompletionGates(entries, rel) {
  const rows = Array.isArray(entries) ? entries : [];
  const allowedClosureClasses = new Set(['semantic_closure', 'implementation_closure', 'runtime_independence']);
  const requiredGateIDs = new Set([
    'no_downgrade_gate',
    'fail_closed_gate',
    'prompt_correctness_gate',
    'cleanup_explainability_gate',
    'derived_view_ownership_gate',
    'runtime_independence_gate',
  ]);
  const seenGateIDs = new Set();
  const seenClasses = new Set();

  for (const row of rows) {
    const gateID = String(row?.gate_id || '').trim();
    if (!gateID) continue;
    seenGateIDs.add(gateID);
    const closureClass = String(row?.closure_class || '').trim();
    if (!allowedClosureClasses.has(closureClass)) {
      fail(`${rel} gate ${gateID} uses illegal closure_class: ${closureClass}`);
    } else {
      seenClasses.add(closureClass);
    }
    for (const field of ['gate_statement', 'minimum_evidence', 'failure_condition']) {
      if (!String(row?.[field] || '').trim()) {
        fail(`${rel} gate ${gateID} must declare ${field}`);
      }
    }
  }

  for (const closureClass of allowedClosureClasses) {
    if (!seenClasses.has(closureClass)) {
      fail(`${rel} is missing closure_class coverage for ${closureClass}`);
    }
  }
  for (const gateID of requiredGateIDs) {
    if (!seenGateIDs.has(gateID)) {
      fail(`${rel} is missing required completion gate: ${gateID}`);
    }
  }
}

function validateSQLiteOnlyBackendFreeze() {
  const forbiddenFiles = [
    'nimi-cognition/internal/storage/filebackend.go',
    'nimi-cognition/internal/storage/filebackend_test.go',
    'nimi-cognition/internal/storage/backend.go',
  ];
  for (const rel of forbiddenFiles) {
    if (fs.existsSync(path.join(cwd, rel))) {
      fail(`sqlite-only cognition closeout forbids retired durable backend path: ${rel}`);
    }
  }
}

function validateSupportDocsAlignment() {
  const readme = read('nimi-cognition/README.md');
  if (!readme.includes('The single admitted durable backend is SQLite.')) {
    fail('nimi-cognition/README.md must state that SQLite is the single admitted durable backend');
  }
  const agents = read('nimi-cognition/AGENTS.md');
  if (!agents.includes('SQLite is the only admitted durable backend.')) {
    fail('nimi-cognition/AGENTS.md must state that SQLite is the only admitted durable backend');
  }
}

function validateCorePublicSurface(entries) {
  const surfaces = Array.isArray(entries) ? entries : [];
  const expectedFunctions = new Set();
  const expectedMethods = new Map([
    ['Cognition', new Set()],
    ['KernelService', new Set()],
    ['MemoryService', new Set()],
    ['KnowledgeService', new Set()],
    ['SkillService', new Set()],
    ['WorkingService', new Set()],
    ['PromptService', new Set()],
  ]);

  for (const row of surfaces) {
    const ownerSurface = String(row?.owner_surface || '').trim();
    const entrypoint = String(row?.entrypoint || '').trim();
    if (!entrypoint) continue;

    if (ownerSurface === 'cognition' && (entrypoint === 'New' || entrypoint === 'WithClock')) {
      expectedFunctions.add(entrypoint);
      continue;
    }
    if (expectedMethods.has(ownerSurface)) {
      const methodName = entrypoint.includes('.') ? entrypoint.split('.').at(-1) : entrypoint;
      if (methodName) expectedMethods.get(ownerSurface).add(methodName);
    }
  }

  const cognitionSource = readGoPackageSource('nimi-cognition/cognition');
  const actualFunctions = collectPublicFunctions(cognitionSource);
  compareSet('cognition package functions', expectedFunctions, actualFunctions);

  const actualMethods = collectPublicMethodsByReceiver(cognitionSource);
  for (const [receiverType, expected] of expectedMethods.entries()) {
    compareSet(`${receiverType} public methods`, expected, actualMethods.get(receiverType) || new Set());
  }
}

function readGoPackageSource(relDir) {
  const dir = path.join(cwd, relDir);
  if (!fs.existsSync(dir)) {
    fail(`missing go package directory: ${relDir}`);
    return '';
  }
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.go') && !name.endsWith('_test.go'))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => fs.readFileSync(path.join(dir, name), 'utf8'))
    .join('\n');
}

function collectPublicFunctions(source) {
  const set = new Set();
  const funcPattern = /^func\s+([A-Z][A-Za-z0-9_]*)\(/gmu;
  for (const match of source.matchAll(funcPattern)) {
    set.add(match[1]);
  }
  return set;
}

function collectPublicMethodsByReceiver(source) {
  const map = new Map();
  const methodPattern = /^func\s+\(\s*\w+\s+\*?([A-Z][A-Za-z0-9_]*)\s*\)\s+([A-Z][A-Za-z0-9_]*)\(/gmu;
  for (const match of source.matchAll(methodPattern)) {
    const receiverType = match[1];
    const methodName = match[2];
    if (!map.has(receiverType)) {
      map.set(receiverType, new Set());
    }
    map.get(receiverType).add(methodName);
  }
  return map;
}

function compareSet(label, expected, actual) {
  for (const item of expected) {
    if (!actual.has(item)) {
      fail(`${label} is missing admitted surface: ${item}`);
    }
  }
  for (const item of actual) {
    if (!expected.has(item)) {
      fail(`${label} exposes unadmitted public surface: ${item}`);
    }
  }
}
