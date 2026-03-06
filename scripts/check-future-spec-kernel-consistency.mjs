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

const backlogTable = readYaml('spec/future/kernel/tables/backlog-items.yaml');
const sourcesTable = readYaml('spec/future/kernel/tables/research-sources.yaml');
const graduationTable = readYaml('spec/future/kernel/tables/graduation-log.yaml');

const items = Array.isArray(backlogTable?.items) ? backlogTable.items : [];
const sources = Array.isArray(sourcesTable?.sources) ? sourcesTable.sources : [];
const graduationEntries = Array.isArray(graduationTable?.entries) ? graduationTable.entries : [];

const domainDocs = listDomainMarkdownFiles('spec/future');
if (domainDocs.length === 0) {
  fail('future domain markdown files are empty');
}
for (const rel of domainDocs) {
  const content = fs.readFileSync(path.join(cwd, rel), 'utf8');
  checkNoLocalRuleIds(content, rel);
  checkNoRuleDefinitionHeadings(content, rel);
  if (rel !== 'spec/future/index.md' && !/\bF-[A-Z]{2,12}-\d{3}\b/u.test(content)) {
    fail(`${rel} must reference at least one future kernel Rule ID`);
  }
}

// ========================================================
// Pass 1: Collect all IDs
// ========================================================

const sourceIdSet = new Set();
for (const source of sources) {
  const sourceId = String(source?.source_id || '').trim();
  if (sourceId) sourceIdSet.add(sourceId);
}

const itemIdSet = new Set();
for (const item of items) {
  const itemId = String(item?.item_id || '').trim();
  if (itemId) itemIdSet.add(itemId);
}

// Track which source_ids are referenced by at least one backlog item
const referencedSourceIds = new Set();

// ========================================================
// Pass 2: Validate all fields
// ========================================================

// --- Check source_id format and uniqueness ---

const sourceIdDupCheck = new Set();
for (const source of sources) {
  const sourceId = String(source?.source_id || '').trim();
  if (!sourceId) {
    fail('research-sources.yaml: entry missing source_id');
    continue;
  }
  if (!/^RESEARCH-[A-Z]{2,6}-\d{3}$/u.test(sourceId)) {
    fail(`research-sources.yaml: invalid source_id format: ${sourceId}`);
  }
  if (sourceIdDupCheck.has(sourceId)) {
    fail(`research-sources.yaml: duplicate source_id: ${sourceId}`);
  }
  sourceIdDupCheck.add(sourceId);

  // Check required fields
  for (const field of ['title', 'path', 'date', 'scope']) {
    if (!String(source?.[field] || '').trim()) {
      fail(`research-sources.yaml ${sourceId}: missing required field: ${field}`);
    }
  }
}

// --- Check source path existence ---

for (const source of sources) {
  const sourceId = String(source?.source_id || '').trim();
  const filePath = String(source?.path || '').trim();
  if (!filePath) continue;
  if (!fs.existsSync(path.join(cwd, filePath))) {
    fail(`research-sources.yaml ${sourceId}: path does not exist: ${filePath}`);
  }
}

// --- Check item_id format, uniqueness, and field validity ---

const validPriorities = new Set(['high', 'medium', 'low']);
const validStatuses = new Set(['proposed', 'accepted', 'spec-drafted', 'implemented', 'rejected', 'deferred']);
const validCategories = new Set(['ux', 'integration', 'platform', 'auth', 'security', 'observability']);
const validTargetLayers = new Set(['runtime', 'sdk', 'desktop', 'web']);
const validComplexities = new Set(['small', 'medium', 'large']);

