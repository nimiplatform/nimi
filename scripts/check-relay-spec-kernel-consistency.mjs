#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { readYamlWithFragments } from './lib/read-yaml-with-fragments.mjs';

const cwd = process.cwd();

const kernelFiles = [
  'apps/relay/spec/INDEX.md',
  'apps/relay/spec/relay.md',
  'apps/relay/spec/kernel/bootstrap-contract.md',
  'apps/relay/spec/kernel/ipc-bridge-contract.md',
  'apps/relay/spec/kernel/transport-validation.md',
  'apps/relay/spec/kernel/interop-contract.md',
  'apps/relay/spec/kernel/agent-core-contract.md',
  'apps/relay/spec/kernel/feature-contract.md',
  'apps/relay/spec/kernel/pipeline-contract.md',
  'apps/relay/spec/kernel/tables/bootstrap-phases.yaml',
  'apps/relay/spec/kernel/tables/feature-capabilities.yaml',
  'apps/relay/spec/kernel/tables/ipc-channels.yaml',
  'apps/relay/spec/kernel/tables/rule-evidence.yaml',
  'apps/relay/spec/kernel/generated/bootstrap-phases.md',
  'apps/relay/spec/kernel/generated/feature-capabilities.md',
  'apps/relay/spec/kernel/generated/ipc-channels.md',
  'apps/relay/spec/kernel/generated/rule-evidence.md',
];

let failed = false;

function fail(message) {
  failed = true;
  console.error(`ERROR: ${message}`);
}

function exists(relPath) {
  return fs.existsSync(path.join(cwd, relPath));
}

function read(relPath) {
  return fs.readFileSync(path.join(cwd, relPath), 'utf8');
}

function loadYaml(relPath) {
  return readYamlWithFragments(path.join(cwd, relPath));
}

function collectRuleDefinitions() {
  const ruleFiles = kernelFiles.filter((file) => file.endsWith('.md') && file.includes('/kernel/') && !file.includes('/generated/'));
  const rules = new Map();
  const headingPattern = /^##\s+(RL-[A-Z]+-\d{3})\b/gmu;
  for (const relPath of ruleFiles) {
    const content = read(relPath);
    for (const match of content.matchAll(headingPattern)) {
      const ruleId = match[1];
      if (!ruleId) continue;
      if (rules.has(ruleId)) {
        fail(`duplicate relay kernel rule definition: ${ruleId}`);
        continue;
      }
      rules.set(ruleId, relPath);
    }
  }
  return rules;
}

function collectSourceRules(value, output = []) {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectSourceRules(entry, output));
    return output;
  }
  if (!value || typeof value !== 'object') {
    return output;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (key === 'source_rule') {
      output.push(String(nested || '').trim());
      continue;
    }
    collectSourceRules(nested, output);
  }
  return output;
}

for (const relPath of kernelFiles) {
  if (!exists(relPath)) {
    fail(`missing relay spec file: ${relPath}`);
  }
}

const relayDomainDoc = read('apps/relay/spec/relay.md');
if (!relayDomainDoc.includes('Normative Imports')) {
  fail('apps/relay/spec/relay.md must declare normative imports');
}
if (!/\bRL-[A-Z]+-\d{3}\b/u.test(relayDomainDoc)) {
  fail('apps/relay/spec/relay.md must reference at least one RL-* rule');
}

const ruleDefinitions = collectRuleDefinitions();
if (ruleDefinitions.size === 0) {
  fail('relay kernel rule definitions are empty');
}

for (const relPath of kernelFiles.filter((file) => file.endsWith('.yaml'))) {
  const yaml = loadYaml(relPath);
  const sourceRules = collectSourceRules(yaml);
  for (const sourceRule of sourceRules) {
    if (!/^RL-[A-Z]+-\d{3}$/u.test(sourceRule)) {
      fail(`${relPath} has invalid source_rule: ${sourceRule || '<empty>'}`);
      continue;
    }
    if (!ruleDefinitions.has(sourceRule)) {
      fail(`${relPath} references unknown source_rule: ${sourceRule}`);
    }
  }
}

const ruleEvidence = loadYaml('apps/relay/spec/kernel/tables/rule-evidence.yaml');
const evidenceEntries = Array.isArray(ruleEvidence?.rules) ? ruleEvidence.rules : [];
const allowedStatuses = new Set(['planned', 'partial', 'verified']);
for (const entry of evidenceEntries) {
  const id = String(entry?.id || '').trim();
  if (!id) {
    fail('rule-evidence entry missing id');
    continue;
  }
  if (!ruleDefinitions.has(id)) {
    fail(`rule-evidence references unknown rule id: ${id}`);
  }
  const status = String(entry?.status || '').trim();
  if (!allowedStatuses.has(status)) {
    fail(`rule-evidence has invalid status for ${id}: ${status || '<empty>'}`);
  }
  const contractRel = path.posix.join('apps/relay/spec', String(entry?.contract || '').trim());
  if (!exists(contractRel)) {
    fail(`rule-evidence contract missing for ${id}: ${contractRel}`);
  }
  const evidencePath = String(entry?.evidence_path || '').trim();
  if (!evidencePath || !exists(evidencePath)) {
    fail(`rule-evidence path missing for ${id}: ${evidencePath || '<empty>'}`);
  }
  const testPath = String(entry?.test || '').trim();
  if (testPath && !exists(testPath)) {
    fail(`rule-evidence test missing for ${id}: ${testPath}`);
  }
}

const ipcChannels = loadYaml('apps/relay/spec/kernel/tables/ipc-channels.yaml');
for (const entry of Array.isArray(ipcChannels?.channels) ? ipcChannels.channels : []) {
  const channel = String(entry?.channel || '').trim();
  if (!channel) continue;
  if (!channel.startsWith('relay:')) {
    fail(`ipc channel must use relay: prefix: ${channel}`);
  }
}

if (failed) {
  process.exit(1);
}

console.log('relay-spec-kernel-consistency: OK');
