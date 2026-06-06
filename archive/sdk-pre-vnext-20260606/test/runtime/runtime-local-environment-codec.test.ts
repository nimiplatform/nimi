import assert from 'node:assert/strict';
import test from 'node:test';
import { createRuntimeClient } from '../../src/runtime/core/client';
import {
  ResolveLocalEnvironmentPlanRequest,
  ResolveLocalEnvironmentPlanResponse,
} from '../../src/runtime/generated/runtime/v1/local_runtime';
import { RuntimeMethodIds } from '../../src/runtime/method-ids';
import type {
  RuntimeUnaryCall,
  RuntimeWireMessage,
} from '../../src/runtime/types';
import {
  clearNodeGrpcBridge,
  installNodeGrpcBridge,
  runtimeConfig,
} from './runtime-client-fixtures.js';

test('resolveLocalEnvironmentPlan preserves installLevel in the wire request', async () => {
  let captured: RuntimeUnaryCall<RuntimeWireMessage> | null = null;
  installNodeGrpcBridge({
    invokeUnary: async (_config, input) => {
      captured = input;
      return ResolveLocalEnvironmentPlanResponse.toBinary(
        ResolveLocalEnvironmentPlanResponse.create({}),
      );
    },
    openStream: async () => ({
      async *[Symbol.asyncIterator]() {
        yield new Uint8Array(0);
      },
    }),
    closeStream: async () => {},
  });

  try {
    const client = createRuntimeClient(runtimeConfig);
    await client.local.resolveLocalEnvironmentPlan({
      packId: 'local-speech',
      consumerScope: 'first-run',
      runtimeDataRoot: 'runtime-data-root',
      installLevel: 'minimal',
    });

    assert.ok(captured);
    assert.equal(captured.methodId, RuntimeMethodIds.local.resolveLocalEnvironmentPlan);
    const decoded = ResolveLocalEnvironmentPlanRequest.fromBinary(captured.request);
    assert.equal(decoded.packId, 'local-speech');
    assert.equal(decoded.consumerScope, 'first-run');
    assert.equal(decoded.runtimeDataRoot, 'runtime-data-root');
    assert.equal(decoded.installLevel, 'minimal');
  } finally {
    clearNodeGrpcBridge();
  }
});
