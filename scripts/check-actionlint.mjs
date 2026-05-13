#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const ACTIONLINT_VERSION = 'v1.7.11';
const ACTIONLINT_PACKAGE = `github.com/rhysd/actionlint/cmd/actionlint@${ACTIONLINT_VERSION}`;

function commandExists(command, args = ['--version']) {
  const result = spawnSync(command, args, { stdio: 'ignore' });
  return result.status === 0;
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) {
    process.stderr.write(`[check-actionlint] failed to start ${command}: ${result.error.message}\n`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

if (commandExists('actionlint', ['-version'])) {
  process.stdout.write('[check-actionlint] using installed actionlint\n');
  run('actionlint', ['-color']);
}

if (!commandExists('go', ['version'])) {
  process.stderr.write(
    '[check-actionlint] actionlint is not installed and Go is unavailable; install Go or actionlint.\n',
  );
  process.exit(1);
}

process.stdout.write(`[check-actionlint] using go run ${ACTIONLINT_PACKAGE}\n`);
run('go', ['run', ACTIONLINT_PACKAGE, '-color']);
