#!/usr/bin/env node
import path from 'node:path';
import { buildCodexAutomationSetup } from './lib/scheduler-automation-setup.mjs';

export function main(argv = process.argv.slice(2)) {
  const normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv;
  const [topicDir] = normalizedArgv;
  if (!topicDir) {
    process.stderr.write('usage: run-schedule-codex-setup <topic-dir>\n');
    process.exit(1);
  }
  const report = buildCodexAutomationSetup(path.resolve(topicDir));
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
