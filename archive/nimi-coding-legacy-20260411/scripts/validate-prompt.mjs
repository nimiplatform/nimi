#!/usr/bin/env node
import path from 'node:path';
import { validatePrompt } from './lib/validators.mjs';

function buildCliReport(filePath, report) {
  return {
    contract: 'validator-cli-result.v1',
    validator: 'validate-prompt',
    target_ref: filePath,
    ok: Boolean(report.ok),
    errors: report.errors || [],
    warnings: report.warnings || [],
  };
}

export function main(argv = process.argv.slice(2)) {
  const normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv;
  const [filePath] = normalizedArgv;
  if (!filePath) {
    process.stderr.write('usage: validate-prompt <path>\n');
    process.exit(1);
  }
  const targetPath = path.resolve(filePath);
  const report = validatePrompt(targetPath);
  const cliReport = buildCliReport(targetPath, report);
  process.stdout.write(`${JSON.stringify(cliReport, null, 2)}\n`);
  if (!report.ok) {
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main();
}
