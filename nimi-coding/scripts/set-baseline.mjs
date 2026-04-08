#!/usr/bin/env node
import path from 'node:path';
import { setBaseline } from './lib/topic-ops.mjs';

export function main(argv = process.argv.slice(2)) {
  const normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv;
  const [topicDir, ...rest] = normalizedArgv;
  if (!topicDir) {
    process.stderr.write('usage: set-baseline <topic-dir> <baseline-rel-path> | set-baseline <topic-dir> --clear\n');
    process.exit(1);
  }
  const clear = rest.includes('--clear');
  const baselineRelPath = clear ? null : rest.find((arg) => !arg.startsWith('--'));
  if (!clear && !baselineRelPath) {
    process.stderr.write('ERROR: provide <baseline-rel-path> or --clear\n');
    process.exit(1);
  }
  const absTopicDir = path.resolve(topicDir);
  const report = setBaseline(absTopicDir, baselineRelPath);
  for (const warning of report.warnings) {
    process.stderr.write(`WARN: ${warning}\n`);
  }
  if (!report.ok) {
    for (const error of report.errors) {
      process.stderr.write(`ERROR: ${error}\n`);
    }
    process.exit(1);
  }
  const label = baselineRelPath || '(cleared)';
  process.stdout.write(`set-baseline: OK ${topicDir} -> ${label}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main();
}
