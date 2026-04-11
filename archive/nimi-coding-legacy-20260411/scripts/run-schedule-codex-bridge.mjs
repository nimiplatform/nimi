#!/usr/bin/env node
import path from 'node:path';
import { bridgeCodexAutomationForTopic } from './lib/scheduler-automation-bridge.mjs';

export function main(argv = process.argv.slice(2)) {
  const normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv;
  const [topicDir, ...rest] = normalizedArgv;
  if (!topicDir) {
    process.stderr.write('usage: run-schedule-codex-bridge <topic-dir> [--codex-home <path>] [--rrule <rrule>] [--status <ACTIVE|PAUSED>] [--name <name>] [--model <model>] [--reasoning-effort <effort>] [--execution-environment <local|worktree>]\n');
    process.exit(1);
  }

  const upsertOptions = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token === '--codex-home') {
      upsertOptions.codexHome = rest[i + 1];
      i += 1;
    } else if (token === '--rrule') {
      upsertOptions.rrule = rest[i + 1];
      i += 1;
    } else if (token === '--status') {
      upsertOptions.status = rest[i + 1];
      i += 1;
    } else if (token === '--name') {
      upsertOptions.name = rest[i + 1];
      i += 1;
    } else if (token === '--model') {
      upsertOptions.model = rest[i + 1];
      i += 1;
    } else if (token === '--reasoning-effort') {
      upsertOptions.reasoningEffort = rest[i + 1];
      i += 1;
    } else if (token === '--execution-environment') {
      upsertOptions.executionEnvironment = rest[i + 1];
      i += 1;
    }
  }

  const report = bridgeCodexAutomationForTopic(path.resolve(topicDir), {
    upsertOptions,
  });
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
