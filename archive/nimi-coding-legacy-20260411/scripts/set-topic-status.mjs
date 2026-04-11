#!/usr/bin/env node
import path from 'node:path';
import { setTopicStatus } from './lib/topic-ops.mjs';

export function main(argv = process.argv.slice(2)) {
  const normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv;
  const [topicDir, status, ...rest] = normalizedArgv;
  if (!topicDir || !status) {
    process.stderr.write('usage: set-topic-status <topic-dir> <status> --reason <text>\n');
    process.exit(1);
  }
  const options = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token === '--reason') {
      options.reason = rest[i + 1];
      i += 1;
    }
  }
  if (!options.reason) {
    process.stderr.write('ERROR: --reason is required\n');
    process.exit(1);
  }
  const absTopicDir = path.resolve(topicDir);
  const report = setTopicStatus(absTopicDir, status, options);
  for (const warning of report.warnings) {
    process.stderr.write(`WARN: ${warning}\n`);
  }
  if (!report.ok) {
    for (const error of report.errors) {
      process.stderr.write(`ERROR: ${error}\n`);
    }
    process.exit(1);
  }
  process.stdout.write(`set-topic-status: OK ${topicDir} -> ${status}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main();
}
