#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSyncCommand } from './lib/command-runner.mjs';
import { withWorkspaceSurfaces } from './lib/workspace-surfaces.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const filters = JSON.parse(process.env.WORKSPACE_FILTERS || '[]');
if (!Array.isArray(filters) || filters.length === 0 || filters.some((value) => typeof value !== 'string' || !value)) {
  throw new Error('WORKSPACE_FILTERS must select at least one workspace package');
}
const filterArgs = ['--filter=!@nimiplatform/nimi', ...filters.map((value) => `--filter=${value}`)];

function run(command, args, capture = false) {
  const result = spawnSyncCommand(command, args, {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${result.status}`);
  return result.stdout;
}

const packages = JSON.parse(run('pnpm', ['--silent', '--recursive', ...filterArgs, 'list', '--depth=-1', '--json'], true));
if (packages.length === 0) throw new Error('workspace selection matched no packages');
const names = packages.map((pkg) => pkg.name);
process.stdout.write(`Workspace checks: ${names.join(', ')}\n`);
await withWorkspaceSurfaces({ repoRoot, label: 'selected workspace tests and builds' }, () => {
  run('pnpm', ['--recursive', ...filterArgs, '--if-present', 'test']);
  run('pnpm', ['--recursive', ...filterArgs, '--if-present', 'test:full:prepared']);
  run('pnpm', [
    '--recursive', ...filterArgs,
    '--filter=!@nimiplatform/sdk', '--filter=!@nimiplatform/kit',
    '--if-present', 'build',
  ]);
  if (process.env.SCRIPTS_CHANGED === 'true') run(process.execPath, ['scripts/run-script-tests.mjs']);
  const bundles = ['desktop', 'web', 'lab'].filter((name) => names.includes(`@nimiplatform/${name}`));
  if (bundles.length > 0) run(process.execPath, ['scripts/check-bundle-size.mjs', ...bundles]);
});
