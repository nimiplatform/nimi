import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const helperDir = path.dirname(fileURLToPath(import.meta.url));
export const defaultRepoRoot = path.resolve(helperDir, '..', '..');
export const policyRel = '.nimi/spec/platform/kernel/tables/test-governance-policy.yaml';
const forbiddenSentinelPurposes = new Set(['forbidden_import', 'forbidden_api', 'forbidden_copy']);
const nonTrustedClassifications = new Set([
  'legacy_drift_quarantine',
  'redundant_candidate',
  'remove_after_replacement',
  'quarantine_unreviewed',
]);
const supersedeRequiredClassifications = new Set(['redundant_candidate', 'remove_after_replacement']);

export function parseCliArgs(argv) {
  const args = {
    domain: null,
    report: false,
    auditClassification: false,
    write: false,
    force: false,
    output: null,
    shardSize: 55,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--domain') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--domain requires a value');
      args.domain = value;
      index += 1;
    } else if (arg === '--report') {
      args.report = true;
    } else if (arg === '--audit-classification') {
      args.auditClassification = true;
    } else if (arg === '--write') {
      args.write = true;
    } else if (arg === '--force') {
      args.force = true;
    } else if (arg === '--output') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--output requires a value');
      args.output = value;
      index += 1;
    } else if (arg === '--shard-size') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--shard-size requires a value');
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error('--shard-size must be a positive integer');
      }
      args.shardSize = parsed;
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return args;
}

export function usage(commandName) {
  if (commandName.includes('generate-test-inventory-bootstrap')) {
    return [
      'Usage: node scripts/generate-test-inventory-bootstrap.mjs --domain <name> [--write] [--output <path>] [--force] [--shard-size <N>]',
      '',
      'Drafts one quarantine_unreviewed inventory row per census-discovered test file.',
      'Inventories over --shard-size rows are emitted as top-level shard pointers plus shard files.',
    ].join('\n');
  }
  return [
    'Usage: node scripts/check-test-inventory.mjs [--domain <name>] [--report] [--audit-classification]',
    '',
    'Validates per-domain test inventories against the platform test-governance policy.',
    '--audit-classification reports likely source-regex misclassifications without failing the gate.',
  ].join('\n');
}

export function readYaml(repoRoot, rel) {
  return YAML.parse(fs.readFileSync(path.join(repoRoot, rel), 'utf8'));
}

function readInventoryWithShards(repoRoot, inventoryRel) {
  const inventory = readYaml(repoRoot, inventoryRel);
  const shards = Array.isArray(inventory?.shards) ? inventory.shards : [];
  if (shards.length > 0 && Object.prototype.hasOwnProperty.call(inventory ?? {}, 'tests')) {
    throw new Error(`${inventoryRel} must not declare top-level tests when using shards`);
  }
  const rows = Array.isArray(inventory?.tests) ? [...inventory.tests] : [];
  for (const rawShard of shards) {
    const shardRel = normalizeRel(rawShard);
    if (!shardRel) {
      continue;
    }
    const shard = readYaml(repoRoot, shardRel);
    validateInventoryShardReference(inventoryRel, inventory, shardRel, shard);
    rows.push(...(Array.isArray(shard?.tests) ? shard.tests : []));
  }
  return { ...inventory, tests: rows };
}

function validateInventoryShardReference(inventoryRel, inventory, shardRel, shard) {
  for (const field of ['version', 'owner', 'authority_class', 'spec_policy_ref']) {
    if (shard?.[field] !== inventory?.[field]) {
      throw new Error(`${shardRel} ${field} must match ${inventoryRel}`);
    }
  }
  if (shard?.inventory_id !== inventory?.inventory_id) {
    throw new Error(`${shardRel} inventory_id must match ${inventoryRel}`);
  }
  if (!String(shard?.shard_id || '').trim()) {
    throw new Error(`${shardRel} must declare shard_id`);
  }
  if (Array.isArray(shard?.shards) && shard.shards.length > 0) {
    throw new Error(`${shardRel} must not declare nested shards`);
  }
  if (!Array.isArray(shard?.tests)) {
    throw new Error(`${shardRel} must declare tests as a list`);
  }
}

