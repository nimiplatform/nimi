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
  NIMI_FIRST_RUN_MATERIALIZATION_CONSUMER_SCOPE,
  NIMI_FIRST_RUN_PHASES,
  Runtime,
  RuntimeCore,
  RUNTIME_AI_METHODS,
  buildRuntimeAgentRequestContext,
  createRuntime,
  createRuntimeTauriIpcTransport,
  productStateForNimiFirstRunMaterializationStatus,
  projectRuntimeLocalAgentIdentity,
} from '@nimiplatform/sdk/runtime';
import {
  RuntimeHealthStatus,
} from '@nimiplatform/sdk/runtime/generated';
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
    assert.equal(request.methodId, '/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth');
    return { status: 3 };
  },
  async *serverStream(request) {
    request.responseMetadataObserver?.({ 'x-nimi-runtime-version': '0.6.0' });
    yield { methodId: request.methodId };
  },
};

const runtime = createRuntime({ appId: 'consumer.app', transport });
assert(runtime instanceof Runtime);
assert.equal('createRuntimeNodeGrpcTransport' in runtimeModule, false);
assert.equal(typeof createRuntimeTauriIpcTransport, 'function');
const nodeGrpcRuntime = createRuntime({
  appId: 'consumer.app',
  transport: {
    type: 'node-grpc',
    endpoint: '127.0.0.1:46371',
    bridge: {
      async unary(request) {
        assert.equal(request.endpoint, '127.0.0.1:46371');
        assert.equal(request.methodId, '/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth');
        return Uint8Array.from([8, RuntimeHealthStatus.READY]);
      },
      async *serverStream() {
        throw new Error('unexpected node-grpc bridge stream');
      },
    },
  },
});
assert.equal((await nodeGrpcRuntime.ready()).status, RuntimeHealthStatus.READY);
assert.equal(RUNTIME_AI_METHODS.includes('executeScenario'), true);
assert.equal(NIMI_FIRST_RUN_MATERIALIZATION_CONSUMER_SCOPE, 'first-run');
assert.deepEqual([...NIMI_FIRST_RUN_PHASES], ['storage', 'device-scan', 'local-ai', 'setup']);
assert.equal(
  productStateForNimiFirstRunMaterializationStatus('failed'),
  'local_ai_profile_selected_environment_not_ready',
);
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
const health = await runtime.ready({ metadata: { traceId: 'trace-consumer' } });
assert.equal(health.status, 3);
assert.equal(lastUnaryRequest.metadata.appId, 'consumer.app');
assert.equal(lastUnaryRequest.metadata.traceId, 'trace-consumer');
assert.equal(runtime.runtimeVersion(), '0.6.0');
assert.equal(runtime.versionCompatibility().state, 'compatible');

const core = new RuntimeCore(runtime.core);
const coreHealth = await core.unary({
  methodId: '/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth',
  body: {},
});
assert.equal(coreHealth.status, 3);

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
      return { status: 3 };
    },
    async *serverStream() {},
  },
});
await assert.rejects(
  () => incompatible.ready(),
  (error) => isNimiError(error) && error.reasonCode === 'SDK_RUNTIME_VERSION_INCOMPATIBLE',
);

await assert.rejects(
  () => runtime.generated.uploadArtifact({}),
  (error) => error?.code === 'SDK_RUNTIME_METHOD_UNAVAILABLE',
);
`);

  writeFileSync(path.join(tempRoot, 'consumer.ts'), `
import {
  NIMI_FIRST_RUN_MATERIALIZATION_CONSUMER_SCOPE,
  NIMI_FIRST_RUN_PHASES,
  Runtime,
  RuntimeCore,
  buildRuntimeAgentRequestContext,
  createRuntime,
  type CoreTransport,
  type NimiFirstRunMaterializationProjection,
  type RuntimeLocalAgentIdentityProjection,
  type RuntimeVersionCompatibilityStatus,
} from '@nimiplatform/sdk/runtime';
import {
  type GetRuntimeHealthResponse,
} from '@nimiplatform/sdk/runtime/generated';
import {
  createNimiError,
  type NimiError,
} from '@nimiplatform/sdk/types';

const transport: CoreTransport = {
  async unary<Response>() {
    return { status: 3 } as Response;
  },
  async *serverStream<Response>() {
    yield { status: 3 } as Response;
  },
};

const runtime: Runtime = createRuntime({
  appId: 'consumer.app',
  transport,
});
const core: RuntimeCore = new RuntimeCore(runtime.core);
const compatibility: RuntimeVersionCompatibilityStatus = runtime.versionCompatibility();
const health: Promise<GetRuntimeHealthResponse> = runtime.ready();
const localIdentity: RuntimeLocalAgentIdentityProjection = buildRuntimeAgentRequestContext({
  runtimeAppId: 'consumer.app',
  subjectUserId: 'user-1',
  ownerUserId: 'user-1',
  runtimeSourceRef: 'agent-1',
  localAgentRef: 'local-agent:runtime-owned-1',
});
const firstRunMaterialization: NimiFirstRunMaterializationProjection = {
  status: 'local_ai_ready',
  productState: 'local_ai_ready',
  reason: 'runtime_local_ai_ready_evidence_projected',
  missingDependencyFamilies: [],
  dependencies: [],
};
const error: NimiError = createNimiError({
  message: 'timeout',
  reasonCode: 'AI_PROVIDER_TIMEOUT',
  actionHint: 'retry',
});

void core;
void compatibility;
void health;
void localIdentity;
void firstRunMaterialization;
void NIMI_FIRST_RUN_MATERIALIZATION_CONSUMER_SCOPE;
void NIMI_FIRST_RUN_PHASES;
void error;
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
