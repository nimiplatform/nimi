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

function readYaml(rel) {
  const content = fs.readFileSync(path.join(cwd, rel), 'utf8');
  return YAML.parse(content);
}

// --- Load tables ---

const vocabularyTable = readYaml('spec/realm/kernel/tables/public-vocabulary.yaml');
const tiersTable = readYaml('spec/realm/kernel/tables/creator-key-tiers.yaml');
const revenueTable = readYaml('spec/realm/kernel/tables/revenue-event-types.yaml');
const sharePlanTable = readYaml('spec/realm/kernel/tables/share-plan-fields.yaml');
const mappingTable = readYaml('spec/realm/kernel/tables/primitive-mapping-status.yaml');
const graduationLogTable = readYaml('spec/realm/kernel/tables/primitive-graduation-log.yaml');
const ruleEvidenceTable = readYaml('spec/realm/kernel/tables/rule-evidence.yaml');

// ========================================================
// Check 1: public-vocabulary.yaml — required domains present, terms non-empty
// ========================================================

const boundaries = Array.isArray(vocabularyTable?.boundaries) ? vocabularyTable.boundaries : [];
const requiredDomains = new Set(['world', 'agent', 'social']);
const foundDomains = new Set();

for (const boundary of boundaries) {
  const domain = String(boundary?.domain || '').trim();
  if (!domain) {
    fail('public-vocabulary.yaml: boundary entry missing domain');
    continue;
  }
  foundDomains.add(domain);

  const vocabulary = Array.isArray(boundary?.vocabulary) ? boundary.vocabulary : [];
  if (vocabulary.length === 0) {
    fail(`public-vocabulary.yaml ${domain}: vocabulary must not be empty`);
  }

  for (const entry of vocabulary) {
    const term = String(entry?.term || '').trim();
    if (!term) {
      fail(`public-vocabulary.yaml ${domain}: vocabulary entry missing term`);
    }
    const description = String(entry?.description || '').trim();
    if (!description) {
      fail(`public-vocabulary.yaml ${domain}/${term}: vocabulary entry missing description`);
    }
  }

  // Check source format: R-*-NNN
  const source = String(boundary?.source_rule || '').trim();
  if (source && !/^R-[A-Z]{2,12}-\d{3}$/u.test(source)) {
    fail(`public-vocabulary.yaml ${domain}: invalid source_rule format: ${source}`);
  }
}

for (const required of requiredDomains) {
  if (!foundDomains.has(required)) {
    fail(`public-vocabulary.yaml: missing required domain: ${required}`);
  }
}

// ========================================================
// Check 2: creator-key-tiers.yaml — pricing monotonic ascending, tier names unique
// ========================================================

const tiers = Array.isArray(tiersTable?.tiers) ? tiersTable.tiers : [];
const tierNumbers = new Set();

if (tiers.length === 0) {
  fail('creator-key-tiers.yaml: tiers must not be empty');
}

let previousPrice = -1;
for (const tier of tiers) {
  const tierNum = tier?.tier;
  if (tierNum == null) {
    fail('creator-key-tiers.yaml: tier entry missing tier number');
    continue;
  }
  const tierKey = String(tierNum);
  if (tierNumbers.has(tierKey)) {
    fail(`creator-key-tiers.yaml: duplicate tier number: ${tierKey}`);
  }
  tierNumbers.add(tierKey);

  const unitPrice = Number(tier?.unit_price_usd);
  if (Number.isNaN(unitPrice)) {
    fail(`creator-key-tiers.yaml tier ${tierKey}: unit_price_usd must be a number`);
    continue;
  }
  if (unitPrice <= previousPrice) {
    fail(`creator-key-tiers.yaml tier ${tierKey}: pricing not monotonically ascending (${unitPrice} <= ${previousPrice})`);
  }
  previousPrice = unitPrice;

  // Check source format
  const source = String(tier?.source_rule || '').trim();
  if (source && !/^R-[A-Z]{2,12}-\d{3}$/u.test(source)) {
    fail(`creator-key-tiers.yaml tier ${tierKey}: invalid source_rule format: ${source}`);
  }
}

