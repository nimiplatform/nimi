/**
 * check-parentos-knowledge-base.ts
 * Validates YAML knowledge base integrity: unique IDs, regex patterns,
 * and generation freshness.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import {
  validateKnowledgeSource,
  validateMilestoneThreshold,
  validateReminderExplain,
  validateReminderKind,
  validateReminderRule,
  validateReminderSourceRetired,
  validateSensitivePeriod,
} from './parentos-knowledge-base-validation.js';
import {
  knowledgeAssetSourcePaths,
  readKnowledgeAssetData,
} from './knowledge-json-asset.js';
import {
  assertCrossReferenceIntegrity,
  assertNoOrphanShards,
  assertValidKnowledgeAsset,
  loadKnowledgeAsset,
} from './knowledge-asset-kernel.js';
import { collectKnowledgeAssetGovernanceErrors } from './check-knowledge-asset-governance.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const REPO_ROOT = resolve(ROOT, '../..');
const TABLES = resolve(ROOT, 'spec/kernel/tables');
const DATA_KNOWLEDGE = resolve(ROOT, 'data/knowledge');
const GEN = resolve(ROOT, 'src/shell/renderer/knowledge-base/gen');
const RUST_GEN = resolve(ROOT, 'src-tauri/src/sqlite/queries');

let errors = 0;

function fail(msg: string) {
  console.error(`  FAIL: ${msg}`);
  errors++;
}

function pass(msg: string) {
  console.log(`  PASS: ${msg}`);
}

function readTableYaml(filename: string): unknown {
  return parseYaml(readFileSync(resolve(TABLES, filename), 'utf-8'));
}

function readKnowledgeAsset(assetId: string): unknown {
  return readKnowledgeAssetData(DATA_KNOWLEDGE, assetId);
}

function sourcePath(source: KnowledgeSourceRef) {
  return source.kind === 'table'
    ? resolve(TABLES, source.file)
    : resolve(DATA_KNOWLEDGE, source.file);
}

type KnowledgeSourceRef = { kind: 'table' | 'data'; file: string };

function sourcePaths(source: KnowledgeSourceRef) {
  if (source.kind === 'data') {
    return knowledgeAssetSourcePaths(DATA_KNOWLEDGE, source.file);
  }
  return [sourcePath(source)];
}

function checkUniqueIds(source: KnowledgeSourceRef, key: string, idField: string, pattern: RegExp) {
  const file = source.file;
  console.log(`\n--- ${file} ---`);
  const data = source.kind === 'table'
    ? (readTableYaml(file) as Record<string, unknown>)
    : (readKnowledgeAsset(file) as Record<string, unknown>);
  const items = data[key] as Array<Record<string, string>>;
  if (!items) {
    fail(`Key '${key}' not found in ${file}`);
    return;
  }

  const seen = new Set<string>();
  for (const item of items) {
    const id = item[idField];
    if (!id) {
      fail(`Missing ${idField} in ${file}`);
      continue;
    }
    if (seen.has(id)) {
      fail(`Duplicate ${idField}: ${id}`);
    }
    seen.add(id);
    if (!pattern.test(id)) {
      fail(`${idField} '${id}' does not match pattern ${pattern}`);
    }
  }
  pass(`${seen.size} unique ${idField}s, all matching ${pattern}`);
}

// ── ID Uniqueness & Pattern ─────────────────────────────────

const reminderRuleShards = ['reminder-rules.yaml', 'reminder-rules-extended.yaml'];
const reminderRuleIds = new Set<string>();
for (const shard of reminderRuleShards) {
  const shardData = parseYaml(readFileSync(resolve(TABLES, shard), 'utf-8')) as { rules?: Array<{ ruleId: string }> };
  for (const rule of shardData.rules ?? []) {
    if (!rule.ruleId) {
      fail(`Missing ruleId in ${shard}`);
      continue;
    }
    if (reminderRuleIds.has(rule.ruleId)) {
      fail(`Duplicate ruleId: ${rule.ruleId}`);
    }
    reminderRuleIds.add(rule.ruleId);
    if (!/^PO-REM-[A-Z]{3,6}-[0-9]{3}$/.test(rule.ruleId)) {
      fail(`ruleId '${rule.ruleId}' does not match pattern /^PO-REM-[A-Z]{3,6}-[0-9]{3}$/`);
    }
  }
}
pass(`${reminderRuleIds.size} unique reminder ruleIds across reminder-rules shards`);
checkUniqueIds({ kind: 'data', file: 'milestone-catalog' }, 'milestones', 'milestoneId', /^PO-MS-[A-Z]{3,5}-[0-9]{3}$/);
checkUniqueIds({ kind: 'data', file: 'sensitive-periods' }, 'periods', 'periodId', /^PO-SP-[A-Z]{3,6}-[0-9]{3}$/);

// Observation dimensions
console.log('\n--- observation-framework ---');
const obsData = readKnowledgeAsset('observation-framework') as { dimensions?: Array<{ dimensionId: string }> };

if (obsData.dimensions) {
  const dimIds = new Set<string>();
  for (const dim of obsData.dimensions) {
    if (dimIds.has(dim.dimensionId)) {
      fail(`Duplicate dimensionId: ${dim.dimensionId}`);
    }
    dimIds.add(dim.dimensionId);
  }
  pass(`${dimIds.size} unique dimensionIds`);
} else {
  pass('No dimensions array (may use frameworkMapping.layers only)');
}

// ── Generated File Freshness ────────────────────────────────

console.log('\n--- reminder-rules.yaml constraints ---');
const reminderData = parseYaml(
  readFileSync(resolve(TABLES, 'reminder-rules.yaml'), 'utf-8'),
) as {
  rules?: Array<{
    ruleId: string;
    category: string;
    kind?: string;
    actionType?: string;
    triggerAge: { startMonths: number; endMonths: number };
    triggerCondition?: unknown;
    explain?: unknown;
    source?: unknown;
  }>;
};
const reminderExtendedData = parseYaml(
  readFileSync(resolve(TABLES, 'reminder-rules-extended.yaml'), 'utf-8'),
) as typeof reminderData;

interface HealthMetric {
  metricId: string;
  captureProtocolIds?: string[];
  evaluationPolicyRef?: string;
}

interface HealthCaptureProtocol {
  protocolId: string;
  metricIds?: string[];
  requiredMetricIds?: string[];
  optionalMetricIds?: string[];
  derivedMetricIds?: string[];
  storageTarget?: string;
}

interface ReminderCaptureTarget {
  ruleId: string;
  actionType: string;
  captureProtocolId: string;
  targetMetricIds?: string[];
}

interface HealthEvaluationPolicy {
  policyId: string;
  appliesTo?: string[];
}

for (const rule of [...(reminderData.rules ?? []), ...(reminderExtendedData.rules ?? [])]) {
  for (const issue of validateReminderRule(rule)) {
    fail(issue);
  }
  for (const issue of validateReminderKind(rule)) {
    fail(issue);
  }
  for (const issue of validateReminderExplain(rule)) {
    fail(issue);
  }
  for (const issue of validateReminderSourceRetired(rule)) {
    fail(issue);
  }
}
pass(`Validated reminder rule constraints for ${reminderData.rules?.length ?? 0} rules`);

console.log('\n--- health capture authority constraints ---');
const healthMetricData = parseYaml(
  readFileSync(resolve(TABLES, 'health-metric-registry.yaml'), 'utf-8'),
) as { metrics?: HealthMetric[] };
const healthProtocolData = parseYaml(
  readFileSync(resolve(TABLES, 'health-capture-protocols.yaml'), 'utf-8'),
) as { protocols?: HealthCaptureProtocol[] };
const reminderTargetData = parseYaml(
  readFileSync(resolve(TABLES, 'reminder-capture-targets.yaml'), 'utf-8'),
) as { targets?: ReminderCaptureTarget[] };
const healthEvaluationData = parseYaml(
  readFileSync(resolve(TABLES, 'health-evaluation-rules.yaml'), 'utf-8'),
) as { policies?: HealthEvaluationPolicy[] };

const healthMetricIds = new Set<string>();
for (const metric of healthMetricData.metrics ?? []) {
  if (!metric.metricId) {
    fail('health-metric-registry.yaml metric is missing metricId');
    continue;
  }
  if (healthMetricIds.has(metric.metricId)) {
    fail(`Duplicate health metricId: ${metric.metricId}`);
  }
  healthMetricIds.add(metric.metricId);
}

const healthProtocolById = new Map<string, HealthCaptureProtocol>();
for (const protocol of healthProtocolData.protocols ?? []) {
  if (!protocol.protocolId) {
    fail('health-capture-protocols.yaml protocol is missing protocolId');
    continue;
  }
  if (healthProtocolById.has(protocol.protocolId)) {
    fail(`Duplicate health capture protocolId: ${protocol.protocolId}`);
  }
  healthProtocolById.set(protocol.protocolId, protocol);
  const referencedMetricIds = [
    ...(protocol.metricIds ?? []),
    ...(protocol.requiredMetricIds ?? []),
    ...(protocol.optionalMetricIds ?? []),
    ...(protocol.derivedMetricIds ?? []),
  ];
  for (const metricId of referencedMetricIds) {
    if (!healthMetricIds.has(metricId)) {
      fail(`health-capture-protocols.yaml protocol ${protocol.protocolId} references unknown metricId ${metricId}`);
    }
  }
  if (protocol.storageTarget !== 'health_record_event' && protocol.storageTarget !== 'retained_table') {
    fail(`health-capture-protocols.yaml protocol ${protocol.protocolId} has invalid storageTarget ${protocol.storageTarget}`);
  }
}

for (const metric of healthMetricData.metrics ?? []) {
  for (const protocolId of metric.captureProtocolIds ?? []) {
    if (!healthProtocolById.has(protocolId)) {
      fail(`health-metric-registry.yaml metric ${metric.metricId} references unknown captureProtocolId ${protocolId}`);
    }
  }
}

const healthEvaluationPolicyIds = new Set<string>();
for (const policy of healthEvaluationData.policies ?? []) {
  if (!policy.policyId) {
    fail('health-evaluation-rules.yaml policy is missing policyId');
    continue;
  }
  if (healthEvaluationPolicyIds.has(policy.policyId)) {
    fail(`Duplicate health evaluation policyId: ${policy.policyId}`);
  }
  healthEvaluationPolicyIds.add(policy.policyId);
  for (const metricId of policy.appliesTo ?? []) {
    if (!healthMetricIds.has(metricId)) {
      fail(`health-evaluation-rules.yaml policy ${policy.policyId} references unknown metricId ${metricId}`);
    }
  }
}

for (const metric of healthMetricData.metrics ?? []) {
  if (metric.evaluationPolicyRef && !healthEvaluationPolicyIds.has(metric.evaluationPolicyRef)) {
    fail(`health-metric-registry.yaml metric ${metric.metricId} references unknown evaluationPolicyRef ${metric.evaluationPolicyRef}`);
  }
}

const recordDataRules = new Map<string, { ruleId: string; actionType?: string }>();
for (const rule of [...(reminderData.rules ?? []), ...(reminderExtendedData.rules ?? [])]) {
  if (rule.actionType === 'record_data') {
    recordDataRules.set(rule.ruleId, rule);
  }
}

const targetCountByRuleId = new Map<string, number>();
for (const target of reminderTargetData.targets ?? []) {
  if (!target.ruleId) {
    fail('reminder-capture-targets.yaml target is missing ruleId');
    continue;
  }
  targetCountByRuleId.set(target.ruleId, (targetCountByRuleId.get(target.ruleId) ?? 0) + 1);
  const rule = recordDataRules.get(target.ruleId);
  if (!rule) {
    fail(`reminder-capture-targets.yaml target ${target.ruleId} does not resolve to an actionType=record_data reminder rule shard`);
  }
  if (target.actionType !== 'record_data') {
    fail(`reminder-capture-targets.yaml target ${target.ruleId} must declare actionType=record_data`);
  }
  const protocol = healthProtocolById.get(target.captureProtocolId);
  if (!protocol) {
    fail(`reminder-capture-targets.yaml target ${target.ruleId} references unknown captureProtocolId ${target.captureProtocolId}`);
  }
  for (const metricId of target.targetMetricIds ?? []) {
    if (!healthMetricIds.has(metricId)) {
      fail(`reminder-capture-targets.yaml target ${target.ruleId} references unknown metricId ${metricId}`);
    }
    if (protocol && !(protocol.metricIds ?? []).includes(metricId)) {
      fail(`reminder-capture-targets.yaml target ${target.ruleId} metricId ${metricId} is not admitted by protocol ${target.captureProtocolId}`);
    }
  }
}
for (const ruleId of recordDataRules.keys()) {
  const count = targetCountByRuleId.get(ruleId) ?? 0;
  if (count !== 1) {
    fail(`actionType=record_data reminder rule ${ruleId} must have exactly one reminder-capture-target row, found ${count}`);
  }
}
pass(`Validated ${healthMetricIds.size} health metrics, ${healthProtocolById.size} capture protocols, ${healthEvaluationPolicyIds.size} evaluation policies, and ${recordDataRules.size} record_data reminder targets`);

console.log('\n--- growth-milestone-rules.yaml constraints ---');

interface GrowthMilestoneRuleRow {
  ruleId: string;
  kind?: string;
  appliesToMetricIds?: string[];
  triggerCondition?: { evidenceWindowMonths?: number };
}

const growthMilestoneData = parseYaml(
  readFileSync(resolve(TABLES, 'growth-milestone-rules.yaml'), 'utf-8'),
) as { rules?: GrowthMilestoneRuleRow[] };

const GROWTH_MILESTONE_RULE_ID_PATTERN = /^growth-milestone-[a-z0-9-]+$/;
const GROWTH_MILESTONE_EVIDENCE_WINDOW_MONTHS_MIN = 1;
const GROWTH_MILESTONE_EVIDENCE_WINDOW_MONTHS_MAX = 24;
const growthMilestoneRuleIds = new Set<string>();

for (const rule of growthMilestoneData.rules ?? []) {
  if (!rule.ruleId) {
    fail('growth-milestone-rules.yaml rule is missing ruleId');
    continue;
  }
  if (!GROWTH_MILESTONE_RULE_ID_PATTERN.test(rule.ruleId)) {
    fail(`growth-milestone-rules.yaml ruleId ${rule.ruleId} does not match ${GROWTH_MILESTONE_RULE_ID_PATTERN}`);
  }
  if (growthMilestoneRuleIds.has(rule.ruleId)) {
    fail(`Duplicate growth-milestone ruleId: ${rule.ruleId}`);
  }
  growthMilestoneRuleIds.add(rule.ruleId);
  for (const metricId of rule.appliesToMetricIds ?? []) {
    if (!healthMetricIds.has(metricId)) {
      fail(`growth-milestone-rules.yaml rule ${rule.ruleId} references unknown metricId ${metricId}`);
    }
  }
  const evidenceWindowMonths = rule.triggerCondition?.evidenceWindowMonths;
  if (typeof evidenceWindowMonths !== 'number') {
    fail(`growth-milestone-rules.yaml rule ${rule.ruleId} triggerCondition.evidenceWindowMonths must be a number`);
  } else if (
    evidenceWindowMonths < GROWTH_MILESTONE_EVIDENCE_WINDOW_MONTHS_MIN ||
    evidenceWindowMonths > GROWTH_MILESTONE_EVIDENCE_WINDOW_MONTHS_MAX
  ) {
    fail(
      `growth-milestone-rules.yaml rule ${rule.ruleId} triggerCondition.evidenceWindowMonths ${evidenceWindowMonths} is outside admitted range [${GROWTH_MILESTONE_EVIDENCE_WINDOW_MONTHS_MIN}, ${GROWTH_MILESTONE_EVIDENCE_WINDOW_MONTHS_MAX}]`,
    );
  }
}
pass(`Validated growth-milestone-rules constraints for ${growthMilestoneData.rules?.length ?? 0} rules`);

console.log('\n--- reference-data-assets.yaml constraints ---');
const referenceAssetData = readTableYaml('reference-data-assets.yaml') as {
  assets?: Array<{
    assetId: string;
    path: string;
    storageModel: string;
    format: string;
    authorityClass: string;
    generatedModule?: string;
    runtimeProjectionAdmission?: string;
  }>;
};
const referenceAssetIds = new Set<string>();
const knowledgeAssetsById = new Map<string, ReturnType<typeof loadKnowledgeAsset>>();
for (const asset of referenceAssetData.assets ?? []) {
  if (!asset.assetId) {
    fail('reference-data-assets.yaml asset is missing assetId');
    continue;
  }
  if (referenceAssetIds.has(asset.assetId)) {
    fail(`Duplicate reference data assetId: ${asset.assetId}`);
  }
  referenceAssetIds.add(asset.assetId);
  if (asset.format !== 'json') {
    fail(`reference-data-assets.yaml asset ${asset.assetId} must use format=json`);
  }
  if (asset.storageModel !== 'directory_backed_asset') {
    fail(`reference-data-assets.yaml asset ${asset.assetId} must use storageModel=directory_backed_asset`);
  }
  if (asset.authorityClass === 'design_asset' && asset.generatedModule && !asset.runtimeProjectionAdmission) {
    fail(`reference-data-assets.yaml design_asset ${asset.assetId} must not declare generatedModule without runtimeProjectionAdmission`);
  }
  if (asset.path !== `apps/parentos/data/knowledge/assets/${asset.assetId}/asset.json`) {
    fail(`reference-data-assets.yaml asset ${asset.assetId} path must be directory-backed asset.json`);
  }
  const manifestPath = resolve(REPO_ROOT, asset.path);
  if (!existsSync(manifestPath)) {
    fail(`reference-data-assets.yaml asset ${asset.assetId} path does not exist: ${asset.path}`);
    continue;
  }
  try {
    const knowledgeAsset = loadKnowledgeAsset({
      dataKnowledgeRoot: DATA_KNOWLEDGE,
      assetId: asset.assetId,
      manifestPath,
      registryEntry: asset,
    });
    knowledgeAssetsById.set(asset.assetId, knowledgeAsset);
    assertValidKnowledgeAsset(knowledgeAsset, { requireContractManifest: true });
    assertNoOrphanShards(knowledgeAsset);
  } catch (error) {
    fail(`reference-data-assets.yaml asset ${asset.assetId} failed asset-kernel validation: ${error instanceof Error ? error.message : String(error)}`);
  }
}
for (const [assetId, knowledgeAsset] of knowledgeAssetsById) {
  try {
    assertCrossReferenceIntegrity(knowledgeAsset, knowledgeAssetsById);
  } catch (error) {
    fail(`reference-data-assets.yaml asset ${assetId} failed asset cross-reference validation: ${error instanceof Error ? error.message : String(error)}`);
  }
}
for (const expected of ['growth-standards', 'milestone-catalog', 'sensitive-periods', 'observation-framework', 'ability-model']) {
  if (!referenceAssetIds.has(expected)) {
    fail(`reference-data-assets.yaml is missing required asset ${expected}`);
  }
}
pass(`Validated ${referenceAssetIds.size} reference data assets`);

console.log('\n--- knowledge asset governance ---');
for (const issue of collectKnowledgeAssetGovernanceErrors()) {
  fail(issue);
}
if (errors === 0) {
  pass('Knowledge asset governance gate passed');
}

console.log('\n--- milestone-catalog constraints ---');
const milestoneData = readKnowledgeAsset('milestone-catalog') as {
  milestones?: Array<{
    milestoneId: string;
    typicalAge: { rangeEnd: number };
    alertIfNotBy?: number;
  }>;
};

for (const milestone of milestoneData.milestones ?? []) {
  for (const issue of validateMilestoneThreshold(milestone)) {
    fail(issue);
  }
}
pass(`Validated milestone alert thresholds for ${milestoneData.milestones?.length ?? 0} milestones`);

console.log('\n--- sensitive-periods constraints ---');
const periodData = readKnowledgeAsset('sensitive-periods') as {
  periods?: Array<{
    periodId: string;
    ageRange: { startMonths: number; peakMonths: number; endMonths: number };
  }>;
};

for (const period of periodData.periods ?? []) {
  for (const issue of validateSensitivePeriod(period)) {
    fail(issue);
  }
}
pass(`Validated sensitive period ordering for ${periodData.periods?.length ?? 0} periods`);

console.log('\n--- knowledge-source-readiness.yaml constraints ---');
const readinessData = parseYaml(
  readFileSync(resolve(TABLES, 'knowledge-source-readiness.yaml'), 'utf-8'),
) as {
  sources?: Array<{
    domain: string;
    status: string;
    lastReviewedAt: string | null;
  }>;
};

const seenDomains = new Set<string>();
for (const source of readinessData.sources ?? []) {
  for (const issue of validateKnowledgeSource(source, seenDomains)) {
    fail(issue);
  }
}
pass(`Validated knowledge-source readiness constraints for ${readinessData.sources?.length ?? 0} entries`);

console.log('\n--- growth-standards constraints ---');
const growthData = readKnowledgeAsset('growth-standards') as {
  measurementTypes?: Array<{
    typeId: string;
    ageRange: { startMonths: number; endMonths: number };
    referenceCoverage?: { startMonths: number; endMonths: number };
  }>;
};

for (const measurement of growthData.measurementTypes ?? []) {
  const coverage = measurement.referenceCoverage;
  if (!coverage) {
    continue;
  }

  if (coverage.startMonths < measurement.ageRange.startMonths) {
    fail(`${measurement.typeId}.referenceCoverage.startMonths must be >= ageRange.startMonths`);
  }

  if (coverage.endMonths > measurement.ageRange.endMonths) {
    fail(`${measurement.typeId}.referenceCoverage.endMonths must be <= ageRange.endMonths`);
  }

  if (coverage.startMonths > coverage.endMonths) {
    fail(`${measurement.typeId}.referenceCoverage startMonths must be <= endMonths`);
  }
}
pass(`Validated growth reference coverage for ${growthData.measurementTypes?.length ?? 0} measurement types`);

console.log('\n--- Generation Freshness ---');

const genFiles: Array<{ source: KnowledgeSourceRef; gen: string; root?: string }> = [
  { source: { kind: 'table', file: 'reminder-rules.yaml' }, gen: 'reminder-rules.gen.ts' },
  { source: { kind: 'table', file: 'reminder-rules-extended.yaml' }, gen: 'reminder-rules.gen.ts' },
  { source: { kind: 'data', file: 'milestone-catalog' }, gen: 'milestone-catalog.gen.ts' },
  { source: { kind: 'data', file: 'sensitive-periods' }, gen: 'sensitive-periods.gen.ts' },
  { source: { kind: 'data', file: 'observation-framework' }, gen: 'observation-framework.gen.ts' },
  { source: { kind: 'data', file: 'observation-framework' }, gen: 'observation-vocabulary.gen.rs', root: RUST_GEN },
  { source: { kind: 'data', file: 'growth-standards' }, gen: 'growth-standards.gen.ts' },
  { source: { kind: 'table', file: 'nurture-modes.yaml' }, gen: 'nurture-modes.gen.ts' },
  { source: { kind: 'table', file: 'knowledge-source-readiness.yaml' }, gen: 'knowledge-source-readiness.gen.ts' },
  { source: { kind: 'data', file: 'growth-standards' }, gen: 'knowledge-asset-fingerprints.gen.ts' },
  { source: { kind: 'data', file: 'milestone-catalog' }, gen: 'knowledge-asset-fingerprints.gen.ts' },
  { source: { kind: 'data', file: 'sensitive-periods' }, gen: 'knowledge-asset-fingerprints.gen.ts' },
  { source: { kind: 'data', file: 'observation-framework' }, gen: 'knowledge-asset-fingerprints.gen.ts' },
  { source: { kind: 'data', file: 'ability-model' }, gen: 'knowledge-asset-fingerprints.gen.ts' },
  { source: { kind: 'table', file: 'health-metric-registry.yaml' }, gen: 'health-record.gen.ts' },
  { source: { kind: 'table', file: 'health-evaluation-rules.yaml' }, gen: 'health-record.gen.ts' },
  { source: { kind: 'table', file: 'health-capture-protocols.yaml' }, gen: 'health-record.gen.ts' },
  { source: { kind: 'table', file: 'reminder-capture-targets.yaml' }, gen: 'health-record.gen.ts' },
  { source: { kind: 'table', file: 'growth-milestone-rules.yaml' }, gen: 'growth-milestone-rules.gen.ts' },
];

for (const { source, gen, root } of genFiles) {
  try {
    const sourceMtime = Math.max(...sourcePaths(source).map((path) => statSync(path).mtimeMs));
    const genMtime = statSync(resolve(root ?? GEN, gen)).mtimeMs;
    if (sourceMtime > genMtime) {
      fail(`${gen} is stale (${source.file} modified after generation). Run pnpm generate:knowledge-base`);
    } else {
      pass(`${gen} is up to date`);
    }
  } catch {
    fail(`${gen} does not exist. Run pnpm generate:knowledge-base`);
  }
}

// ── Result ──────────────────────────────────────────────────

console.log(`\n${errors === 0 ? 'All checks passed.' : `${errors} error(s) found.`}\n`);
process.exit(errors > 0 ? 1 : 0);
