#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const PROJECT_ROOT = process.cwd();
const REALM_ROOT = path.join(PROJECT_ROOT, 'spec', 'realm');
const KERNEL_ROOT = path.join(REALM_ROOT, 'kernel');
const TABLES_DIR = path.join(KERNEL_ROOT, 'tables');

const RULE_FAMILIES = ['TRUTH', 'WSTATE', 'WHIST', 'MEM', 'CHAT', 'SOC', 'ECON', 'ASSET', 'TRANSIT'];
const EXPECTED_ID_PATTERN = `^R-(${RULE_FAMILIES.join('|')})-[0-9]{3}$`;
const RULE_ID_PATTERN = new RegExp(`^R-(${RULE_FAMILIES.join('|')})-[0-9]{3}$`);

const RULE_CATALOG_PATH = path.join(TABLES_DIR, 'rule-catalog.yaml');
const RULE_EVIDENCE_PATH = path.join(TABLES_DIR, 'rule-evidence.yaml');
const DOMAIN_ENUMS_PATH = path.join(TABLES_DIR, 'domain-enums.yaml');
const DOMAIN_STATE_MACHINES_PATH = path.join(TABLES_DIR, 'domain-state-machines.yaml');
const OPEN_SPEC_ALIGNMENT_MAP_PATH = path.join(TABLES_DIR, 'open-spec-alignment-map.yaml');
const COMMIT_AUTHORIZATION_MATRIX_PATH = path.join(TABLES_DIR, 'commit-authorization-matrix.yaml');

const DOMAIN_DOCS = [
  path.join(REALM_ROOT, 'truth.md'),
  path.join(REALM_ROOT, 'world-state.md'),
  path.join(REALM_ROOT, 'world-history.md'),
  path.join(REALM_ROOT, 'agent-memory.md'),
  path.join(REALM_ROOT, 'world.md'),
  path.join(REALM_ROOT, 'agent.md'),
  path.join(REALM_ROOT, 'social.md'),
  path.join(REALM_ROOT, 'economy.md'),
  path.join(REALM_ROOT, 'asset.md'),
  path.join(REALM_ROOT, 'transit.md'),
  path.join(REALM_ROOT, 'chat.md'),
];

const BRIDGE_DOCS = [
  path.join(REALM_ROOT, 'app-interconnect-model.md'),
  path.join(REALM_ROOT, 'world-creator-economy.md'),
  path.join(REALM_ROOT, 'creator-revenue-policy.md'),
  path.join(REALM_ROOT, 'realm-interop-mapping.md'),
];

function toPosix(filePath) {
  return filePath.replace(/\\/g, '/');
}

function rel(absPath) {
  return toPosix(path.relative(PROJECT_ROOT, absPath));
}

function readYaml(absPath) {
  const raw = fs.readFileSync(absPath, 'utf8');
  return YAML.parse(raw) ?? {};
}

function asStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === 'string' && item.trim().length > 0);
}

function pushIssue(issues, scope, message) {
  issues.push({ scope, message });
}

function splitAnchor(value) {
  const [filePath, anchor] = value.split('#');
  return { filePath: filePath.trim(), anchor: (anchor ?? '').trim() };
}

function hasAnchor(content, anchor) {
  if (!anchor) return true;
  return content.includes(anchor) || content.includes(`## ${anchor}`) || content.includes(`### ${anchor}`);
}

