#!/usr/bin/env node
import { evaluateAiContextBudget, formatBytes } from './ai-context-budget-core.mjs';

const report = evaluateAiContextBudget();

console.log(`ai-context-budget: config=${report.configPath}`);
console.log(`ai-context-budget: tracked=${report.totalTrackedFiles}, analyzed=${report.analyzedFiles}`);

for (const row of report.warnings) {
  console.warn(
    `WARN: ${row.file} [${row.profile}] lines=${row.lines} bytes=${formatBytes(row.bytes)} ` +
      `(threshold warn lines>=${row.warningLines ?? '-'} bytes>=${row.warningBytes ?? '-'})`,
  );
}

for (const row of report.waivedErrors) {
  const until = row.waiver?.until ? row.waiver.until.toISOString().slice(0, 10) : 'n/a';
  const reason = row.waiver?.reason || 'no reason';
  console.warn(
    `WARN: WAIVED error for ${row.file} [${row.profile}] lines=${row.lines} bytes=${formatBytes(row.bytes)} ` +
      `until=${until} reason=${reason}`,
  );
}

for (const row of report.expiredWaivers) {
  console.error(
    `ERROR: waiver expired for ${row.file} [${row.profile}] ` +
      `(lines=${row.lines} bytes=${formatBytes(row.bytes)})`,
  );
}

for (const row of report.errors) {
  console.error(
    `ERROR: ${row.file} [${row.profile}] lines=${row.lines} bytes=${formatBytes(row.bytes)} ` +
      `(threshold error lines>=${row.errorLines ?? '-'} bytes>=${row.errorBytes ?? '-'})`,
  );
}

if (report.expiredWaivers.length > 0 || report.errors.length > 0) {
  process.exit(1);
}

console.log('ai-context-budget: OK');
