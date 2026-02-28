#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const cwd = process.cwd();

const kernelFiles = [
  'spec/runtime/kernel/index.md',
  'spec/runtime/kernel/rpc-surface.md',
  'spec/runtime/kernel/authz-ownership.md',
  'spec/runtime/kernel/key-source-routing.md',
  'spec/runtime/kernel/media-job-lifecycle.md',
  'spec/runtime/kernel/local-category-capability.md',
  'spec/runtime/kernel/endpoint-security.md',
  'spec/runtime/kernel/streaming-contract.md',
  'spec/runtime/kernel/error-model.md',
  'spec/runtime/kernel/pagination-filtering.md',
  'spec/runtime/kernel/audit-contract.md',
  'spec/runtime/kernel/tables/rpc-methods.yaml',
  'spec/runtime/kernel/tables/reason-codes.yaml',
  'spec/runtime/kernel/tables/metadata-keys.yaml',
  'spec/runtime/kernel/tables/provider-catalog.yaml',
  'spec/runtime/kernel/tables/provider-capabilities.yaml',
  'spec/runtime/kernel/tables/connector-rpc-field-rules.yaml',
  'spec/runtime/kernel/tables/job-states.yaml',
  'spec/runtime/kernel/tables/state-transitions.yaml',
];

const domainFiles = [
  'spec/runtime/connector-auth.md',
  'spec/runtime/nimillm.md',
  'spec/runtime/local-model.md',
];

const allRuntimeSpecs = walk(path.join(cwd, 'spec/runtime')).filter((p) => p.endsWith('.md') || p.endsWith('.yaml'));

let failed = false;

function fail(msg) {
  failed = true;
  console.error(`ERROR: ${msg}`);
}

function read(rel) {
  return fs.readFileSync(path.join(cwd, rel), 'utf8');
}

for (const rel of kernelFiles) {
  if (!fs.existsSync(path.join(cwd, rel))) {
    fail(`missing kernel file: ${rel}`);
  }
}

for (const rel of domainFiles) {
  if (!fs.existsSync(path.join(cwd, rel))) {
    fail(`missing runtime domain file: ${rel}`);
    continue;
  }
  const content = read(rel);
  if (!content.includes('Normative Imports: `spec/runtime/kernel/*`')) {
    fail(`${rel} must declare kernel imports`);
  }
  if (!/K-[A-Z]+-\d{3}/.test(content)) {
    fail(`${rel} must reference at least one kernel Rule ID`);
  }
}

const legacyRefs = [
  /docs\/runtime\/design-/g,
  /design-connector-auth\.md/g,
  /design-nimillm\.md/g,
  /design-local-model\.md/g,
];
for (const file of allRuntimeSpecs) {
  const rel = path.relative(cwd, file);
  const txt = fs.readFileSync(file, 'utf8');
  for (const re of legacyRefs) {
    if (re.test(txt)) {
      fail(`legacy runtime design reference found in ${rel}`);
      break;
    }
  }
}

const tokenProviderPatterns = [
  /CheckTokenProviderHealth/g,
  /ListTokenProviderModels/g,
  /TokenProviderHealthStatus/g,
];
for (const file of allRuntimeSpecs) {
  const rel = path.relative(cwd, file);
  const txt = fs.readFileSync(file, 'utf8');
  for (const re of tokenProviderPatterns) {
    if (re.test(txt)) {
      fail(`token-provider legacy naming found in ${rel}`);
      break;
    }
  }
}

const bannedExternalRpcNames = [/\bGenerateText\b/g, /\bStreamGenerateText\b/g, /\bSynthesizeSpeech\b/g];
for (const rel of ['spec/runtime/connector-auth.md', 'spec/runtime/local-model.md']) {
  const txt = read(rel);
  for (const re of bannedExternalRpcNames) {
    if (re.test(txt)) {
      fail(`external RPC naming drift found in ${rel}: ${re}`);
    }
  }
}

for (const file of allRuntimeSpecs) {
  const rel = path.relative(cwd, file);
  if (rel === 'spec/runtime/kernel/tables/reason-codes.yaml') continue;
  const txt = fs.readFileSync(file, 'utf8');
  if (/AI_[A-Z0-9_]+\s*=\s*\d+/.test(txt)) {
    fail(`ReasonCode numeric assignment must live only in reason-codes.yaml: ${rel}`);
  }
}

checkProviderTableParity();
checkConnectorRpcFieldRulesCoverage();
checkStateTransitionCoverage();

if (failed) process.exit(1);
console.log('runtime-spec-kernel-consistency: OK');