function collectMarkdownRuleIds(absPath) {
  const lines = fs.readFileSync(absPath, 'utf8').split(/\r?\n/);
  return lines
    .map((line) => line.match(/^##\s+(R-(TRUTH|WSTATE|WHIST|MEM|CHAT|SOC|ECON|ASSET|TRANSIT)-[0-9]{3})\s*$/)?.[1] ?? '')
    .filter(Boolean);
}

function resolveEvidence(profiles, entry) {
  const resolved = { openapi: [], prisma_models: [], service_files: [], test_files: [] };
  const merge = (source) => {
    if (!source) return;
    resolved.openapi.push(...asStringArray(source.openapi));
    resolved.prisma_models.push(...asStringArray(source.prisma_models));
    resolved.service_files.push(...asStringArray(source.service_files));
    resolved.test_files.push(...asStringArray(source.test_files));
  };
  for (const ref of asStringArray(entry.profile_refs)) merge(profiles[ref]);
  merge(entry);
  resolved.openapi = [...new Set(resolved.openapi)];
  resolved.prisma_models = [...new Set(resolved.prisma_models)];
  resolved.service_files = [...new Set(resolved.service_files)];
  resolved.test_files = [...new Set(resolved.test_files)];
  return resolved;
}

function getContractTables() {
  return fs
    .readdirSync(TABLES_DIR)
    .filter((file) => file.endsWith('-contract.yaml'))
    .sort((a, b) => a.localeCompare(b))
    .map((file) => {
      const yamlPath = path.join(TABLES_DIR, file);
      const mdPath = path.join(KERNEL_ROOT, file.replace(/\.yaml$/, '.md'));
      return { yamlPath, mdPath, doc: readYaml(yamlPath) };
    });
}

function main() {
  const issues = [];
  const contractTables = getContractTables();
  const catalog = readYaml(RULE_CATALOG_PATH);
  const evidence = readYaml(RULE_EVIDENCE_PATH);
  const enums = readYaml(DOMAIN_ENUMS_PATH);
  const stateMachines = readYaml(DOMAIN_STATE_MACHINES_PATH);
  const alignment = readYaml(OPEN_SPEC_ALIGNMENT_MAP_PATH);
  const commitAuthorization = readYaml(COMMIT_AUTHORIZATION_MATRIX_PATH);

  if (catalog.id_pattern !== EXPECTED_ID_PATTERN) {
    pushIssue(issues, 'rule-catalog', `id_pattern must equal ${EXPECTED_ID_PATTERN}`);
  }

  const catalogRules = Array.isArray(catalog.rules) ? catalog.rules : [];
  const catalogRuleIds = new Set();
  for (const row of catalogRules) {
    const ruleId = String(row.rule_id || '').trim();
    if (!RULE_ID_PATTERN.test(ruleId)) {
      pushIssue(issues, 'rule-catalog', `invalid rule_id: ${ruleId || '<empty>'}`);
      continue;
    }
    if (catalogRuleIds.has(ruleId)) pushIssue(issues, 'rule-catalog', `duplicate rule_id: ${ruleId}`);
    catalogRuleIds.add(ruleId);
    const source = String(row.source || '').trim();
    if (!source) {
      pushIssue(issues, 'rule-catalog', `${ruleId}: source is required`);
    } else if (!fs.existsSync(path.join(PROJECT_ROOT, source))) {
      pushIssue(issues, 'rule-catalog', `${ruleId}: source file not found ${source}`);
    }
  }

  const contractRuleIds = new Set();
  for (const contract of contractTables) {
    if (!fs.existsSync(contract.mdPath)) {
      pushIssue(issues, 'contract-doc', `missing contract doc ${rel(contract.mdPath)}`);
      continue;
    }
    const mdRuleIds = new Set(collectMarkdownRuleIds(contract.mdPath));
    for (const rule of Array.isArray(contract.doc.rules) ? contract.doc.rules : []) {
      const ruleId = String(rule.rule_id || '').trim();
      if (!RULE_ID_PATTERN.test(ruleId)) {
        pushIssue(issues, 'contract-table', `${rel(contract.yamlPath)} has invalid rule_id ${ruleId || '<empty>'}`);
        continue;
      }
      if (contractRuleIds.has(ruleId)) pushIssue(issues, 'contract-table', `duplicate contract rule_id ${ruleId}`);
      contractRuleIds.add(ruleId);
      if (!mdRuleIds.has(ruleId)) {
        pushIssue(issues, 'contract-doc', `${rel(contract.mdPath)} missing heading for ${ruleId}`);
      }
    }
  }

  if (catalogRuleIds.size !== contractRuleIds.size) {
    pushIssue(issues, 'rule-catalog', `catalog rule count ${catalogRuleIds.size} does not match contract total ${contractRuleIds.size}`);
  }
  for (const ruleId of contractRuleIds) {
    if (!catalogRuleIds.has(ruleId)) pushIssue(issues, 'rule-catalog', `missing catalog entry for ${ruleId}`);
  }
  for (const ruleId of catalogRuleIds) {
    if (!contractRuleIds.has(ruleId)) pushIssue(issues, 'rule-catalog', `unexpected catalog entry ${ruleId}`);
  }

  const evidenceRules = evidence.rules ?? {};
  const profiles = evidence.profiles ?? {};
  for (const ruleId of contractRuleIds) {
    const entry = evidenceRules[ruleId];
    if (!entry) {
      pushIssue(issues, 'rule-evidence', `missing evidence entry for ${ruleId}`);
      continue;
    }
    const resolved = resolveEvidence(profiles, entry);
    if (!String(entry.spec_anchor || '').trim()) {
      pushIssue(issues, 'rule-evidence', `${ruleId}: spec_anchor is required`);
    } else {
      const { filePath, anchor } = splitAnchor(String(entry.spec_anchor || ''));
      const absPath = path.join(PROJECT_ROOT, filePath);
      if (!fs.existsSync(absPath)) {
        pushIssue(issues, 'rule-evidence', `${ruleId}: spec_anchor file not found ${filePath}`);
      } else if (anchor && !hasAnchor(fs.readFileSync(absPath, 'utf8'), anchor)) {
        pushIssue(issues, 'rule-evidence', `${ruleId}: spec_anchor missing anchor ${anchor}`);
      }
    }
    if (resolved.openapi.length === 0) pushIssue(issues, 'rule-evidence', `${ruleId}: openapi evidence is empty`);
    if (resolved.prisma_models.length === 0) pushIssue(issues, 'rule-evidence', `${ruleId}: prisma evidence is empty`);
    if (resolved.service_files.length === 0) pushIssue(issues, 'rule-evidence', `${ruleId}: service evidence is empty`);
    if (resolved.test_files.length === 0) pushIssue(issues, 'rule-evidence', `${ruleId}: test evidence is empty`);
  }
  for (const extraRuleId of Object.keys(evidenceRules)) {
    if (!contractRuleIds.has(extraRuleId)) pushIssue(issues, 'rule-evidence', `unexpected evidence entry ${extraRuleId}`);
  }

  for (const row of Array.isArray(enums.enums) ? enums.enums : []) {
    const enumId = String(row.enum_id || '').trim();
    if (!enumId) pushIssue(issues, 'domain-enums', 'enum_id must be non-empty');
    if (asStringArray(row.values).length === 0) pushIssue(issues, 'domain-enums', `${enumId}: values must be non-empty`);
    for (const ruleId of asStringArray(row.source_rules)) {
      if (!contractRuleIds.has(ruleId)) pushIssue(issues, 'domain-enums', `${enumId}: unknown source rule ${ruleId}`);
    }
  }

  for (const row of Array.isArray(stateMachines.state_machines) ? stateMachines.state_machines : []) {
    const machineId = String(row.machine_id || '').trim();
    if (!machineId) pushIssue(issues, 'domain-state-machines', 'machine_id must be non-empty');
    if (asStringArray(row.states).length === 0) pushIssue(issues, 'domain-state-machines', `${machineId}: states must be non-empty`);
    for (const ruleId of asStringArray(row.source_rules)) {
      if (!contractRuleIds.has(ruleId)) pushIssue(issues, 'domain-state-machines', `${machineId}: unknown source rule ${ruleId}`);
    }
  }

  const runModeRows = Array.isArray(commitAuthorization.run_modes) ? commitAuthorization.run_modes : [];
  const appPolicyRows = Array.isArray(commitAuthorization.app_policies) ? commitAuthorization.app_policies : [];
  const runModes = new Map();

  if (runModeRows.length === 0) pushIssue(issues, 'commit-authorization-matrix', 'run_modes must be non-empty');
  for (const row of runModeRows) {
    const runMode = String(row.run_mode || '').trim();
    if (!runMode) {
      pushIssue(issues, 'commit-authorization-matrix', 'run_mode must be non-empty');
      continue;
    }
    if (runModes.has(runMode)) {
      pushIssue(issues, 'commit-authorization-matrix', `duplicate run_mode ${runMode}`);
      continue;
    }
    runModes.set(runMode, row);
    if (typeof row.allow_state_commit !== 'boolean') {
      pushIssue(issues, 'commit-authorization-matrix', `${runMode}: allow_state_commit must be boolean`);
    }
    if (typeof row.allow_history_append !== 'boolean') {
      pushIssue(issues, 'commit-authorization-matrix', `${runMode}: allow_history_append must be boolean`);
    }
    for (const ruleId of asStringArray(row.source_rules)) {
      if (!contractRuleIds.has(ruleId)) {
        pushIssue(issues, 'commit-authorization-matrix', `${runMode}: unknown source rule ${ruleId}`);
      }
    }
  }

  for (const requiredRunMode of ['REPLAY', 'PRIVATE_CONTINUITY', 'CANON_MUTATION']) {
    if (!runModes.has(requiredRunMode)) {
      pushIssue(issues, 'commit-authorization-matrix', `missing run_mode ${requiredRunMode}`);
    }
  }

  const seenPolicies = new Set();
  if (appPolicyRows.length === 0) pushIssue(issues, 'commit-authorization-matrix', 'app_policies must be non-empty');
  for (const row of appPolicyRows) {
    const appId = String(row.app_id || '').trim();
    const schemaId = String(row.schema_id || '').trim();
    const schemaVersion = String(row.schema_version || '').trim();
    const effectClass = String(row.effect_class || '').trim();
    const runMode = String(row.run_mode || '').trim();
    const policyId = [appId, schemaId, schemaVersion, effectClass].join('|');

    if (!appId || !schemaId || !schemaVersion || !effectClass) {
      pushIssue(issues, 'commit-authorization-matrix', `invalid app_policies row ${policyId || '<empty>'}`);
      continue;
    }
    if (seenPolicies.has(policyId)) {
      pushIssue(issues, 'commit-authorization-matrix', `duplicate app policy ${policyId}`);
      continue;
    }
    seenPolicies.add(policyId);

    if (!['MEMORY_ONLY', 'STATE_ONLY', 'STATE_AND_HISTORY'].includes(effectClass)) {
      pushIssue(issues, 'commit-authorization-matrix', `${policyId}: invalid effect_class ${effectClass}`);
    }

    const runModeRow = runModes.get(runMode);
    if (!runModeRow) {
      pushIssue(issues, 'commit-authorization-matrix', `${policyId}: unknown run_mode ${runMode}`);
      continue;
    }

    const allowedScopes = asStringArray(row.allowed_scopes);
    const allowedMemoryTypes = asStringArray(row.allowed_memory_types);
    const runModeAllowedMemoryTypes = asStringArray(runModeRow.allowed_memory_types);

    if (allowedScopes.length === 0) {
      pushIssue(issues, 'commit-authorization-matrix', `${policyId}: allowed_scopes must be non-empty`);
    }
    if (effectClass === 'MEMORY_ONLY' && allowedMemoryTypes.length === 0) {
      pushIssue(issues, 'commit-authorization-matrix', `${policyId}: MEMORY_ONLY policies must declare allowed_memory_types`);
    }
    if ((effectClass === 'STATE_ONLY' || effectClass === 'STATE_AND_HISTORY') && runModeRow.allow_state_commit !== true) {
      pushIssue(issues, 'commit-authorization-matrix', `${policyId}: ${runMode} cannot authorize shared state writes`);
    }
    if (effectClass === 'STATE_AND_HISTORY' && runModeRow.allow_history_append !== true) {
      pushIssue(issues, 'commit-authorization-matrix', `${policyId}: ${runMode} cannot authorize world history append`);
    }
    for (const memoryType of allowedMemoryTypes) {
      if (!runModeAllowedMemoryTypes.includes(memoryType)) {
        pushIssue(issues, 'commit-authorization-matrix', `${policyId}: memory type ${memoryType} exceeds run mode ${runMode}`);
      }
    }
    for (const ruleId of asStringArray(row.source_rules)) {
      if (!contractRuleIds.has(ruleId)) {
        pushIssue(issues, 'commit-authorization-matrix', `${policyId}: unknown source rule ${ruleId}`);
      }
    }
  }

  const alignmentMappings = Array.isArray(alignment.mappings) ? alignment.mappings : [];
  if (alignmentMappings.length === 0) pushIssue(issues, 'alignment-map', 'mappings must be non-empty');
  for (const row of alignmentMappings) {
    const externalId = String(row.external_id || '').trim();
    const externalPath = String(row.external_path || '').trim();
    const localAnchor = String(row.local_anchor || '').trim();
    if (!externalId) pushIssue(issues, 'alignment-map', 'external_id must be non-empty');
    if (!externalPath) pushIssue(issues, 'alignment-map', `${externalId}: external_path is required`);
    if (!localAnchor) {
      pushIssue(issues, 'alignment-map', `${externalId}: local_anchor is required`);
    } else {
      const { filePath, anchor } = splitAnchor(localAnchor);
      const absPath = path.join(PROJECT_ROOT, filePath);
      if (!fs.existsSync(absPath)) {
        pushIssue(issues, 'alignment-map', `${externalId}: local anchor file not found ${filePath}`);
      } else if (anchor && !hasAnchor(fs.readFileSync(absPath, 'utf8'), anchor)) {
        pushIssue(issues, 'alignment-map', `${externalId}: local anchor missing ${anchor}`);
      }
    }
    if (String(row.coverage_status || '').trim() !== 'mapped') {
      pushIssue(issues, 'alignment-map', `${externalId}: coverage_status must be mapped`);
    }
  }

  for (const docPath of [...DOMAIN_DOCS, ...BRIDGE_DOCS]) {
    if (!fs.existsSync(docPath)) pushIssue(issues, 'docs', `missing doc ${rel(docPath)}`);
  }

  if (issues.length > 0) {
    for (const issue of issues) {
      console.error(`[${issue.scope}] ${issue.message}`);
    }
    process.exit(1);
  }

  console.log(`Realm kernel consistency check passed (${contractTables.length} contract tables).`);
}

main();
