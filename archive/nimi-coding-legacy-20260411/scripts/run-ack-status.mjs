#!/usr/bin/env node
import path from 'node:path';
import { readNotificationCheckpoint } from './lib/notification-checkpoint.mjs';

export function main(argv = process.argv.slice(2)) {
  const normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv;
  const [topicDir, ...rest] = normalizedArgv;
  if (!topicDir) {
    process.stderr.write('usage: run-ack-status <topic-dir> --consumer <consumer-id> [--run-id <run-id>]\n');
    process.exit(1);
  }

  const options = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token === '--consumer') {
      options.consumerId = rest[i + 1];
      i += 1;
      continue;
    }
    if (token === '--run-id') {
      options.runId = rest[i + 1];
      i += 1;
    }
  }
  if (!options.consumerId) {
    process.stderr.write('run-ack-status: --consumer is required\n');
    process.exit(1);
  }

  const report = readNotificationCheckpoint(path.resolve(topicDir), options);
  for (const warning of report.warnings || []) {
    process.stderr.write(`WARN: ${warning}\n`);
  }
  if (!report.ok) {
    process.stderr.write('run-ack-status: REFUSED\n');
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
