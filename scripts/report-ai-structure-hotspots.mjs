#!/usr/bin/env node
import { evaluateAiStructureBudget } from './ai-structure-budget-core.mjs';

function parseLimit(argv) {
  const defaultLimit = 80;
  const index = argv.findIndex((item) => item === '--limit');
  if (index === -1) {
    return defaultLimit;
  }
  const parsed = Number.parseInt(argv[index + 1] ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultLimit;
  }
  return parsed;
}

const limit = parseLimit(process.argv.slice(2));
const report = evaluateAiStructureBudget();

console.log('# AI Structure Hotspots');
console.log('');
console.log(`- Config: \`${report.configPath}\``);
console.log(`- Tracked files: ${report.totalTrackedFiles}`);
console.log(`- Analyzed files: ${report.analyzedFiles}`);
console.log(`- Warning count: ${report.warnings.length}`);
console.log(`- Error count: ${report.errors.length}`);
console.log(`- Waived errors: ${report.waivedErrors.length}`);
console.log('');
console.log('| Severity | Check | Value | Budget | Base | Subject | File | Waiver |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');

let printed = 0;
for (const row of report.rows) {
  if (printed >= limit) {
    break;
  }
  const value = row.check === 'depth' ? String(row.depth) : row.basename;
  const budget = row.check === 'depth'
    ? `warn>=${row.warningDepth}, error>=${row.errorDepth}`
    : 'allowed basenames only';
  const base = row.check === 'depth' ? `\`${row.depthBase}\`` : '-';
  const subject = row.check === 'depth' ? `\`${row.depthSubject}\`` : '-';
  const waiver = row.waiver
    ? `${row.waiver.untilDate ? row.waiver.untilDate.toISOString().slice(0, 10) : 'n/a'}`
    : 'no';
  console.log(`| ${row.severity} | ${row.check} | ${value} | ${budget} | ${base} | ${subject} | \`${row.file}\` | ${waiver} |`);
  printed += 1;
}

if (printed === 0) {
  console.log('| - | - | - | - | - | - | - | - |');
}
