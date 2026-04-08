#!/usr/bin/env node
import path from 'node:path';
import { validateWorkerOutput } from './lib/validators.mjs';

export function main(argv = process.argv.slice(2)) {
  const normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv;
  const [filePath] = normalizedArgv;
  if (!filePath) {
    process.stderr.write('usage: validate-worker-output <path>\n');
    process.exit(1);
  }
  const report = validateWorkerOutput(path.resolve(filePath));
  for (const warning of report.warnings) {
    process.stderr.write(`WARN: ${warning}\n`);
  }
  if (!report.ok) {
    for (const error of report.errors) {
      process.stderr.write(`ERROR: ${error}\n`);
    }
    process.exit(1);
  }
  process.stdout.write(`validate-worker-output: OK ${filePath}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main();
}
