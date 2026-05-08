import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeRouteBinding } from '@nimiplatform/sdk/mod';
import { streamSectorAnalyst } from './sector-analyst-runtime.js';

const mocks = vi.hoisted(() => ({
  getPlatformClient: vi.fn(),
}));

vi.mock('@nimiplatform/sdk', () => ({
  getPlatformClient: mocks.getPlatformClient,
}));

async function* streamEvents(events: Array<Record<string, unknown>>) {
  for (const event of events) {
    yield event;
  }
}

const binding = {
  source: 'local',
  modelId: 'polyinfo-model',
} as RuntimeRouteBinding;

describe('sector analyst runtime stream completion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns assistant text only after a completed stream event', async () => {
    const streamScenario = vi.fn(async () => streamEvents([
      {
        traceId: 'trace-started',
        payload: {
          oneofKind: 'started',
          started: { modelResolved: 'resolved-model' },
        },
      },
      {
        traceId: 'trace-delta',
        payload: {
          oneofKind: 'delta',
          delta: {
            delta: {
              oneofKind: 'text',
              text: { text: 'finished answer' },
            },
          },
        },
      },
      {
        traceId: 'trace-completed',
        payload: {
          oneofKind: 'completed',
          completed: { finishReason: 1 },
        },
      },
    ]));
    mocks.getPlatformClient.mockReturnValue({
      runtime: {
        appId: 'nimi.polyinfo',
        ai: { streamScenario },
      },
    });

    await expect(streamSectorAnalyst({
      binding,
      prompt: 'Analyze this sector',
      systemPrompt: 'Stay inside evidence',
    })).resolves.toMatchObject({
      text: 'finished answer',
      finishReason: 'stop',
      traceId: 'trace-completed',
      modelResolved: 'resolved-model',
    });
  });

  it('fails closed when a stream ends without a completed event', async () => {
    const streamScenario = vi.fn(async () => streamEvents([
      {
        traceId: 'trace-started',
        payload: {
          oneofKind: 'started',
          started: { modelResolved: 'resolved-model' },
        },
      },
      {
        traceId: 'trace-delta',
        payload: {
          oneofKind: 'delta',
          delta: {
            delta: {
              oneofKind: 'text',
              text: { text: 'partial answer' },
            },
          },
        },
      },
    ]));
    mocks.getPlatformClient.mockReturnValue({
      runtime: {
        appId: 'nimi.polyinfo',
        ai: { streamScenario },
      },
    });

    await expect(streamSectorAnalyst({
      binding,
      prompt: 'Analyze this sector',
      systemPrompt: 'Stay inside evidence',
    })).rejects.toThrow('分析请求未返回完成事件，请稍后重试。');
  });
});
