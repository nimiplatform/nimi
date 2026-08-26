import {
  assert,
  test,
  clearDesktopTestNimiClientSession,
  createDesktopTestNimiClientSession,
  streamChatAgentRuntimeAgentTurn,
} from './chat-agent-local-mode-test-utils.js';

test('Desktop Agent chat uses the canonical handle-only Conversation stream', async () => {
  clearDesktopTestNimiClientSession();
  const calls: unknown[] = [];
  let streamListener: ((event: { payload: unknown }) => void) | null = null;
  const host = globalThis as typeof globalThis & {
    __NIMI_ELECTRON_TEST__?: {
      invoke: (command: string, payload?: unknown) => Promise<unknown>;
      listen: (eventName: string, handler: (event: { payload: unknown }) => void) => () => void;
    };
  };
  host.__NIMI_ELECTRON_TEST__ = {
    invoke: async (command, payload) => {
      if (command.endsWith('.conversationSubscribe')) {
        return { subscriptionId: 'subscription-1', eventName: 'conversation-events-1' };
      }
      if (command.endsWith('.conversationSendTurn')) {
        calls.push((payload as { payload?: unknown })?.payload);
        queueMicrotask(() => {
          for (const event of [
            { conversationAnchorId: 'anchor-1', sequence: '1', turnId: 'turn-1', type: 'text-delta', delta: 'hello ' },
            { conversationAnchorId: 'anchor-1', sequence: '2', turnId: 'turn-1', type: 'message-committed', message: { turnId: 'turn-1', role: 'assistant', messageId: 'message-1', parts: [{ kind: 'text', text: 'hello back' }] } },
            { conversationAnchorId: 'anchor-1', sequence: '3', turnId: 'turn-1', type: 'turn-completed', terminalReason: 'stop' },
          ]) streamListener?.({ payload: { subscriptionId: 'subscription-1', eventType: 'next', event } });
          streamListener?.({ payload: { subscriptionId: 'subscription-1', eventType: 'completed' } });
        });
        return { turnId: 'turn-1' };
      }
      if (command.endsWith('.conversationSubscribe') && (payload as { payload?: { action?: string } })?.payload?.action === 'cancel') {
        return { subscriptionId: 'subscription-1', closed: true };
      }
      throw new Error(`unexpected command ${command}`);
    },
    listen: (_eventName, handler) => {
      streamListener = handler;
      return () => { streamListener = null; };
    },
  };
  await createDesktopTestNimiClientSession({
    appId: 'nimi.desktop.test.canonical-conversation',
    runtime: {
      auth: {},
      agents: {
        subscribeLocalAppConversationEvents: () => (async function* () {
          yield {
            conversationAnchorId: 'anchor-1', sequence: '1',
            event: { oneofKind: 'reasoningStatus', reasoningStatus: { turnId: 'turn-1', state: 2 } },
          };
          yield {
            conversationAnchorId: 'anchor-1', sequence: '2',
            event: { oneofKind: 'liveAction', liveAction: {
              turnId: 'turn-1', actionId: 'action-1', name: 'image.generate',
              lifecycle: 2, progress: 'rendering', reasonCode: 0,
            } },
          };
          yield {
            conversationAnchorId: 'anchor-1', sequence: '3',
            event: { oneofKind: 'liveTool', liveTool: {
              turnId: 'turn-1', toolId: 'tool-1', name: 'lookup',
              lifecycle: 1, reasonCode: 0,
            } },
          };
          yield {
            conversationAnchorId: 'anchor-1', sequence: '4',
            event: { oneofKind: 'textDelta', textDelta: { turnId: 'turn-1', delta: 'hello ' } },
          };
          yield {
            conversationAnchorId: 'anchor-1', sequence: '5',
            event: { oneofKind: 'messageCommitted', messageCommitted: { message: {
              turnId: 'turn-1', role: 2, messageId: 'message-1',
              parts: [{ part: { oneofKind: 'text', text: { text: 'hello back' } } }],
            } } },
          };
          yield {
            conversationAnchorId: 'anchor-1', sequence: '6',
            event: { oneofKind: 'turnCompleted', turnCompleted: { turnId: 'turn-1', terminalReason: 'stop' } },
          };
        })(),
        sendLocalAppConversationTurn: async (request: unknown) => {
          calls.push(request);
          return { turnId: 'turn-1' };
        },
        interruptLocalAppConversationTurn: async () => ({ turnId: 'turn-1' }),
      },
    },
  });
  try {
    const result = await streamChatAgentRuntimeAgentTurn({
      agentHandle: 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      conversationAnchorId: 'anchor-1', threadId: 'thread-1', userMessageId: 'user-message-1',
      userText: 'hello', reasoningPreference: 'off', signal: new AbortController().signal,
    });
    const parts = [];
    for await (const part of result.stream) parts.push(part);
    assert.deepEqual(parts.map((part) => part.type), [
      'reasoning-status', 'live-child', 'live-child',
      'text-delta', 'message-sealed', 'turn-completed',
    ]);
    assert.equal((calls[0] as { agentHandle?: string }).agentHandle, 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    assert.equal(JSON.stringify(calls).includes('localAgentRef'), false);
  } finally {
    delete host.__NIMI_ELECTRON_TEST__;
    clearDesktopTestNimiClientSession();
  }
});
