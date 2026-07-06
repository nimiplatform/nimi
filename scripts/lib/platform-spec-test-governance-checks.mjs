export function checkTestGovernanceTables({
  cwd,
  definedRuleIds,
  fail,
  fs,
  path,
  read,
  testGovernancePolicyTable,
  testGovernanceRuleEvidenceFragment,
}) {
  checkTestGovernancePolicy({
    definedRuleIds,
    fail,
    testGovernancePolicyTable,
  });
  checkTestGovernanceRuleEvidenceFragment({
    cwd,
    definedRuleIds,
    fail,
    fs,
    path,
    read,
    testGovernanceRuleEvidenceFragment,
  });
}

function checkTestGovernancePolicy({ definedRuleIds, fail, testGovernancePolicyTable }) {
  const rel = '.nimi/spec/platform/kernel/tables/test-governance-policy.yaml';
  if (!testGovernancePolicyTable || typeof testGovernancePolicyTable !== 'object') {
    fail(`${rel} must parse as an object`);
    return;
  }
  if (testGovernancePolicyTable.version !== 1) fail(`${rel} must declare version: 1`);
  if (testGovernancePolicyTable.table_family !== 'product_catalog') fail(`${rel} must declare table_family: product_catalog`);
  if (testGovernancePolicyTable.owner !== 'platform') fail(`${rel} must declare owner: platform`);
  if (testGovernancePolicyTable.catalog_id !== 'platform_test_governance_policy') {
    fail(`${rel} must declare catalog_id: platform_test_governance_policy`);
  }
  if (testGovernancePolicyTable.source_rule !== 'P-TEST-001') fail(`${rel} must declare source_rule: P-TEST-001`);
  expectSetContains(fail, rel, testGovernancePolicyTable.entries, [
    'classification_vocabulary',
    'gate_eligibility_enum',
    'hard_blocks',
    'census',
    'module_owner_map',
  ], 'entries');

  const expectedClassifications = new Map([
    ['authority_boundary_guard', 'T3'],
    ['behavior_unit', 'T4'],
    ['contract_conformance', 'T5'],
    ['generated_drift_guard', 'T2'],
    ['product_acceptance', 'T6'],
    ['live_provider_proof', 'T7'],
    ['source_regex_sentinel', 'T3'],
    ['evidence_only', 'T10'],
    ['legacy_drift_quarantine', null],
    ['redundant_candidate', null],
    ['remove_after_replacement', null],
    ['quarantine_unreviewed', null],
  ]);
  const vocabulary = Array.isArray(testGovernancePolicyTable.classification_vocabulary)
    ? testGovernancePolicyTable.classification_vocabulary
    : [];
  if (vocabulary.length !== expectedClassifications.size) {
    fail(`${rel} classification_vocabulary must contain exactly ${expectedClassifications.size} entries`);
  }
  const seenClassifications = new Set();
  for (const row of vocabulary) {
    const classification = String(row?.classification || '').trim();
    if (!classification) {
      fail(`${rel} classification_vocabulary row missing classification`);
      continue;
    }
    if (seenClassifications.has(classification)) fail(`${rel} duplicate classification ${classification}`);
    seenClassifications.add(classification);
    if (!expectedClassifications.has(classification)) {
      fail(`${rel} unexpected classification ${classification}`);
      continue;
    }
    const expectedTier = expectedClassifications.get(classification);
    if ((row?.tier ?? null) !== expectedTier) {
      fail(`${rel} ${classification} tier must be ${expectedTier === null ? 'null' : expectedTier}`);
    }
    checkAuthorityRefs(fail, rel, `${classification}.authority_refs`, row?.authority_refs, definedRuleIds);
  }
  for (const classification of expectedClassifications.keys()) {
    if (!seenClassifications.has(classification)) fail(`${rel} missing classification ${classification}`);
  }

  expectExactSet(fail, rel, testGovernancePolicyTable.gate_eligibility_enum?.values, [
    'allowed',
    'never',
    'after_rewrite',
    'after_scope_limit',
    'after_real_shell_evidence',
    'after_env_evidence',
  ], 'gate_eligibility_enum.values');
  checkAuthorityRefs(fail, rel, 'gate_eligibility_enum.authority_refs', testGovernancePolicyTable.gate_eligibility_enum?.authority_refs, definedRuleIds);

  const hardBlocks = Array.isArray(testGovernancePolicyTable.hard_blocks) ? testGovernancePolicyTable.hard_blocks : [];
  expectExactSet(fail, rel, hardBlocks.map((row) => row?.id), [
    'unclassified_test_file',
    'test_file_without_spec_ref',
    'authority_claim_true',
    'quarantine_without_removal_condition',
    'source_regex_sentinel_not_forbidden_purpose',
    'evidence_only_in_gate',
    'live_proof_without_env_evidence',
    'unreviewed_in_release_gate',
    'owner_mismatch',
    'tier_classification_mismatch',
  ], 'hard_blocks.id');
  for (const row of hardBlocks) {
    const id = String(row?.id || '').trim() || '<empty>';
    if (!String(row?.condition || '').trim()) fail(`${rel} hard block ${id} must declare condition`);
    checkAuthorityRefs(fail, rel, `hard_blocks.${id}.authority_refs`, row?.authority_refs, definedRuleIds);
  }

  checkCensus({
    definedRuleIds,
    fail,
    rel,
    census: testGovernancePolicyTable.census,
  });
  checkModuleOwnerMap({
    definedRuleIds,
    fail,
    rel,
    moduleRows: testGovernancePolicyTable.module_owner_map,
  });
}

