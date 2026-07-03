#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const inventoryRel = 'config/zhiyu-test-inventory.yaml';
const policyRel = '.nimi/spec/zhiyu/kernel/tables/test-quarantine-policy.yaml';
const testRoot = 'apps/zhiyu/test';
const testFilePattern = /\.(?:mjs|cjs|js|jsx|ts|tsx)$/u;
const ruleDefinitionPattern = /^##\s+(Z-(?:PROD|AUTH|STATE|PARTNER|CHAT|CONFIG|MEM|AV|ACT|COPY|DIAG|GATE|REL|PERSIST)-\d{3})\b/gmu;

let failed = false;

function fail(message) {
  failed = true;
  console.error(`ERROR: ${message}`);
}

function abs(rel) {
  return path.join(repoRoot, rel);
}

function read(rel) {
  return fs.readFileSync(abs(rel), 'utf8');
}

function readYaml(rel) {
  try {
    return YAML.parse(read(rel));
  } catch (error) {
    fail(`${rel} must parse as YAML: ${error.message}`);
    return null;
  }
}

function* walk(rel) {
  const base = abs(rel);
  if (!fs.existsSync(base)) return;
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    const child = `${rel}/${entry.name}`;
    if (entry.isDirectory()) {
      yield* walk(child);
    } else if (entry.isFile()) {
      const normalized = child.replaceAll('\\', '/');
      if (!testFilePattern.test(entry.name)) {
        fail(`${normalized} has unsupported test inventory extension`);
      } else {
        yield normalized;
      }
    }
  }
}

function* walkKernelMarkdown(rel = '.nimi/spec/zhiyu/kernel') {
  const base = abs(rel);
  if (!fs.existsSync(base)) return;
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    const child = `${rel}/${entry.name}`;
    if (entry.isDirectory()) {
      yield* walkKernelMarkdown(child);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      yield child.replaceAll('\\', '/');
    }
  }
}

function collectRuleDefinitions() {
  const rules = new Set();
  for (const rel of walkKernelMarkdown()) {
    const content = read(rel);
    for (const match of content.matchAll(ruleDefinitionPattern)) {
      rules.add(match[1]);
    }
  }
  return rules;
}

const policy = readYaml(policyRel);
const inventory = readYaml(inventoryRel);
const definedRules = collectRuleDefinitions();
const allowedClassifications = new Set(
  (policy?.classification || [])
    .map((row) => String(row?.id || '').trim())
    .filter(Boolean),
);

if (!inventory) {
  fail(`${inventoryRel} is required for Zhiyu test quarantine inventory`);
} else {
  if (inventory.authority_class !== 'non_authoritative_inventory') {
    fail(`${inventoryRel} must declare authority_class: non_authoritative_inventory`);
  }
  if (inventory.spec_policy_ref !== policyRel) {
    fail(`${inventoryRel} must reference ${policyRel}`);
  }
}

const actualTests = [...walk(testRoot)].sort((a, b) => a.localeCompare(b));
const rows = Array.isArray(inventory?.tests) ? inventory.tests : [];
const byPath = new Map();

for (const row of rows) {
  const rel = String(row?.path || '').replaceAll('\\', '/').trim();
  if (!rel) {
    fail(`${inventoryRel} contains a test row without path`);
    continue;
  }
  if (byPath.has(rel)) {
    fail(`${inventoryRel} contains duplicate inventory row for ${rel}`);
  }
  byPath.set(rel, row);

  const classification = String(row?.classification || '').trim();
  if (!allowedClassifications.has(classification)) {
    fail(`${rel} has invalid classification ${classification || '<empty>'}`);
  }
  const specRefs = Array.isArray(row?.spec_refs) ? row.spec_refs : [];
  if (!specRefs.includes('Z-GATE-001')) {
    fail(`${rel} must include Z-GATE-001 in spec_refs`);
  }
  for (const specRef of specRefs) {
    const ref = String(specRef).trim();
    if (ref.startsWith('Z-') && !definedRules.has(ref)) {
      fail(`${rel} references undefined Zhiyu rule ${ref}`);
    }
  }
  if (row?.authority_claim !== false) {
    fail(`${rel} must declare authority_claim: false`);
  }
  if (classification === 'legacy_drift_quarantine' && row?.may_enter_release_gate !== false) {
    fail(`${rel} legacy drift quarantine must declare may_enter_release_gate: false`);
  }
  if (/image-studio|release-evidence|electron-(?:live-runtime-)?acceptance|proactive/u.test(rel) && row?.may_enter_release_gate !== false) {
    fail(`${rel} must not enter release gate before replacement`);
  }
}

for (const rel of actualTests) {
  if (!byPath.has(rel)) {
    fail(`${inventoryRel} is missing current test file ${rel}`);
  }
}

for (const rel of byPath.keys()) {
  if (!actualTests.includes(rel)) {
    fail(`${inventoryRel} references missing test file ${rel}`);
  }
}

if (failed) {
  process.exit(1);
}

console.log(`zhiyu-test-inventory: OK (${actualTests.length} tests inventoried)`);
