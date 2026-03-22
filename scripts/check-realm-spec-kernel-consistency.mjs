#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const cwd = process.cwd();
const realmRoot = path.join(cwd, 'spec', 'realm');
const kernelRoot = path.join(realmRoot, 'kernel');
const tablesRoot = path.join(kernelRoot, 'tables');

const RULE_ID_RE = /^R-(TRUTH|WSTATE|WHIST|MEM|CHAT|SOC|ECON|ASSET|TRANSIT)-\d{3}$/u;
const RULE_HEADING_RE = /^##\s+(R-(TRUTH|WSTATE|WHIST|MEM|CHAT|SOC|ECON|ASSET|TRANSIT)-\d{3})\b/gmu;
const RULE_REF_RE = /\bR-(TRUTH|WSTATE|WHIST|MEM|CHAT|SOC|ECON|ASSET|TRANSIT)-\d{3}\b/gu;
const FORBIDDEN_PATTERNS = [
  /boundary-vocabulary-contract\.md/iu,
  /interop-mapping-contract\.md/iu,
  /public-vocabulary/iu,
  /primitive-mapping/iu,
  /\bR-BOUND-\d{3}\b/u,
  /\bR-INTEROP-\d{3}[a-z]?\b/u,
  /\bWorldMutation\b/u,
  /\/mutations\b/u,
];

const REQUIRED_KERNEL_DOCS = [
  'index.md',
  'truth-contract.md',
  'world-state-contract.md',
  'world-history-contract.md',
  'agent-memory-contract.md',
  'chat-contract.md',
  'social-contract.md',
  'economy-contract.md',
  'asset-contract.md',
  'transit-contract.md',
];

const REQUIRED_TABLES = [
  'rule-catalog.yaml',
  'rule-evidence.yaml',
  'commit-authorization-matrix.yaml',
  'truth-contract.yaml',
  'world-state-contract.yaml',
  'world-history-contract.yaml',
  'agent-memory-contract.yaml',
  'chat-contract.yaml',
  'social-contract.yaml',
  'economy-contract.yaml',
  'asset-contract.yaml',
  'transit-contract.yaml',
  'domain-enums.yaml',
  'domain-state-machines.yaml',
  'open-spec-alignment-map.yaml',
  'under-spec-registry.yaml',
  'creator-key-tiers.yaml',
  'realm-asset-types.yaml',
  'revenue-event-types.yaml',
  'share-plan-fields.yaml',
];

const THIN_DOMAIN_DOCS = [
  'truth.md',
  'world-state.md',
  'world-history.md',
  'agent-memory.md',
  'world.md',
  'agent.md',
  'chat.md',
  'social.md',
  'economy.md',
  'asset.md',
  'transit.md',
  'world-creator-economy.md',
  'creator-revenue-policy.md',
  'app-interconnect-model.md',
  'realm-interop-mapping.md',
];

let failed = false;

function fail(message) {
  failed = true;
  console.error(`ERROR: ${message}`);
}

function readYaml(relPath) {
  return YAML.parse(fs.readFileSync(path.join(cwd, relPath), 'utf8'));
}

function readText(relPath) {
  return fs.readFileSync(path.join(cwd, relPath), 'utf8');
}

function fileExists(relPath) {
  return fs.existsSync(path.join(cwd, relPath));
}

function listMarkdownFiles(dir) {
  return fs.readdirSync(dir).filter((entry) => entry.endsWith('.md')).sort((a, b) => a.localeCompare(b));
}

function collectRuleHeadings(relPath) {
  const text = readText(relPath);
  return new Set([...text.matchAll(RULE_HEADING_RE)].map((match) => match[1]));
}

function hasSection(content, name) {
  return new RegExp(`^##\\s+(?:\\d+\\.\\s+)?${name}\\b`, 'imu').test(content);
}

function collectSourceRules(value, sink) {
  if (Array.isArray(value)) {
    for (const item of value) collectSourceRules(item, sink);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, inner] of Object.entries(value)) {
    if (key === 'source_rule' || key === 'rule_id') {
      if (typeof inner === 'string' && inner.trim()) sink.add(inner.trim());
      continue;
    }
    if (key === 'source_rules' && Array.isArray(inner)) {
      for (const item of inner) {
        if (typeof item === 'string' && item.trim()) sink.add(item.trim());
      }
      continue;
    }
    collectSourceRules(inner, sink);
  }
}