const itemIdDupCheck = new Set();
for (const item of items) {
  const itemId = String(item?.item_id || '').trim();
  if (!itemId) {
    fail('backlog-items.yaml: entry missing item_id');
    continue;
  }

  // Validate item_id format: F-<MNEMONIC>-NNN
  if (!/^F-[A-Z]{2,12}-\d{3}$/u.test(itemId)) {
    fail(`backlog-items.yaml: invalid item_id format: ${itemId}`);
  }

  if (itemIdDupCheck.has(itemId)) {
    fail(`backlog-items.yaml: duplicate item_id: ${itemId}`);
  }
  itemIdDupCheck.add(itemId);

  // Check required fields
  for (const field of ['title', 'priority', 'category', 'status', 'complexity', 'architecture_notes']) {
    if (!String(item?.[field] || '').trim()) {
      fail(`backlog-items.yaml ${itemId}: missing required field: ${field}`);
    }
  }

  // Validate enums
  const priority = String(item?.priority || '').trim();
  if (priority && !validPriorities.has(priority)) {
    fail(`backlog-items.yaml ${itemId}: invalid priority: ${priority}`);
  }

  const status = String(item?.status || '').trim();
  if (status && !validStatuses.has(status)) {
    fail(`backlog-items.yaml ${itemId}: invalid status: ${status}`);
  }

  const category = String(item?.category || '').trim();
  if (category && !validCategories.has(category)) {
    fail(`backlog-items.yaml ${itemId}: invalid category: ${category}`);
  }

  const complexity = String(item?.complexity || '').trim();
  if (complexity && !validComplexities.has(complexity)) {
    fail(`backlog-items.yaml ${itemId}: invalid complexity: ${complexity}`);
  }

  // Validate target_layers
  const targetLayers = Array.isArray(item?.target_layers) ? item.target_layers : [];
  if (targetLayers.length === 0) {
    fail(`backlog-items.yaml ${itemId}: target_layers must not be empty`);
  }
  for (const layer of targetLayers) {
    const layerStr = String(layer).trim();
    if (!validTargetLayers.has(layerStr)) {
      fail(`backlog-items.yaml ${itemId}: invalid target_layer: ${layerStr}`);
    }
  }

  // Validate source_ids resolve
  const sourceIds = Array.isArray(item?.source_ids) ? item.source_ids : [];
  if (sourceIds.length === 0) {
    fail(`backlog-items.yaml ${itemId}: source_ids must not be empty`);
  }
  for (const sid of sourceIds) {
    const sidStr = String(sid).trim();
    if (!sourceIdSet.has(sidStr)) {
      fail(`backlog-items.yaml ${itemId}: source_id not found in research-sources.yaml: ${sidStr}`);
    }
    referencedSourceIds.add(sidStr);
  }

  // Validate depends_on references
  const dependsOn = Array.isArray(item?.depends_on) ? item.depends_on : [];
  for (const dep of dependsOn) {
    const depStr = String(dep).trim();
    if (depStr === itemId) {
      fail(`backlog-items.yaml ${itemId}: depends_on contains self-reference`);
    }
    if (!itemIdSet.has(depStr)) {
      fail(`backlog-items.yaml ${itemId}: depends_on references unknown item_id: ${depStr}`);
    }
  }
}

// --- Cycle detection (DFS) ---

function detectCycles() {
  const adjacency = new Map();
  for (const item of items) {
    const itemId = String(item?.item_id || '').trim();
    if (!itemId) continue;
    const dependsOn = Array.isArray(item?.depends_on) ? item.depends_on : [];
    adjacency.set(itemId, dependsOn.map((d) => String(d).trim()));
  }

  // 0 = unvisited, 1 = in-stack, 2 = done
  const state = new Map();
  const parent = new Map();

  function dfs(node) {
    state.set(node, 1);
    const deps = adjacency.get(node) || [];
    for (const dep of deps) {
      const depState = state.get(dep) || 0;
      if (depState === 1) {
        // Reconstruct cycle
        const cycle = [dep, node];
        let cur = node;
        while (parent.has(cur) && parent.get(cur) !== dep) {
          cur = parent.get(cur);
          cycle.push(cur);
        }
        cycle.reverse();
        return cycle;
      }
      if (depState === 0) {
        parent.set(dep, node);
        const result = dfs(dep);
        if (result) return result;
      }
    }
    state.set(node, 2);
    return null;
  }

  for (const node of adjacency.keys()) {
    if ((state.get(node) || 0) === 0) {
      const cycle = dfs(node);
      if (cycle) return cycle;
    }
  }
  return null;
}

