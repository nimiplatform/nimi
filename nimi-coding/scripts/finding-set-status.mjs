#!/usr/bin/env node
import path from 'node:path';
import { setFindingStatus } from './lib/topic-ops.mjs';

export function main(argv = process.argv.slice(2)) {
  const normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv;
  const [topicDir, findingId, status, ...rest] = normalizedArgv;
  if (!topicDir || !findingId || !status) {
    process.stderr.write('usage: finding-set-status <topic-dir> <finding-id> <status> [--reason <text>] [--evidence-ref <rel>] [--superseded-by <id>]\n');
    process.exit(1);
  }
  const options = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token === '--reason') {
      options.reason = rest[i + 1];
      i += 1;
    } else if (token === '--evidence-ref') {
      options.evidenceRef = rest[i + 1];
      i += 1;
    } else if (token === '--superseded-by') {
      options.supersededBy = rest[i + 1];
      i += 1;
    } else if (token === '--baseline-ref') {
      options.baselineRef = rest[i + 1];
      i += 1;
    } else if (token === '--protocol-ref') {
      options.protocolRef = rest[i + 1];
      i += 1;
    }
  }
  const absTopicDir = path.resolve(topicDir);
  const report = setFindingStatus(absTopicDir, findingId, status, options);
  for (const warning of report.warnings) {
    process.stderr.write(`WARN: ${warning}\n`);
  }
  if (!report.ok) {
    for (const error of report.errors) {
      process.stderr.write(`ERROR: ${error}\n`);
    }
    process.exit(1);
  }
  process.stdout.write(`finding-set-status: OK ${findingId} -> ${status}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main();
}
