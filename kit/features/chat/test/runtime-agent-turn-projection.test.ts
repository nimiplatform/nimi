import { describe, expect, it } from 'vitest';
import {
  createRuntimeAgentConversationProjectionState,
  reduceRuntimeAgentConversationProjectionEvent,
  streamRuntimeAgentTurnRunnerPartsAsConversationEvents,
} from '../src/headless.js';
import type { ConversationTurnEvent } from '../src/headless.js';

async function collectEvents(stream: AsyncIterable<ConversationTurnEvent>): Promise<ConversationTurnEvent[]> {
  const events: ConversationTurnEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

async function* parts(items: readonly unknown[]): AsyncIterable<unknown> {
  for (const item of items) {
    yield item;
  }
}

function reduceAll(events: readonly ConversationTurnEvent[]) {
  return events.reduce(
    (state, event) => reduceRuntimeAgentConversationProjectionEvent(state, event, {
      now: () => '2026-07-02T08:30:00.000Z',
    }),
    createRuntimeAgentConversationProjectionState({
      modeId: 'runtime-agent-chat-v1',
      threadId: 'thread-1',
      turnId: 'turn-ui-1',
      sessionId: 'agent-anchor-1',
      targetId: 'agent:local-1',
      conversationAnchorId: 'agent-anchor-1',
      localAgentRef: 'runtime-local-agent:1',
      userMessage: {
        id: 'user-message-1',
        text: '你好，知遇。',
        createdAt: '2026-07-02T08:29:59.000Z',
      },
      assistantMessageId: 'assistant-pending-1',
      assistantName: '知遇',
    }),
  );
}

describe('Runtime Agent chat turn projection', () => {
  it('maps Runtime Agent runner parts to canonical conversation events and transcript state', async () => {
    const events = await collectEvents(streamRuntimeAgentTurnRunnerPartsAsConversationEvents({
      modeId: 'runtime-agent-chat-v1',
      threadId: 'thread-1',
      turnId: 'turn-ui-1',
      parts: parts([
        { type: 'reasoning-delta', textDelta: '检查 Runtime anchor。' },
        { type: 'text-delta', textDelta: '你好，' },
        { type: 'text-delta', textDelta: 'Runtime 已连接。' },
        {
          type: 'message-sealed',
          envelope: {
            message: {
              messageId: 'runtime-message-1',
              text: '你好，Runtime 已连接。',
            },
          },
          diagnostics: {
            transport: 'runtime.agent.turns',
          },
        },
        {
          type: 'turn-completed',
          outputText: '你好，Runtime 已连接。',
          finishReason: 'stop',
          diagnostics: {
            runtimeTurnId: 'turn-runtime-1',
          },
        },
      ]),
    }));

    expect(events.map((event) => event.type)).toEqual([
      'turn-started',
      'reasoning-delta',
      'text-delta',
      'text-delta',
      'message-sealed',
      'turn-completed',
    ]);
    expect(events[4]).toEqual({
      type: 'message-sealed',
      turnId: 'turn-ui-1',
      messageId: 'runtime-message-1',
      beatId: 'turn-ui-1:beat:0',
      text: '你好，Runtime 已连接。',
    });

    const state = reduceAll(events);
    expect(state.status).toBe('completed');
    expect(state.reasonCode).toBe('runtime-agent-turn-completed');
    expect(state.messages).toHaveLength(2);
    expect(state.messages[0]).toEqual(expect.objectContaining({
      id: 'user-message-1',
      role: 'user',
      text: '你好，知遇。',
      status: 'complete',
    }));
    expect(state.messages[1]).toEqual(expect.objectContaining({
      id: 'runtime-message-1',
      role: 'agent',
      text: '你好，Runtime 已连接。',
      status: 'complete',
      kind: 'text',
    }));
    expect(state.messages[1]?.metadata).toEqual(expect.objectContaining({
      reasoningText: '检查 Runtime anchor。',
      transport: 'runtime.agent.turns',
      runtimeTurnId: 'turn-runtime-1',
    }));
  });

  it('preserves sanitized reasoning status and live action/tool lifecycle', async () => {
    const events = await collectEvents(streamRuntimeAgentTurnRunnerPartsAsConversationEvents({
      modeId: 'runtime-agent-chat-v1',
      threadId: 'thread-1',
      turnId: 'turn-ui-1',
      parts: parts([
        { type: 'reasoning-status', state: 'active' },
        {
          type: 'live-child', childKind: 'action', childId: 'action-1',
          name: 'image.generate', lifecycle: 'updated', progress: 'rendering',
        },
        {
          type: 'live-child', childKind: 'tool', childId: 'tool-1',
          name: 'lookup', lifecycle: 'failed', reasonCode: 'AI_PROVIDER_INTERNAL',
        },
        { type: 'message-sealed', envelope: { message: { messageId: 'message-1', text: 'done' } } },
        { type: 'turn-completed', outputText: 'done' },
      ]),
    }));

    expect(events.map((event) => event.type)).toEqual([
      'turn-started', 'reasoning-status', 'live-child', 'live-child',
      'message-sealed', 'turn-completed',
    ]);
    const state = reduceAll(events);
    expect(state.diagnostics).toEqual(expect.objectContaining({
      reasoningState: 'active',
      liveChild: expect.objectContaining({
        childKind: 'tool', childId: 'tool-1', lifecycle: 'failed',
      }),
    }));
    expect(state.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'live-child', childKind: 'action', childId: 'action-1' }),
      expect.objectContaining({ type: 'live-child', childKind: 'tool', childId: 'tool-1' }),
    ]));
  });

  it('fails closed when Runtime reports completion without a sealed message', async () => {
    const events = await collectEvents(streamRuntimeAgentTurnRunnerPartsAsConversationEvents({
      modeId: 'runtime-agent-chat-v1',
      threadId: 'thread-1',
      turnId: 'turn-ui-1',
      parts: parts([
        { type: 'text-delta', textDelta: 'partial answer' },
        { type: 'turn-completed', outputText: 'partial answer', finishReason: 'stop' },
      ]),
    }));

    expect(events.map((event) => event.type)).toEqual([
      'turn-started',
      'text-delta',
      'turn-failed',
    ]);
    const terminal = events[2];
    expect(terminal).toEqual(expect.objectContaining({
      type: 'turn-failed',
      turnId: 'turn-ui-1',
      outputText: 'partial answer',
    }));
    if (terminal.type !== 'turn-failed') {
      throw new Error('expected failed terminal event');
    }
    expect(terminal.error.code).toBe('RUNTIME_AGENT_CHAT_INVALID');

    const state = reduceAll(events);
    expect(state.status).toBe('failed');
    expect(state.reasonCode).toBe('RUNTIME_AGENT_CHAT_INVALID');
    expect(state.messages[1]).toEqual(expect.objectContaining({
      status: 'error',
      error: 'runtime.agent completed without structured message-sealed event',
    }));
  });

  it('keeps Runtime artifact identity while allowing host-provided preview URIs', async () => {
    const events = await collectEvents(streamRuntimeAgentTurnRunnerPartsAsConversationEvents({
      modeId: 'runtime-agent-chat-v1',
      threadId: 'thread-1',
      turnId: 'turn-ui-1',
      parts: parts([
        {
          type: 'message-sealed',
          envelope: {
            message: {
              messageId: 'runtime-message-1',
              text: '我生成了一张图。',
            },
          },
        },
        {
          type: 'artifact-ready',
          turnId: 'runtime-turn-1',
          beatId: 'action-0',
          artifactId: 'runtime-artifact-1',
          mimeType: 'image/png',
          projectionMessageId: 'runtime-projection-message-1',
        },
        {
          type: 'beat-delivered',
          turnId: 'runtime-turn-1',
          beatId: 'action-0',
          projectionMessageId: 'runtime-projection-message-1',
        },
        { type: 'turn-completed', outputText: '我生成了一张图。' },
      ]),
      resolveArtifactPreviewUri: async (artifact) => `runtime-preview://${artifact.artifactId}`,
    }));

    expect(events.map((event) => event.type)).toEqual([
      'turn-started',
      'message-sealed',
      'artifact-ready',
      'beat-delivered',
      'turn-completed',
    ]);
    expect(events[2]).toEqual({
      type: 'artifact-ready',
      turnId: 'turn-ui-1',
      beatId: 'turn-ui-1:beat:1',
      artifactId: 'runtime-artifact-1',
      mimeType: 'image/png',
      uri: 'runtime-preview://runtime-artifact-1',
      projectionMessageId: 'runtime-projection-message-1',
    });
  });

  it('projects typed image action failure without failing the committed text turn', async () => {
    const events = await collectEvents(streamRuntimeAgentTurnRunnerPartsAsConversationEvents({
      modeId: 'runtime-agent-chat-v1', threadId: 'thread-1', turnId: 'turn-ui-1',
      parts: parts([
        { type: 'message-sealed', envelope: { message: { messageId: 'runtime-message-1', text: 'I tried to generate an image.' } } },
        {
          type: 'beat-delivery-failed', turnId: 'runtime-turn-1', beatId: 'action-0',
          operation: 'image.generate', modality: 'image', reasonCode: 'AI_PROVIDER_TIMEOUT',
          reason: 'image_execution_failed', message: 'Image generation timed out.',
          projectionMessageId: 'runtime-image-message-1',
        },
        { type: 'turn-completed', outputText: 'I tried to generate an image.' },
      ]),
    }));
    expect(events[2]).toEqual(expect.objectContaining({
      type: 'beat-delivery-failed',
      operationId: 'runtime-turn-1:action-0',
      reasonCode: 'AI_PROVIDER_TIMEOUT',
    }));
    const state = reduceAll(events);
    expect(state.status).toBe('completed');
    expect(state.messages.at(-1)).toEqual(expect.objectContaining({
      id: 'runtime-image-message-1', kind: 'image', status: 'error', error: 'Image generation timed out.',
    }));
    expect(state.messages.at(-1)?.metadata).toEqual(expect.objectContaining({
      operationId: 'runtime-turn-1:action-0', reasonCode: 'AI_PROVIDER_TIMEOUT', imageTerminalState: 'failed',
    }));
  });

  it('projects resolved image artifacts as canonical image messages without taking artifact truth', async () => {
    const events = await collectEvents(streamRuntimeAgentTurnRunnerPartsAsConversationEvents({
      modeId: 'runtime-agent-chat-v1',
      threadId: 'thread-1',
      turnId: 'turn-ui-1',
      parts: parts([
        {
          type: 'message-sealed',
          envelope: {
            message: {
              messageId: 'runtime-message-1',
              text: 'I generated an image.',
            },
          },
        },
        {
          type: 'artifact-ready',
          beatId: 'action-0',
          artifactId: 'runtime-artifact-1',
          mimeType: 'image/png',
          projectionMessageId: 'runtime-image-message-1',
        },
        { type: 'turn-completed', outputText: 'I generated an image.' },
      ]),
      resolveArtifactPreviewUri: async (artifact) => `runtime-preview://${artifact.artifactId}`,
    }));

    const state = reduceAll(events);
    expect(state.status).toBe('completed');
    expect(state.messages).toHaveLength(3);
    expect(state.messages[1]).toEqual(expect.objectContaining({
      id: 'runtime-message-1',
      kind: 'text',
      status: 'complete',
      text: 'I generated an image.',
    }));
    expect(state.messages[1]?.metadata?.artifacts).toEqual([
      expect.objectContaining({
        artifactId: 'runtime-artifact-1',
        mimeType: 'image/png',
        uri: 'runtime-preview://runtime-artifact-1',
        projectionMessageId: 'runtime-image-message-1',
      }),
    ]);
    expect(state.messages[2]).toEqual(expect.objectContaining({
      id: 'runtime-image-message-1',
      role: 'agent',
      kind: 'image',
      status: 'complete',
      text: 'I generated an image.',
    }));
    expect(state.messages[2]?.metadata).toEqual(expect.objectContaining({
      artifactId: 'runtime-artifact-1',
      mimeType: 'image/png',
      mediaUrl: 'runtime-preview://runtime-artifact-1',
      projectionMessageId: 'runtime-image-message-1',
      artifactProjection: 'runtime.agent.turn.artifact_ready',
    }));
  });
});
