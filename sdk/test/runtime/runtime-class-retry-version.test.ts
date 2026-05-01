import {
  assert,
  test,
  asNimiError,
  Runtime,
  RuntimeMethodIds,
  ReasonCode,
  isRetryableReasonCode,
  AuthorizeExternalPrincipalRequest,
  AuthorizeExternalPrincipalResponse,
  PolicyMode,
  AuthorizationPreset,
  OpenSessionResponse,
  RuntimeProtoReasonCode,
  ExecuteScenarioRequest,
  ExecuteScenarioResponse,
  FinishReason,
  ScenarioJobEvent,
  ScenarioJobEventType,
  ScenarioJobStatus,
  ScenarioType,
  RoutePolicy,
  WorkflowEvent,
  WorkflowEventType,
  Timestamp,
  textGenerateOutput,
  APP_ID,
  installNodeGrpcBridge,
  clearNodeGrpcBridge,
} from './runtime-class-test-utils.js';

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