for (const rel of REQUIRED_KERNEL_DOCS.map((file) => path.posix.join('spec/realm/kernel', file))) {
  if (!fileExists(rel)) fail(`missing kernel doc: ${rel}`);
}

for (const rel of REQUIRED_TABLES.map((file) => path.posix.join('spec/realm/kernel/tables', file))) {
  if (!fileExists(rel)) fail(`missing kernel table: ${rel}`);
}

for (const rel of THIN_DOMAIN_DOCS.map((file) => path.posix.join('spec/realm', file))) {
  if (!fileExists(rel)) fail(`missing realm domain doc: ${rel}`);
}

const contractDocs = REQUIRED_KERNEL_DOCS.filter((file) => file.endsWith('-contract.md'));
const definedRuleIds = new Set();
for (const file of contractDocs) {
  const rel = path.posix.join('spec/realm/kernel', file);
  for (const ruleId of collectRuleHeadings(rel)) {
    if (!RULE_ID_RE.test(ruleId)) fail(`${rel}: invalid rule heading ${ruleId}`);
    definedRuleIds.add(ruleId);
  }
}

const ruleCatalog = readYaml('spec/realm/kernel/tables/rule-catalog.yaml');
if (String(ruleCatalog?.id_pattern || '') !== '^R-(TRUTH|WSTATE|WHIST|MEM|CHAT|SOC|ECON|ASSET|TRANSIT)-[0-9]{3}$') {
  fail('spec/realm/kernel/tables/rule-catalog.yaml: id_pattern must match current rule families');
}

const catalogRuleIds = new Set();
for (const row of Array.isArray(ruleCatalog?.rules) ? ruleCatalog.rules : []) {
  const ruleId = String(row?.rule_id || '').trim();
  if (!RULE_ID_RE.test(ruleId)) {
    fail(`rule-catalog: invalid rule_id ${ruleId || '<empty>'}`);
    continue;
  }
  catalogRuleIds.add(ruleId);
  const source = String(row?.source || '').trim();
  if (!source) fail(`rule-catalog: ${ruleId} missing source`);
  else if (!fileExists(source)) fail(`rule-catalog: ${ruleId} source file not found ${source}`);
}

for (const file of REQUIRED_TABLES.filter((entry) => entry.endsWith('-contract.yaml'))) {
  const rel = path.posix.join('spec/realm/kernel/tables', file);
  const doc = readYaml(rel);
  const mdRel = path.posix.join('spec/realm/kernel', file.replace(/\.yaml$/u, '.md'));
  const headings = collectRuleHeadings(mdRel);
  for (const row of Array.isArray(doc?.rules) ? doc.rules : []) {
    const ruleId = String(row?.rule_id || '').trim();
    if (!RULE_ID_RE.test(ruleId)) {
      fail(`${rel}: invalid rule_id ${ruleId || '<empty>'}`);
      continue;
    }
    if (!headings.has(ruleId)) fail(`${mdRel}: missing heading for ${ruleId}`);
    if (!definedRuleIds.has(ruleId)) fail(`${rel}: rule_id ${ruleId} missing from kernel docs`);
  }
}

for (const ruleId of definedRuleIds) {
  if (!catalogRuleIds.has(ruleId)) fail(`rule-catalog: missing catalog entry for ${ruleId}`);
}
for (const ruleId of catalogRuleIds) {
  if (!definedRuleIds.has(ruleId)) fail(`rule-catalog: unexpected catalog entry ${ruleId}`);
}

const sourceRuleRefs = new Set();
for (const file of REQUIRED_TABLES) {
  collectSourceRules(readYaml(path.posix.join('spec/realm/kernel/tables', file)), sourceRuleRefs);
}
for (const ref of sourceRuleRefs) {
  if (!RULE_ID_RE.test(ref)) continue;
  if (!definedRuleIds.has(ref)) fail(`kernel tables reference undefined rule ${ref}`);
}

const ruleEvidence = readYaml('spec/realm/kernel/tables/rule-evidence.yaml');
const evidenceCatalog = ruleEvidence?.evidence_catalog && typeof ruleEvidence.evidence_catalog === 'object'
  ? ruleEvidence.evidence_catalog
  : null;
