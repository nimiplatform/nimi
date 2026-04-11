#!/usr/bin/env node
import { evaluateAiStructureBudget } from '../../scripts/ai-structure-budget-core.mjs';

function parseLimit(argv) {
  const defaultLimit = 80;
  const normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv;
  const index = normalizedArgv.findIndex((item) => item === '--limit');
  if (index === -1) {
    return defaultLimit;
  }
  const parsed = Number.parseInt(normalizedArgv[index + 1] ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultLimit;
  }
  return parsed;
}

export function main(argv = process.argv.slice(2)) {
  const limit = parseLimit(argv);
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
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  main();
}
