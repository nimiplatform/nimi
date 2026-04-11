#!/usr/bin/env node
import path from 'node:path';
import { runNotifyWebhook } from './lib/notification-webhook.mjs';

export async function main(argv = process.argv.slice(2)) {
  const normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv;
  const [topicDir, ...rest] = normalizedArgv;
  if (!topicDir) {
    process.stderr.write(
      'usage: run-notify-webhook <topic-dir> --consumer <consumer-id> --endpoint <url> [--run-id <run-id>] [--header <name:value>]... [--timeout-ms <ms>]\n',
    );
    process.exit(1);
  }

  const options = {
    headerLines: [],
  };
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token === '--consumer') {
      options.consumerId = rest[i + 1];
      i += 1;
      continue;
    }
    if (token === '--endpoint') {
      options.endpoint = rest[i + 1];
      i += 1;
      continue;
    }
    if (token === '--run-id') {
      options.runId = rest[i + 1];
      i += 1;
      continue;
    }
    if (token === '--header') {
      options.headerLines.push(rest[i + 1]);
      i += 1;
      continue;
    }
    if (token === '--timeout-ms') {
      options.timeoutMs = rest[i + 1];
      i += 1;
    }
  }

  if (!options.consumerId || !options.endpoint) {
    process.stderr.write('run-notify-webhook: --consumer and --endpoint are required\n');
    process.exit(1);
  }

  const report = await runNotifyWebhook(path.resolve(topicDir), options);
  for (const warning of report.warnings || []) {
    process.stderr.write(`WARN: ${warning}\n`);
  }
  if (!report.ok) {
    process.stderr.write('run-notify-webhook: REFUSED\n');
    for (const error of report.errors) {
      process.stderr.write(`  ${error}\n`);
    }
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch((error) => {
    process.stderr.write(`run-notify-webhook: ${String(error.message || error)}\n`);
    process.exit(1);
  });
}
