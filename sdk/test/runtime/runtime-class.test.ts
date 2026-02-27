import assert from 'node:assert/strict';
import test from 'node:test';

import {
  asNimiError,
  Runtime,
  RuntimeMethodIds,
  setNodeGrpcBridge,
  type NodeGrpcBridge,
} from '../../src/runtime/index.js';
import { ReasonCode } from '../../src/types/index.js';
import {
  AuthorizeExternalPrincipalRequest,
  AuthorizeExternalPrincipalResponse,
  PolicyMode,
  AuthorizationPreset,
} from '../../src/runtime/generated/runtime/v1/grant';
import {
  FinishReason,
  GenerateRequest,
  GenerateResponse,
  Modal,
  RoutePolicy,
} from '../../src/runtime/generated/runtime/v1/ai';
import { Timestamp } from '../../src/runtime/generated/google/protobuf/timestamp';
import { Struct } from '../../src/runtime/generated/google/protobuf/struct.js';

const APP_ID = 'nimi.runtime.class.test';

function installNodeGrpcBridge(bridge: NodeGrpcBridge): void {
  setNodeGrpcBridge(bridge);
}

function clearNodeGrpcBridge(): void {
  setNodeGrpcBridge(null);
}

test('Runtime auto mode connects lazily and injects subjectUserId from authContext provider', async () => {
  let capturedGenerateRequest: GenerateRequest | null = null;

  installNodeGrpcBridge({
    invokeUnary: async (_config, input) => {
      if (input.methodId === RuntimeMethodIds.ai.generate) {
        capturedGenerateRequest = GenerateRequest.fromBinary(input.request);
        return GenerateResponse.toBinary(
          GenerateResponse.create({
            output: Struct.fromJson({ text: 'hello from runtime class' } as never),
            finishReason: FinishReason.STOP,
            routeDecision: RoutePolicy.LOCAL_RUNTIME,
            modelResolved: 'local/qwen2.5',
            traceId: 'trace-runtime-class',
          }),
        );
      }
      throw new Error(`unexpected method: ${input.methodId}`);
    },
    openStream: async () => {
      throw new Error('unexpected stream call');
    },
    closeStream: async () => {},
  });

  try {
    const runtime = new Runtime({
      appId: APP_ID,
      transport: {
        type: 'node-grpc',
        endpoint: '127.0.0.1:46371',
      },
      authContext: {
        getSubjectUserId: async () => 'user-from-provider',
      },
    });

    const output = await runtime.ai.text.generate({
      model: 'local/qwen2.5',
      input: 'hello',
    });

    assert.equal(output.text, 'hello from runtime class');
    assert.equal(output.trace.traceId, 'trace-runtime-class');
    assert.ok(capturedGenerateRequest);
    assert.equal(capturedGenerateRequest?.appId, APP_ID);
    assert.equal(capturedGenerateRequest?.subjectUserId, 'user-from-provider');
    assert.equal(capturedGenerateRequest?.modal, Modal.TEXT);
    assert.equal(runtime.state().status, 'ready');

    await runtime.close();
    assert.equal(runtime.state().status, 'closed');
  } finally {
    clearNodeGrpcBridge();
  }
});

test('Runtime auto mode retries retryable runtime errors with configured backoff', async () => {
  let generateCalls = 0;
  let disconnectedEvents = 0;
  let connectedEvents = 0;

  installNodeGrpcBridge({
    invokeUnary: async (_config, input) => {
      if (input.methodId === RuntimeMethodIds.ai.generate) {
        generateCalls += 1;

        if (generateCalls === 1) {
          throw {
            reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
            actionHint: 'retry_or_check_runtime_daemon',
            retryable: true,
            message: 'runtime daemon restarting',
          };
        }

        return GenerateResponse.toBinary(
          GenerateResponse.create({
            output: Struct.fromJson({ text: 'retry-ok' } as never),
            finishReason: FinishReason.STOP,
            routeDecision: RoutePolicy.LOCAL_RUNTIME,
            modelResolved: 'local/qwen2.5',
            traceId: 'trace-runtime-retry',
          }),
        );
      }

      throw new Error(`unexpected method: ${input.methodId}`);
    },
    openStream: async () => {
      throw new Error('unexpected stream call');
    },
    closeStream: async () => {},
  });

  try {
    const runtime = new Runtime({
      appId: APP_ID,
      transport: {
        type: 'node-grpc',
        endpoint: '127.0.0.1:46371',
      },
      retry: {
        maxAttempts: 2,
        backoffMs: 1,
      },
      authContext: {
        subjectUserId: 'retry-user',
      },
    });

    runtime.events.on('runtime.disconnected', () => {
      disconnectedEvents += 1;
    });
    runtime.events.on('runtime.connected', () => {
      connectedEvents += 1;
    });

    const output = await runtime.ai.text.generate({
      model: 'local/qwen2.5',
      input: 'retry once',
    });

    assert.equal(output.text, 'retry-ok');
    assert.equal(generateCalls, 2);
    assert.equal(disconnectedEvents, 1);
    assert.equal(connectedEvents, 2);
  } finally {
    clearNodeGrpcBridge();
  }
});