const cycle = detectCycles();
if (cycle) {
  fail(`backlog-items.yaml: circular dependency detected: ${cycle.join(' → ')}`);
}

// --- Check orphan sources (WARNING, not ERROR) ---

for (const sourceId of sourceIdSet) {
  if (!referencedSourceIds.has(sourceId)) {
    warn(`research-sources.yaml: source_id ${sourceId} is registered but not referenced by any backlog item`);
  }
}

// --- Check graduation log ---

const graduatedItemIds = new Set();
for (const entry of graduationEntries) {
  const itemId = String(entry?.item_id || '').trim();
  if (!itemId) {
    fail('graduation-log.yaml: entry missing item_id');
    continue;
  }

  if (!itemIdSet.has(itemId)) {
    fail(`graduation-log.yaml: item_id not found in backlog-items.yaml: ${itemId}`);
  }

  if (graduatedItemIds.has(itemId)) {
    fail(`graduation-log.yaml: duplicate graduation entry for: ${itemId}`);
  }
  graduatedItemIds.add(itemId);

  // Check required fields
  for (const field of ['graduated_date', 'target_spec_path', 'target_rule_ids']) {
    const value = entry?.[field];
    if (field === 'target_rule_ids') {
      if (!Array.isArray(value) || value.length === 0) {
        fail(`graduation-log.yaml ${itemId}: missing required field: ${field}`);
      }
    } else if (!String(value || '').trim()) {
      fail(`graduation-log.yaml ${itemId}: missing required field: ${field}`);
    }
  }
}

// --- Check graduated items have matching status ---

for (const item of items) {
  const itemId = String(item?.item_id || '').trim();
  const status = String(item?.status || '').trim();
  if (!itemId) continue;

  if ((status === 'spec-drafted' || status === 'implemented') && !graduatedItemIds.has(itemId)) {
    fail(`backlog-items.yaml ${itemId}: status is ${status} but no graduation-log entry found`);
  }

  if (graduatedItemIds.has(itemId) && status !== 'spec-drafted' && status !== 'implemented') {
    fail(`backlog-items.yaml ${itemId}: has graduation-log entry but status is ${status}`);
  }
}

checkGraduationContractParity();

if (failed) process.exit(1);
console.log('future-spec-kernel-consistency: OK');

function listDomainMarkdownFiles(domainDirRel) {
  const domainDir = path.join(cwd, domainDirRel);
  if (!fs.existsSync(domainDir)) return [];
  return fs.readdirSync(domainDir)
    .filter((name) => name.endsWith('.md'))
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

function checkGraduationContractParity() {
  const graduationContractPath = path.join(cwd, 'spec/future/kernel/graduation-contract.md');
  const futureIndexPath = path.join(cwd, 'spec/future/index.md');
  const graduationContract = fs.readFileSync(graduationContractPath, 'utf8');
  const futureIndex = fs.readFileSync(futureIndexPath, 'utf8');

  for (const token of ['check:<domain>-spec-kernel-consistency', 'check:<domain>-spec-kernel-docs-drift', 'spec/desktop/', 'spec/desktop/web-adapter.md']) {
    if (!graduationContract.includes(token)) {
      fail(`graduation-contract.md must mention ${token}`);
    }
  }

  for (const token of ['spec/runtime/', 'spec/sdk/', 'spec/desktop/', 'spec/desktop/web-adapter.md']) {
    if (!futureIndex.includes(token)) {
      fail(`spec/future/index.md must mention ${token}`);
    }
  }
}
