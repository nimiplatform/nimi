import assert from 'node:assert/strict';
import test from 'node:test';
import { ReasonCode } from '../../src/types/index.js';
import { asNimiError, isNimiError } from '../../src/runtime/errors';
import { createRuntimeClient } from '../../src/runtime/core/client';
import { mergeRuntimeMetadata } from '../../src/runtime/core/metadata';
import { ListModelsResponse } from '../../src/runtime/generated/runtime/v1/model';
import {
  runtimeConfig,
  installNodeGrpcBridge,
  clearNodeGrpcBridge,
  installTauriRuntime,
} from './runtime-client-fixtures.js';

test('mergeRuntimeMetadata applies defaults and per-call overrides', () => {
  const metadata = mergeRuntimeMetadata(
    {
      appId: 'nimi.desktop.test',
      transport: {
        type: 'node-grpc',
        endpoint: '127.0.0.1:46371',
      },
      defaults: {
        protocolVersion: '1.2.3',
        participantProtocolVersion: '1.2.4',
        participantId: 'desktop:core',
        callerKind: 'desktop-core',
        callerId: 'app:nimi.desktop',
        surfaceId: 'renderer',
      },
    },
    {
      idempotencyKey: 'idem-1',
      metadata: {
        domain: 'runtime.test',
        traceId: 'trace-meta',
        extra: {
          'x-nimi-test': 'yes',
        },
      },
    },
  );

  assert.equal(metadata.protocolVersion, '1.2.3');
  assert.equal(metadata.participantProtocolVersion, '1.2.4');
  assert.equal(metadata.participantId, 'desktop:core');
  assert.equal(metadata.callerKind, 'desktop-core');
  assert.equal(metadata.callerId, 'app:nimi.desktop');
  assert.equal(metadata.surfaceId, 'renderer');
  assert.equal(metadata.domain, 'runtime.test');
  assert.equal(metadata.traceId, 'trace-meta');
  assert.equal(metadata.idempotencyKey, 'idem-1');
  assert.deepEqual(metadata.extra, { 'x-nimi-test': 'yes' });
});

test('asNimiError parses embedded runtime JSON payload', () => {
  const error = asNimiError(
    JSON.stringify({
      reasonCode: ReasonCode.AI_PROVIDER_TIMEOUT,
      actionHint: 'retry',
      traceId: 'trace-json',
      retryable: true,
      message: 'provider timeout',
      details: {
        provider: 'media',
        rawReasonCode: 'UPSTREAM_504',
      },
    }),
    { source: 'runtime' },
  );

  assert.equal(error.reasonCode, 'AI_PROVIDER_TIMEOUT');
  assert.equal(error.code, 'AI_PROVIDER_TIMEOUT');
  assert.equal(error.actionHint, 'retry');
  assert.equal(error.traceId, 'trace-json');
  assert.equal(error.retryable, true);
  assert.equal(error.source, 'runtime');
  assert.equal(error.message, 'provider timeout');
  assert.deepEqual(error.details, {
    provider: 'media',
    rawReasonCode: 'UPSTREAM_504',
  });
});

test('asNimiError keeps provided defaults for plain Error objects', () => {
  const error = asNimiError(new Error('permission denied'), {
    reasonCode: ReasonCode.RUNTIME_GRPC_PERMISSION_DENIED,
    actionHint: 'check_request_and_app_auth',
    source: 'runtime',
  });

  assert.equal(error.reasonCode, 'RUNTIME_GRPC_PERMISSION_DENIED');
  assert.equal(error.code, 'RUNTIME_GRPC_PERMISSION_DENIED');
  assert.equal(error.actionHint, 'check_request_and_app_auth');
  assert.equal(error.source, 'runtime');
  assert.equal(error.message, 'permission denied');
});

test('isNimiError detects structured sdk/runtime errors', () => {
  const normalized = asNimiError(
    JSON.stringify({
      reasonCode: ReasonCode.AI_PROVIDER_TIMEOUT,
      actionHint: 'retry',
      traceId: 'trace-123',
      retryable: true,
      message: 'timeout',
    }),
    { source: 'runtime' },
  );

  assert.equal(isNimiError(normalized), true);
  assert.equal(isNimiError(new Error('plain error')), false);
});

test('node-grpc and tauri-ipc unary transports decode equivalent payloads', async () => {
  installNodeGrpcBridge({
    invokeUnary: async () => ListModelsResponse.toBinary(
      ListModelsResponse.create({
        models: [{
          modelId: 'llama3',
          provider: 'local',
          modal: [],
        }],
      }),
    ),
    openStream: async () => {
      return {
        async *[Symbol.asyncIterator]() {
          yield new Uint8Array(0);
        },
      };
    },
    closeStream: async () => {},
  });

  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async (command: string) => {
        if (command !== 'runtime_bridge_unary') {
          throw new Error(`unexpected tauri command: ${command}`);
        }
        return {
          responseBytesBase64: Buffer.from(
            ListModelsResponse.toBinary(
              ListModelsResponse.create({
                models: [{
                  modelId: 'llama3',
                  provider: 'local',
                  modal: [],
                }],
              }),
            ),
          ).toString('base64'),
        };
      },
    },
    event: {
      listen: () => () => {},
    },
  });

  try {
    const nodeClient = createRuntimeClient({
      ...runtimeConfig,
      transport: {
        type: 'node-grpc',
        endpoint: '127.0.0.1:46371',
      },
    });
    const tauriClient = createRuntimeClient({
      ...runtimeConfig,
      transport: {
        type: 'tauri-ipc',
        commandNamespace: 'runtime_bridge',
        eventNamespace: 'runtime_bridge',
      },
    });

    const nodeResponse = await nodeClient.model.list({});
    const tauriResponse = await tauriClient.model.list({});

    assert.deepEqual(tauriResponse, nodeResponse);
  } finally {
    restoreTauri();
    clearNodeGrpcBridge();
  }
});

// ---------------------------------------------------------------------------
// S-TRANSPORT-006: observability metadata must not leak credentials
// ---------------------------------------------------------------------------
test('mergeRuntimeMetadata does not propagate raw credentials into metadata output', () => {
  const metadata = mergeRuntimeMetadata(
    {
      appId: 'nimi.test.cred-redact',
      transport: {
        type: 'node-grpc',
        endpoint: '127.0.0.1:46371',
      },
      auth: {
        accessToken: 'SECRET_ACCESS_TOKEN',
      },
      defaults: {
        protocolVersion: '1.0.0',
        callerKind: 'sdk-test',
        callerId: 'test:cred-redact',
      },
    },
    {
      metadata: {
        domain: 'transport.test',
        traceId: 'trace-cred-redact',
      },
    },
  );

  const serialized = JSON.stringify(metadata);
  assert.equal(serialized.includes('SECRET_ACCESS_TOKEN'), false,
    'metadata output must not contain raw access token');
  assert.equal(metadata.traceId, 'trace-cred-redact');
  assert.equal(metadata.domain, 'transport.test');
});
