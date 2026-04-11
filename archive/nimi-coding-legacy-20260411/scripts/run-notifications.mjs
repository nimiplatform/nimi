#!/usr/bin/env node
import path from 'node:path';
import { readNotificationsAfterAck } from './lib/notification-checkpoint.mjs';
import { readNotificationLog } from './lib/notification-log.mjs';

export function main(argv = process.argv.slice(2)) {
  const normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv;
  const [topicDir, ...rest] = normalizedArgv;
  if (!topicDir) {
    process.stderr.write('usage: run-notifications <topic-dir> [--run-id <run-id>] [--after-cursor <n>] [--after-ack <consumer-id>]\n');
    process.exit(1);
  }
  const options = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token === '--run-id') {
      options.runId = rest[i + 1];
      i += 1;
      continue;
    }
    if (token === '--after-cursor') {
      options.afterCursor = rest[i + 1];
      i += 1;
      continue;
    }
    if (token === '--after-ack') {
      options.consumerId = rest[i + 1];
      i += 1;
    }
  }
  if (options.afterCursor !== undefined && options.consumerId) {
    process.stderr.write('run-notifications: --after-cursor and --after-ack cannot be combined\n');
    process.exit(1);
  }
  const report = options.consumerId
    ? readNotificationsAfterAck(path.resolve(topicDir), options)
    : readNotificationLog(path.resolve(topicDir), options);
  for (const warning of report.warnings || []) {
    process.stderr.write(`WARN: ${warning}\n`);
  }
  if (!report.ok) {
    process.stderr.write('run-notifications: REFUSED\n');
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
