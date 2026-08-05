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

test('Nimi Chat Cloud commit admits the grantless selection-required information state', () => {
  const intent = createDesktopNimiCloudTextIntent(
    {
      requiredFeatures: ['tool.use'],
      defaults: { temperature: 0.4 },
    },
    {
      implementation: {
        implementationId: 'openai',
        driverId: 'nimillm',
        driverDialect: 'openai',
      },
      providerModelTarget: { provider: 'openai', providerModelId: 'gpt-test' },
      connectorGrantId: null,
    },
  );

  assert.equal(intent.capabilityContract, 'text.generate');
  assert.deepEqual(intent.requiredFeatures, ['tool.use']);
  assert.deepEqual(desktopNimiTextIntentDefaults(intent), { temperature: 0.4 });
  assert.equal(intent.route.oneofKind, 'cloud');
  if (intent.route.oneofKind !== 'cloud') throw new Error('expected Cloud route');
  assert.equal(intent.route.cloud.connectorGrantId, '');
  assert.equal(intent.route.cloud.implementation?.implementationId, 'openai');
  assert.doesNotMatch(
    JSON.stringify(intent.route.cloud.implementation),
    /connector|grant|target/i,
  );
});

test('Nimi Chat Cloud commit keeps target confirmation and ConnectorGrant selection separate', () => {
  const intent = createDesktopNimiCloudTextIntent(
    { requiredFeatures: ['text.generate'] },
    {
      implementation: {
        implementationId: 'openai',
        driverId: 'nimillm',
        driverDialect: 'openai',
      },
      providerModelTarget: {
        provider: 'openai',
        providerModelId: 'gpt-test',
      },
      connectorGrantId: 'grant-1',
    },
  );

  assert.equal(intent.route.oneofKind, 'cloud');
  if (intent.route.oneofKind !== 'cloud') throw new Error('expected Cloud route');
  assert.deepEqual(intent.route.cloud.implementation, {
    implementationId: 'openai',
    driverId: 'nimillm',
    driverDialect: 'openai',
  });
  assert.deepEqual(intent.route.cloud.providerModelTarget, {
    fields: {
      provider: { kind: { oneofKind: 'stringValue', stringValue: 'openai' } },
      providerModelId: { kind: { oneofKind: 'stringValue', stringValue: 'gpt-test' } },
    },
  });
  assert.equal(intent.route.cloud.connectorGrantId, 'grant-1');
  assert.doesNotMatch(JSON.stringify(intent.route.cloud.implementation), /grant|connector/i);
  assert.doesNotMatch(JSON.stringify(intent.route.cloud.providerModelTarget), /grant|connector/i);
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