export function loadPolicy(repoRoot = defaultRepoRoot) {
  const policy = readYaml(repoRoot, policyRel);
  const classifications = new Map();
  for (const row of Array.isArray(policy?.classification_vocabulary) ? policy.classification_vocabulary : []) {
    const id = String(row?.classification || '').trim();
    if (id) classifications.set(id, row);
  }
  const gateEligibility = new Set(
    (Array.isArray(policy?.gate_eligibility_enum?.values) ? policy.gate_eligibility_enum.values : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  );
  const moduleOwnerMap = (Array.isArray(policy?.module_owner_map) ? policy.module_owner_map : [])
    .map((row) => ({
      domain: String(row?.domain || '').trim(),
      owner: String(row?.owner || '').trim(),
      root: normalizeRel(row?.root),
      inventory: normalizeRel(row?.inventory),
    }))
    .filter((row) => row.domain);

  return {
    raw: policy,
    classifications,
    gateEligibility,
    moduleOwnerMap,
    census: policy?.census || {},
  };
}

export function selectModuleRows(policy, domain) {
  if (!domain) return policy.moduleOwnerMap;
  return policy.moduleOwnerMap.filter((row) => row.domain === domain);
}

export function discoverTestFiles(repoRoot, policy, moduleRow) {
  const rootAbs = path.join(repoRoot, moduleRow.root);
  if (!fs.existsSync(rootAbs)) {
    throw new Error(`${moduleRow.domain}: census root does not exist: ${moduleRow.root}`);
  }
  const includeGlobs = [
    ...(Array.isArray(policy.census.include_globs) ? policy.census.include_globs : []),
    ...(Array.isArray(policy.census.helper_globs) ? policy.census.helper_globs : []),
  ].map((glob) => String(glob || '').trim()).filter(Boolean);
  const excludeDirs = new Set(
    (Array.isArray(policy.census.exclude_dirs) ? policy.census.exclude_dirs : [])
      .map((dir) => String(dir || '').trim())
      .filter(Boolean),
  );
  const files = [];
  for (const rel of walkFiles(repoRoot, moduleRow.root, excludeDirs)) {
    const withinRoot = rel.slice(moduleRow.root.length).replace(/^\/+/u, '');
    if (includeGlobs.some((glob) => matchesSupportedGlob(withinRoot, glob))) {
      files.push(rel);
    }
  }
  return files.sort(comparePath);
}

export function collectDefinedRuleIds(repoRoot) {
  const specRoot = path.join(repoRoot, '.nimi/spec');
  const ruleIds = new Set();
  if (!fs.existsSync(specRoot)) return ruleIds;
  for (const rel of walkFiles(repoRoot, '.nimi/spec', new Set(['generated', 'gen']))) {
    if (!rel.endsWith('.md')) continue;
    const content = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
    for (const match of content.matchAll(/^##\s+([A-Z]+-[A-Z0-9]+-\d{3}[a-z]?)\b/gmu)) {
      ruleIds.add(match[1]);
    }
  }
  return ruleIds;
}

export function checkInventories({ repoRoot = defaultRepoRoot, domain = null, report = false } = {}) {
  const errors = [];
  const policy = loadPolicy(repoRoot);
  const selectedRows = selectModuleRows(policy, domain);
  if (domain && selectedRows.length === 0) {
    errors.push(`unknown test inventory domain: ${domain}`);
  }
  const definedRuleIds = collectDefinedRuleIds(repoRoot);
  const reports = [];
  let totalFiles = 0;
  let totalBacklog = 0;

  for (const moduleRow of selectedRows) {
    const domainReport = {
      domain: moduleRow.domain,
      owner: moduleRow.owner,
      fileCount: 0,
      backlog: 0,
      histogram: Object.fromEntries([...policy.classifications.keys()].map((classification) => [classification, 0])),
    };
    reports.push(domainReport);

    let actualTests = [];
    try {
      actualTests = discoverTestFiles(repoRoot, policy, moduleRow);
    } catch (error) {
      errors.push(error.message);
      continue;
    }
    domainReport.fileCount = actualTests.length;
    totalFiles += actualTests.length;

    const inventoryPath = path.join(repoRoot, moduleRow.inventory);
    if (!fs.existsSync(inventoryPath)) {
      errors.push(`${moduleRow.domain}: missing inventory ${moduleRow.inventory}`);
      for (const rel of actualTests) errors.push(`${moduleRow.domain}: unclassified_test_file ${rel}`);
      continue;
    }

    let inventory;
    try {
      inventory = readInventoryWithShards(repoRoot, moduleRow.inventory);
    } catch (error) {
      errors.push(`${moduleRow.inventory} must parse as YAML: ${error.message}`);
      continue;
    }
    validateInventoryEnvelope(errors, moduleRow, inventory);

    const actualSet = new Set(actualTests);
    const rows = Array.isArray(inventory?.tests) ? inventory.tests : [];
    const byPath = new Map();
    for (const row of rows) {
      const rel = normalizeRel(row?.path);
      if (!rel) {
        errors.push(`${moduleRow.inventory} contains a test row without path`);
        continue;
      }
      if (byPath.has(rel)) {
        errors.push(`${moduleRow.inventory} contains duplicate inventory row for ${rel}`);
      }
      byPath.set(rel, row);
      validateInventoryRow(errors, {
        definedRuleIds,
        moduleRow,
        policy,
        rel,
        row,
      });
      const classification = String(row?.classification || '').trim();
      if (Object.prototype.hasOwnProperty.call(domainReport.histogram, classification)) {
        domainReport.histogram[classification] += 1;
      }
      if (classification === 'quarantine_unreviewed') {
        domainReport.backlog += 1;
        totalBacklog += 1;
      }
      if (!actualSet.has(rel)) {
        errors.push(`${moduleRow.inventory} references missing test file ${rel}`);
      }
    }

    for (const rel of actualTests) {
      if (!byPath.has(rel)) {
        errors.push(`${moduleRow.domain}: unclassified_test_file ${rel}`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    reports,
    reportText: report ? renderReport(reports, totalBacklog) : '',
    totalBacklog,
    totalFiles,
  };
}

export function buildBootstrapInventory({ repoRoot = defaultRepoRoot, domain, shardSize = 55 }) {
  if (!domain) throw new Error('--domain is required for bootstrap generation');
  if (!Number.isInteger(shardSize) || shardSize <= 0) {
    throw new Error('--shard-size must be a positive integer');
  }
  const policy = loadPolicy(repoRoot);
  const selectedRows = selectModuleRows(policy, domain);
  if (selectedRows.length !== 1) throw new Error(`unknown test inventory domain: ${domain}`);
  const moduleRow = selectedRows[0];
  const tests = discoverTestFiles(repoRoot, policy, moduleRow).map((rel) => ({
    path: rel,
    owner: moduleRow.owner,
    classification: 'quarantine_unreviewed',
    tier: null,
    authority_claim: false,
    deterministic: true,
    offline: true,
    may_enter_regression_gate: 'never',
    may_enter_release_gate: 'never',
    spec_refs: ['P-TEST-001'],
    removal_condition: 'human classification pending',
  }));
  const baseEnvelope = {
    version: 1,
    inventory_id: `${domain.replaceAll('-', '_')}_test_inventory`,
    owner: moduleRow.owner,
    authority_class: 'non_authoritative_inventory',
    spec_policy_ref: policyRel,
  };
  if (tests.length <= shardSize) {
    const inventory = {
      ...baseEnvelope,
      tests,
    };
    return {
      inventory,
      moduleRow,
      shards: [],
      testCount: tests.length,
      yaml: `${YAML.stringify(inventory, { lineWidth: 0 })}`,
    };
  }

  const shardDirRel = `config/test-inventories/${domain}`;
  const shardCount = Math.ceil(tests.length / shardSize);
  const shardRels = Array.from({ length: shardCount }, (_, index) => (
    `${shardDirRel}/shard-${String(index + 1).padStart(2, '0')}.yaml`
  ));
  const inventory = {
    ...baseEnvelope,
    shards: shardRels,
  };
  const shards = shardRels.map((rel, index) => {
    const shardNumber = index + 1;
    const shardInventory = {
      ...baseEnvelope,
      shard_id: `${baseEnvelope.inventory_id}_shard_${String(shardNumber).padStart(2, '0')}`,
      tests: tests.slice(index * shardSize, shardNumber * shardSize),
    };
    return {
      rel,
      inventory: shardInventory,
      yaml: `${YAML.stringify(shardInventory, { lineWidth: 0 })}`,
    };
  });
  return {
    inventory,
    moduleRow,
    shardDirRel,
    shards,
    testCount: tests.length,
    yaml: `${YAML.stringify(inventory, { lineWidth: 0 })}`,
  };
}

export function auditInventoryClassifications({ repoRoot = defaultRepoRoot, domain = null } = {}) {
  const policy = loadPolicy(repoRoot);
  const selectedRows = selectModuleRows(policy, domain);
  const suspects = [];

  for (const moduleRow of selectedRows) {
    const inventoryPath = path.join(repoRoot, moduleRow.inventory);
    if (!fs.existsSync(inventoryPath)) continue;
    const inventory = readInventoryWithShards(repoRoot, moduleRow.inventory);
    const rows = Array.isArray(inventory?.tests) ? inventory.tests : [];
    for (const row of rows) {
      const rel = normalizeRel(row?.path);
      if (!rel || String(row?.classification || '').trim() === 'source_regex_sentinel') continue;
      const abs = path.join(repoRoot, rel);
      if (!fs.existsSync(abs)) continue;
      const source = fs.readFileSync(abs, 'utf8');
      const reason = sourceRegexMisclassificationReason(source);
      if (!reason) continue;
      suspects.push({
        domain: moduleRow.domain,
        path: rel,
        classification: String(row?.classification || '').trim() || '<empty>',
        reason,
      });
    }
  }

  return {
    suspects,
    reportText: renderClassificationAuditReport(suspects),
  };
}

export function writeBootstrapInventory({ repoRoot = defaultRepoRoot, domain, output = null, force = false, shardSize = 55 }) {
  const result = buildBootstrapInventory({ repoRoot, domain, shardSize });
  const outputRel = normalizeRel(output || result.moduleRow.inventory);
  const outputAbs = path.join(repoRoot, outputRel);
  if (fs.existsSync(outputAbs) && !force) {
    throw new Error(`${outputRel} already exists; pass --force to replace it`);
  }
  for (const shard of result.shards) {
    const shardAbs = path.join(repoRoot, shard.rel);
    if (fs.existsSync(shardAbs) && !force) {
      throw new Error(`${shard.rel} already exists; pass --force to replace it`);
    }
  }
  fs.mkdirSync(path.dirname(outputAbs), { recursive: true });
  fs.writeFileSync(outputAbs, result.yaml, 'utf8');
  for (const shard of result.shards) {
    const shardAbs = path.join(repoRoot, shard.rel);
    fs.mkdirSync(path.dirname(shardAbs), { recursive: true });
    fs.writeFileSync(shardAbs, shard.yaml, 'utf8');
  }
  return { ...result, outputRel };
}

function validateInventoryEnvelope(errors, moduleRow, inventory) {
  if (inventory?.version !== 1) errors.push(`${moduleRow.inventory} must declare version: 1`);
  if (inventory?.owner !== moduleRow.owner) {
    errors.push(`${moduleRow.inventory} owner_mismatch: owner must be ${moduleRow.owner}`);
  }
  if (inventory?.authority_class !== 'non_authoritative_inventory') {
    errors.push(`${moduleRow.inventory} must declare authority_class: non_authoritative_inventory`);
  }
  if (inventory?.spec_policy_ref !== policyRel) {
    errors.push(`${moduleRow.inventory} must reference ${policyRel}`);
  }
  if (!Array.isArray(inventory?.tests)) {
    errors.push(`${moduleRow.inventory} must declare tests as a list`);
  }
}

function validateInventoryRow(errors, context) {
  const { definedRuleIds, moduleRow, policy, rel, row } = context;
  const classification = String(row?.classification || '').trim();
  const classificationSpec = policy.classifications.get(classification);
  if (!classificationSpec) {
    errors.push(`${rel} has invalid classification ${classification || '<empty>'}`);
    return;
  }
  if (!rel.startsWith(`${moduleRow.root}/`) && rel !== moduleRow.root) {
    errors.push(`${rel} escapes module root ${moduleRow.root}`);
  }
  if (row?.owner !== moduleRow.owner) {
    errors.push(`${rel} owner_mismatch: owner must be ${moduleRow.owner}`);
  }
  if (row?.authority_claim !== false) {
    errors.push(`${rel} authority_claim_true: authority_claim must be false`);
  }
  if (row?.deterministic !== true) {
    errors.push(`${rel} must declare deterministic: true`);
  }
  if (classification === 'live_provider_proof') {
    if (row?.offline !== false && row?.offline !== true) {
      errors.push(`${rel} live_provider_proof must declare offline as a boolean`);
    }
  } else if (row?.offline !== true) {
    errors.push(`${rel} must declare offline: true unless classification is live_provider_proof`);
  }

  const expectedTier = classificationSpec?.tier ?? null;
  if ((row?.tier ?? null) !== expectedTier) {
    errors.push(`${rel} tier_classification_mismatch: tier must be ${expectedTier === null ? 'null' : expectedTier}`);
  }

  validateGateValue(errors, rel, policy, 'may_enter_regression_gate', row?.may_enter_regression_gate);
  validateGateValue(errors, rel, policy, 'may_enter_release_gate', row?.may_enter_release_gate);
  validateSpecRefs(errors, rel, row?.spec_refs, definedRuleIds);

  if (nonTrustedClassifications.has(classification) && !String(row?.removal_condition || '').trim()) {
    errors.push(`${rel} quarantine_without_removal_condition: removal_condition is required`);
  }
  if (supersedeRequiredClassifications.has(classification) && !String(row?.supersede_ref || '').trim()) {
    errors.push(`${rel} ${classification} requires supersede_ref`);
  }
  if (classification === 'source_regex_sentinel') {
    const purpose = String(row?.sentinel_purpose || '').trim();
    if (!forbiddenSentinelPurposes.has(purpose)) {
      errors.push(`${rel} source_regex_sentinel_not_forbidden_purpose: sentinel_purpose must be forbidden_import, forbidden_api, or forbidden_copy`);
    }
  }
  if (classification === 'evidence_only') {
    if (row?.may_enter_regression_gate !== 'never' || row?.may_enter_release_gate !== 'never') {
      errors.push(`${rel} evidence_only_in_gate: evidence_only must use never for regression and release gates`);
    }
  }
  if (nonTrustedClassifications.has(classification)) {
    if (row?.may_enter_regression_gate !== 'never' || row?.may_enter_release_gate !== 'never') {
      errors.push(`${rel} ${classification} must use never for regression and release gates`);
    }
  }
  if (classification === 'live_provider_proof' && row?.may_enter_release_gate === 'allowed') {
    errors.push(`${rel} live_proof_without_env_evidence: live_provider_proof may not enter release as allowed`);
  }
  if (classification === 'quarantine_unreviewed' && row?.may_enter_release_gate !== 'never') {
    errors.push(`${rel} unreviewed_in_release_gate: quarantine_unreviewed must not enter release gate`);
  }
}

function validateGateValue(errors, rel, policy, field, value) {
  const normalized = String(value || '').trim();
  if (!policy.gateEligibility.has(normalized)) {
    errors.push(`${rel} ${field} has invalid gate eligibility ${normalized || '<empty>'}`);
  }
}

function validateSpecRefs(errors, rel, specRefs, definedRuleIds) {
  if (!Array.isArray(specRefs) || specRefs.length === 0) {
    errors.push(`${rel} test_file_without_spec_ref: spec_refs must not be empty`);
    return;
  }
  for (const rawRef of specRefs) {
    const ref = String(rawRef || '').trim();
    if (!/^[A-Z]+-[A-Z0-9]+-\d{3}[a-z]?$/u.test(ref)) {
      errors.push(`${rel} test_file_without_spec_ref: invalid rule ref ${ref || '<empty>'}`);
    } else if (!definedRuleIds.has(ref)) {
      errors.push(`${rel} test_file_without_spec_ref: undefined rule ref ${ref}`);
    }
  }
}

function renderReport(reports, totalBacklog) {
  const lines = ['test-inventory report'];
  for (const report of reports) {
    lines.push(`domain: ${report.domain}`);
    lines.push(`  owner: ${report.owner}`);
    lines.push(`  files: ${report.fileCount}`);
    lines.push('  classification_histogram:');
    for (const [classification, count] of Object.entries(report.histogram)) {
      lines.push(`    ${classification}: ${count}`);
    }
    lines.push(`  quarantine_unreviewed backlog: ${report.backlog}`);
  }
  lines.push(`total quarantine_unreviewed backlog: ${totalBacklog}`);
  return lines.join('\n');
}

function renderClassificationAuditReport(suspects) {
  const lines = [`classification audit: ${suspects.length} suspect${suspects.length === 1 ? '' : 's'}`];
  for (const suspect of suspects) {
    lines.push(
      `WARN possible source_regex_sentinel misclassification: ${suspect.path} `
        + `(domain: ${suspect.domain}, classification: ${suspect.classification}, reason: ${suspect.reason})`,
    );
  }
  return lines.join('\n');
}

function sourceRegexMisclassificationReason(source) {
  if (!/\bfrom\s+['"]node:fs(?:\/promises)?['"]|require\(\s*['"]node:fs(?:\/promises)?['"]\s*\)/u.test(source)) {
    return null;
  }
  const code = stripQuotedLiterals(source);
  if (!/\b(?:readFile|readFileSync|readdir|readdirSync)\s*\(/u.test(code)) {
    return null;
  }

  const buildsViolationsList =
    /\b(?:const|let)\s+violations\s*=\s*\[\s*\]/u.test(code)
    && /\bviolations\.push\s*\(/u.test(code)
    && /assert\.(?:deepEqual|deepStrictEqual)\s*\(\s*violations\s*,\s*\[\s*\]/u.test(code);
  if (buildsViolationsList) {
    return 'reads source files, builds violations, asserts no forbidden source hits';
  }

  const scansForbiddenList =
    /for\s*\(\s*const\s+forbidden\s+of\s+\[/u.test(code)
    || /\b(?:forbidden|forbiddenPaths|forbiddenImports|forbiddenFragments)\s*=\s*\[/u.test(code);
  if (scansForbiddenList && /assert\.(?:doesNotMatch|equal|deepEqual|deepStrictEqual)\s*\(/u.test(code)) {
    return 'reads source files and asserts a forbidden source-pattern list';
  }

  if (hasSourceTextPatternAssertion(code)) {
    return 'reads source files and asserts source-pattern presence or absence';
  }

  return null;
}

function stripQuotedLiterals(source) {
  return source.replace(/(['"`])(?:\\[\s\S]|(?!\1)[\s\S])*\1/gu, (literal) => ' '.repeat(literal.length));
}

function hasSourceTextPatternAssertion(source) {
  const sourceTextVariables = collectSourceTextVariables(source);
  for (const variable of sourceTextVariables) {
    const escaped = escapeRegExp(variable);
    const directAssert = new RegExp(`assert\\.(?:match|doesNotMatch)\\s*\\(\\s*${escaped}\\b`, 'u');
    const methodAssert = new RegExp(`\\b${escaped}\\s*\\.(?:includes|match)\\s*\\(`, 'u');
    if (directAssert.test(source) || methodAssert.test(source)) {
      return true;
    }
  }
  return false;
}

function collectSourceTextVariables(source) {
  const variables = new Set();
  const readAssignmentPattern = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;]*\b(?:readFile|readFileSync)\s*\([^;]*)/gsu;
  for (const match of source.matchAll(readAssignmentPattern)) {
    const variable = match[1];
    if (isSourceTextVariable(variable)) {
      variables.add(variable);
    }
  }
  return variables;
}

function isSourceTextVariable(variable) {
  return /source/iu.test(variable);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function* walkFiles(repoRoot, relRoot, excludeDirs) {
  const absRoot = path.join(repoRoot, relRoot);
  const entries = fs.readdirSync(absRoot, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const rel = `${relRoot}/${entry.name}`.replaceAll('\\', '/');
    if (entry.isDirectory()) {
      if (excludeDirs.has(entry.name)) continue;
      yield* walkFiles(repoRoot, rel, excludeDirs);
    } else if (entry.isFile()) {
      yield rel;
    }
  }
}

function matchesSupportedGlob(rel, glob) {
  const normalized = normalizeRel(rel);
  const pattern = String(glob || '').trim();
  if (pattern.startsWith('**/*')) {
    return normalized.endsWith(pattern.slice(4));
  }
  throw new Error(`unsupported census glob: ${pattern}`);
}

function normalizeRel(value) {
  return String(value || '').replaceAll('\\', '/').replace(/^\.\/+/u, '').replace(/\/+$/u, '').trim();
}

function comparePath(left, right) {
  return left.localeCompare(right);
}
