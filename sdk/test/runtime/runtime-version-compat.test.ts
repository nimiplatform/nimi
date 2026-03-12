import assert from 'node:assert/strict';
import test from 'node:test';

import { Runtime, RuntimeMethodIds, setNodeGrpcBridge, type NodeGrpcBridge } from '../../src/runtime/index.js';
import { asNimiError } from '../../src/runtime/errors.js';
import { ReasonCode } from '../../src/types/index.js';
import {
  ExecuteScenarioResponse,
  FinishReason,
  RoutePolicy,
} from '../../src/runtime/generated/runtime/v1/ai';
import { Struct } from '../../src/runtime/generated/google/protobuf/struct.js';

const APP_ID = 'nimi.runtime.version-compat.test';

function installNodeGrpcBridge(bridge: NodeGrpcBridge): void {
  setNodeGrpcBridge(bridge);
}

function clearNodeGrpcBridge(): void {
  setNodeGrpcBridge(null);
}

function createExecuteScenarioResponse(text: string): Uint8Array {
  return ExecuteScenarioResponse.toBinary(
    ExecuteScenarioResponse.create({
      output: Struct.fromJson({ text } as never),
      finishReason: FinishReason.STOP,
      routeDecision: RoutePolicy.LOCAL,
      modelResolved: 'local/test',
      traceId: 'trace-version-compat',
    }),
  );
}

test('Runtime versionCompatibility() exposes unknown state before runtime metadata arrives', () => {
  const runtime = new Runtime({
    appId: APP_ID,
    transport: { type: 'node-grpc', endpoint: '127.0.0.1:46371' },
  });

  assert.deepEqual(runtime.versionCompatibility(), {
    state: 'unknown',
    compatible: true,
    checked: false,
    sdkRuntimeMajor: 0,
    runtimeVersion: null,
    runtimeMajor: null,
    reason: 'metadata_missing',
  });
});

test('Runtime versionCompatibility() exposes structured compatible status after metadata arrives', async () => {
  installNodeGrpcBridge({
    invokeUnary: async (config, input) => {
      if (input.methodId !== RuntimeMethodIds.ai.executeScenario) {
        throw new Error(`unexpected method: ${input.methodId}`);
      }
      config._responseMetadataObserver?.({ 'x-nimi-runtime-version': '0.2.0' });
      return createExecuteScenarioResponse('ok');
    },
    openStream: async () => {
      throw new Error('unexpected stream call');
    },
    closeStream: async () => {},
  });

  try {
    const runtime = new Runtime({
      appId: APP_ID,
      transport: { type: 'node-grpc', endpoint: '127.0.0.1:46371' },
      subjectContext: { subjectUserId: 'version-user' },
    });

    await runtime.ai.text.generate({ model: 'local/test', input: 'hi' });

    assert.deepEqual(runtime.versionCompatibility(), {
      state: 'compatible',
      compatible: true,
      checked: true,
      sdkRuntimeMajor: 0,
      runtimeVersion: '0.2.0',
      runtimeMajor: 0,
    });
  } finally {
    clearNodeGrpcBridge();
  }
});

test('Runtime versionCompatibility() preserves incompatible status after fail-close', async () => {
  installNodeGrpcBridge({
    invokeUnary: async (config, input) => {
      if (input.methodId !== RuntimeMethodIds.ai.executeScenario) {
        throw new Error(`unexpected method: ${input.methodId}`);
      }
      config._responseMetadataObserver?.({ 'x-nimi-runtime-version': '1.0.0' });
      return createExecuteScenarioResponse('never');
    },
    openStream: async () => {
      throw new Error('unexpected stream call');
    },
    closeStream: async () => {},
  });

  try {
    const runtime = new Runtime({
      appId: APP_ID,
      transport: { type: 'node-grpc', endpoint: '127.0.0.1:46371' },
      subjectContext: { subjectUserId: 'version-user' },
    });

    let thrown: unknown = null;
    try {
      await runtime.ai.text.generate({ model: 'local/test', input: 'hi' });
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown);
    assert.equal(
      asNimiError(thrown, { source: 'sdk' }).reasonCode,
      ReasonCode.SDK_RUNTIME_VERSION_INCOMPATIBLE,
    );
    assert.deepEqual(runtime.versionCompatibility(), {
      state: 'incompatible',
      compatible: false,
      checked: true,
      sdkRuntimeMajor: 0,
      runtimeVersion: '1.0.0',
      runtimeMajor: 1,
      reason: 'major_mismatch',
    });
  } finally {
    clearNodeGrpcBridge();
  }
});
