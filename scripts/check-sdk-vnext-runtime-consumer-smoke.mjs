#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { linkWorkspacePackage } from './lib/sdk-consumer-link.mjs';
import { isSdkDistPrepared, withSdkDistLock } from './lib/sdk-dist-lock.mjs';

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
  process.stdout.write(`[check-sdk-vnext-runtime-consumer-smoke] ${label}\n`);
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
  tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-sdk-vnext-runtime-consumer-'));
  const packageDir = path.join(tempRoot, 'node_modules', '@nimiplatform');
  mkdirSync(packageDir, { recursive: true });
  linkWorkspacePackage(vnextRoot, path.join(packageDir, 'sdk'));

  writeFileSync(path.join(tempRoot, 'package.json'), JSON.stringify({
    private: true,
    type: 'module',
  }, null, 2));

  writeFileSync(path.join(tempRoot, 'consumer.mjs'), `
import assert from 'node:assert/strict';
import * as runtimeModule from '@nimiplatform/sdk/runtime';
import {
  NIMI_FIRST_RUN_PHASES,
  Runtime,
  RUNTIME_AI_METHODS,
  buildRuntimeAgentRequestContext,
  createRuntime,
  projectRuntimeLocalAgentIdentity,
} from '@nimiplatform/sdk/runtime';
import {
  RuntimeHealthStatus,
} from '@nimiplatform/sdk/runtime/generated';
import {
  ScenarioType,
} from '@nimiplatform/sdk/runtime/wire-types';
import {
  asNimiError,
  createNimiError,
  isNimiError,
} from '@nimiplatform/sdk/types';

let lastUnaryRequest;
const transport = {
  async unary(request) {
    lastUnaryRequest = request;
    request.responseMetadataObserver?.({ 'x-nimi-runtime-version': '0.6.0' });
    assert.equal(request.methodId, '/nimi.runtime.v1.RuntimeAiService/ListScenarioProfiles');
    return { profiles: [] };
  },
  async *serverStream(request) {
    request.responseMetadataObserver?.({ 'x-nimi-runtime-version': '0.6.0' });
    yield { methodId: request.methodId };
  },
};

const runtime = createRuntime({ appId: 'consumer.app', transport });
assert(runtime instanceof Runtime);
assert.equal('createRuntimeNodeGrpcTransport' in runtimeModule, false);
assert.equal('createRuntimeTauriIpcTransport' in runtimeModule, false);
const nodeGrpcRuntime = createRuntime({
  appId: 'consumer.app',
  transport: {
    type: 'node-grpc',
    endpoint: '127.0.0.1:46371',
    bridge: {
      async unary(request) {
        assert.equal(request.endpoint, '127.0.0.1:46371');
        assert.equal(request.methodId, '/nimi.runtime.v1.RuntimeAiService/ListScenarioProfiles');
        return new Uint8Array();
      },
      async *serverStream() {
        throw new Error('unexpected node-grpc bridge stream');
      },
    },
  },
});
assert.deepEqual(await nodeGrpcRuntime.ai.listScenarioProfiles({}), { profiles: [] });
assert.equal(RUNTIME_AI_METHODS.includes('executeScenario'), true);
assert.equal(ScenarioType.TEXT_GENERATE, 1);
assert.deepEqual([...NIMI_FIRST_RUN_PHASES], ['storage']);
assert.equal('generate' in runtime, false);
assert.equal('stream' in runtime, false);
assert.deepEqual(projectRuntimeLocalAgentIdentity({
  ownerUserId: 'user-1',
  runtimeSourceRef: 'agent-1',
  localAgentRef: 'local-agent:runtime-owned-1',
}), {
  ownerUserId: 'user-1',
  runtimeSourceRef: 'agent-1',
  localAgentRef: 'local-agent:runtime-owned-1',
});
assert.equal(buildRuntimeAgentRequestContext({
  runtimeAppId: 'consumer.app',
  subjectUserId: 'user-1',
  ownerUserId: 'user-1',
  runtimeSourceRef: 'agent-1',
  localAgentRef: 'local-agent:runtime-owned-1',
}).appId, 'consumer.app');
for (const operation of [() => runtime.health(), () => runtime.ready(), () => nodeGrpcRuntime.ready()]) {
  await assert.rejects(operation, {
    reasonCode: 'SDK_RUNTIME_METHOD_UNAVAILABLE',
    actionHint: 'use_admitted_protected_runtime_carrier',
  });
}
assert.equal(lastUnaryRequest, undefined);
assert.deepEqual(await runtime.ai.listScenarioProfiles({}, { metadata: { traceId: 'trace-consumer' } }), { profiles: [] });
assert.equal(lastUnaryRequest.metadata.appId, 'consumer.app');
assert.equal(lastUnaryRequest.metadata.traceId, 'trace-consumer');
assert.equal(runtime.runtimeVersion(), '0.6.0');
assert.equal(runtime.versionCompatibility().state, 'compatible');

const hostRuntime = createRuntime({
  hostOwnedIdentity: true,
  transport: {
    async unary(request) {
      assert.equal(request.methodId, '/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth');
      assert.equal(request.metadata.traceId, 'trace-machine');
      return { status: RuntimeHealthStatus.READY };
    },
    async *serverStream() {},
  },
});
assert.equal((await hostRuntime.ready({ metadata: { traceId: 'trace-machine' } })).status, RuntimeHealthStatus.READY);
assert.equal('RuntimeCore' in runtimeModule, false);
assert.equal('core' in runtime, false);
assert.equal(Object.getPrototypeOf(runtime.generated), null);
assert.equal(Object.isFrozen(runtime.generated), true);
for (const privateMethod of [
  'createSourceMaterializationChallenge',
  'beginSourceMaterializationUpload',
  'putSourceMaterializationChunk',
  'commitSourceMaterialization',
  'abortSourceMaterializationUpload',
]) {
  assert.equal(privateMethod in runtime.generated, false);
}

const localError = createNimiError({
  message: 'provider timeout',
  reasonCode: 'AI_PROVIDER_TIMEOUT',
  actionHint: 'retry',
  traceId: 'trace-error',
  retryable: true,
});
assert.equal(isNimiError(localError), true);
assert.equal(localError.reasonCode, 'AI_PROVIDER_TIMEOUT');

const projected = asNimiError({
  message: 'remote failure',
  reason_code: 'RUNTIME_UNAVAILABLE',
  action_hint: 'start_runtime',
  trace_id: 'trace-remote',
  retryable: true,
});
assert.equal(projected.reasonCode, 'RUNTIME_UNAVAILABLE');
assert.equal(projected.actionHint, 'start_runtime');
assert.equal(projected.traceId, 'trace-remote');
assert.equal(projected.retryable, true);

const incompatible = createRuntime({
  appId: 'consumer.app',
  transport: {
    async unary(request) {
      request.responseMetadataObserver?.({ 'x-nimi-runtime-version': '1.0.0' });
      return { profiles: [] };
    },
    async *serverStream() {},
  },
});
await assert.rejects(
  () => incompatible.ai.listScenarioProfiles({}),
  (error) => isNimiError(error) && error.reasonCode === 'SDK_RUNTIME_VERSION_INCOMPATIBLE',
);

await assert.rejects(
  () => runtime.generated.uploadArtifact({}),
  (error) => error?.code === 'SDK_RUNTIME_METHOD_UNAVAILABLE',
);
`);

  writeFileSync(path.join(tempRoot, 'consumer.ts'), `
import {
  NIMI_FIRST_RUN_PHASES,
  Runtime,
  buildRuntimeAgentRequestContext,
  createRuntime,
  type CoreTransport,
  type RuntimeLocalAgentIdentityProjection,
  type RuntimeVersionCompatibilityStatus,
} from '@nimiplatform/sdk/runtime';
import {
  type GetRuntimeHealthResponse,
} from '@nimiplatform/sdk/runtime/generated';
import {
  ScenarioType,
  type ExecuteScenarioRequest,
} from '@nimiplatform/sdk/runtime/wire-types';
import {
  createNimiError,
  type NimiError,
} from '@nimiplatform/sdk/types';

const transport: CoreTransport = {
  async unary<Response>() {
    return { profiles: [] } as Response;
  },
  async *serverStream<Response>() {
    yield { profiles: [] } as Response;
  },
};

const runtime: Runtime = createRuntime({
  appId: 'consumer.app',
  transport,
});
const compatibility: RuntimeVersionCompatibilityStatus = runtime.versionCompatibility();
const hostRuntime = createRuntime({ hostOwnedIdentity: true, transport });
const health: Promise<GetRuntimeHealthResponse> = hostRuntime.ready();
const localIdentity: RuntimeLocalAgentIdentityProjection = buildRuntimeAgentRequestContext({
  runtimeAppId: 'consumer.app',
  subjectUserId: 'user-1',
  ownerUserId: 'user-1',
  runtimeSourceRef: 'agent-1',
  localAgentRef: 'local-agent:runtime-owned-1',
});
const error: NimiError = createNimiError({
  message: 'timeout',
  reasonCode: 'AI_PROVIDER_TIMEOUT',
  actionHint: 'retry',
});
const scenarioRequest: Partial<ExecuteScenarioRequest> = { scenarioType: ScenarioType.TEXT_GENERATE };
// @ts-expect-error Runtime does not expose its raw CoreClient.
runtime.core;
// @ts-expect-error Source materialization acquisition is Runtime-private.
runtime.generated.createSourceMaterializationChallenge({});

void compatibility;
void health;
void localIdentity;
void NIMI_FIRST_RUN_PHASES;
void error;
void scenarioRequest;
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
  if (!isSdkDistPrepared()) {
    run('building sdks/typescript package', PNPM_BIN, ['--dir', vnextRoot, 'build']);
  }
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
  process.stdout.write('SDK vNext Runtime consumer smoke passed\n');
}

try {
  await withSdkDistLock('check-sdk-vnext-runtime-consumer-smoke build+consumer', main);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`check-sdk-vnext-runtime-consumer-smoke failed: ${message}\n`);
  process.exitCode = 1;
} finally {
  cleanup();
}
