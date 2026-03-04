#!/usr/bin/env node
import { evaluateAiContextBudget, formatBytes } from './ai-context-budget-core.mjs';

function parseLimit(argv) {
  const defaultLimit = 80;
  const index = argv.findIndex((item) => item === '--limit');
  if (index === -1) {
    return defaultLimit;
  }
  const raw = argv[index + 1];
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultLimit;
  }
  return parsed;
}

const limit = parseLimit(process.argv.slice(2));
const report = evaluateAiContextBudget();

console.log(`# AI Hotspots`);
console.log('');
console.log(`- Config: \`${report.configPath}\``);
console.log(`- Tracked files: ${report.totalTrackedFiles}`);
console.log(`- Analyzed files: ${report.analyzedFiles}`);
console.log(`- Warning count: ${report.warnings.length}`);
console.log(`- Error count: ${report.errors.length}`);
console.log(`- Waived errors: ${report.waivedErrors.length}`);
console.log('');
console.log('| Severity | Profile | Lines | Size | File | Waiver |');
console.log('| --- | --- | ---: | ---: | --- | --- |');

let printed = 0;
for (const row of report.rows) {
  if (row.severity === 'none') {
    continue;
  }
  if (printed >= limit) {
    break;
  }
  const waiver = row.waived
    ? `yes (${row.waiver?.until ? row.waiver.until.toISOString().slice(0, 10) : 'n/a'})`
    : row.waiverExpired
      ? 'expired'
      : 'no';
  console.log(
    `| ${row.severity} | ${row.profile} | ${row.lines} | ${formatBytes(row.bytes)} | \`${row.file}\` | ${waiver} |`,
  );
  printed += 1;
}

if (printed === 0) {
  console.log('| - | - | - | - | - | - |');
}
