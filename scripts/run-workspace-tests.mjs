#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSyncCommand } from './lib/command-runner.mjs';
import { withSdkDistLock } from './lib/sdk-dist-lock.mjs';
import { checkTestTopology, loadTestPolicy } from './lib/test-topology-governance.mjs';
import { WORKSPACE_SURFACES_PREPARED_ENV } from './lib/workspace-surfaces.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const workspaceLane = 'workspace_regression';

function parseSimpleCommand(source, suiteId) {
  const command = String(source || '').trim();
  if (!command || /["'`;&|<>\\]/u.test(command)) {
    throw new Error(`${suiteId}: workspace command must be an unquoted, shell-free argv sequence`);
  }
  return command.split(/\s+/u);
}

function runSuite(suite, env) {
  const [command, ...args] = parseSimpleCommand(suite.command, suite.id);
  const cwd = path.resolve(repoRoot, suite.cwd || '.');
  process.stdout.write(`\n[workspace-tests] ${suite.id}: ${suite.command}\n`);
  const result = spawnSyncCommand(command, args, { cwd, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if ((result.status ?? 1) !== 0) {
    throw new Error(`${suite.id} failed with status ${result.status ?? 1}`);
  }
}

const topology = checkTestTopology({ repoRoot });
if (!topology.ok) {
  for (const error of topology.errors) process.stderr.write(`[workspace-tests] topology: ${error}\n`);
  process.exit(1);
}

const suites = loadTestPolicy(repoRoot).suites
  .filter((suite) => suite.lane === workspaceLane)
  .sort((left, right) => left.workspace_order - right.workspace_order);
const requiredSurfaces = new Set(suites.flatMap((suite) => suite.requires_workspace_surfaces ?? []));

try {
  await withSdkDistLock('workspace regression', () => {
    const provided = new Set();
    for (const suite of suites) {
      const missing = (suite.requires_workspace_surfaces ?? []).filter((surface) => !provided.has(surface));
      if (missing.length > 0) throw new Error(`${suite.id} is missing workspace surfaces: ${missing.join(', ')}`);

      const prepared = [...requiredSurfaces].every((surface) => provided.has(surface));
      const env = { ...process.env };
      if (prepared) env[WORKSPACE_SURFACES_PREPARED_ENV] = '1';
      else delete env[WORKSPACE_SURFACES_PREPARED_ENV];
      runSuite(suite, env);
      for (const surface of suite.provides_workspace_surfaces ?? []) provided.add(surface);
    }
  });
  process.stdout.write(`\n[workspace-tests] PASS: ${suites.length} suites / ${topology.totalFiles} governed test sources\n`);
} catch (error) {
  process.stderr.write(`[workspace-tests] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
