/**
 * check-parentos-knowledge-base.ts
 * Validates YAML knowledge base integrity: unique IDs, regex patterns,
 * and generation freshness.
 */

import { readFileSync, statSync } from 'node:fs';
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const TABLES = resolve(ROOT, 'spec/kernel/tables');
const GEN = resolve(ROOT, 'src/shell/renderer/knowledge-base/gen');

let errors = 0;

function fail(msg: string) {
  console.error(`  FAIL: ${msg}`);
  errors++;
}

function pass(msg: string) {
  console.log(`  PASS: ${msg}`);
}

function checkUniqueIds(file: string, key: string, idField: string, pattern: RegExp) {
  console.log(`\n--- ${file} ---`);
  const data = parseYaml(readFileSync(resolve(TABLES, file), 'utf-8')) as Record<string, unknown>;
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

checkUniqueIds('reminder-rules.yaml', 'rules', 'ruleId', /^PO-REM-[A-Z]{3,6}-[0-9]{3}$/);
checkUniqueIds('milestone-catalog.yaml', 'milestones', 'milestoneId', /^PO-MS-[A-Z]{3,5}-[0-9]{3}$/);
checkUniqueIds('sensitive-periods.yaml', 'periods', 'periodId', /^PO-SP-[A-Z]{3,6}-[0-9]{3}$/);

// Observation dimensions
console.log('\n--- observation-framework.yaml ---');
const obsData = parseYaml(
  readFileSync(resolve(TABLES, 'observation-framework.yaml'), 'utf-8'),
) as { dimensions?: Array<{ dimensionId: string }> };

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

for (const rule of reminderData.rules ?? []) {
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

console.log('\n--- milestone-catalog.yaml constraints ---');
const milestoneData = parseYaml(
  readFileSync(resolve(TABLES, 'milestone-catalog.yaml'), 'utf-8'),
) as {
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

console.log('\n--- sensitive-periods.yaml constraints ---');
const periodData = parseYaml(
  readFileSync(resolve(TABLES, 'sensitive-periods.yaml'), 'utf-8'),
) as {
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

console.log('\n--- growth-standards.yaml constraints ---');
const growthData = parseYaml(
  readFileSync(resolve(TABLES, 'growth-standards.yaml'), 'utf-8'),
) as {
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

const genFiles = [
  { yaml: 'reminder-rules.yaml', gen: 'reminder-rules.gen.ts' },
  { yaml: 'milestone-catalog.yaml', gen: 'milestone-catalog.gen.ts' },
  { yaml: 'sensitive-periods.yaml', gen: 'sensitive-periods.gen.ts' },
  { yaml: 'observation-framework.yaml', gen: 'observation-framework.gen.ts' },
  { yaml: 'growth-standards.yaml', gen: 'growth-standards.gen.ts' },
  { yaml: 'nurture-modes.yaml', gen: 'nurture-modes.gen.ts' },
  { yaml: 'knowledge-source-readiness.yaml', gen: 'knowledge-source-readiness.gen.ts' },
];

for (const { yaml, gen } of genFiles) {
  try {
    const yamlMtime = statSync(resolve(TABLES, yaml)).mtimeMs;
    const genMtime = statSync(resolve(GEN, gen)).mtimeMs;
    if (yamlMtime > genMtime) {
      fail(`${gen} is stale (YAML modified after generation). Run pnpm generate:knowledge-base`);
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
