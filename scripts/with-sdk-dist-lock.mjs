#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { withSdkDistLock } from './lib/sdk-dist-lock.mjs';

function parseCommand(argv) {
  const separatorIndex = argv.indexOf('--');
  const command = separatorIndex >= 0 ? argv.slice(separatorIndex + 1) : argv;
  if (command.length === 0) {
    throw new Error('usage: node scripts/with-sdk-dist-lock.mjs -- <command> [...args]');
  }
  return command;
}

try {
  const [command, ...args] = parseCommand(process.argv.slice(2));
  const status = await withSdkDistLock(`command: ${[command, ...args].join(' ')}`, () => {
    const result = spawnSync(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    if (result.error) {
      throw result.error;
    }
    return result.status ?? 1;
  });
  process.exitCode = status;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[with-sdk-dist-lock] failed: ${message}\n`);
  process.exit(1);
}
