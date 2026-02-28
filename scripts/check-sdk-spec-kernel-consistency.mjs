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

const domainFiles = [
  'spec/sdk/runtime.md',
  'spec/sdk/ai-provider.md',
  'spec/sdk/realm.md',
  'spec/sdk/scope.md',
  'spec/sdk/mod.md',
];

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
const aiMethods = new Set(
  ((runtimeRpcMethods?.services || []).find((service) => String(service?.name || '').trim() === 'AIService')?.methods || [])
    .map((m) => String(m?.name || '').trim())
    .filter(Boolean),
);
for (const group of Array.isArray(runtimeMethodGroups?.groups) ? runtimeMethodGroups.groups : []) {
  const sourceRule = String(group?.source_rule || '').trim();
  if (!/^S-[A-Z]+-\d{3}$/u.test(sourceRule)) {
    fail(`runtime-method-groups invalid source_rule: ${sourceRule}`);
  }
  const methods = Array.isArray(group?.methods) ? group.methods : [];
  if (String(group?.group || '').trim() === 'ai_service_projection') {
    for (const method of methods.map((v) => String(v).trim())) {
      if (!aiMethods.has(method)) {
        fail(`runtime-method-groups ai_service_projection references unknown AIService method: ${method}`);
      }
    }
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
    if (!kernelRuleSet().has(ruleId)) {
      fail(`${rel} references undefined sdk kernel Rule ID: ${ruleId}`);
    }
  }
}

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
