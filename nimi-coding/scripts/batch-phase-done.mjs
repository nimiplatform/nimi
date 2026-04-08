#!/usr/bin/env node
import path from 'node:path';
import { batchPhaseDone } from './lib/batch-delivery.mjs';

export function main(argv = process.argv.slice(2)) {
  const normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv;
  const [topicDir, ...rest] = normalizedArgv;
  if (!topicDir) {
    process.stderr.write('usage: batch-phase-done <topic-dir> --phase <name> --disposition <complete|partial|deferred> --acceptance <rel-path> [--evidence <rel-path>]\n');
    process.exit(1);
  }
  const options = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token === '--phase') {
      options.phase = rest[i + 1];
      i += 1;
    } else if (token === '--disposition') {
      options.disposition = rest[i + 1];
      i += 1;
    } else if (token === '--acceptance') {
      options.acceptance = rest[i + 1];
      i += 1;
    } else if (token === '--evidence') {
      options.evidence = rest[i + 1];
      i += 1;
    }
  }
  const report = batchPhaseDone(path.resolve(topicDir), options);
  for (const warning of report.warnings) {
    process.stderr.write(`WARN: ${warning}\n`);
  }
  if (!report.ok) {
    process.stderr.write('batch-phase-done: REFUSED\n');
    for (const error of report.errors) {
      process.stderr.write(`  ${error}\n`);
    }
    process.exit(1);
  }
  process.stdout.write(`batch-phase-done: OK phase=${report.phase} disposition=${report.disposition}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main();
}
