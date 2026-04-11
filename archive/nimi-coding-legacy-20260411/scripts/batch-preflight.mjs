#!/usr/bin/env node
import path from 'node:path';
import { batchPreflight } from './lib/batch-delivery.mjs';

export function main(argv = process.argv.slice(2)) {
  const normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv;
  const [topicDir] = normalizedArgv;
  if (!topicDir) {
    process.stderr.write('usage: batch-preflight <topic-dir>\n');
    process.exit(1);
  }
  const report = batchPreflight(path.resolve(topicDir));
  for (const warning of report.warnings) {
    process.stderr.write(`WARN: ${warning}\n`);
  }
  if (!report.ok) {
    process.stderr.write('batch-preflight: REFUSED\n');
    for (const error of report.errors) {
      process.stderr.write(`  ${error}\n`);
    }
    process.exit(1);
  }
  process.stdout.write(`batch-preflight: PASS ${topicDir} packet=${report.packet_id} entry_phase=${report.entry_phase_id} phases=${report.phase_count}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main();
}
