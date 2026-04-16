import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createIdleChatAgentAvatarPointerInteractionState,
  hasValidChatAgentAvatarStageRect,
  resolveChatAgentAvatarPointerInteractionScopeKey,
  resolveChatAgentAvatarPointerInteraction,
  shouldUpdateChatAgentAvatarPointerInteraction,
} from '../src/shell/renderer/features/chat/chat-agent-avatar-pointer-interaction.js';

test('avatar pointer interaction normalizes stage-local coordinates into a bounded symmetric range', () => {
  const state = resolveChatAgentAvatarPointerInteraction({
    clientX: 150,
    clientY: 50,
    rect: {
      left: 50,
      top: 0,
      width: 200,
      height: 100,
    },
  });

  assert.equal(state.hovered, true);
  assert.equal(state.normalizedX, 0);
  assert.equal(state.normalizedY, 0);
  assert.equal(state.interactionBoost, 'hover');
});

test('avatar pointer interaction clamps out-of-bounds positions and escalates engagement near stage edges', () => {
  const state = resolveChatAgentAvatarPointerInteraction({
    clientX: 350,
    clientY: -100,
    rect: {
      left: 100,
      top: 0,
      width: 200,
      height: 200,
    },
  });

  assert.equal(state.normalizedX, 1);
  assert.equal(state.normalizedY, -1);
  assert.equal(state.interactionBoost, 'engaged');
});

test('avatar pointer interaction fails closed when stage bounds are invalid', () => {
  assert.equal(hasValidChatAgentAvatarStageRect(null), false);
  assert.deepEqual(
    resolveChatAgentAvatarPointerInteraction({
      clientX: 100,
      clientY: 100,
      rect: {
        left: 0,
        top: 0,
        width: 0,
        height: 120,
      },
    }),
    createIdleChatAgentAvatarPointerInteractionState(),
  );
});

test('avatar pointer interaction applies a center deadzone before follow consume', () => {
  const state = resolveChatAgentAvatarPointerInteraction({
    clientX: 101,
    clientY: 100,
    rect: {
      left: 0,
      top: 0,
      width: 200,
      height: 200,
    },
  });

  assert.equal(state.normalizedX, 0);
  assert.equal(state.normalizedY, 0);
});

test('avatar pointer interaction scope key includes both agent target and thread owner', () => {
  assert.equal(
    resolveChatAgentAvatarPointerInteractionScopeKey({
      targetId: 'agent-1',
      canonicalSessionId: 'thread-a',
    }),
    'thread-a::agent-1',
  );
  assert.equal(
    resolveChatAgentAvatarPointerInteractionScopeKey({
      targetId: 'agent-1',
      canonicalSessionId: 'thread-b',
    }),
    'thread-b::agent-1',
  );
  assert.equal(
    resolveChatAgentAvatarPointerInteractionScopeKey({
      targetId: 'agent-1',
      canonicalSessionId: null,
    }),
    'detached-session::agent-1',
  );
});

test('avatar pointer interaction ignores sub-epsilon move updates to reduce hover jitter', () => {
  assert.equal(
    shouldUpdateChatAgentAvatarPointerInteraction(
      {
        hovered: true,
        normalizedX: 0.2,
        normalizedY: -0.1,
        interactionBoost: 'hover',
      },
      {
        hovered: true,
        normalizedX: 0.209,
        normalizedY: -0.11,
        interactionBoost: 'hover',
      },
    ),
    false,
  );
  assert.equal(
    shouldUpdateChatAgentAvatarPointerInteraction(
      {
        hovered: true,
        normalizedX: 0.2,
        normalizedY: -0.1,
        interactionBoost: 'hover',
      },
      {
        hovered: true,
        normalizedX: 0.26,
        normalizedY: -0.1,
        interactionBoost: 'hover',
      },
    ),
    true,
  );
});