// ========================================================
// Check 3: revenue-event-types.yaml — type names unique, required fields present
// ========================================================

const eventTypes = Array.isArray(revenueTable?.event_types) ? revenueTable.event_types : [];
const eventTypeNames = new Set();

if (eventTypes.length === 0) {
  fail('revenue-event-types.yaml: event_types must not be empty');
}

for (const event of eventTypes) {
  const type = String(event?.type || '').trim();
  if (!type) {
    fail('revenue-event-types.yaml: event_type entry missing type');
    continue;
  }
  if (eventTypeNames.has(type)) {
    fail(`revenue-event-types.yaml: duplicate event type: ${type}`);
  }
  eventTypeNames.add(type);

  // Check required fields
  if (!String(event?.description || '').trim()) {
    fail(`revenue-event-types.yaml ${type}: missing required field: description`);
  }
  if (event?.subject_to_share == null) {
    fail(`revenue-event-types.yaml ${type}: missing required field: subject_to_share`);
  }

  // Check source format
  const source = String(event?.source_rule || '').trim();
  if (source && !/^R-[A-Z]{2,12}-\d{3}$/u.test(source)) {
    fail(`revenue-event-types.yaml ${type}: invalid source_rule format: ${source}`);
  }
}

// ========================================================
// Check 4: share-plan-fields.yaml — field names unique, required fields present
// ========================================================

const fields = Array.isArray(sharePlanTable?.fields) ? sharePlanTable.fields : [];
const fieldNames = new Set();

if (fields.length === 0) {
  fail('share-plan-fields.yaml: fields must not be empty');
}

for (const field of fields) {
  const name = String(field?.field || '').trim();
  if (!name) {
    fail('share-plan-fields.yaml: field entry missing field name');
    continue;
  }
  if (fieldNames.has(name)) {
    fail(`share-plan-fields.yaml: duplicate field name: ${name}`);
  }
  fieldNames.add(name);

  // Check required fields
  if (!String(field?.type || '').trim()) {
    fail(`share-plan-fields.yaml ${name}: missing required field: type`);
  }
  if (field?.required == null) {
    fail(`share-plan-fields.yaml ${name}: missing required field: required`);
  }

  // Check source format
  const source = String(field?.source_rule || '').trim();
  if (source && !/^R-[A-Z]{2,12}-\d{3}$/u.test(source)) {
    fail(`share-plan-fields.yaml ${name}: invalid source_rule format: ${source}`);
  }
}

// Check validation rules source format
const validationRules = Array.isArray(sharePlanTable?.validation_rules) ? sharePlanTable.validation_rules : [];
for (const rule of validationRules) {
  const ruleText = String(rule?.rule || '').trim();
  const source = String(rule?.source_rule || '').trim();
  if (!ruleText) {
    fail('share-plan-fields.yaml: validation_rule entry missing rule text');
  }
  if (source && !/^R-[A-Z]{2,12}-\d{3}$/u.test(source)) {
    fail(`share-plan-fields.yaml validation_rule: invalid source_rule format: ${source}`);
  }
}

// Check ledgers source format
const ledgers = Array.isArray(sharePlanTable?.ledgers) ? sharePlanTable.ledgers : [];
for (const ledger of ledgers) {
  const name = String(ledger?.name || '').trim();
  const source = String(ledger?.source_rule || '').trim();
  if (!name) {
    fail('share-plan-fields.yaml: ledger entry missing name');
  }
  if (source && !/^R-[A-Z]{2,12}-\d{3}$/u.test(source)) {
    fail(`share-plan-fields.yaml ledger ${name}: invalid source_rule format: ${source}`);
  }
}

// ========================================================
// Check 5: primitive-mapping-status.yaml — all 6 primitives present, valid statuses
// ========================================================

