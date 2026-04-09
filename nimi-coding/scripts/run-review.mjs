#!/usr/bin/env node
import path from 'node:path';
import { runReview } from './lib/continuous-delivery.mjs';

export function main(argv = process.argv.slice(2)) {
  const normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv;
  const [topicDir, ...rest] = normalizedArgv;
  if (!topicDir) {
    process.stderr.write('usage: run-review <topic-dir> --worker-output <topic-local-path> --acceptance <topic-local-path> --disposition <complete|partial|deferred> [--evidence <topic-local-path>]... [--awaiting-human-action <action>] [--defer-reason <reason>]\n');
    process.exit(1);
  }
  const options = {
    evidenceRefs: [],
  };
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token === '--worker-output') {
      options.workerOutput = rest[i + 1];
      i += 1;
    } else if (token === '--acceptance') {
      options.acceptance = rest[i + 1];
      i += 1;
    } else if (token === '--disposition') {
      options.disposition = rest[i + 1];
      i += 1;
    } else if (token === '--evidence') {
      options.evidenceRefs.push(rest[i + 1]);
      i += 1;
    } else if (token === '--awaiting-human-action') {
      options.awaitingHumanAction = rest[i + 1];
      i += 1;
    } else if (token === '--defer-reason') {
      options.deferReason = rest[i + 1];
      i += 1;
    }
  }
  const report = runReview(path.resolve(topicDir), options);
  for (const warning of report.warnings || []) {
    process.stderr.write(`WARN: ${warning}\n`);
  }
  if (!report.ok) {
    process.stderr.write('run-review: REFUSED\n');
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
