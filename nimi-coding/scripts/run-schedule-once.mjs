#!/usr/bin/env node
import path from 'node:path';
import { runScheduleOnce } from './lib/scheduler-foreground.mjs';

export function main(argv = process.argv.slice(2)) {
  const normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv;
  const [topicDir, ...rest] = normalizedArgv;
  if (!topicDir) {
    process.stderr.write('usage: run-schedule-once <topic-dir> [--timeout-ms <ms>] [--max-steps <n>] [--lease-ttl-ms <ms>] [--lease-holder <id>]\n');
    process.exit(1);
  }
  const options = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token === '--timeout-ms') {
      options.timeoutMs = Number(rest[i + 1]);
      i += 1;
    } else if (token === '--max-steps') {
      options.maxSteps = Number(rest[i + 1]);
      i += 1;
    } else if (token === '--lease-ttl-ms') {
      options.leaseTtlMs = Number(rest[i + 1]);
      i += 1;
    } else if (token === '--lease-holder') {
      options.leaseHolderId = rest[i + 1];
      i += 1;
    }
  }
  const report = runScheduleOnce(path.resolve(topicDir), options);
  for (const warning of report.warnings || []) {
    process.stderr.write(`WARN: ${warning}\n`);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) {
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main();
}
