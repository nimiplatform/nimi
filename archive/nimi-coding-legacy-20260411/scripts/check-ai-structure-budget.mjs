#!/usr/bin/env node
import path from 'node:path';
import { evaluateAiStructureBudget } from '../../scripts/ai-structure-budget-core.mjs';

function formatRow(row) {
  if (row.check === 'depth') {
    return `${row.file} [rule=${row.ruleId}] depth=${row.depth} base=${row.depthBase} subject=${row.depthSubject} (threshold warn>=${row.warningDepth} error>=${row.errorDepth})`;
  }
  return `${row.file} [rule=${row.ruleId}] basename=${row.basename} (forwarding shell outside allowed basename set)`;
}

export function main() {
  const report = evaluateAiStructureBudget();

  console.log(`ai-structure-budget: config=${report.configPath}`);
  console.log(`ai-structure-budget: tracked=${report.totalTrackedFiles}, analyzed=${report.analyzedFiles}`);

  for (const row of report.warnings) {
    console.warn(`WARN: ${formatRow(row)}`);
  }
  for (const row of report.waivedErrors) {
    const until = row.waiver?.untilDate ? row.waiver.untilDate.toISOString().slice(0, 10) : 'n/a';
    const reason = row.waiver?.reason || 'no reason';
    console.warn(`WARN: WAIVED error for ${formatRow(row)} until=${until} reason=${reason}`);
  }
  for (const row of report.expiredWaivers) {
    console.error(`ERROR: expired waiver for ${formatRow(row)}`);
  }
  for (const row of report.errors) {
    console.error(`ERROR: ${formatRow(row)}`);
  }
  if (report.errors.length > 0 || report.expiredWaivers.length > 0) {
    process.exit(1);
  }
  console.log('ai-structure-budget: OK');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main();
}