const mappings = Array.isArray(mappingTable?.mappings) ? mappingTable.mappings : [];
const requiredPrimitives = new Set(['timeflow', 'social', 'economy', 'transit', 'context', 'presence']);
const foundPrimitives = new Set();
const validStatuses = new Set(Array.isArray(mappingTable?.valid_statuses) ? mappingTable.valid_statuses.map(String) : []);

if (validStatuses.size === 0) {
  fail('primitive-mapping-status.yaml: valid_statuses must not be empty');
}

for (const mapping of mappings) {
  const primitive = String(mapping?.primitive || '').trim();
  if (!primitive) {
    fail('primitive-mapping-status.yaml: mapping entry missing primitive');
    continue;
  }
  foundPrimitives.add(primitive);

  const status = String(mapping?.status || '').trim();
  if (!status) {
    fail(`primitive-mapping-status.yaml ${primitive}: missing required field: status`);
  } else if (validStatuses.size > 0 && !validStatuses.has(status)) {
    fail(`primitive-mapping-status.yaml ${primitive}: invalid status '${status}', valid: ${[...validStatuses].join(', ')}`);
  }

  // Check source format
  const source = String(mapping?.source_rule || '').trim();
  if (source && !/^R-[A-Z]{2,12}-\d{3}$/u.test(source)) {
    fail(`primitive-mapping-status.yaml ${primitive}: invalid source_rule format: ${source}`);
  }
}

for (const required of requiredPrimitives) {
  if (!foundPrimitives.has(required)) {
    fail(`primitive-mapping-status.yaml: missing required primitive: ${required}`);
  }
}

// ========================================================
// Check 6: R-* source format validation across all tables
// ========================================================

const allSourceRefs = new Set();

for (const boundary of boundaries) {
  const source = String(boundary?.source_rule || '').trim();
  if (source) allSourceRefs.add(source);
}
for (const tier of tiers) {
  const source = String(tier?.source_rule || '').trim();
  if (source) allSourceRefs.add(source);
}
for (const event of eventTypes) {
  const source = String(event?.source_rule || '').trim();
  if (source) allSourceRefs.add(source);
}
for (const field of fields) {
  const source = String(field?.source_rule || '').trim();
  if (source) allSourceRefs.add(source);
}
for (const rule of validationRules) {
  const source = String(rule?.source_rule || '').trim();
  if (source) allSourceRefs.add(source);
}
for (const ledger of ledgers) {
  const source = String(ledger?.source_rule || '').trim();
  if (source) allSourceRefs.add(source);
}
for (const mapping of mappings) {
  const source = String(mapping?.source_rule || '').trim();
  if (source) allSourceRefs.add(source);
}
for (const entry of Array.isArray(graduationLogTable?.entries) ? graduationLogTable.entries : []) {
  const source = String(entry?.source_rule || '').trim();
  if (source) allSourceRefs.add(source);
}

// Verify all references match R-*-NNN format
for (const ref of allSourceRefs) {
  if (!/^R-[A-Z]{2,12}-\d{3}$/u.test(ref)) {
    fail(`cross-table: invalid R-* rule ID format: ${ref}`);
  }
}

// ========================================================
// Check 7: Kernel contract files exist
// ========================================================

const kernelDir = path.join(cwd, 'spec', 'realm', 'kernel');
const requiredKernelFiles = [
  'index.md',
  'boundary-vocabulary-contract.md',
  'economy-contract.md',
  'interop-mapping-contract.md',
  'tables/primitive-graduation-log.yaml',
  'tables/rule-evidence.yaml',
];

for (const file of requiredKernelFiles) {
  if (!fs.existsSync(path.join(kernelDir, file))) {
    fail(`kernel file missing: spec/realm/kernel/${file}`);
  }
}

// ========================================================
// Check 8 (CI-1): creator-key-tiers.yaml cumulative revenue arithmetic verification
// ========================================================

