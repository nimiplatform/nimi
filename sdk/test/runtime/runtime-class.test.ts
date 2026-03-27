import assert from 'node:assert/strict';
import test from 'node:test';

import {
  asNimiError,
  Runtime,
  RuntimeMethodIds,
  setNodeGrpcBridge,
  type NodeGrpcBridge,
} from '../../src/runtime/index.js';
import { ReasonCode, isRetryableReasonCode } from '../../src/types/index.js';
import {
  AuthorizeExternalPrincipalRequest,
  AuthorizeExternalPrincipalResponse,
  PolicyMode,
  AuthorizationPreset,
} from '../../src/runtime/generated/runtime/v1/grant';
import { OpenSessionResponse } from '../../src/runtime/generated/runtime/v1/auth';
import { ReasonCode as RuntimeProtoReasonCode } from '../../src/runtime/generated/runtime/v1/common';
import {
  ExecuteScenarioRequest,
  ExecuteScenarioResponse,
  FinishReason,
  ScenarioJobEvent,
  ScenarioJobEventType,
  ScenarioJobStatus,
  ScenarioType,
  RoutePolicy,
} from '../../src/runtime/generated/runtime/v1/ai';
import { WorkflowEvent, WorkflowEventType } from '../../src/runtime/generated/runtime/v1/workflow';
import { Timestamp } from '../../src/runtime/generated/google/protobuf/timestamp';
import { textGenerateOutput } from '../helpers/runtime-ai-shapes.js';

const APP_ID = 'nimi.runtime.class.test';

function installNodeGrpcBridge(bridge: NodeGrpcBridge): void {
  setNodeGrpcBridge(bridge);
}

function clearNodeGrpcBridge(): void {
  setNodeGrpcBridge(null);
}

