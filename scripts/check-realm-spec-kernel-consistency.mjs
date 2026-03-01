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
  const source = String(boundary?.source || '').trim();
  if (source && !/^R-[A-Z]{2,12}-\d{3}$/u.test(source)) {
    fail(`public-vocabulary.yaml ${domain}: invalid source format: ${source}`);
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
  const source = String(tier?.source || '').trim();
  if (source && !/^R-[A-Z]{2,12}-\d{3}$/u.test(source)) {
    fail(`creator-key-tiers.yaml tier ${tierKey}: invalid source format: ${source}`);
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
  const source = String(event?.source || '').trim();
  if (source && !/^R-[A-Z]{2,12}-\d{3}$/u.test(source)) {
    fail(`revenue-event-types.yaml ${type}: invalid source format: ${source}`);
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
  const source = String(field?.source || '').trim();
  if (source && !/^R-[A-Z]{2,12}-\d{3}$/u.test(source)) {
    fail(`share-plan-fields.yaml ${name}: invalid source format: ${source}`);
  }
}

// Check validation rules source format
const validationRules = Array.isArray(sharePlanTable?.validation_rules) ? sharePlanTable.validation_rules : [];
for (const rule of validationRules) {
  const ruleText = String(rule?.rule || '').trim();
  const source = String(rule?.source || '').trim();
  if (!ruleText) {
    fail('share-plan-fields.yaml: validation_rule entry missing rule text');
  }
  if (source && !/^R-[A-Z]{2,12}-\d{3}$/u.test(source)) {
    fail(`share-plan-fields.yaml validation_rule: invalid source format: ${source}`);
  }
}

// Check ledgers source format
const ledgers = Array.isArray(sharePlanTable?.ledgers) ? sharePlanTable.ledgers : [];
for (const ledger of ledgers) {
  const name = String(ledger?.name || '').trim();
  const source = String(ledger?.source || '').trim();
  if (!name) {
    fail('share-plan-fields.yaml: ledger entry missing name');
  }
  if (source && !/^R-[A-Z]{2,12}-\d{3}$/u.test(source)) {
    fail(`share-plan-fields.yaml ledger ${name}: invalid source format: ${source}`);
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
  const source = String(mapping?.source || '').trim();
  if (source && !/^R-[A-Z]{2,12}-\d{3}$/u.test(source)) {
    fail(`primitive-mapping-status.yaml ${primitive}: invalid source format: ${source}`);
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
  const source = String(boundary?.source || '').trim();
  if (source) allSourceRefs.add(source);
}
for (const tier of tiers) {
  const source = String(tier?.source || '').trim();
  if (source) allSourceRefs.add(source);
}
for (const event of eventTypes) {
  const source = String(event?.source || '').trim();
  if (source) allSourceRefs.add(source);
}
for (const field of fields) {
  const source = String(field?.source || '').trim();
  if (source) allSourceRefs.add(source);
}
for (const rule of validationRules) {
  const source = String(rule?.source || '').trim();
  if (source) allSourceRefs.add(source);
}
for (const ledger of ledgers) {
  const source = String(ledger?.source || '').trim();
  if (source) allSourceRefs.add(source);
}
for (const mapping of mappings) {
  const source = String(mapping?.source || '').trim();
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
// Check 10 (CI-3): domain document Normative Imports Rule ID existence verification
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
  const ruleIdMatches = content.matchAll(/\bR-[A-Z]{2,12}-\d{3}\b/gu);
  for (const match of ruleIdMatches) {
    definedRuleIds.add(match[0]);
  }
}

// Scan domain documents for referenced rule IDs and verify they exist
const domainDocFiles = fs.readdirSync(domainDocsDir)
  .filter((f) => f.endsWith('.md') && !f.startsWith('kernel'));

for (const file of domainDocFiles) {
  const filePath = path.join(domainDocsDir, file);
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) continue;
  const content = fs.readFileSync(filePath, 'utf8');
  const ruleIdMatches = content.matchAll(/\bR-[A-Z]{2,12}-\d{3}\b/gu);
  for (const match of ruleIdMatches) {
    if (!definedRuleIds.has(match[0])) {
      fail(`${file}: references undefined rule ID: ${match[0]}`);
    }
  }
}

// ========================================================
// Check 11 (CI-4): validation_rules source → economy-contract.md section heading cross-reference
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
    const source = String(rule?.source || '').trim();
    if (source && source.startsWith('R-ECON-')) {
      if (!economyHeadingRuleIds.has(source)) {
        fail(`share-plan-fields.yaml validation_rule source '${source}' has no matching section heading in economy-contract.md`);
      }
    }
  }
}

// ========================================================
// Check 12 (CI-5): YAML vocabulary term names align with kernel contract prose
// ========================================================

const boundaryContractPath = path.join(kernelContractsDir, 'boundary-vocabulary-contract.md');
if (fs.existsSync(boundaryContractPath)) {
  const boundaryContent = fs.readFileSync(boundaryContractPath, 'utf8');

  for (const boundary of boundaries) {
    const domain = String(boundary?.domain || '').trim();
    const source = String(boundary?.source || '').trim();
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

if (failed) process.exit(1);
console.log('realm-spec-kernel-consistency: OK');
