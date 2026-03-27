import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ExecuteScenarioRequest,
  ExecuteScenarioResponse,
  FinishReason,
  RoutePolicy,
  StreamEventType,
  StreamScenarioEvent,
} from '../../src/runtime/generated/runtime/v1/ai.js';
import {
  Runtime,
  RuntimeMethodIds,
  setNodeGrpcBridge,
  type NodeGrpcBridge,
} from '../../src/runtime/index.js';
import { ReasonCode } from '../../src/types/index.js';
import { textDelta, textGenerateOutput } from '../helpers/runtime-ai-shapes.js';

function installNodeGrpcBridge(bridge: NodeGrpcBridge): void {
  setNodeGrpcBridge(bridge);
}

function clearNodeGrpcBridge(): void {
  setNodeGrpcBridge(null);
}

test('new Runtime() defaults appId and node transport in Node.js', async () => {
  let capturedRequest: ExecuteScenarioRequest | null = null;

  installNodeGrpcBridge({
    invokeUnary: async (_config, input) => {
      if (input.methodId !== RuntimeMethodIds.ai.executeScenario) {
        throw new Error(`unexpected method: ${input.methodId}`);
      }
      capturedRequest = ExecuteScenarioRequest.fromBinary(input.request);
      return ExecuteScenarioResponse.toBinary(ExecuteScenarioResponse.create({
        output: textGenerateOutput('hello-default-runtime'),
        finishReason: FinishReason.STOP,
        routeDecision: RoutePolicy.LOCAL,
        modelResolved: 'local/qwen2.5',
        traceId: 'trace-default-runtime',
        usage: {
          inputTokens: 3,
          outputTokens: 5,
        },
      }));
    },
    openStream: async () => {
      throw new Error('unexpected stream');
    },
    closeStream: async () => {},
  });

  try {
    const runtime = new Runtime();
    let thrown: unknown = null;
    try {
      await runtime.generate({
        prompt: 'hello default runtime',
      });
    } catch (error) {
      thrown = error;
    }

    assert.equal(runtime.appId, 'nimi.app');
    assert.equal(runtime.transport.type, 'node-grpc');
    if (runtime.transport.type === 'node-grpc') {
      assert.equal(runtime.transport.endpoint, '127.0.0.1:46371');
    }
    assert.ok(thrown);
    assert.equal((thrown as { reasonCode?: string }).reasonCode, ReasonCode.ACTION_INPUT_INVALID);
    assert.match(String((thrown as { message?: string })?.message || ''), /requires an explicit local model or provider \+ model/i);
    assert.equal(capturedRequest, null);
  } finally {
    clearNodeGrpcBridge();
  }
});

test('new Runtime() without transport throws targeted error outside Node.js', () => {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'versions');
  if (!descriptor?.configurable) {
    return;
  }

  const originalVersions = process.versions;
  try {
    Object.defineProperty(process, 'versions', {
      value: {
        ...originalVersions,
        node: undefined,
      },
      configurable: true,
    });

    assert.throws(
      () => new Runtime(),
      (error: unknown) => {
        assert.equal(typeof error, 'object');
        assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_TRANSPORT_INVALID');
        assert.match(String((error as { message?: string }).message || ''), /transport is required outside Node\.js/i);
        return true;
      },
    );
  } finally {
    Object.defineProperty(process, 'versions', descriptor);
  }
});

test('Runtime.generate requires explicit provider-scoped models', async () => {
  const capturedRequests: ExecuteScenarioRequest[] = [];

  installNodeGrpcBridge({
    invokeUnary: async (_config, input) => {
      capturedRequests.push(ExecuteScenarioRequest.fromBinary(input.request));
      return ExecuteScenarioResponse.toBinary(ExecuteScenarioResponse.create({
        output: textGenerateOutput('hello-cloud-runtime'),
        finishReason: FinishReason.STOP,
        routeDecision: RoutePolicy.CLOUD,
        modelResolved: 'cloud/gpt-4o-mini',
        traceId: 'trace-cloud-runtime',
      }));
    },
    openStream: async () => {
      throw new Error('unexpected stream');
    },
    closeStream: async () => {},
  });

  try {
    const runtime = new Runtime();
    await assert.rejects(
      () => runtime.generate({
        provider: 'gemini',
        prompt: 'hello cloud runtime',
      }),
      (error: unknown) => {
        assert.equal((error as { reasonCode?: string }).reasonCode, ReasonCode.ACTION_INPUT_INVALID);
        assert.match(String((error as { message?: string }).message || ''), /requires provider \+ model for cloud routing/i);
        return true;
      },
    );
    await runtime.generate({
      provider: 'gemini',
      model: 'gemini-2.5-pro',
      subjectUserId: 'user-001',
      prompt: 'explicit provider model',
    });

    assert.equal(capturedRequests.length, 1);
    assert.equal(capturedRequests[0]?.head?.routePolicy, RoutePolicy.CLOUD);
    assert.equal(capturedRequests[0]?.head?.modelId, 'gemini/gemini-2.5-pro');
  } finally {
    clearNodeGrpcBridge();
  }
});

