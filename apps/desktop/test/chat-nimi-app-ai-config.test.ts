import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDesktopNimiCloudTextIntent,
  createDesktopNimiLocalTextIntent,
  desktopNimiTextIntentDefaults,
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

test('Nimi Chat Cloud selection writes route intent without implementation authority', () => {
  const intent = createDesktopNimiCloudTextIntent({
    requiredFeatures: ['tool.use'],
    defaults: { temperature: 0.4 },
  });

  assert.equal(intent.capabilityContract, 'text.generate');
  assert.deepEqual(intent.requiredFeatures, ['tool.use']);
  assert.deepEqual(desktopNimiTextIntentDefaults(intent), { temperature: 0.4 });
  assert.deepEqual(intent.route, {
    oneofKind: 'cloud',
    cloud: { connectorGrantId: '' },
  });
  assert.doesNotMatch(
    JSON.stringify(intent),
    /model|binding|target|implementation|readiness/i,
  );
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