function checkCensus({ definedRuleIds, fail, rel, census }) {
  if (!census || typeof census !== 'object') {
    fail(`${rel} must declare census`);
    return;
  }
  expectExactSet(fail, rel, census.include_globs, [
    '**/*.test.ts',
    '**/*.test.tsx',
    '**/*.test.mts',
    '**/*.test.mjs',
    '**/*.test.cts',
    '**/*.test.cjs',
    '**/*.test.js',
    '**/*.test.jsx',
    '**/*.spec.ts',
    '**/*.spec.tsx',
    '**/*.spec.mjs',
    '**/*.spec.js',
    '**/*_test.go',
  ], 'census.include_globs');
  expectExactSet(fail, rel, census.helper_globs, [
    '**/*-helpers.mjs',
    '**/*.test-helper.ts',
  ], 'census.helper_globs');
  expectExactSet(fail, rel, census.exclude_dirs, [
    'archive',
    '_external',
    'node_modules',
    'dist',
    'generated',
    '.next',
    '.cache',
    '.iterate',
  ], 'census.exclude_dirs');
  checkAuthorityRefs(fail, rel, 'census.authority_refs', census.authority_refs, definedRuleIds);
}

function checkModuleOwnerMap({ definedRuleIds, fail, rel, moduleRows }) {
  const rows = Array.isArray(moduleRows) ? moduleRows : [];
  const expectedDomains = new Map([
    ['runtime', ['runtime', 'runtime', 'config/runtime-test-inventory.yaml']],
    ['desktop', ['desktop', 'apps/desktop', 'config/desktop-test-inventory.yaml']],
    ['kit', ['platform', 'kit', 'config/kit-test-inventory.yaml']],
    ['sdks-typescript', ['sdks', 'sdks/typescript', 'config/sdks-typescript-test-inventory.yaml']],
    ['avatar', ['avatar', 'apps/avatar', 'config/avatar-test-inventory.yaml']],
    ['scripts', ['platform', 'scripts', 'config/scripts-test-inventory.yaml']],
    ['zhiyu', ['zhiyu', 'apps/zhiyu/test', 'config/zhiyu-test-inventory.yaml']],
    ['nimi-cognition', ['cognition', 'nimi-cognition', 'config/nimi-cognition-test-inventory.yaml']],
    ['tester', ['tester', 'apps/tester', 'config/tester-test-inventory.yaml']],
    ['web', ['web', 'apps/web', 'config/web-test-inventory.yaml']],
    ['install-gateway', ['web', 'apps/install-gateway', 'config/install-gateway-test-inventory.yaml']],
  ]);
  if (rows.length !== expectedDomains.size) {
    fail(`${rel} module_owner_map must contain exactly ${expectedDomains.size} entries`);
  }
  const seenDomains = new Set();
  for (const row of rows) {
    const domain = String(row?.domain || '').trim();
    if (!domain) {
      fail(`${rel} module_owner_map row missing domain`);
      continue;
    }
    if (seenDomains.has(domain)) fail(`${rel} duplicate module_owner_map domain ${domain}`);
    seenDomains.add(domain);
    const expected = expectedDomains.get(domain);
    if (!expected) {
      fail(`${rel} unexpected module_owner_map domain ${domain}`);
      continue;
    }
    const [owner, root, inventory] = expected;
    if (row?.owner !== owner) fail(`${rel} module_owner_map.${domain}.owner must be ${owner}`);
    if (row?.root !== root) fail(`${rel} module_owner_map.${domain}.root must be ${root}`);
    if (row?.inventory !== inventory) fail(`${rel} module_owner_map.${domain}.inventory must be ${inventory}`);
    checkAuthorityRefs(fail, rel, `module_owner_map.${domain}.authority_refs`, row?.authority_refs, definedRuleIds);
  }
  for (const domain of expectedDomains.keys()) {
    if (!seenDomains.has(domain)) fail(`${rel} missing module_owner_map domain ${domain}`);
  }
}

