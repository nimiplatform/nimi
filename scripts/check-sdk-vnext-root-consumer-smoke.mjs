#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { linkWorkspacePackage } from './lib/sdk-consumer-link.mjs';
import { withSdkDistLock } from './lib/sdk-dist-lock.mjs';

const PNPM_BIN = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const vnextRoot = path.join(repoRoot, 'sdks', 'typescript');
let tempRoot = '';

function cleanup() {
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
}

function run(label, command, args, options = {}) {
  process.stdout.write(`[check-sdk-vnext-root-consumer-smoke] ${label}\n`);
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
  tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-sdk-vnext-root-consumer-'));
  const packageDir = path.join(tempRoot, 'node_modules', '@nimiplatform');
  mkdirSync(packageDir, { recursive: true });
  linkWorkspacePackage(vnextRoot, path.join(packageDir, 'sdk'));
  writeFileSync(path.join(tempRoot, 'package.json'), JSON.stringify({ private: true, type: 'module' }, null, 2));

  writeFileSync(path.join(tempRoot, 'consumer.mjs'), `
import assert from 'node:assert/strict';
import * as sdk from '@nimiplatform/sdk';

assert.equal(typeof sdk.createNimiClient, 'function');
assert.equal(typeof sdk.NimiClient, 'function');
assert.equal('createPlatformClient' in sdk, false);
assert.equal('getPlatformClient' in sdk, false);
assert.equal('clearPlatformClient' in sdk, false);

const calls = [];
const transport = {
  async unary(request) {
    calls.push(request);
    request.responseMetadataObserver?.({ 'x-nimi-runtime-version': '0.6.0' });
    if (request.methodId.endsWith('/GetRuntimeHealth')) return { status: 3 };
    if (request.methodId.endsWith('/ExecuteScenario')) {
      return {
        output: { output: { oneofKind: 'textGenerate', textGenerate: { text: 'consumer root text' } } },
        finishReason: 1,
        usage: { inputTokens: '1', outputTokens: '2', computeMs: '3' },
        routeDecision: 1,
        modelResolved: 'root-model',
        traceId: 'trace-root-consumer',
        ignoredExtensions: [],
      };
    }
    throw new Error('unexpected method ' + request.methodId);
  },
  async *serverStream() {},
};

const realmCalls = [];
const realmTransport = {
  async unary(request) {
    realmCalls.push(request.methodId);
    if (request.methodId === 'listMyAppPermissionGrants') {
      return {
        items: [{
          grantId: 'grant-1',
          subjectAccountId: 'account-1',
          appId: 'tester.app',
          scopeFamily: 'account',
          scopeName: 'account.read',
          state: 'GRANTED',
          reason: 'root consumer smoke',
          version: 1,
          requestedAt: '2026-06-10T00:00:00.000Z',
          requestedByAccountId: 'account-1',
        }],
      };
    }
    throw new Error('unexpected realm method ' + request.methodId);
  },
  async *serverStream() {},
};

const client = sdk.createNimiClient({ appId: 'dev.nimi.consumer', runtime: { transport } });
assert(client instanceof sdk.NimiClient);
assert.equal((await client.runtime.ready()).status, 3);
assert.equal(client.runtime.runtimeVersion(), '0.6.0');
assert.equal(client.requireScopes().listCatalog().appId, 'dev.nimi.consumer');

const model = client.ai.createRuntimeModel({
  model: { providerId: 'runtime', modelId: 'root-model' },
  targetRef: { kind: 'local-runtime', version: 'v2', readinessRef: 'root-model' },
});
const generated = await model.generateText({
  model: model.model,
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
});
assert.equal(generated.text, 'consumer root text');
assert.equal(calls.some((call) => call.methodId.endsWith('/ExecuteScenario')), true);

assert.throws(
  () => client.requireRealm(),
  (error) => sdk.isNimiError(error) && error.reasonCode === 'SDK_CLIENT_REALM_REQUIRED',
);

const realmClient = sdk.createNimiClient({
  appId: 'tester.app',
  runtime: { transport },
  realm: { transport: realmTransport },
});
const grants = await realmClient.requirePermissions().list({ kind: 'app', ownerId: 'tester.app' });
assert.equal(grants[0]?.state, 'granted');
assert.deepEqual(realmCalls, ['listMyAppPermissionGrants']);
`);

  writeFileSync(path.join(tempRoot, 'consumer.ts'), `
import {
  NimiClient,
  createNimiClient,
  type NimiClientConfig,
} from '@nimiplatform/sdk';
import type { CoreTransport } from '@nimiplatform/sdk/runtime';

const transport: CoreTransport = {
  async unary<Response>() {
    return { status: 3 } as Response;
  },
  async *serverStream<Response>() {
    yield { status: 3 } as Response;
  },
};
const realmTransport: CoreTransport = {
  async unary<Response>() {
    return { items: [] } as Response;
  },
  async *serverStream<Response>() {
    yield { items: [] } as Response;
  },
};

const config: NimiClientConfig = {
  appId: 'dev.nimi.consumer',
  runtime: { transport },
};
const client: NimiClient = createNimiClient(config);
client.ai.createRuntimeModel({
  model: { providerId: 'runtime', modelId: 'root-model' },
  targetRef: { kind: 'local-runtime', version: 'v2', readinessRef: 'root-model' },
});
client.features.generation.createRuntimeClient({
  head: { modelId: 'root-model' },
});
client.features.knowledge.createRuntimeContextClient({});
client.requireScopes().listCatalog();
const realmClient: NimiClient = createNimiClient({
  appId: 'tester.app',
  runtime: { transport },
  realm: { transport: realmTransport },
});
realmClient.requirePermissions().list({ kind: 'app', ownerId: 'tester.app' });
`);
}

function main() {
  run('build sdks/typescript', PNPM_BIN, ['--dir', vnextRoot, 'run', 'build']);
  writeConsumerFiles();
  run('execute root consumer', 'node', [path.join(tempRoot, 'consumer.mjs')]);
  run('typecheck root declarations', PNPM_BIN, [
    '--dir',
    vnextRoot,
    'exec',
    'tsc',
    '--module',
    'NodeNext',
    '--moduleResolution',
    'NodeNext',
    '--target',
    'ES2022',
    '--strict',
    '--skipLibCheck',
    '--noEmit',
    path.join(tempRoot, 'consumer.ts'),
  ]);
  process.stdout.write('SDK vNext root consumer smoke passed\n');
}

try {
  await withSdkDistLock('check-sdk-vnext-root-consumer-smoke build+consumer', main);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`check-sdk-vnext-root-consumer-smoke failed: ${message}\n`);
  process.exitCode = 1;
} finally {
  cleanup();
}
