#!/usr/bin/env node
import path from 'node:path';
import { runStatus } from './lib/continuous-delivery.mjs';

export function main(argv = process.argv.slice(2)) {
  const normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv;
  const [topicDir] = normalizedArgv;
  if (!topicDir) {
    process.stderr.write('usage: run-status <topic-dir>\n');
    process.exit(1);
  }
  const report = runStatus(path.resolve(topicDir));
  for (const warning of report.warnings || []) {
    process.stderr.write(`WARN: ${warning}\n`);
  }
  if (!report.ok) {
    process.stderr.write('run-status: REFUSED\n');
    for (const error of report.errors) {
      process.stderr.write(`  ${error}\n`);
    }
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main();
}
