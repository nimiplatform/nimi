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