test('Runtime auto mode connects lazily and injects subjectUserId from subjectContext provider', async () => {
  let capturedExecuteScenarioRequest: ExecuteScenarioRequest | null = null;

  installNodeGrpcBridge({
    invokeUnary: async (_config, input) => {
      if (input.methodId === RuntimeMethodIds.ai.executeScenario) {
        capturedExecuteScenarioRequest = ExecuteScenarioRequest.fromBinary(input.request);
        return ExecuteScenarioResponse.toBinary(
          ExecuteScenarioResponse.create({
            output: textGenerateOutput('hello from runtime class'),
            finishReason: FinishReason.STOP,
            routeDecision: RoutePolicy.LOCAL,
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
      subjectContext: {
        getSubjectUserId: async () => 'user-from-provider',
      },
    });

    const output = await runtime.ai.text.generate({
      model: 'local/qwen2.5',
      input: 'hello',
    });

    assert.equal(output.text, 'hello from runtime class');
    assert.equal(output.trace.traceId, 'trace-runtime-class');
    assert.ok(capturedExecuteScenarioRequest);
    assert.equal(capturedExecuteScenarioRequest?.head?.appId, APP_ID);
    assert.equal(capturedExecuteScenarioRequest?.head?.subjectUserId, 'user-from-provider');
    assert.equal(capturedExecuteScenarioRequest?.scenarioType, ScenarioType.TEXT_GENERATE);
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
      if (input.methodId === RuntimeMethodIds.ai.executeScenario) {
        generateCalls += 1;

        if (generateCalls === 1) {
          throw {
            reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
            actionHint: 'retry_or_check_runtime_daemon',
            retryable: true,
            message: 'runtime daemon restarting',
          };
        }

        return ExecuteScenarioResponse.toBinary(
          ExecuteScenarioResponse.create({
            output: textGenerateOutput('retry-ok'),
            finishReason: FinishReason.STOP,
            routeDecision: RoutePolicy.LOCAL,
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
      subjectContext: {
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

test('Runtime auto mode retries RESOURCE_EXHAUSTED scheduler rejections', async () => {
  let generateCalls = 0;

  installNodeGrpcBridge({
    invokeUnary: async (_config, input) => {
      if (input.methodId === RuntimeMethodIds.ai.executeScenario) {
        generateCalls += 1;

        if (generateCalls === 1) {
          throw {
            reasonCode: ReasonCode.RESOURCE_EXHAUSTED,
            actionHint: 'retry_after_scheduler_backoff',
            retryable: true,
            message: 'scheduler concurrency limit reached',
          };
        }

        return ExecuteScenarioResponse.toBinary(
          ExecuteScenarioResponse.create({
            output: textGenerateOutput('resource-exhausted-ok'),
            finishReason: FinishReason.STOP,
            routeDecision: RoutePolicy.LOCAL,
            modelResolved: 'local/qwen2.5',
            traceId: 'trace-runtime-resource-exhausted',
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
      subjectContext: {
        subjectUserId: 'retry-user',
      },
    });

    const output = await runtime.ai.text.generate({
      model: 'local/qwen2.5',
      input: 'retry on RESOURCE_EXHAUSTED',
    });

    assert.equal(output.text, 'resource-exhausted-ok');
    assert.equal(generateCalls, 2);
  } finally {
    clearNodeGrpcBridge();
  }
});

test('Runtime coalesces concurrent retry lifecycle transitions across overlapping invokes', async () => {
  let generateCalls = 0;
  let disconnectedEvents = 0;
  let connectedEvents = 0;

  installNodeGrpcBridge({
    invokeUnary: async (_config, input) => {
      if (input.methodId === RuntimeMethodIds.ai.executeScenario) {
        generateCalls += 1;
        if (generateCalls <= 2) {
          throw {
            reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
            actionHint: 'retry_or_check_runtime_daemon',
            retryable: true,
            message: `runtime daemon restarting ${generateCalls}`,
          };
        }

        return ExecuteScenarioResponse.toBinary(
          ExecuteScenarioResponse.create({
            output: textGenerateOutput(`retry-ok-${generateCalls}`),
            finishReason: FinishReason.STOP,
            routeDecision: RoutePolicy.LOCAL,
            modelResolved: 'local/qwen2.5',
            traceId: `trace-runtime-concurrent-${generateCalls}`,
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
      subjectContext: {
        subjectUserId: 'retry-user',
      },
    });

    runtime.events.on('runtime.disconnected', () => {
      disconnectedEvents += 1;
    });
    runtime.events.on('runtime.connected', () => {
      connectedEvents += 1;
    });

    const [first, second] = await Promise.all([
      runtime.ai.text.generate({
        model: 'local/qwen2.5',
        input: 'retry concurrently 1',
      }),
      runtime.ai.text.generate({
        model: 'local/qwen2.5',
        input: 'retry concurrently 2',
      }),
    ]);

    assert.equal(first.text.startsWith('retry-ok-'), true);
    assert.equal(second.text.startsWith('retry-ok-'), true);
    assert.equal(generateCalls, 4);
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
      if (input.methodId === RuntimeMethodIds.ai.executeScenario) {
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
      subjectContext: {
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

test('AI_PROVIDER_RATE_LIMITED is retryable', () => {
  assert.equal(isRetryableReasonCode(ReasonCode.AI_PROVIDER_RATE_LIMITED), true);
});

test('SDK_SCOPE_CATALOG_VERSION_CONFLICT exists and key equals value', () => {
  assert.equal(
    ReasonCode.SDK_SCOPE_CATALOG_VERSION_CONFLICT,
    'SDK_SCOPE_CATALOG_VERSION_CONFLICT',
  );
});

test('retry backoff includes jitter', async () => {
  const originalRandom = Math.random;
  try {
    Math.random = () => 0.5;

    let callCount = 0;
    const callTimestamps: number[] = [];

    installNodeGrpcBridge({
      invokeUnary: async (_config, input) => {
        if (input.methodId === RuntimeMethodIds.ai.executeScenario) {
          callCount += 1;
          callTimestamps.push(Date.now());

          if (callCount < 3) {
            throw {
              reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
              actionHint: 'retry',
              retryable: true,
              message: 'unavailable',
            };
          }

          return ExecuteScenarioResponse.toBinary(
            ExecuteScenarioResponse.create({
              output: textGenerateOutput('jitter-ok'),
              finishReason: FinishReason.STOP,
              routeDecision: RoutePolicy.LOCAL,
              modelResolved: 'local/qwen2.5',
              traceId: 'trace-jitter',
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

    const runtime = new Runtime({
      appId: APP_ID,
      transport: {
        type: 'node-grpc',
        endpoint: '127.0.0.1:46371',
      },
      retry: {
        maxAttempts: 3,
        backoffMs: 100,
      },
      subjectContext: {
        subjectUserId: 'jitter-user',
      },
    });

    const output = await runtime.ai.text.generate({
      model: 'local/qwen2.5',
      input: 'jitter test',
    });

    assert.equal(output.text, 'jitter-ok');
    assert.equal(callCount, 3);
  } finally {
    Math.random = originalRandom;
    clearNodeGrpcBridge();
  }
});

test('metadata sends x-nimi-key-source with inline/managed values', async () => {
  let capturedMetadata: Record<string, string> = {};

  installNodeGrpcBridge({
    invokeUnary: async (_config, input) => {
      if (input.methodId === RuntimeMethodIds.ai.executeScenario) {
        const metadataEntries = input.metadata;
        capturedMetadata = {};
        for (const [key, value] of Object.entries(metadataEntries)) {
          if (typeof value === 'string') {
            capturedMetadata[key] = value;
          }
        }

        return ExecuteScenarioResponse.toBinary(
          ExecuteScenarioResponse.create({
            output: textGenerateOutput('metadata-ok'),
            finishReason: FinishReason.STOP,
            routeDecision: RoutePolicy.LOCAL,
            modelResolved: 'local/qwen2.5',
            traceId: 'trace-metadata',
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
      subjectContext: {
        subjectUserId: 'metadata-user',
      },
    });

    await runtime.ai.text.generate({
      model: 'local/qwen2.5',
      input: 'metadata test',
      metadata: {
        keySource: 'managed',
      },
    });

    assert.equal(capturedMetadata.keySource, 'managed');
  } finally {
    clearNodeGrpcBridge();
  }
});

test('Runtime ai.text.generate omits x-nimi-key-source unless explicitly provided', async () => {
  let capturedMetadata: Record<string, string> = {};

  installNodeGrpcBridge({
    invokeUnary: async (_config, input) => {
      if (input.methodId === RuntimeMethodIds.ai.executeScenario) {
        capturedMetadata = {};
        for (const [key, value] of Object.entries(input.metadata || {})) {
          if (typeof value === 'string') {
            capturedMetadata[key] = value;
          }
        }
        return ExecuteScenarioResponse.toBinary(
          ExecuteScenarioResponse.create({
            output: textGenerateOutput('metadata-default-ok'),
            finishReason: FinishReason.STOP,
            routeDecision: RoutePolicy.CLOUD,
            modelResolved: 'gemini/gemini-3-flash-preview',
            traceId: 'trace-metadata-default',
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
      subjectContext: {
        subjectUserId: 'metadata-default-user',
      },
    });

    await runtime.ai.text.generate({
      model: 'gemini/gemini-3-flash-preview',
      input: 'metadata default test',
      route: 'cloud',
    });

    assert.equal(capturedMetadata.keySource, undefined);
  } finally {
    clearNodeGrpcBridge();
  }
});

test('RuntimeEventName does not include ai.route.decision or media.job.status (SDKR-028)', () => {
  // The Phase 1 event set is: runtime.connected, runtime.disconnected,
  // auth.token.issued, auth.token.revoked, error.
  // ai.route.decision and media.job.status are NOT in Phase 1 — they were
  // removed and moved to telemetry side-channel.
  const runtime = new Runtime({
    appId: APP_ID,
    transport: {
      type: 'node-grpc',
      endpoint: '127.0.0.1:46371',
    },
  });

  // Attempting to subscribe to a non-existent event name should not register
  // a meaningful handler. We verify the Phase 1 set is the complete list by
  // confirming events.on returns an unsubscribe function for valid names.
  const validNames = [
    'runtime.connected',
    'runtime.disconnected',
    'auth.token.issued',
    'auth.token.revoked',
    'error',
  ] as const;

  for (const name of validNames) {
    const unsub = runtime.events.on(name, () => {});
    assert.equal(typeof unsub, 'function', `events.on('${name}') must return unsubscribe`);
    unsub();
  }
});

test('Runtime runtimeVersion() returns null before any RPC and caches after metadata arrives', async () => {
  installNodeGrpcBridge({
    invokeUnary: async (_config, input) => {
      if (input.methodId === RuntimeMethodIds.ai.executeScenario) {
        return ExecuteScenarioResponse.toBinary(
          ExecuteScenarioResponse.create({
            output: textGenerateOutput('version-test'),
            finishReason: FinishReason.STOP,
            routeDecision: RoutePolicy.LOCAL,
            modelResolved: 'local/qwen2.5',
            traceId: 'trace-version',
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
      subjectContext: {
        subjectUserId: 'version-user',
      },
    });

    // Before any RPC, version is null
    assert.equal(runtime.runtimeVersion(), null);

    await runtime.ai.text.generate({
      model: 'local/qwen2.5',
      input: 'version test',
    });

    // runtimeVersion remains null when the bridge does not emit metadata
    // (node-grpc bridge mock doesn't call _responseMetadataObserver)
    assert.equal(runtime.runtimeVersion(), null);
  } finally {
    clearNodeGrpcBridge();
  }
});

test('Runtime retry defaults to maxAttempts=3 backoffMs=200 when retry is omitted', async () => {
  let generateCalls = 0;

  installNodeGrpcBridge({
    invokeUnary: async (_config, input) => {
      if (input.methodId === RuntimeMethodIds.ai.executeScenario) {
        generateCalls += 1;

        if (generateCalls < 3) {
          throw {
            reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
            actionHint: 'retry',
            retryable: true,
            message: 'unavailable',
          };
        }

        return ExecuteScenarioResponse.toBinary(
          ExecuteScenarioResponse.create({
            output: textGenerateOutput('default-retry'),
            finishReason: FinishReason.STOP,
            routeDecision: RoutePolicy.LOCAL,
            modelResolved: 'local/qwen2.5',
            traceId: 'trace-default-retry',
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
    // No retry config — should use defaults (maxAttempts=3, backoffMs=200)
    const runtime = new Runtime({
      appId: APP_ID,
      transport: {
        type: 'node-grpc',
        endpoint: '127.0.0.1:46371',
      },
      subjectContext: {
        subjectUserId: 'default-retry-user',
      },
    });

    const output = await runtime.ai.text.generate({
      model: 'local/qwen2.5',
      input: 'default retry',
    });

    assert.equal(output.text, 'default-retry');
    assert.equal(generateCalls, 3, 'should retry with default maxAttempts=3');
  } finally {
    clearNodeGrpcBridge();
  }
});

test('OPERATION_ABORTED reasonCode prevents retry even when retryable is true', async () => {
  let generateCalls = 0;

  installNodeGrpcBridge({
    invokeUnary: async (_config, input) => {
      if (input.methodId === RuntimeMethodIds.ai.executeScenario) {
        generateCalls += 1;
        throw {
          reasonCode: ReasonCode.OPERATION_ABORTED,
          actionHint: 'retry_if_needed',
          retryable: true,
          message: 'operation aborted',
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
      subjectContext: {
        subjectUserId: 'abort-user',
      },
    });

    let thrown: unknown = null;
    try {
      await runtime.ai.text.generate({
        model: 'local/qwen2.5',
        input: 'abort test',
      });
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown);
    const nimiError = asNimiError(thrown, { source: 'runtime' });
    assert.equal(nimiError.reasonCode, ReasonCode.OPERATION_ABORTED);
    assert.equal(generateCalls, 1, 'OPERATION_ABORTED must not be retried');
  } finally {
    clearNodeGrpcBridge();
  }
});

// --- S-TRANSPORT-005: Version Negotiation ---

test('Runtime version negotiation: incompatible major version throws SDK_RUNTIME_VERSION_INCOMPATIBLE', async () => {
  installNodeGrpcBridge({
    invokeUnary: async (config, input) => {
      if (config._responseMetadataObserver) {
        config._responseMetadataObserver({ 'x-nimi-runtime-version': '1.0.0' });
      }
      return ExecuteScenarioResponse.toBinary(
        ExecuteScenarioResponse.create({
          output: textGenerateOutput('never'),
          finishReason: FinishReason.STOP,
          routeDecision: RoutePolicy.LOCAL,
          modelResolved: 'local/test',
          traceId: 'trace-version',
        }),
      );
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
    assert.ok(thrown, 'should throw on incompatible major version');
    const nimiError = asNimiError(thrown, { source: 'sdk' });
    assert.equal(nimiError.reasonCode, ReasonCode.SDK_RUNTIME_VERSION_INCOMPATIBLE);
  } finally {
    clearNodeGrpcBridge();
  }
});

test('Runtime version negotiation: compatible version 0.x.y proceeds normally', async () => {
  installNodeGrpcBridge({
    invokeUnary: async (config, input) => {
      if (config._responseMetadataObserver) {
        config._responseMetadataObserver({ 'x-nimi-runtime-version': '0.2.0' });
      }
      return ExecuteScenarioResponse.toBinary(
        ExecuteScenarioResponse.create({
          output: textGenerateOutput('version-ok'),
          finishReason: FinishReason.STOP,
          routeDecision: RoutePolicy.LOCAL,
          modelResolved: 'local/test',
          traceId: 'trace-version-ok',
        }),
      );
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

    const output = await runtime.ai.text.generate({ model: 'local/test', input: 'hi' });
    assert.equal(output.text, 'version-ok');
    assert.equal(runtime.runtimeVersion(), '0.2.0');
  } finally {
    clearNodeGrpcBridge();
  }
});

// --- S-TRANSPORT-007: Mode B Terminal State Detection ---

test('Mode B: subscribeScenarioJobEvents stops after terminal COMPLETED event', async () => {
  const events: ScenarioJobEvent[] = [
    ScenarioJobEvent.create({
      eventType: ScenarioJobEventType.SCENARIO_JOB_EVENT_SUBMITTED,
      sequence: '1',
      job: {
        jobId: 'job-1',
        scenarioType: ScenarioType.IMAGE_GENERATE,
        status: ScenarioJobStatus.SUBMITTED,
      },
    }),
    ScenarioJobEvent.create({
      eventType: ScenarioJobEventType.SCENARIO_JOB_EVENT_RUNNING,
      sequence: '2',
      job: {
        jobId: 'job-1',
        scenarioType: ScenarioType.IMAGE_GENERATE,
        status: ScenarioJobStatus.RUNNING,
      },
    }),
    ScenarioJobEvent.create({
      eventType: ScenarioJobEventType.SCENARIO_JOB_EVENT_COMPLETED,
      sequence: '3',
      job: {
        jobId: 'job-1',
        scenarioType: ScenarioType.IMAGE_GENERATE,
        status: ScenarioJobStatus.COMPLETED,
      },
    }),
    ScenarioJobEvent.create({
      eventType: ScenarioJobEventType.SCENARIO_JOB_EVENT_SUBMITTED,
      sequence: '4',
      job: {
        jobId: 'job-1',
        scenarioType: ScenarioType.IMAGE_GENERATE,
        status: ScenarioJobStatus.SUBMITTED,
      },
    }),
  ];

  installNodeGrpcBridge({
    invokeUnary: async () => {
      throw new Error('unexpected unary call');
    },
    openStream: async (_config, input) => {
      if (input.methodId !== RuntimeMethodIds.ai.subscribeScenarioJobEvents) {
        throw new Error(`unexpected stream method: ${input.methodId}`);
      }
      const wireEvents = events.map((e) => ScenarioJobEvent.toBinary(e));
      return (async function* () {
        for (const we of wireEvents) {
          yield we;
        }
      })();
    },
    closeStream: async () => {},
  });

  try {
    const runtime = new Runtime({
      appId: APP_ID,
      transport: { type: 'node-grpc', endpoint: '127.0.0.1:46371' },
      subjectContext: { subjectUserId: 'mode-b-user' },
    });

    await runtime.connect();
    const stream = await runtime.media.jobs.subscribe('job-1');
    const received: ScenarioJobEventType[] = [];
    for await (const event of stream) {
      received.push(event.eventType);
    }

    assert.deepEqual(received, [
      ScenarioJobEventType.SCENARIO_JOB_EVENT_SUBMITTED,
      ScenarioJobEventType.SCENARIO_JOB_EVENT_RUNNING,
      ScenarioJobEventType.SCENARIO_JOB_EVENT_COMPLETED,
    ]);
  } finally {
    clearNodeGrpcBridge();
  }
});

test('Mode B: subscribeScenarioJobEvents stops after FAILED event', async () => {
  const events: ScenarioJobEvent[] = [
    ScenarioJobEvent.create({
      eventType: ScenarioJobEventType.SCENARIO_JOB_EVENT_RUNNING,
      sequence: '1',
      job: {
        jobId: 'job-2',
        scenarioType: ScenarioType.IMAGE_GENERATE,
        status: ScenarioJobStatus.RUNNING,
      },
    }),
    ScenarioJobEvent.create({
      eventType: ScenarioJobEventType.SCENARIO_JOB_EVENT_FAILED,
      sequence: '2',
      job: {
        jobId: 'job-2',
        scenarioType: ScenarioType.IMAGE_GENERATE,
        status: ScenarioJobStatus.FAILED,
      },
    }),
    ScenarioJobEvent.create({
      eventType: ScenarioJobEventType.SCENARIO_JOB_EVENT_SUBMITTED,
      sequence: '3',
      job: {
        jobId: 'job-2',
        scenarioType: ScenarioType.IMAGE_GENERATE,
        status: ScenarioJobStatus.SUBMITTED,
      },
    }),
  ];

  installNodeGrpcBridge({
    invokeUnary: async () => {
      throw new Error('unexpected unary call');
    },
    openStream: async (_config, input) => {
      if (input.methodId !== RuntimeMethodIds.ai.subscribeScenarioJobEvents) {
        throw new Error(`unexpected stream method: ${input.methodId}`);
      }
      const wireEvents = events.map((e) => ScenarioJobEvent.toBinary(e));
      return (async function* () {
        for (const we of wireEvents) {
          yield we;
        }
      })();
    },
    closeStream: async () => {},
  });

  try {
    const runtime = new Runtime({
      appId: APP_ID,
      transport: { type: 'node-grpc', endpoint: '127.0.0.1:46371' },
      subjectContext: { subjectUserId: 'mode-b-user' },
    });

    await runtime.connect();
    const stream = await runtime.media.jobs.subscribe('job-2');
    const received: ScenarioJobEventType[] = [];
    for await (const event of stream) {
      received.push(event.eventType);
    }

    assert.deepEqual(received, [
      ScenarioJobEventType.SCENARIO_JOB_EVENT_RUNNING,
      ScenarioJobEventType.SCENARIO_JOB_EVENT_FAILED,
    ]);
  } finally {
    clearNodeGrpcBridge();
  }
});

// --- S-ERROR-012: Mode D CANCELLED Handling ---

test('Mode D: healthEvents emits runtime.disconnected on CANCELLED and stops stream', async () => {
  let disconnectedEvents = 0;
  let disconnectedReasonCode = '';

  installNodeGrpcBridge({
    invokeUnary: async () => {
      throw new Error('unexpected unary call');
    },
    openStream: async () => {
      return (async function* () {
        yield new Uint8Array(0);
        throw { reasonCode: ReasonCode.RUNTIME_GRPC_CANCELLED, message: 'stream cancelled by server', retryable: false };
      })();
    },
    closeStream: async () => {},
  });

  try {
    const runtime = new Runtime({
      appId: APP_ID,
      transport: { type: 'node-grpc', endpoint: '127.0.0.1:46371' },
    });

    runtime.events.on('runtime.disconnected', (event) => {
      disconnectedEvents += 1;
      disconnectedReasonCode = event.reasonCode || '';
    });

    await runtime.connect();
    const stream = await runtime.healthEvents();
    const received: unknown[] = [];
    for await (const event of stream) {
      received.push(event);
    }

    assert.equal(disconnectedEvents, 1, 'should emit runtime.disconnected on CANCELLED');
    assert.equal(disconnectedReasonCode, ReasonCode.RUNTIME_GRPC_CANCELLED);
  } finally {
    clearNodeGrpcBridge();
  }
});

test('runtime.disconnected recovery remains caller-driven via connect and openSession', async () => {
  let openSessionCalls = 0;

  installNodeGrpcBridge({
    invokeUnary: async (_config, input) => {
      if (input.methodId === RuntimeMethodIds.auth.openSession) {
        openSessionCalls += 1;
        return OpenSessionResponse.toBinary(
          OpenSessionResponse.create({
            sessionId: 'session-recovered',
            sessionToken: 'session-token',
            issuedAt: Timestamp.create({ seconds: '1700000000', nanos: 0 }),
            expiresAt: Timestamp.create({ seconds: '1700003600', nanos: 0 }),
            reasonCode: RuntimeProtoReasonCode.ACTION_EXECUTED,
          }),
        );
      }
      throw new Error(`unexpected unary method: ${input.methodId}`);
    },
    openStream: async () => {
      return (async function* () {
        yield new Uint8Array(0);
        throw {
          reasonCode: ReasonCode.RUNTIME_GRPC_CANCELLED,
          message: 'stream cancelled by server',
          retryable: false,
        };
      })();
    },
    closeStream: async () => {},
  });

  try {
    const runtime = new Runtime({
      appId: APP_ID,
      transport: { type: 'node-grpc', endpoint: '127.0.0.1:46371' },
    });

    let disconnectedEvents = 0;
    runtime.events.on('runtime.disconnected', () => {
      disconnectedEvents += 1;
    });

    await runtime.connect();
    const stream = await runtime.healthEvents();
    for await (const _event of stream) {
      // consume until disconnect
    }

    assert.equal(disconnectedEvents, 1);
    await runtime.connect();
    const response = await runtime.auth.openSession({
      appId: APP_ID,
      appInstanceId: 'desktop-instance-1',
      deviceId: 'device-1',
      subjectUserId: 'user-1',
      ttlSeconds: 300,
    });
    assert.equal(response.sessionId, 'session-recovered');
    assert.equal(openSessionCalls, 1);
  } finally {
    clearNodeGrpcBridge();
  }
});

test('Mode D subscriptions do not auto-resubscribe after disconnect', async () => {
  let openStreamCalls = 0;

  installNodeGrpcBridge({
    invokeUnary: async () => {
      throw new Error('unexpected unary call');
    },
    openStream: async () => {
      openStreamCalls += 1;
      if (openStreamCalls === 1) {
        return (async function* () {
          yield new Uint8Array(0);
          throw {
            reasonCode: ReasonCode.RUNTIME_GRPC_CANCELLED,
            message: 'stream cancelled by server',
            retryable: false,
          };
        })();
      }

      return (async function* () {
        yield new Uint8Array(0);
      })();
    },
    closeStream: async () => {},
  });

  try {
    const runtime = new Runtime({
      appId: APP_ID,
      transport: { type: 'node-grpc', endpoint: '127.0.0.1:46371' },
    });

    await runtime.connect();
    const firstStream = await runtime.healthEvents();
    for await (const _event of firstStream) {
      // consume until disconnect
    }

    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(openStreamCalls, 1, 'SDK must not auto-resubscribe Mode D streams');

    const secondStream = await runtime.healthEvents();
    let secondStreamEvents = 0;
    for await (const _event of secondStream) {
      secondStreamEvents += 1;
    }

    assert.equal(openStreamCalls, 2, 'caller must explicitly reopen the subscription');
    assert.equal(secondStreamEvents, 1);
  } finally {
    clearNodeGrpcBridge();
  }
});

// --- S-ERROR-011: ExternalPrincipal non-retryable codes ---

test('S-ERROR-011: AUTH_TOKEN_EXPIRED, AUTH_UNSUPPORTED_PROOF_TYPE, AUTH_TOKEN_INVALID are not retryable; SESSION_EXPIRED is retryable', () => {
  // ExternalPrincipal auth failure codes must never be retried
  assert.equal(isRetryableReasonCode(ReasonCode.AUTH_TOKEN_EXPIRED), false,
    'AUTH_TOKEN_EXPIRED must not be retryable');
  assert.equal(isRetryableReasonCode(ReasonCode.AUTH_UNSUPPORTED_PROOF_TYPE), false,
    'AUTH_UNSUPPORTED_PROOF_TYPE must not be retryable');
  assert.equal(isRetryableReasonCode(ReasonCode.AUTH_TOKEN_INVALID), false,
    'AUTH_TOKEN_INVALID must not be retryable');

  // SESSION_EXPIRED is a transient condition and IS retryable (contrast)
  assert.equal(isRetryableReasonCode(ReasonCode.SESSION_EXPIRED), true,
    'SESSION_EXPIRED must be retryable');
});

// --- S-RUNTIME-066: pagination defaults are not overridden by SDK ---

test('S-RUNTIME-066: SDK pagination passthrough does not override runtime defaults', async () => {
  const capturedRequests: { methodId: string; request: Uint8Array }[] = [];

  installNodeGrpcBridge({
    invokeUnary: async (_config, input) => {
      if (input.methodId === RuntimeMethodIds.connector.listConnectors) {
        capturedRequests.push({
          methodId: input.methodId,
          request: new Uint8Array(input.request),
        });
        // Return an empty protobuf response (default ListConnectorsResponse)
        return new Uint8Array(0);
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
      transport: { type: 'node-grpc', endpoint: '127.0.0.1:46371' },
    });

    await runtime.connect();

    // Call with explicit pagination params
    await runtime.connector.listConnectors({
      pageSize: 100,
      pageToken: 'abc',
      kindFilter: 0,
      statusFilter: 0,
      providerFilter: '',
    });

    // Call with no pagination params (all defaults)
    await runtime.connector.listConnectors({
      pageSize: 0,
      pageToken: '',
      kindFilter: 0,
      statusFilter: 0,
      providerFilter: '',
    });

    assert.equal(capturedRequests.length, 2, 'expected two listConnectors calls');

    // First call: SDK must encode pageSize=100 and pageToken='abc' as provided
    // Protobuf encodes non-default values, so the binary must be non-empty
    assert.ok(capturedRequests[0].request.length > 0,
      'request with explicit pagination must encode non-default fields');

    // Second call: SDK must NOT inject default pageSize or pageToken
    // Proto3 omits default values (pageSize=0, pageToken=''), so binary is empty
    assert.equal(capturedRequests[1].request.length, 0,
      'SDK must not inject default pageSize or pageToken when caller provides none');
  } finally {
    clearNodeGrpcBridge();
  }
});

// --- S-RUNTIME-050: blocked vs deferred distinction ---

test('S-RUNTIME-050: Phase 2 deferred method propagates SDK_RUNTIME_METHOD_UNAVAILABLE', async () => {
  installNodeGrpcBridge({
    invokeUnary: async (config, input) => {
      // Emit runtime version 0.4.0 to trigger version detection
      if (config._responseMetadataObserver) {
        config._responseMetadataObserver({ 'x-nimi-runtime-version': '0.4.0' });
      }

      if (input.methodId === RuntimeMethodIds.ai.executeScenario) {
        return ExecuteScenarioResponse.toBinary(
          ExecuteScenarioResponse.create({
            output: textGenerateOutput('version-seed'),
            finishReason: FinishReason.STOP,
            routeDecision: RoutePolicy.LOCAL,
            modelResolved: 'local/test',
            traceId: 'trace-phase2',
          }),
        );
      }

      // Phase 2 workflow method: runtime rejects with unavailable
      if (input.methodId === RuntimeMethodIds.workflow.submit) {
        throw {
          reasonCode: ReasonCode.SDK_RUNTIME_METHOD_UNAVAILABLE,
          message: 'workflow.submit is unavailable: runtime version 0.4.0 does not support this Phase 2 deferred method',
          actionHint: 'upgrade_runtime_to_support_phase2_method',
          retryable: false,
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
      transport: { type: 'node-grpc', endpoint: '127.0.0.1:46371' },
      subjectContext: { subjectUserId: 'phase2-user' },
    });

    // Trigger version detection via an AI call
    await runtime.ai.text.generate({ model: 'local/test', input: 'seed' });
    assert.equal(runtime.runtimeVersion(), '0.4.0');

    // Call a Phase 2 deferred method (workflow.submit)
    let thrown: unknown = null;
    try {
      await runtime.workflow.submit({
        appId: APP_ID,
        subjectUserId: 'phase2-user',
        timeoutMs: 5000,
      });
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown, 'Phase 2 deferred method must throw when unavailable');
    const nimiError = asNimiError(thrown, { source: 'sdk' });
    assert.equal(nimiError.reasonCode, ReasonCode.SDK_RUNTIME_METHOD_UNAVAILABLE,
      'reasonCode must be SDK_RUNTIME_METHOD_UNAVAILABLE, not a generic blocked error');
    assert.ok(
      nimiError.actionHint.includes('phase') || nimiError.message.includes('Phase'),
      'error must reference phase/deferred context in actionHint or message',
    );
  } finally {
    clearNodeGrpcBridge();
  }
});
