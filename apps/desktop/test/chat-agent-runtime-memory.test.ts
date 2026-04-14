import assert from 'node:assert/strict';
import test from 'node:test';
import {
  runDesktopAgentAssistantTurnRuntimeFollowUp,
} from '../src/shell/renderer/features/chat/chat-agent-runtime-memory';

test('assistant turn runtime follow-up writes memory before forwarding chat sidecar input', async () => {
  const calls: string[] = [];

  await runDesktopAgentAssistantTurnRuntimeFollowUp({
    agentId: 'agent-1',
    displayName: 'Agent One',
    worldId: 'world-1',
    assistantText: 'I can help with that.',
    turnId: 'turn-1',
    threadId: 'thread-1',
    history: [
      { id: 'msg-user-1', role: 'user', text: 'hello' },
    ],
  }, {
    writeAssistantTurnMemory: async () => {
      calls.push('write');
    },
    sendChatTrackSidecarInput: async (input) => {
      calls.push('send');
      assert.equal(input.agentId, 'agent-1');
      assert.equal(input.turnId, 'turn-1');
      assert.equal(input.threadId, 'thread-1');
      assert.equal(input.history.length, 1);
      assert.equal(input.assistantText, 'I can help with that.');
    },
    log: async () => {
      calls.push('log');
    },
  });

  assert.deepEqual(calls, ['write', 'send']);
});

test('assistant turn runtime follow-up logs sidecar forwarding failures without failing the committed turn', async () => {
  const calls: string[] = [];

  await assert.doesNotReject(async () => {
    await runDesktopAgentAssistantTurnRuntimeFollowUp({
      agentId: 'agent-1',
      displayName: 'Agent One',
      worldId: null,
      assistantText: 'reply',
      turnId: 'turn-2',
      threadId: 'thread-2',
      history: [
        { id: 'msg-user-2', role: 'user', text: 'hello again' },
      ],
    }, {
      writeAssistantTurnMemory: async () => {
        calls.push('write');
      },
      sendChatTrackSidecarInput: async () => {
        calls.push('send');
        throw new Error('transport unavailable');
      },
      log: async (payload) => {
        calls.push('log');
        assert.equal(payload.message, 'action:agent-chat-sidecar-forwarding-failed');
      },
    });
  });

  assert.deepEqual(calls, ['write', 'send', 'log']);
});
