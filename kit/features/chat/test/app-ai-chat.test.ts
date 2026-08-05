import { describe, expect, it, vi } from 'vitest';
import {
  createAppAiChatComposerAdapter,
} from '../src/runtime.js';
import { createRuntimeAiTestRuntime } from './runtime-ai-test-helpers.js';

describe('app AI chat helpers', () => {
  it('creates a generate composer adapter with kit metadata defaults', async () => {
    const runtimeHarness = createRuntimeAiTestRuntime();
    const onResponse = vi.fn();
    const adapter = createAppAiChatComposerAdapter({
      runtime: runtimeHarness.runtime,
      appId: 'kit-chat-test-app',
      mode: 'generate',
      onResponse,
    });

    await adapter.submit({
      text: 'Hello runtime',
      attachments: [],
    });

    expect(runtimeHarness.executeScenario).toHaveBeenCalledTimes(1);
    const [request, callOptions] = runtimeHarness.executeScenario.mock.calls[0] ?? [];
    expect(request).toEqual(expect.objectContaining({
      head: {
        appId: 'kit-chat-test-app',
        subjectUserId: '',
        timeoutMs: 0,
      },
      scenarioType: 1,
      executionMode: 1,
    }));
    expect(request?.spec?.spec.oneofKind === 'textGenerate'
      ? request.spec.spec.textGenerate.input[0]?.content
      : '').toBe('Hello runtime');
    expect(callOptions).toEqual(expect.objectContaining({
      metadata: expect.objectContaining({
        callerKind: 'third-party-app',
        callerId: 'nimi-kit.chat.app-ai',
        surfaceId: 'kit.features.chat',
        idempotencyKey: expect.stringMatching(/^runtime-ai-/u),
      }),
    }));
    expect(onResponse).toHaveBeenCalledWith({
      mode: 'generate',
      text: 'Generated reply',
      result: expect.objectContaining({
        text: 'Generated reply',
      }),
    }, {
      text: 'Hello runtime',
      attachments: [],
    });
  });

  it('creates a streaming composer adapter that resolves request overrides and emits chunk callbacks', async () => {
    const runtimeHarness = createRuntimeAiTestRuntime({
      streamEvents: [
        { type: 'start', traceId: 'trace-3', model: { modelId: 'text.generate' } },
        { type: 'text-delta', text: 'First ' },
        { type: 'text-delta', text: 'reply' },
        { type: 'done', finishReason: 'stop', usage: { promptTokens: 3, completionTokens: 4, totalTokens: 7 } },
      ],
    });
    const onChunk = vi.fn();
    const onResponse = vi.fn();
    const adapter = createAppAiChatComposerAdapter({
      runtime: runtimeHarness.runtime,
      appId: 'kit-chat-test-app',
      mode: 'stream',
      resolveRequest: ({ text }) => ({
        input: [
          { role: 'user', content: text },
        ],
      }),
      onChunk,
      onResponse,
    });

    await adapter.submit({
      text: 'Prompt me',
      attachments: [],
    });

    expect(runtimeHarness.streamScenario).toHaveBeenCalledTimes(1);
    const [request, callOptions] = runtimeHarness.streamScenario.mock.calls[0] ?? [];
    expect(request).toEqual(expect.objectContaining({
      head: {
        appId: 'kit-chat-test-app',
        subjectUserId: '',
        timeoutMs: 0,
      },
      scenarioType: 1,
      executionMode: 2,
    }));
    expect(callOptions).toEqual(expect.objectContaining({
      metadata: expect.objectContaining({
        callerKind: 'third-party-app',
        callerId: 'nimi-kit.chat.app-ai',
        surfaceId: 'kit.features.chat',
        idempotencyKey: expect.stringMatching(/^runtime-ai-/u),
      }),
    }));
    expect(onChunk).toHaveBeenCalledTimes(2);
    expect(onResponse).toHaveBeenCalledWith({
      mode: 'stream',
      text: 'First reply',
      result: {
        text: 'First reply',
        finishReason: 'stop',
        usage: { promptTokens: 3, completionTokens: 4, totalTokens: 7 },
        traceId: 'trace-3',
      },
    }, {
      text: 'Prompt me',
      attachments: [],
    });
  });

  it('fails closed when attachments are present without a prompt resolver', async () => {
    const runtimeHarness = createRuntimeAiTestRuntime();
    const adapter = createAppAiChatComposerAdapter<{ id: string }>({
      runtime: runtimeHarness.runtime,
      appId: 'kit-chat-test-app',
      mode: 'generate',
    });

    await expect(adapter.submit({
      text: 'Prompt me',
      attachments: [{ id: 'att-1' }],
    })).rejects.toThrow('app AI chat adapter requires resolveInput or resolveRequest when attachments are present');
  });

});
