import { describe, expect, it, vi } from 'vitest';
import type { Runtime, TextGenerateOutput, TextStreamPart } from '@nimiplatform/sdk/runtime';
import {
  createRuntimeChatComposerAdapter,
  streamRuntimeChatResponse,
  submitRuntimeChat,
} from '../src/runtime.js';

function makeGenerateRuntime(output?: Partial<TextGenerateOutput>): Runtime {
  return {
    ai: {
      text: {
        generate: vi.fn().mockResolvedValue({
          text: output?.text || 'Generated reply',
          finishReason: output?.finishReason || 'stop',
          usage: output?.usage || { inputTokens: 1, outputTokens: 2 },
          trace: output?.trace || { traceId: 'trace-1', modelResolved: 'openai/gpt-4.1', routeDecision: 'cloud' },
        }),
        stream: vi.fn(),
      },
    },
  } as unknown as Runtime;
}

function makeStreamRuntime(parts: TextStreamPart[]): Runtime {
  return {
    ai: {
      text: {
        generate: vi.fn(),
        stream: vi.fn().mockResolvedValue({
          stream: (async function* () {
            for (const part of parts) {
              yield part;
            }
          })(),
        }),
      },
    },
  } as unknown as Runtime;
}

describe('chat runtime helpers', () => {
  it('submits runtime chat requests with kit metadata defaults', async () => {
    const runtime = makeGenerateRuntime();
    const result = await submitRuntimeChat(runtime, {
      model: 'auto',
      input: 'Hello runtime',
      route: 'cloud',
    });

    expect(result.text).toBe('Generated reply');
    expect(runtime.ai.text.generate).toHaveBeenCalledWith({
      model: 'auto',
      input: 'Hello runtime',
      route: 'cloud',
      metadata: {
        callerKind: 'third-party-app',
        callerId: 'nimi-kit.chat.runtime',
        surfaceId: 'kit.features.chat',
      },
    });
  });

  it('collects stream deltas into a final text result', async () => {
    const runtime = makeStreamRuntime([
      { type: 'start' },
      { type: 'delta', text: 'Hello ' },
      { type: 'delta', text: 'world' },
      { type: 'finish', finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 2 }, trace: { traceId: 'trace-2' } },
    ]);
    const onDelta = vi.fn();

    const result = await streamRuntimeChatResponse(runtime, {
      model: 'auto',
      input: 'Hi',
      route: 'cloud',
    }, { onDelta });

    expect(onDelta).toHaveBeenNthCalledWith(1, 'Hello ', { type: 'delta', text: 'Hello ' });
    expect(onDelta).toHaveBeenNthCalledWith(2, 'world', { type: 'delta', text: 'world' });
    expect(result.text).toBe('Hello world');
    expect(result.finish?.type).toBe('finish');
  });

  it('creates a streaming composer adapter that resolves request overrides and emits chunk callbacks', async () => {
    const runtime = makeStreamRuntime([
      { type: 'start' },
      { type: 'delta', text: 'First ' },
      { type: 'delta', text: 'reply' },
      { type: 'finish', finishReason: 'stop', usage: { inputTokens: 3, outputTokens: 4 }, trace: { traceId: 'trace-3' } },
    ]);
    const onChunk = vi.fn();
    const onResponse = vi.fn();
    const adapter = createRuntimeChatComposerAdapter({
      runtime,
      mode: 'stream',
      resolveRequest: ({ text }) => ({
        model: 'auto',
        input: [
          { role: 'user', content: text },
        ],
        route: 'cloud',
      }),
      onChunk,
      onResponse,
    });

    await adapter.submit({
      text: 'Prompt me',
      attachments: [],
    });

    expect(runtime.ai.text.stream).toHaveBeenCalledTimes(1);
    expect(onChunk).toHaveBeenCalledTimes(3);
    expect(onResponse).toHaveBeenCalledWith({
      mode: 'stream',
      text: 'First reply',
      result: {
        text: 'First reply',
        finish: {
          type: 'finish',
          finishReason: 'stop',
          usage: { inputTokens: 3, outputTokens: 4 },
          trace: { traceId: 'trace-3' },
        },
      },
    }, {
      text: 'Prompt me',
      attachments: [],
    });
  });

  it('fails closed when attachments are present without a prompt resolver', async () => {
    const runtime = makeGenerateRuntime();
    const adapter = createRuntimeChatComposerAdapter<{ id: string }>({
      runtime,
      mode: 'generate',
      model: 'auto',
      route: 'cloud',
    });

    await expect(adapter.submit({
      text: 'Prompt me',
      attachments: [{ id: 'att-1' }],
    })).rejects.toThrow('runtime chat adapter requires resolveInput or resolveRequest when attachments are present');
  });
});