let cumulativeRevenue = 0;
for (const tier of tiers) {
  const tierNum = tier?.tier;
  if (tierNum == null) continue;
  const tierKey = String(tierNum);
  const unitPrice = Number(tier?.unit_price_usd);
  const capacity = tier?.capacity;
  const expectedCumulativeRevenue = tier?.cumulative_revenue_usd;

  if (capacity === 'open' || expectedCumulativeRevenue == null) continue;

  const numCapacity = Number(capacity);
  if (Number.isNaN(numCapacity) || Number.isNaN(unitPrice)) continue;

  cumulativeRevenue += unitPrice * numCapacity;
  if (cumulativeRevenue !== Number(expectedCumulativeRevenue)) {
    fail(`creator-key-tiers.yaml tier ${tierKey}: cumulative_revenue_usd expected ${cumulativeRevenue} but got ${expectedCumulativeRevenue}`);
  }
}

// ========================================================
// Check 9 (CI-2): realm vs platform primitive name set alignment
// ========================================================

const platformPrimitivesPath = path.join(cwd, 'spec', 'platform', 'kernel', 'tables', 'protocol-primitives.yaml');
if (fs.existsSync(platformPrimitivesPath)) {
  const platformTable = readYaml('spec/platform/kernel/tables/protocol-primitives.yaml');
  const platformPrimitives = new Set(
    (Array.isArray(platformTable?.primitives) ? platformTable.primitives : [])
      .map((p) => String(p?.name || '').trim())
      .filter(Boolean)
  );
  const realmPrimitives = new Set(
    mappings.map((m) => String(m?.primitive || '').trim()).filter(Boolean)
  );

  for (const pp of platformPrimitives) {
    if (!realmPrimitives.has(pp)) {
      fail(`primitive-mapping-status.yaml: platform primitive '${pp}' has no realm mapping entry`);
    }
  }
  for (const rp of realmPrimitives) {
    if (!platformPrimitives.has(rp)) {
      fail(`primitive-mapping-status.yaml: realm primitive '${rp}' has no platform primitive definition`);
    }
  }
}

// ========================================================
// Check 10 (CI-3): graduation log aligns with COVERED primitive mappings
// ========================================================

const graduationEntries = Array.isArray(graduationLogTable?.entries) ? graduationLogTable.entries : [];
const graduationByPrimitive = new Map();

for (const entry of graduationEntries) {
  const primitive = String(entry?.primitive || '').trim();
  if (!primitive) {
    fail('primitive-graduation-log.yaml: entry missing primitive');
    continue;
  }
  if (graduationByPrimitive.has(primitive)) {
    fail(`primitive-graduation-log.yaml: duplicate entry for primitive ${primitive}`);
    continue;
  }
  graduationByPrimitive.set(primitive, entry);

  const graduatedAt = String(entry?.graduated_at || '').trim();
  const sourceRule = String(entry?.source_rule || '').trim();
  const status = String(entry?.status || '').trim();
  const testPath = String(entry?.test_path || '').trim();
  const testName = String(entry?.test_name || '').trim();
  const ciPath = String(entry?.ci_path || '').trim();
  const ciCommand = String(entry?.ci_command || '').trim();

  if (!graduatedAt) fail(`primitive-graduation-log.yaml ${primitive}: missing graduated_at`);
  if (sourceRule !== 'R-INTEROP-002') fail(`primitive-graduation-log.yaml ${primitive}: source_rule must be R-INTEROP-002`);
  if (status !== 'COVERED') fail(`primitive-graduation-log.yaml ${primitive}: status must be COVERED`);
  if (!testPath) fail(`primitive-graduation-log.yaml ${primitive}: missing test_path`);
  if (!testName) fail(`primitive-graduation-log.yaml ${primitive}: missing test_name`);
  if (!ciPath) fail(`primitive-graduation-log.yaml ${primitive}: missing ci_path`);
  if (!ciCommand) fail(`primitive-graduation-log.yaml ${primitive}: missing ci_command`);
  if (testPath && !fs.existsSync(path.join(cwd, testPath))) {
    fail(`primitive-graduation-log.yaml ${primitive}: test_path does not exist: ${testPath}`);
  }
  if (ciPath && !fs.existsSync(path.join(cwd, ciPath))) {
    fail(`primitive-graduation-log.yaml ${primitive}: ci_path does not exist: ${ciPath}`);
  }
}