function checkProviderTableParity() {
  const catalog = readYaml('spec/runtime/kernel/tables/provider-catalog.yaml');
  const capabilities = readYaml('spec/runtime/kernel/tables/provider-capabilities.yaml');

  const catalogProviders = new Set(
    (Array.isArray(catalog?.providers) ? catalog.providers : [])
      .map((item) => String(item?.provider || '').trim())
      .filter(Boolean),
  );

  const capabilityProviders = Array.isArray(capabilities?.providers) ? capabilities.providers : [];
  const remoteCapabilities = capabilityProviders.filter((item) => String(item?.runtime_plane || '').trim() === 'remote');
  const remoteCapabilityProviders = new Set(
    remoteCapabilities.map((item) => String(item?.provider || '').trim()).filter(Boolean),
  );

  const missingInCapabilities = [...catalogProviders].filter((provider) => !remoteCapabilityProviders.has(provider));
  const extraInCapabilities = [...remoteCapabilityProviders].filter((provider) => !catalogProviders.has(provider));
  if (missingInCapabilities.length > 0) {
    fail(`provider-capabilities missing remote providers from provider-catalog: ${missingInCapabilities.join(', ')}`);
  }
  if (extraInCapabilities.length > 0) {
    fail(`provider-capabilities has unknown remote providers: ${extraInCapabilities.join(', ')}`);
  }

  const localEntries = capabilityProviders.filter((item) => String(item?.provider || '').trim() === 'local');
  if (localEntries.length !== 1) {
    fail('provider-capabilities must contain exactly one `local` entry');
  } else {
    const local = localEntries[0];
    if (String(local?.runtime_plane || '').trim() !== 'local') {
      fail('provider-capabilities local entry must use runtime_plane=local');
    }
    if (String(local?.execution_module || '').trim() !== 'local-model') {
      fail('provider-capabilities local entry must map execution_module=local-model');
    }
    if (local?.inline_supported === true) {
      fail('provider-capabilities local entry must not support inline');
    }
  }

  const catalogMap = new Map();
  for (const item of Array.isArray(catalog?.providers) ? catalog.providers : []) {
    const provider = String(item?.provider || '').trim();
    if (!provider) continue;
    catalogMap.set(provider, Boolean(item?.requires_explicit_endpoint));
  }
  for (const item of remoteCapabilities) {
    const provider = String(item?.provider || '').trim();
    if (!provider) continue;
    const explicitRequired = catalogMap.get(provider);
    const endpointRequirement = String(item?.endpoint_requirement || '').trim();
    if (explicitRequired && endpointRequirement !== 'explicit_required') {
      fail(`provider-capabilities ${provider} must use endpoint_requirement=explicit_required`);
    }
    if (!explicitRequired && endpointRequirement === 'explicit_required') {
      fail(`provider-capabilities ${provider} endpoint_requirement conflicts with provider-catalog default endpoint`);
    }
  }
}

function checkConnectorRpcFieldRulesCoverage() {
  const table = readYaml('spec/runtime/kernel/tables/connector-rpc-field-rules.yaml');
  const rules = Array.isArray(table?.rules) ? table.rules : [];
  const requiredRpcs = new Set(['CreateConnector', 'UpdateConnector', 'DeleteConnector', 'TestConnector', 'ListConnectorModels']);
  const presentRpcs = new Set(rules.map((item) => String(item?.rpc || '').trim()).filter(Boolean));

  for (const rpc of requiredRpcs) {
    if (!presentRpcs.has(rpc)) {
      fail(`connector-rpc-field-rules missing RPC coverage: ${rpc}`);
    }
  }

  for (const item of rules) {
    const sourceRule = String(item?.source_rule || '').trim();
    if (!sourceRule) {
      fail('connector-rpc-field-rules: each rule must include source_rule');
      continue;
    }
    if (!/^CONN-\d{3}$/u.test(sourceRule)) {
      fail(`connector-rpc-field-rules invalid source_rule: ${sourceRule}`);
    }
  }
}

function checkStateTransitionCoverage() {
  const transitions = readYaml('spec/runtime/kernel/tables/state-transitions.yaml');
  const jobStates = readYaml('spec/runtime/kernel/tables/job-states.yaml');

  const machines = Array.isArray(transitions?.machines) ? transitions.machines : [];
  const machineMap = new Map();
  for (const machine of machines) {
    const name = String(machine?.machine || '').trim();
    if (!name) continue;
    machineMap.set(name, machine);
  }

  const requiredMachines = [
    'connector_status',
    'remote_connector_delete_flow',
    'media_job',
    'local_model_lifecycle',
    'local_service_lifecycle',
  ];
  for (const machineName of requiredMachines) {
    if (!machineMap.has(machineName)) {
      fail(`state-transitions missing machine: ${machineName}`);
    }
  }

  const mediaMachine = machineMap.get('media_job');
  if (mediaMachine) {
    const mediaStates = new Set(
      (Array.isArray(mediaMachine?.states) ? mediaMachine.states : []).map((s) => String(s || '').trim()).filter(Boolean),
    );
    const jobStateSet = new Set(
      (Array.isArray(jobStates?.states) ? jobStates.states : []).map((item) => String(item?.state || '').trim()).filter(Boolean),
    );
    const missing = [...jobStateSet].filter((state) => !mediaStates.has(state));
    const extra = [...mediaStates].filter((state) => !jobStateSet.has(state));
    if (missing.length > 0) {
      fail(`state-transitions media_job missing states from job-states: ${missing.join(', ')}`);
    }
    if (extra.length > 0) {
      fail(`state-transitions media_job has unknown states: ${extra.join(', ')}`);
    }
  }
}

function readYaml(rel) {
  const raw = read(rel);
  return YAML.parse(raw);
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