test('Runtime.generate rejects fully-qualified remote model ids on the high-level surface', async () => {
  const runtime = new Runtime();

  await assert.rejects(
    () => runtime.generate({
      model: 'openai/gpt-5.2',
      prompt: 'should fail',
    }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, ReasonCode.ACTION_INPUT_INVALID);
      assert.match(String((error as { message?: string }).message || ''), /does not accept fully-qualified remote model ids/i);
      return true;
    },
  );
});

test('Runtime.generate rejects legacy local prefixes with SDK_AI_PROVIDER_CONFIG_INVALID', async () => {
  const runtime = new Runtime();

  await assert.rejects(
    () => runtime.generate({
      model: 'localai/qwen2.5',
      prompt: 'should fail legacy prefix',
    }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, ReasonCode.SDK_AI_PROVIDER_CONFIG_INVALID);
      assert.equal((error as { actionHint?: string }).actionHint, 'rename_legacy_local_model_prefix');
      return true;
    },
  );
});

test('Runtime.generate rejects unsupported provider ids with ACTION_INPUT_INVALID', async () => {
  const runtime = new Runtime();

  await assert.rejects(
    () => runtime.generate({
      provider: 'legacy-cloud',
      model: 'gpt-4.1-mini',
      prompt: 'should fail provider validation',
    }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, ReasonCode.ACTION_INPUT_INVALID);
      assert.match(String((error as { message?: string }).message || ''), /unsupported provider/i);
      return true;
    },
  );
});

test('Runtime.stream maps text, done, and error chunks', async () => {
  installNodeGrpcBridge({
    invokeUnary: async () => {
      throw new Error('unexpected unary');
    },
    openStream: async (_config, input) => {
      if (input.methodId !== RuntimeMethodIds.ai.streamScenario) {
        throw new Error(`unexpected method: ${input.methodId}`);
      }
      return (async function* () {
        yield StreamScenarioEvent.toBinary(StreamScenarioEvent.create({
          eventType: StreamEventType.STREAM_EVENT_STARTED,
          traceId: 'trace-stream-runtime',
          payload: {
            oneofKind: 'started',
            started: {
              routeDecision: RoutePolicy.LOCAL,
              modelResolved: 'local/qwen2.5',
            },
          },
        }));
        yield StreamScenarioEvent.toBinary(StreamScenarioEvent.create({
          eventType: StreamEventType.STREAM_EVENT_DELTA,
          payload: {
            oneofKind: 'delta',
            delta: textDelta('hello '),
          },
        }));
        yield StreamScenarioEvent.toBinary(StreamScenarioEvent.create({
          eventType: StreamEventType.STREAM_EVENT_USAGE,
          payload: {
            oneofKind: 'usage',
            usage: {
              inputTokens: 2,
              outputTokens: 4,
            },
          },
        }));
        yield StreamScenarioEvent.toBinary(StreamScenarioEvent.create({
          eventType: StreamEventType.STREAM_EVENT_COMPLETED,
          traceId: 'trace-stream-runtime',
          payload: {
            oneofKind: 'completed',
            completed: {
              finishReason: FinishReason.STOP,
            },
          },
        }));
      })();
    },
    closeStream: async () => {},
  });

  try {
    const runtime = new Runtime();
    const stream = await runtime.stream({
      prompt: 'hello stream runtime',
      model: 'llama3',
    });
    const parts: Array<Record<string, unknown>> = [];
    for await (const part of stream) {
      if (part.type === 'error') {
        parts.push({ type: part.type, reasonCode: part.error.reasonCode });
        continue;
      }
      parts.push({ ...part });
    }

    assert.deepEqual(parts, [
      { type: 'text', text: 'hello' },
      {
        type: 'done',
        usage: { inputTokens: 2, outputTokens: 4 },
        finishReason: 'stop',
        traceId: 'trace-stream-runtime',
        modelResolved: 'local/qwen2.5',
        routeDecision: 'local',
      },
    ]);
  } finally {
    clearNodeGrpcBridge();
  }
});

test('Runtime embedding surface fails closed on mismatched typed output', async () => {
  installNodeGrpcBridge({
    invokeUnary: async (_config, input) => {
      if (input.methodId !== RuntimeMethodIds.ai.executeScenario) {
        throw new Error(`unexpected method: ${input.methodId}`);
      }
      return ExecuteScenarioResponse.toBinary(ExecuteScenarioResponse.create({
        output: textGenerateOutput('wrong-output-kind'),
        finishReason: FinishReason.STOP,
        routeDecision: RoutePolicy.LOCAL,
        modelResolved: 'llama/embed',
        traceId: 'trace-embed-mismatch',
      }));
    },
    openStream: async () => {
      throw new Error('unexpected stream');
    },
    closeStream: async () => {},
  });

  try {
    const runtime = new Runtime();
    await assert.rejects(
      () => runtime.ai.embedding.generate({
        model: 'llama/embed',
        input: ['hello'],
      }),
      (error: unknown) => {
        assert.equal((error as { reasonCode?: string }).reasonCode, ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED);
        return true;
      },
    );
  } finally {
    clearNodeGrpcBridge();
  }
});
