import { describe, expect, it, vi } from 'vitest';
import type { Runtime, TextGenerateOutput, TextStreamPart } from '@nimiplatform/kit/core/sdk-contract';
import {
  createAppAiChatComposerAdapter,
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

describe('app AI chat helpers', () => {
  it('creates a generate composer adapter with kit metadata defaults', async () => {
    const runtime = makeGenerateRuntime();
    const onResponse = vi.fn();
    const adapter = createAppAiChatComposerAdapter({
      runtime,
      mode: 'generate',
      model: 'runtime-selected-chat',
      route: 'cloud',
      onResponse,
    });

    await adapter.submit({
      text: 'Hello runtime',
      attachments: [],
    });

    expect(runtime.ai.text.generate).toHaveBeenCalledWith({
      model: 'runtime-selected-chat',
      input: 'Hello runtime',
      route: 'cloud',
      metadata: {
        callerKind: 'third-party-app',
        callerId: 'nimi-kit.chat.app-ai',
        surfaceId: 'kit.features.chat',
      },
    });
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
    const runtime = makeStreamRuntime([
      { type: 'start' },
      { type: 'delta', text: 'First ' },
      { type: 'delta', text: 'reply' },
      { type: 'finish', finishReason: 'stop', usage: { inputTokens: 3, outputTokens: 4 }, trace: { traceId: 'trace-3' } },
    ]);
    const onChunk = vi.fn();
    const onResponse = vi.fn();
    const adapter = createAppAiChatComposerAdapter({
      runtime,
      mode: 'stream',
      resolveRequest: ({ text }) => ({
        model: 'runtime-selected-chat',
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
    const adapter = createAppAiChatComposerAdapter<{ id: string }>({
      runtime,
      mode: 'generate',
      model: 'runtime-selected-chat',
      route: 'cloud',
    });

    await expect(adapter.submit({
      text: 'Prompt me',
      attachments: [{ id: 'att-1' }],
    })).rejects.toThrow('app AI chat adapter requires resolveInput or resolveRequest when attachments are present');
  });

  it('fails closed when a composer request lacks an explicit model', async () => {
    const runtime = makeGenerateRuntime();
    const adapter = createAppAiChatComposerAdapter({
      runtime,
      mode: 'generate',
      route: 'cloud',
    });

    await expect(adapter.submit({
      text: 'Prompt me',
      attachments: [],
    })).rejects.toThrow('app AI chat adapter requires an explicit model or resolveRequest');
    expect(runtime.ai.text.generate).not.toHaveBeenCalled();
  });

  it('fails closed when a composer request uses auto as a pseudo-model', async () => {
    const runtime = makeGenerateRuntime();
    const adapter = createAppAiChatComposerAdapter({
      runtime,
      mode: 'generate',
      model: 'auto',
      route: 'cloud',
    });

    await expect(adapter.submit({
      text: 'Prompt me',
      attachments: [],
    })).rejects.toThrow('app AI chat adapter requires a concrete Runtime model, not auto');
    expect(runtime.ai.text.generate).not.toHaveBeenCalled();
  });
});
