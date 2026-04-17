import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveChatAgentAvatarLive2dFramingPolicy,
} from '../src/shell/renderer/features/chat/chat-agent-avatar-live2d-framing';

test('live2d framing policy lifts tall no-layout full-body models in portrait rails', () => {
  assert.deepEqual(
    resolveChatAgentAvatarLive2dFramingPolicy({
      railWidth: 360,
      railHeight: 820,
      modelCanvasWidth: 1,
      modelCanvasHeight: 1.42,
      layout: new Map(),
    }),
    {
      mode: 'full-body-tall',
      height: 2.2,
      centerX: 0,
      centerY: 0.13,
    },
  );
});

test('live2d framing policy keeps wide no-layout models on explicit width framing in portrait rails', () => {
  assert.deepEqual(
    resolveChatAgentAvatarLive2dFramingPolicy({
      railWidth: 360,
      railHeight: 820,
      modelCanvasWidth: 1.4,
      modelCanvasHeight: 1,
      layout: new Map(),
    }),
    {
      mode: 'wide-in-portrait',
      width: 2,
      centerX: 0,
      centerY: 0.03,
    },
  );
});

test('live2d framing policy crops upper-body portrait models tighter for the chat rail', () => {
  assert.deepEqual(
    resolveChatAgentAvatarLive2dFramingPolicy({
      railWidth: 360,
      railHeight: 820,
      modelCanvasWidth: 1,
      modelCanvasHeight: 1.25,
      layout: new Map(),
    }),
    {
      mode: 'upper-body-portrait',
      height: 2.22,
      centerX: 0,
      centerY: 0.1,
    },
  );
});

test('live2d framing policy preserves strong layout metadata without extra recentering', () => {
  const layout = new Map<string, number>([
    ['CenterX', 0],
    ['CenterY', 0],
    ['Width', 2],
  ]);
  assert.deepEqual(
    resolveChatAgentAvatarLive2dFramingPolicy({
      railWidth: 360,
      railHeight: 820,
      modelCanvasWidth: 1,
      modelCanvasHeight: 1.2,
      layout,
    }),
    {
      mode: 'layout',
    },
  );
});

test('live2d framing policy recenters weak layout metadata inside portrait rails', () => {
  const layout = new Map<string, number>([
    ['Width', 1.7],
  ]);
  assert.deepEqual(
    resolveChatAgentAvatarLive2dFramingPolicy({
      railWidth: 360,
      railHeight: 820,
      modelCanvasWidth: 1,
      modelCanvasHeight: 1.1,
      layout,
    }),
    {
      mode: 'layout',
      centerX: 0,
      centerY: 0.06,
    },
  );
});
