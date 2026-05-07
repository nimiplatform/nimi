#!/usr/bin/env node
import path from 'node:path';
import { evaluateAiContextBudget, formatBytes } from './ai-context-budget-core.mjs';

function formatContextBudgetRow(row, thresholdPrefix) {
  return `${row.file} [${row.profile}] lines=${row.lines} bytes=${formatBytes(row.bytes)} max-line=${formatBytes(row.maxLineBytes)} avg-line=${formatBytes(Math.round(row.averageLineBytes))} `
    + `(${thresholdPrefix} lines>=${row[`${thresholdPrefix}Lines`] ?? '-'} bytes>=${row[`${thresholdPrefix}Bytes`] ?? '-'} max-line>=${row[`${thresholdPrefix}MaxLineBytes`] ?? '-'} avg-line>=${row[`${thresholdPrefix}AverageLineBytes`] ?? '-'})`;
}

export function main() {
  const report = evaluateAiContextBudget();
  console.log(`ai-context-budget: config=${report.configPath}`);
  console.log(`ai-context-budget: tracked=${report.totalTrackedFiles}, analyzed=${report.analyzedFiles}`);

  for (const row of report.warnings) {
    console.warn(`WARN: ${formatContextBudgetRow(row, 'warning')}`);
  }

  for (const row of report.waivedErrors) {
    const until = row.waiver?.until ? row.waiver.until.toISOString().slice(0, 10) : 'n/a';
    const reason = row.waiver?.reason || 'no reason';
    console.warn(`WARN: WAIVED error for ${formatContextBudgetRow(row, 'error')} until=${until} reason=${reason}`);
  }

  for (const row of report.expiredWaivers) {
    console.error(`ERROR: waiver expired for ${formatContextBudgetRow(row, 'error')}`);
  }

  for (const row of report.invalidWaivers) {
    console.error(`ERROR: invalid waiver for ${row.file}: ${row.detail}`);
  }

  for (const row of report.errors) {
    console.error(`ERROR: ${formatContextBudgetRow(row, 'error')}`);
  }

  if (report.invalidWaivers.length > 0 || report.expiredWaivers.length > 0 || report.errors.length > 0) {
    process.exit(1);
  }

  console.log('ai-context-budget: OK');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main();
}
