import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyChatAgentAvatarDebugOverride,
  CHAT_AGENT_AVATAR_DEBUG_DEFAULTS,
  clearChatAgentAvatarDebugOverride,
  readChatAgentAvatarDebugOverride,
  resolveChatAgentAvatarDebugFormState,
} from '../src/shell/renderer/features/chat/chat-agent-avatar-debug-override.js';

test('chat agent avatar debug form state falls back to defaults when override is missing', () => {
  assert.deepEqual(resolveChatAgentAvatarDebugFormState(null), CHAT_AGENT_AVATAR_DEBUG_DEFAULTS);
  assert.deepEqual(resolveChatAgentAvatarDebugFormState({
    phase: 'speaking',
    label: 'Speaking test',
  }), {
    phase: 'speaking',
    emotion: 'joy',
    label: 'Speaking test',
    amplitude: '0.34',
  });
});

test('chat agent avatar debug override can be applied, read, and cleared', () => {
  const previousWindow = (globalThis as typeof globalThis & { window?: unknown }).window;
  const dispatchedEvents: string[] = [];
  const mockWindow = {
    __NIMI_CHAT_AVATAR_SMOKE_OVERRIDE__: null as Record<string, unknown> | null,
    __NIMI_LIVE2D_SMOKE_OVERRIDE__: null as Record<string, unknown> | null,
    dispatchEvent(event: Event) {
      dispatchedEvents.push(event.type);
      return true;
    },
  };
  Object.defineProperty(globalThis, 'window', {
    value: mockWindow,
    configurable: true,
    writable: true,
  });
  try {
    applyChatAgentAvatarDebugOverride({
      phase: 'idle',
      emotion: 'playful',
      label: 'Playful test',
      amplitude: 0.42,
    });
    assert.deepEqual(readChatAgentAvatarDebugOverride(), {
      phase: 'idle',
      emotion: 'playful',
      label: 'Playful test',
      amplitude: 0.42,
    });
    assert.equal(mockWindow.__NIMI_CHAT_AVATAR_SMOKE_OVERRIDE__?.emotion, 'playful');
    assert.equal(mockWindow.__NIMI_LIVE2D_SMOKE_OVERRIDE__?.emotion, 'playful');

    clearChatAgentAvatarDebugOverride();
    assert.equal(readChatAgentAvatarDebugOverride(), null);
    assert.equal(mockWindow.__NIMI_CHAT_AVATAR_SMOKE_OVERRIDE__, null);
    assert.equal(mockWindow.__NIMI_LIVE2D_SMOKE_OVERRIDE__, null);
    assert.deepEqual(dispatchedEvents, [
      'nimi:chat-avatar-smoke-override-change',
      'nimi:chat-avatar-smoke-override-change',
    ]);
  } finally {
    if (previousWindow === undefined) {
      Object.defineProperty(globalThis, 'window', {
        value: undefined,
        configurable: true,
        writable: true,
      });
    } else {
      Object.defineProperty(globalThis, 'window', {
        value: previousWindow,
        configurable: true,
        writable: true,
      });
    }
  }
});
