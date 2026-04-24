import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createForegroundHandsFreeAgentVoiceSessionShellState,
  createInitialAgentVoiceSessionShellState,
  resolveIdleAgentVoiceSessionShellState,
  resolveAgentComposerVoiceState,
} from '../src/shell/renderer/features/chat/chat-agent-voice-session.js';

test('agent voice session composer state maps listening to recording semantics', () => {
  const voiceState = resolveAgentComposerVoiceState({
    state: {
      status: 'listening',
      mode: 'push-to-talk',
      conversationAnchorId: 'anchor-1',
      message: null,
    },
    onToggle: () => undefined,
    onCancel: () => undefined,
  });

  assert.equal(voiceState.status, 'recording');
});

test('agent voice session shell starts idle and failed shell state maps to failed composer state', () => {
  assert.deepEqual(createInitialAgentVoiceSessionShellState(), {
    status: 'idle',
    mode: 'push-to-talk',
    conversationAnchorId: null,
    message: null,
  });
  assert.deepEqual(createForegroundHandsFreeAgentVoiceSessionShellState(), {
    status: 'idle',
    mode: 'hands-free',
    conversationAnchorId: null,
    message: null,
  });
  assert.deepEqual(resolveIdleAgentVoiceSessionShellState('hands-free'), {
    status: 'idle',
    mode: 'hands-free',
    conversationAnchorId: null,
    message: null,
  });

  const voiceState = resolveAgentComposerVoiceState({
    state: {
      status: 'failed',
      mode: 'hands-free',
      conversationAnchorId: 'anchor-1',
      message: 'route unavailable',
    },
    onToggle: () => undefined,
    onCancel: () => undefined,
  });

  assert.equal(voiceState.status, 'failed');
});