function checkTestGovernanceRuleEvidenceFragment({
  cwd,
  definedRuleIds,
  fail,
  fs,
  path,
  read,
  testGovernanceRuleEvidenceFragment,
}) {
  const registryRel = '.nimi/spec/platform/kernel/tables/rule-evidence.yaml';
  const fragmentRel = '.nimi/spec/platform/kernel/tables/rule-evidence.rules-test-governance.yaml';
  if (!read(registryRel).includes('rule-evidence.rules-test-governance.yaml')) {
    fail(`${registryRel} must register rule-evidence.rules-test-governance.yaml`);
  }
  if (!testGovernanceRuleEvidenceFragment || typeof testGovernanceRuleEvidenceFragment !== 'object') {
    fail(`${fragmentRel} must parse as an object`);
    return;
  }
  if (testGovernanceRuleEvidenceFragment.table_family !== 'support_registry') {
    fail(`${fragmentRel} must declare table_family: support_registry`);
  }
  if (testGovernanceRuleEvidenceFragment.owner !== 'platform') fail(`${fragmentRel} must declare owner: platform`);
  expectExactSet(fail, fragmentRel, testGovernanceRuleEvidenceFragment.forbidden_state_fields, [
    'done',
    'covered',
    'coverage_status',
    'audit_date',
    'evidence_report',
    'current',
    'proposed',
    'backlog_status',
    'migration_status',
    'mapping_status',
    'run_id',
    'ledger_ref',
  ], 'forbidden_state_fields');
  const expectedRules = [
    'P-TEST-001',
    'P-TEST-002',
    'P-TEST-003',
    'P-TEST-004',
    'P-TEST-005',
    'P-TEST-006',
    'P-TEST-007',
    'P-TEST-008',
  ];
  expectExactSet(fail, fragmentRel, testGovernanceRuleEvidenceFragment.entries, expectedRules, 'entries');
  const rows = Array.isArray(testGovernanceRuleEvidenceFragment.rules) ? testGovernanceRuleEvidenceFragment.rules : [];
  if (rows.length !== expectedRules.length) fail(`${fragmentRel} rules must contain exactly ${expectedRules.length} entries`);
  const seen = new Set();
  for (const row of rows) {
    const ruleId = String(row?.rule_id || '').trim();
    if (!ruleId) {
      fail(`${fragmentRel} rule row missing rule_id`);
      continue;
    }
    seen.add(ruleId);
    if (!expectedRules.includes(ruleId)) fail(`${fragmentRel} unexpected rule_id ${ruleId}`);
    if (!definedRuleIds.has(ruleId)) fail(`${fragmentRel} references unknown rule_id ${ruleId}`);
    if (row?.evidence_requirement !== 'test-governance-policy.yaml') {
      fail(`${fragmentRel} ${ruleId} evidence_requirement must be test-governance-policy.yaml`);
    }
    if (!fs.existsSync(path.join(cwd, '.nimi/spec/platform/kernel/tables', row?.evidence_requirement || ''))) {
      fail(`${fragmentRel} ${ruleId} evidence_requirement target does not exist`);
    }
    checkNoForbiddenStateFields(fail, fragmentRel, ruleId, row, testGovernanceRuleEvidenceFragment.forbidden_state_fields);
  }
  for (const ruleId of expectedRules) {
    if (!seen.has(ruleId)) fail(`${fragmentRel} missing rule row ${ruleId}`);
  }
}

function checkAuthorityRefs(fail, rel, label, refs, definedRuleIds) {
  const values = Array.isArray(refs) ? refs.map((item) => String(item || '').trim()).filter(Boolean) : [];
  if (values.length === 0) {
    fail(`${rel} ${label} must not be empty`);
    return;
  }
  for (const ref of values) {
    if (!definedRuleIds.has(ref)) fail(`${rel} ${label} references unknown rule ${ref}`);
  }
}

function expectExactSet(fail, rel, values, expectedValues, label) {
  const actual = (Array.isArray(values) ? values : []).map((value) => String(value)).filter(Boolean);
  const expected = expectedValues.map((value) => String(value));
  expectSetContains(fail, rel, actual, expected, label);
  for (const value of actual) {
    if (!expected.includes(value)) fail(`${rel} ${label} includes unexpected ${value}`);
  }
  if (actual.length !== new Set(actual).size) fail(`${rel} ${label} must not contain duplicates`);
}

function expectSetContains(fail, rel, values, requiredValues, label) {
  const set = new Set((Array.isArray(values) ? values : []).map((value) => String(value)));
  for (const value of requiredValues) {
    if (!set.has(value)) {
      fail(`${rel} ${label} must include ${value}`);
    }
  }
}

function checkNoForbiddenStateFields(fail, rel, label, row, forbiddenFields) {
  const forbidden = new Set(Array.isArray(forbiddenFields) ? forbiddenFields : []);
  for (const key of Object.keys(row || {})) {
    if (forbidden.has(key)) fail(`${rel} ${label} must not use forbidden state field ${key}`);
  }
}
