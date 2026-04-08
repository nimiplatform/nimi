#!/usr/bin/env node
import path from 'node:path';
import { validateWorkerOutput } from './lib/validators.mjs';

function buildCliReport(filePath, report) {
  return {
    contract: 'validator-cli-result.v1',
    validator: 'validate-worker-output',
    target_ref: filePath,
    ok: Boolean(report.ok),
    refusal: report.refusal || null,
    errors: report.errors || [],
    warnings: report.warnings || [],
    signal: report.signal || null,
  };
}

export function main(argv = process.argv.slice(2)) {
  const normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv;
  const [filePath] = normalizedArgv;
  if (!filePath) {
    process.stderr.write('usage: validate-worker-output <path>\n');
    process.exit(1);
  }
  const targetPath = path.resolve(filePath);
  const report = validateWorkerOutput(targetPath);
  const cliReport = buildCliReport(targetPath, report);
  process.stdout.write(`${JSON.stringify(cliReport, null, 2)}\n`);
  if (!report.ok) {
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main();
}
