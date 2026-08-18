import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  createNimiCloudAIConfigCapabilityIntent,
  createNimiLocalAIConfigCapabilityIntent,
} from '@nimiplatform/sdk/ai';
import {
  desktopNimiAppAIConfigQueryKey,
  findDesktopNimiTextIntent,
  projectDesktopMachineLoadoutSelections,
  readDesktopNimiAppAIConfig,
} from '../src/shell/renderer/features/chat/chat-nimi-app-ai-config.js';

test('Desktop App AIConfig cache identity preserves one exact appId', () => {
  assert.deepEqual(desktopNimiAppAIConfigQueryKey('tester.local-app'), [
    'app-ai-config',
    'tester.local-app',
  ]);
  assert.throws(() => desktopNimiAppAIConfigQueryKey(''));
  assert.throws(() => desktopNimiAppAIConfigQueryKey(' tester.local-app '));
});

test('Nimi Chat locates canonical text intent without owning its construction', () => {
  const imageIntent = createNimiLocalAIConfigCapabilityIntent({
    capabilityContract: 'image.generate',
    requiredFeatures: [],
  });
  const textIntent = createNimiCloudAIConfigCapabilityIntent({
    capabilityContract: 'text.generate',
    requiredFeatures: ['tool.use'],
    implementation: {
      implementationId: 'openai',
      driverId: 'nimillm',
      driverDialect: 'openai',
    },
    providerModelTarget: {
      provider: 'openai',
      providerModelId: 'gpt-test',
      remoteModelCatalogId: 'remote-model-catalog-gpt-test',
    },
  });

  assert.equal(findDesktopNimiTextIntent({
    owner: undefined,
    capabilities: [imageIntent, textIntent],
  }), textIntent);
});

test('Nimi Chat projects machine-local selection as read-only Model Config context', () => {
  assert.deepEqual(projectDesktopMachineLoadoutSelections({
    selections: [{
      capabilityContract: 'text.generate',
      loadoutId: 'local-text',
      effectiveDefaults: { temperature: '0.8' },
    }],
    loadouts: [{
      loadoutId: 'local-text', capabilityContract: 'text.generate',
      implementation: { implementationId: 'local.text.generate.llama-cpp', driverId: 'nimi.runtime.driver.llama-cpp', driverDialect: 'llama.cpp/text-generate/v1' },
      recipeId: 'llama.text-generate.gemma.v1', recipeRevision: '1', options: {}, modelAxes: [], recipeCustody: [],
      displayName: 'Local text', supportedFeatures: ['tool.use'], validationState: 'configured', reasons: [],
      provenance: {}, createdAt: '2026-08-15T00:00:00Z', updatedAt: '2026-08-15T00:00:00Z',
    }],
  }), [{
    capabilityContract: 'text.generate',
    state: 'selected',
    loadoutId: null,
    displayName: 'Local text',
    supportedFeatures: ['tool.use'],
    reasons: [],
    effectiveDefaults: { temperature: '0.8' },
  }]);
});

test('Nimi Chat treats missing App AIConfig as canonical not-configured state', async () => {
  assert.equal(await readDesktopNimiAppAIConfig({
    async get() {
      throw { reasonCode: 'AI_CONFIG_NOT_FOUND' };
    },
  }), null);

  const unavailable = { reasonCode: 'RUNTIME_UNAVAILABLE' };
  await assert.rejects(
    () => readDesktopNimiAppAIConfig({ async get() { throw unavailable; } }),
    (error) => error === unavailable,
  );
});

test('Nimi Chat settings delegates configuration UX to the public Kit owner surface', async () => {
  const source = await readFile(new URL(
    '../src/shell/renderer/features/chat/chat-shared-settings-panel.tsx',
    import.meta.url,
  ), 'utf8');

  assert.match(source, /ModelConfigAIConfigSurface/u);
  assert.match(source, /owner:\s*'app-ai-config'/u);
  assert.match(source, /appId:\s*DESKTOP_NIMI_APP_ID/u);
  assert.match(source, /capabilityContracts=\{\['text\.generate'\]\}/u);
  assert.doesNotMatch(source, /createDesktopNimi(?:Local|Cloud)TextIntent/u);
});

test('Desktop App AIConfig hooks resolve the exact App through the first-party semantic client', async () => {
  const source = await readFile(new URL(
    '../src/shell/renderer/features/chat/chat-nimi-app-ai-config.ts',
    import.meta.url,
  ), 'utf8');

  assert.match(source, /accountProduct\(\)\.appAIConfig\(appId\)/u);
  assert.doesNotMatch(source, /accountProduct\(\)\.aiConfig/u);
});
