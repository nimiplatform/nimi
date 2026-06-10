#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withSdkDistLock } from './lib/sdk-dist-lock.mjs';

const PNPM_BIN = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const vnextRoot = path.join(repoRoot, 'sdks', 'typescript');
let tempRoot = '';

function cleanup() {
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function run(label, command, args, options = {}) {
  process.stdout.write(`[check-sdk-vnext-world-consumer-smoke] ${label}\n`);
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${String(result.status ?? 1)}`);
  }
}

function writeConsumerFiles() {
  tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-sdk-vnext-world-consumer-'));
  const packageDir = path.join(tempRoot, 'node_modules', '@nimiplatform');
  mkdirSync(packageDir, { recursive: true });
  symlinkSync(vnextRoot, path.join(packageDir, 'sdk'), 'dir');
  writeFileSync(path.join(tempRoot, 'package.json'), JSON.stringify({ private: true, type: 'module' }, null, 2));

  writeFileSync(path.join(tempRoot, 'consumer.mjs'), `
import assert from 'node:assert/strict';
import { createRealm } from '@nimiplatform/sdk/realm';
import {
  createWorldWorkflowPlan,
  executeWorldWorkflowPlan,
  listWorldsStep,
  mainWorldStep,
  worldDetailWithAgentsStep,
  worldHistoryStep,
  worldSummaryStep,
} from '@nimiplatform/sdk/features/workflow';

let lastRequest;
const calls = [];
const transport = {
  async unary(request) {
    lastRequest = request;
    calls.push(request.methodId);
    if (request.methodId === 'WorldController_listWorlds') return [{ id: 'world-1', status: 'ACTIVE' }];
    if (request.methodId === 'WorldController_getWorldHistory') return { items: [] };
    return { id: 'world-1', methodId: request.methodId };
  },
  async *serverStream() {
    throw new Error('World workflow consumer smoke must not use streaming');
  },
};

const realm = createRealm({ transport });
const plan = createWorldWorkflowPlan({
  planId: 'consumer-world-plan',
  steps: [
    mainWorldStep(),
    worldSummaryStep('world-1'),
    worldDetailWithAgentsStep({ worldId: 'world-1', recommendedAgentLimit: 1 }),
    worldHistoryStep('world-1'),
    listWorldsStep('ACTIVE'),
  ],
});

const result = await executeWorldWorkflowPlan(realm, plan);
assert.deepEqual(calls, [
  'WorldController_getMainWorld',
  'WorldController_getWorld',
  'WorldController_getWorldDetailWithAgents',
  'WorldController_getWorldHistory',
  'WorldController_listWorlds',
]);
assert.equal(result.results.length, 5);
assert.deepEqual(lastRequest.body, { path: {}, query: { status: 'ACTIVE' } });

await assert.rejects(
  import('@nimiplatform/sdk/world'),
  /Package subpath '.\\/world' is not defined/,
);
`);

  writeFileSync(path.join(tempRoot, 'consumer.ts'), `
import { createRealm, type CoreTransport } from '@nimiplatform/sdk/realm';
import {
  createWorldWorkflowPlan,
  executeWorldWorkflowPlan,
  listWorldsStep,
  type WorldWorkflowReadResult,
} from '@nimiplatform/sdk/features/workflow';

const transport: CoreTransport = {
  async unary<Response>() {
    return {} as Response;
  },
  async *serverStream<Response>() {
    yield {} as Response;
  },
};

const plan = createWorldWorkflowPlan({
  planId: 'typed-world-plan',
  steps: [listWorldsStep('ACTIVE')],
});
const result: Promise<{
  readonly events: readonly unknown[];
  readonly results: readonly WorldWorkflowReadResult[];
}> = executeWorldWorkflowPlan(createRealm({ transport }), plan);

void result;
`);

  writeFileSync(path.join(tempRoot, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
    },
    include: ['consumer.ts'],
  }, null, 2));
}

function main() {
  run('building sdks/typescript package', PNPM_BIN, ['--dir', vnextRoot, 'build']);
  writeConsumerFiles();
  run('running package export consumer', 'node', [path.join(tempRoot, 'consumer.mjs')], { cwd: tempRoot });
  run('typechecking package export consumer', PNPM_BIN, [
    '--dir',
    vnextRoot,
    'exec',
    'tsc',
    '-p',
    path.join(tempRoot, 'tsconfig.json'),
  ]);
  process.stdout.write('SDK vNext World/Workflow consumer smoke passed\n');
}

try {
  await withSdkDistLock('check-sdk-vnext-world-consumer-smoke build+consumer', main);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`check-sdk-vnext-world-consumer-smoke failed: ${message}\n`);
  process.exitCode = 1;
} finally {
  cleanup();
}