for (const mapping of mappings) {
  const primitive = String(mapping?.primitive || '').trim();
  const status = String(mapping?.status || '').trim();
  if (!primitive) continue;
  const hasLog = graduationByPrimitive.has(primitive);
  if (status === 'COVERED' && !hasLog) {
    fail(`primitive-mapping-status.yaml ${primitive}: status=COVERED requires graduation-log entry`);
  }
  if (status !== 'COVERED' && hasLog) {
    fail(`primitive-graduation-log.yaml ${primitive}: log entry requires mapping status COVERED`);
  }
}

// ========================================================
// Check 11 (CI-4): domain document Normative Imports Rule ID existence verification
// ========================================================

const domainDocsDir = path.join(cwd, 'spec', 'realm');
const kernelContractsDir = path.join(cwd, 'spec', 'realm', 'kernel');

// Collect all R-*-NNN rule IDs defined in kernel contracts
const definedRuleIds = new Set();
const kernelContractFiles = ['boundary-vocabulary-contract.md', 'economy-contract.md', 'interop-mapping-contract.md'];

for (const file of kernelContractFiles) {
  const filePath = path.join(kernelContractsDir, file);
  if (!fs.existsSync(filePath)) continue;
  const content = fs.readFileSync(filePath, 'utf8');
  const ruleIdMatches = content.matchAll(/^##\s+(R-[A-Z]{2,12}-\d{3})\b/gmu);
  for (const match of ruleIdMatches) {
    definedRuleIds.add(match[1]);
  }
}

// Scan domain documents for referenced rule IDs and verify they exist
const domainDocFiles = fs.readdirSync(domainDocsDir)
  .filter((f) => f.endsWith('.md') && f !== 'index.md')
  .sort((a, b) => a.localeCompare(b));

if (domainDocFiles.length === 0) {
  fail('realm domain markdown files are empty');
}

for (const file of domainDocFiles) {
  const filePath = path.join(domainDocsDir, file);
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) continue;
  const content = fs.readFileSync(filePath, 'utf8');
  if (!/^##\s+0\.\s+Normative Imports\b/mu.test(content)) {
    fail(`${file}: must define Section 0 Normative Imports`);
  }
  if (!/\bR-[A-Z]{2,12}-\d{3}\b/gu.test(content)) {
    fail(`${file}: must reference at least one realm kernel Rule ID`);
  }
  if (/^##\s+R-[A-Z]{2,12}-\d{3}\b/gmu.test(content)) {
    fail(`${file}: must not define kernel Rule IDs directly`);
  }
  checkNoLocalRuleIds(content, file);
  checkNoRuleDefinitionHeadings(content, file);
  const ruleIdMatches = content.matchAll(/\bR-[A-Z]{2,12}-\d{3}\b/gu);
  for (const match of ruleIdMatches) {
    if (!definedRuleIds.has(match[0])) {
      fail(`${file}: references undefined rule ID: ${match[0]}`);
    }
  }
}

// ========================================================
// Check 12 (CI-5): validation_rules source → economy-contract.md section heading cross-reference
// ========================================================

