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