if (!evidenceCatalog) {
  fail('rule-evidence.yaml: evidence_catalog must be an object');
} else {
  for (const [name, entry] of Object.entries(evidenceCatalog)) {
    const command = String(entry?.command || '').trim();
    const targetPath = String(entry?.path || '').trim();
    if (!command) fail(`rule-evidence.yaml: evidence_catalog.${name} missing command`);
    if (!targetPath) fail(`rule-evidence.yaml: evidence_catalog.${name} missing path`);
    else if (!fileExists(targetPath)) fail(`rule-evidence.yaml: evidence_catalog.${name} path does not exist: ${targetPath}`);
  }
}

const coveredRuleIds = new Set();
for (const row of Array.isArray(ruleEvidence?.rules) ? ruleEvidence.rules : []) {
  const ruleId = String(row?.rule_id || '').trim();
  const status = String(row?.status || '').trim().toLowerCase();
  const refs = Array.isArray(row?.evidence_refs) ? row.evidence_refs : [];
  if (!RULE_ID_RE.test(ruleId)) {
    fail(`rule-evidence.yaml: invalid rule_id ${ruleId || '<empty>'}`);
    continue;
  }
  if (!definedRuleIds.has(ruleId)) fail(`rule-evidence.yaml: unknown rule ${ruleId}`);
  if (coveredRuleIds.has(ruleId)) fail(`rule-evidence.yaml: duplicate rule row ${ruleId}`);
  coveredRuleIds.add(ruleId);
  if (status !== 'covered' && status !== 'na') fail(`rule-evidence.yaml: ${ruleId} invalid status ${status || '<empty>'}`);
  if (status === 'covered' && refs.length === 0) fail(`rule-evidence.yaml: ${ruleId} covered row requires evidence_refs`);
  for (const ref of refs.map((item) => String(item || '').trim())) {
    if (!ref) fail(`rule-evidence.yaml: ${ruleId} contains empty evidence ref`);
    else if (!evidenceCatalog || !Object.prototype.hasOwnProperty.call(evidenceCatalog, ref)) {
      fail(`rule-evidence.yaml: ${ruleId} references unknown evidence ref ${ref}`);
    }
  }
}
for (const ruleId of definedRuleIds) {
  if (!coveredRuleIds.has(ruleId)) fail(`rule-evidence.yaml: missing row for ${ruleId}`);
}

const alignmentMap = readYaml('spec/realm/kernel/tables/open-spec-alignment-map.yaml');
if (!Array.isArray(alignmentMap?.mappings) || alignmentMap.mappings.length === 0) {
  fail('open-spec-alignment-map.yaml: mappings must not be empty');
}

for (const file of THIN_DOMAIN_DOCS) {
  const rel = path.posix.join('spec/realm', file);
  const content = readText(rel);
  for (const sectionName of ['Normative Imports', 'Scope', 'Reading Path', 'Non-goals']) {
    if (!hasSection(content, sectionName)) fail(`${rel}: missing section ${sectionName}`);
  }
  if ([...content.matchAll(RULE_HEADING_RE)].length > 0) fail(`${rel}: thin domain doc must not define kernel rule headings`);
  const refs = new Set([...content.matchAll(RULE_REF_RE)].map((match) => match[0]));
  if (refs.size === 0) fail(`${rel}: must reference at least one kernel rule`);
  for (const ruleId of refs) {
    if (!definedRuleIds.has(ruleId)) fail(`${rel}: references undefined rule ${ruleId}`);
  }
}

for (const scanRoot of [realmRoot, path.join(cwd, 'apps', 'forge', 'spec'), path.join(cwd, 'spec', 'desktop')]) {
  if (!fs.existsSync(scanRoot)) continue;
  const queue = [scanRoot];
  while (queue.length > 0) {
    const current = queue.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(absPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const content = fs.readFileSync(absPath, 'utf8');
      for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.test(content)) {
          fail(`${path.relative(cwd, absPath)} contains forbidden legacy reference matching ${pattern}`);
        }
      }
    }
  }
}

const generatedDir = path.join(kernelRoot, 'generated');
if (!fs.existsSync(generatedDir)) fail('spec/realm/kernel/generated directory is missing');

if (failed) process.exit(1);
console.log('realm-spec-kernel-consistency: OK');