const economyContractPath = path.join(kernelContractsDir, 'economy-contract.md');
if (fs.existsSync(economyContractPath)) {
  const economyContent = fs.readFileSync(economyContractPath, 'utf8');
  const economyHeadingRuleIds = new Set();
  const headingMatches = economyContent.matchAll(/^## (R-ECON-\d{3})/gmu);
  for (const match of headingMatches) {
    economyHeadingRuleIds.add(match[1]);
  }

  for (const rule of validationRules) {
    const source = String(rule?.source_rule || '').trim();
    if (source && source.startsWith('R-ECON-')) {
      if (!economyHeadingRuleIds.has(source)) {
        fail(`share-plan-fields.yaml validation_rule source '${source}' has no matching section heading in economy-contract.md`);
      }
    }
  }
}

// ========================================================
// Check 13 (CI-6): YAML vocabulary term names align with kernel contract prose
// ========================================================

const boundaryContractPath = path.join(kernelContractsDir, 'boundary-vocabulary-contract.md');
if (fs.existsSync(boundaryContractPath)) {
  const boundaryContent = fs.readFileSync(boundaryContractPath, 'utf8');

  for (const boundary of boundaries) {
    const domain = String(boundary?.domain || '').trim();
    const source = String(boundary?.source_rule || '').trim();
    if (!domain || !source) continue;

    // Find the section for this source rule ID
    const sectionRegex = new RegExp(`## ${source.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}[^#]*`, 'u');
    const sectionMatch = boundaryContent.match(sectionRegex);
    if (!sectionMatch) continue;
    const sectionText = sectionMatch[0];

    const vocabulary = Array.isArray(boundary?.vocabulary) ? boundary.vocabulary : [];
    for (const entry of vocabulary) {
      const term = String(entry?.term || '').trim();
      if (!term) continue;
      if (!sectionText.includes(term)) {
        fail(`public-vocabulary.yaml ${domain}/${term}: term not found in ${source} section of boundary-vocabulary-contract.md`);
      }
    }
  }
}

checkCrossDomainRuleReferences(
  [
    ...requiredKernelFiles
      .filter((file) => file.endsWith('.md'))
      .map((file) => path.posix.join('spec/realm/kernel', file)),
    ...domainDocFiles.map((file) => path.posix.join('spec/realm', file)),
  ],
  [
    {
      label: 'Platform',
      dir: 'spec/platform/kernel',
      headingPattern: /^##\s+(P-[A-Z]+-\d{3}[a-z]?)\b/gmu,
      refPattern: /\bP-[A-Z]+-\d{3}[a-z]?\b/gu,
    },
    {
      label: 'Runtime',
      dir: 'spec/runtime/kernel',
      headingPattern: /^##\s+(K-[A-Z]+-\d{3}[a-z]?)\b/gmu,
      refPattern: /\bK-[A-Z]+-\d{3}[a-z]?\b/gu,
    },
    {
      label: 'SDK',
      dir: 'spec/sdk/kernel',
      headingPattern: /^##\s+(S-[A-Z]+-\d{3}[a-z]?)\b/gmu,
      refPattern: /\bS-[A-Z]+-\d{3}[a-z]?\b/gu,
    },
  ],
);

checkRuleEvidenceTraceability(definedRuleIds);
checkOrphanRules(definedRuleIds, domainDocFiles);

if (failed) process.exit(1);
console.log('realm-spec-kernel-consistency: OK');

function checkRuleEvidenceTraceability(definedRuleIds) {
  const rel = 'spec/realm/kernel/tables/rule-evidence.yaml';
  const catalog = ruleEvidenceTable?.evidence_catalog && typeof ruleEvidenceTable.evidence_catalog === 'object'
    ? ruleEvidenceTable.evidence_catalog
    : null;
  if (!catalog) {
    fail(`${rel} missing evidence_catalog map`);
    return;
  }

  for (const [ref, item] of Object.entries(catalog)) {
    const record = item && typeof item === 'object' ? item : null;
    if (!record) {
      fail(`${rel} evidence_catalog.${ref} must be an object`);
      continue;
    }
    const command = String(record.command || '').trim();
    const targetPath = String(record.path || '').trim();
    if (!String(record.type || '').trim()) fail(`${rel} evidence_catalog.${ref} missing type`);
    if (!command) fail(`${rel} evidence_catalog.${ref} missing command`);
    if (!targetPath) {
      fail(`${rel} evidence_catalog.${ref} missing path`);
      continue;
    }
    if (!fs.existsSync(path.join(cwd, targetPath))) {
      fail(`${rel} evidence_catalog.${ref} path does not exist: ${targetPath}`);
    }
  }

  const rules = Array.isArray(ruleEvidenceTable?.rules) ? ruleEvidenceTable.rules : [];
  const seen = new Set();
  for (const item of rules) {
    const ruleId = String(item?.rule_id || '').trim();
    const status = String(item?.status || '').trim().toLowerCase();
    const refs = Array.isArray(item?.evidence_refs) ? item.evidence_refs : [];
    const naReason = String(item?.na_reason || '').trim();
    if (!/^R-[A-Z]{2,12}-\d{3}$/u.test(ruleId)) {
      fail(`${rel} has invalid rule_id format: ${ruleId || '<empty>'}`);
      continue;
    }
    if (seen.has(ruleId)) {
      fail(`${rel} has duplicate rule_id entry: ${ruleId}`);
      continue;
    }
    seen.add(ruleId);
    if (!definedRuleIds.has(ruleId)) {
      fail(`${rel} references unknown realm kernel rule: ${ruleId}`);
    }
    if (status !== 'covered' && status !== 'na') {
      fail(`${rel} ${ruleId} has invalid status: ${status || '<empty>'}`);
      continue;
    }
    if (status === 'na') {
      if (!naReason) fail(`${rel} ${ruleId} status=na requires na_reason`);
      continue;
    }
    if (refs.length === 0) {
      fail(`${rel} ${ruleId} status=covered requires non-empty evidence_refs`);
      continue;
    }
    for (const rawRef of refs) {
      const ref = String(rawRef || '').trim();
      if (!ref) {
        fail(`${rel} ${ruleId} contains empty evidence_refs item`);
        continue;
      }
      if (!Object.prototype.hasOwnProperty.call(catalog, ref)) {
        fail(`${rel} ${ruleId} references undefined evidence ref: ${ref}`);
      }
    }
  }

  const missing = [...definedRuleIds].filter((ruleId) => !seen.has(ruleId));
  if (missing.length > 0) {
    fail(`${rel} missing evidence rows for rules: ${missing.join(', ')}`);
  }
}

function checkOrphanRules(definedRuleIds, domainDocFiles) {
  const refs = [];
  const files = [
    ...requiredKernelFiles.map((file) => path.posix.join('spec/realm/kernel', file)),
    ...domainDocFiles.map((file) => path.posix.join('spec/realm', file)),
  ].filter((rel) => !rel.endsWith('rule-evidence.yaml'));

  for (const rel of files) {
    if (!fs.existsSync(path.join(cwd, rel))) continue;
    const content = fs.readFileSync(path.join(cwd, rel), 'utf8');
    for (const match of content.matchAll(/\bR-[A-Z]{2,12}-\d{3}\b/g)) {
      refs.push(match[0]);
    }
  }

  const orphans = [...definedRuleIds].filter((ruleId) => refs.filter((ref) => ref === ruleId).length <= 1);
  if (orphans.length > 0) {
    fail(`realm orphan kernel rules detected: ${orphans.join(', ')}`);
  }
}

function checkCrossDomainRuleReferences(files, targets) {
  for (const target of targets) {
    const targetDir = path.join(cwd, target.dir);
    if (!fs.existsSync(targetDir)) continue;

    const definitions = new Set();
    for (const name of fs.readdirSync(targetDir).filter((entry) => entry.endsWith('.md'))) {
      const filePath = path.join(targetDir, name);
      if (!fs.statSync(filePath).isFile()) continue;
      const content = fs.readFileSync(filePath, 'utf8');
      for (const match of content.matchAll(target.headingPattern)) {
        definitions.add(match[1]);
      }
    }
    if (definitions.size === 0) continue;

    for (const rel of files) {
      const filePath = path.join(cwd, rel);
      if (!fs.existsSync(filePath)) continue;
      const content = fs.readFileSync(filePath, 'utf8');
      for (const ref of new Set([...content.matchAll(target.refPattern)].map((match) => match[0]))) {
        if (!definitions.has(ref)) {
          fail(`${rel} references undefined ${target.label} Rule ID: ${ref}`);
        }
      }
    }
  }
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