test('Runtime auto mode does not retry non-retryable runtime errors', async () => {
  let generateCalls = 0;

  installNodeGrpcBridge({
    invokeUnary: async (_config, input) => {
      if (input.methodId === RuntimeMethodIds.ai.generate) {
        generateCalls += 1;
        throw {
          reasonCode: ReasonCode.ACTION_INPUT_INVALID,
          actionHint: 'fix_request_payload',
          retryable: false,
          message: 'input validation failed',
        };
      }
      throw new Error(`unexpected method: ${input.methodId}`);
    },
    openStream: async () => {
      throw new Error('unexpected stream call');
    },
    closeStream: async () => {},
  });

  try {
    const runtime = new Runtime({
      appId: APP_ID,
      transport: {
        type: 'node-grpc',
        endpoint: '127.0.0.1:46371',
      },
      retry: {
        maxAttempts: 3,
        backoffMs: 1,
      },
      authContext: {
        subjectUserId: 'retry-user',
      },
    });

    let thrown: unknown = null;
    try {
      await runtime.ai.text.generate({
        model: 'local/qwen2.5',
        input: 'no retry',
      });
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown);
    const nimiError = asNimiError(thrown, { source: 'runtime' });
    assert.equal(nimiError.reasonCode, ReasonCode.ACTION_INPUT_INVALID);
    assert.equal(generateCalls, 1);
  } finally {
    clearNodeGrpcBridge();
  }
});

test('Runtime manual mode requires explicit connect before API calls', async () => {
  const runtime = new Runtime({
    appId: APP_ID,
    connection: {
      mode: 'manual',
    },
    transport: {
      type: 'node-grpc',
      endpoint: '127.0.0.1:46371',
    },
    authContext: {
      subjectUserId: 'manual-user',
    },
  });

  let thrown: unknown = null;
  try {
    await runtime.ai.text.generate({
      model: 'local/qwen2.5',
      input: 'hello',
    });
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown);
  const nimiError = asNimiError(thrown, { source: 'sdk' });
  assert.equal(nimiError.reasonCode, 'RUNTIME_UNAVAILABLE');
});

test('Runtime appAuth.authorizeExternalPrincipal resolves published scopeCatalogVersion', async () => {
  let capturedScopeCatalogVersion = '';

  installNodeGrpcBridge({
    invokeUnary: async (_config, input) => {
      if (input.methodId === RuntimeMethodIds.appAuth.authorizeExternalPrincipal) {
        const request = AuthorizeExternalPrincipalRequest.fromBinary(input.request);
        capturedScopeCatalogVersion = request.scopeCatalogVersion;

        return AuthorizeExternalPrincipalResponse.toBinary(
          AuthorizeExternalPrincipalResponse.create({
            tokenId: 'token-runtime-class',
            appId: APP_ID,
            subjectUserId: 'scope-user-1',
            externalPrincipalId: 'external-principal-1',
            effectiveScopes: [`app.${APP_ID}.chat.read`],
            policyVersion: '1.0.0',
            issuedScopeCatalogVersion: '1.0.0',
            canDelegate: false,
            secret: 'secret-runtime-class',
          }),
        );
      }
      throw new Error(`unexpected method: ${input.methodId}`);
    },
    openStream: async () => {
      throw new Error('unexpected stream call');
    },
    closeStream: async () => {},
  });

  try {
    const runtime = new Runtime({
      appId: APP_ID,
      transport: {
        type: 'node-grpc',
        endpoint: '127.0.0.1:46371',
      },
    });

    await runtime.scope.register({
      manifestVersion: '1.0.0',
      scopes: [`app.${APP_ID}.chat.read`],
    });
    await runtime.scope.publish();

    await runtime.appAuth.authorizeExternalPrincipal({
      domain: 'app-auth',
      appId: APP_ID,
      externalPrincipalId: 'external-principal-1',
      externalPrincipalType: 2,
      subjectUserId: 'scope-user-1',
      consentId: 'consent-1',
      consentVersion: '1.0',
      decisionAt: Timestamp.create({ seconds: '1700000000', nanos: 0 }),
      policyVersion: '1.0.0',
      policyMode: PolicyMode.PRESET,
      preset: AuthorizationPreset.READ_ONLY,
      scopes: [`app.${APP_ID}.chat.read`],
      resourceSelectors: undefined,
      canDelegate: false,
      maxDelegationDepth: 0,
      ttlSeconds: 3600,
      scopeCatalogVersion: '',
      policyOverride: false,
    });

    assert.equal(capturedScopeCatalogVersion, '1.0.0');
  } finally {
    clearNodeGrpcBridge();
  }
});
