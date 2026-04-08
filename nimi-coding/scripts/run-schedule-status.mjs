#!/usr/bin/env node
import path from 'node:path';
import { runScheduleStatus } from './lib/scheduler-foreground.mjs';

export function main(argv = process.argv.slice(2)) {
  const normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv;
  const [topicDir] = normalizedArgv;
  if (!topicDir) {
    process.stderr.write('usage: run-schedule-status <topic-dir>\n');
    process.exit(1);
  }
  const report = runScheduleStatus(path.resolve(topicDir));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main();
}
