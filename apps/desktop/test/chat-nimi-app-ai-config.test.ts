import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDesktopNimiLocalTextIntent,
  findDesktopNimiTextIntent,
  replaceDesktopNimiTextIntent,
} from '../src/shell/renderer/features/chat/chat-nimi-app-ai-config.js';

test('Nimi Chat local selection carries no machine binding or model identity', () => {
  assert.deepEqual(createDesktopNimiLocalTextIntent(), {
    capabilityContract: 'text.generate',
    requiredFeatures: [],
    defaults: undefined,
    route: {
      oneofKind: 'local',
      local: {},
    },
  });
});

test('Nimi Chat text replacement preserves unrelated capability intent', () => {
  const imageIntent = {
    capabilityContract: 'image.generate',
    requiredFeatures: [],
    defaults: undefined,
    route: {
      oneofKind: 'local' as const,
      local: {},
    },
  };
  const next = replaceDesktopNimiTextIntent(
    [
      {
        capabilityContract: 'text.generate',
        requiredFeatures: [],
        defaults: undefined,
        route: {
          oneofKind: 'cloud' as const,
          cloud: {
            implementation: undefined,
            providerModelTarget: undefined,
            connectorGrantId: '',
          },
        },
      },
      imageIntent,
    ],
    createDesktopNimiLocalTextIntent(),
  );

  assert.deepEqual(next, [createDesktopNimiLocalTextIntent(), imageIntent]);
  assert.deepEqual(findDesktopNimiTextIntent({
    owner: undefined,
    capabilities: next,
  }), createDesktopNimiLocalTextIntent());
});
