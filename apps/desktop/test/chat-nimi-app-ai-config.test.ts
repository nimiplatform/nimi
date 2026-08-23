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
  readDesktopNimiAppAIConfig,
} from '../src/shell/renderer/features/chat/chat-nimi-app-ai-config.js';

test('Desktop App AIConfig cache identity preserves one exact appId', () => {
  assert.deepEqual(desktopNimiAppAIConfigQueryKey('acme.widget'), [
    'app-ai-config',
    'acme.widget',
  ]);
  assert.throws(() => desktopNimiAppAIConfigQueryKey(''));
  assert.throws(() => desktopNimiAppAIConfigQueryKey(' acme.widget '));
});

test('Nimi Chat locates canonical text intent without owning its construction', () => {
  const imageIntent = createNimiLocalAIConfigCapabilityIntent({
    capabilityContract: 'image.generate',
    requiredFeatures: [],
  });
  const textIntent = createNimiCloudAIConfigCapabilityIntent({
    capabilityContract: 'text.generate',
    connectorRef: 'connector:text',
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

test('Nimi Chat treats missing App AIConfig as canonical not-configured state', async () => {
  const missing = { config: null, revision: '0', effectiveSelections: [] } as const;
  assert.deepEqual(await readDesktopNimiAppAIConfig({
    async get() {
      return missing;
    },
  }), missing);

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
  assert.match(source, /Mutation results acknowledge committed\/current config/u);
  assert.match(source, /staleTime:\s*0/u);
  assert.match(source, /refetchOnMount:\s*'always'/u);
  assert.match(source, /refetchOnWindowFocus:\s*'always'/u);
  assert.doesNotMatch(source, /result\.outcome === 'committed'[\s\S]*invalidateQueries/u);
});
