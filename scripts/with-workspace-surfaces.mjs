#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSyncCommand } from './lib/command-runner.mjs';
import { withWorkspaceSurfaces } from './lib/workspace-surfaces.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

function parseCommand(argv) {
  const separator = argv.indexOf('--');
  const command = separator >= 0 ? argv.slice(separator + 1) : argv;
  if (command.length === 0) {
    throw new Error('usage: node scripts/with-workspace-surfaces.mjs -- <command> [...args]');
  }
  return command;
}

try {
  const [command, ...args] = parseCommand(process.argv.slice(2));
  const status = await withWorkspaceSurfaces({
    repoRoot,
    label: `workspace surfaces: ${[command, ...args].join(' ')}`,
  }, () => {
    const result = spawnSyncCommand(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    return result.status ?? 1;
  });
  process.exitCode = status;
} catch (error) {
  process.stderr.write(`[with-workspace-surfaces] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
