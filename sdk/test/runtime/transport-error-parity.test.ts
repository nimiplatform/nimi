import assert from 'node:assert/strict';
import test from 'node:test';

import { asNimiError } from '../../src/runtime/errors.js';
import { createNodeGrpcTransport, setNodeGrpcBridge } from '../../src/runtime/transports/node-grpc.js';
import { createTauriIpcTransport } from '../../src/runtime/transports/tauri-ipc.js';
import { ReasonCode } from '../../src/types/index.js';
import { installTauriRuntime, type TauriRuntime } from './runtime-client-fixtures.js';

const STRUCTURED_ERROR = JSON.stringify({
  message: 'provider unavailable',
  reasonCode: ReasonCode.AI_PROVIDER_UNAVAILABLE,
  actionHint: 'retry_after_backoff',
  traceId: 'trace-transport-parity',
  retryable: true,
});

async function captureNodeGrpcError() {
  setNodeGrpcBridge({
    invokeUnary: async () => {
      throw STRUCTURED_ERROR;
    },
    openStream: async () => {
      throw new Error('unexpected stream call');
    },
    closeStream: async () => {},
  });

  try {
    const transport = createNodeGrpcTransport({
      type: 'node-grpc',
      endpoint: '127.0.0.1:46371',
    });
    await transport.invokeUnary({
      methodId: 'runtime.test/unary',
      request: new Uint8Array(0),
      metadata: {},
    });
    throw new Error('expected node-grpc transport to fail');
  } catch (error) {
    return asNimiError(error, { source: 'runtime' });
  } finally {
    setNodeGrpcBridge(null);
  }
}

async function captureTauriError() {
  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async () => {
        throw STRUCTURED_ERROR;
      },
    },
    event: {
      listen: async () => () => {},
    },
  } satisfies TauriRuntime);

  try {
    const transport = createTauriIpcTransport({
      type: 'tauri-ipc',
    });
    await transport.invokeUnary({
      methodId: 'runtime.test/unary',
      request: new Uint8Array(0),
      metadata: {},
    });
    throw new Error('expected tauri transport to fail');
  } catch (error) {
    return asNimiError(error, { source: 'runtime' });
  } finally {
    restoreTauri();
  }
}

test('node-grpc and tauri-ipc produce the same NimiError shape for the same upstream error', async () => {
  const [nodeError, tauriError] = await Promise.all([
    captureNodeGrpcError(),
    captureTauriError(),
  ]);

  assert.deepEqual(
    {
      message: nodeError.message,
      reasonCode: nodeError.reasonCode,
      actionHint: nodeError.actionHint,
      traceId: nodeError.traceId,
      retryable: nodeError.retryable,
    },
    {
      message: tauriError.message,
      reasonCode: tauriError.reasonCode,
      actionHint: tauriError.actionHint,
      traceId: tauriError.traceId,
      retryable: tauriError.retryable,
    },
  );
});
