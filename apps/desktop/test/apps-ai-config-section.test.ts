import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  createNimiCloudAIConfigCapabilityIntent,
  createNimiLocalAIConfigCapabilityIntent,
  runtimeAIConfigStructToJson,
} from '@nimiplatform/sdk/ai';
import { CANONICAL_CAPABILITY_IDS } from '@nimiplatform/kit/core/runtime-capabilities';
import {
  APPS_AI_CONFIG_APP_ACCESS_DOMAIN,
  appsAIConfigCapabilityContracts,
  buildAppsOneClickLocalAIConfig,
} from '../src/shell/renderer/features/apps/apps-ai-config-section.js';
import { readDesktopLocale } from './helpers/read-desktop-locale.js';

test('Apps AIConfig composes exact canonical capabilities only for runtime consumers', () => {
  assert.deepEqual(appsAIConfigCapabilityContracts(['realm.data']), []);
  assert.deepEqual(
    appsAIConfigCapabilityContracts(['realm.data', APPS_AI_CONFIG_APP_ACCESS_DOMAIN]),
    CANONICAL_CAPABILITY_IDS,
  );
  assert.ok(CANONICAL_CAPABILITY_IDS.includes('voice.create'));
  assert.ok(CANONICAL_CAPABILITY_IDS.includes('audio.synthesize'));
});

test('Apps one-click configuration uses selected Local models and leaves missing capabilities unchanged', () => {
  const existingText = createNimiCloudAIConfigCapabilityIntent({
    capabilityContract: 'text.generate',
    requiredFeatures: ['tool.use'],
    defaults: { temperature: 0.4 },
    implementation: {
      implementationId: 'cloud-test',
      driverId: 'nimillm',
      driverDialect: 'openai',
    },
    providerModelTarget: {
      provider: 'test',
      providerModelId: 'cloud-model',
      remoteModelCatalogId: 'remote-cloud-model',
    },
  });
  const existingAudio = createNimiLocalAIConfigCapabilityIntent({
    capabilityContract: 'audio.synthesize',
  });

  const next = buildAppsOneClickLocalAIConfig(
    ['text.generate', 'image.generate', 'audio.synthesize'],
    [existingText, existingAudio],
    [
      {
        capabilityContract: 'text.generate', state: 'selected', loadoutId: null,
        displayName: 'Local text', supportedFeatures: ['tool.use'], reasons: [],
      },
      {
        capabilityContract: 'image.generate', state: 'missing', loadoutId: null,
        displayName: null, supportedFeatures: [], reasons: [],
      },
      {
        capabilityContract: 'audio.synthesize', state: 'broken', loadoutId: null,
        displayName: null, supportedFeatures: [], reasons: ['loadout-unresolved'],
      },
    ],
  );

  assert.ok(next);
  const text = next.find((capability) => capability.capabilityContract === 'text.generate');
  assert.equal(text?.route.oneofKind, 'local');
  assert.deepEqual(text?.requiredFeatures, ['tool.use']);
  assert.deepEqual(runtimeAIConfigStructToJson(text?.defaults), { temperature: 0.4 });
  assert.equal(next.find((capability) => capability.capabilityContract === 'audio.synthesize'), existingAudio);
  assert.equal(next.some((capability) => capability.capabilityContract === 'image.generate'), false);
  assert.doesNotMatch(JSON.stringify(next), /loadoutId|providerModelId|remoteModelCatalogId/u);
});

test('Apps one-click configuration performs no write plan when no Local model is selected', () => {
  assert.equal(buildAppsOneClickLocalAIConfig(
    ['text.generate'],
    [],
    [{
      capabilityContract: 'text.generate', state: 'unavailable', loadoutId: null,
      displayName: null, supportedFeatures: [], reasons: [],
    }],
  ), null);
});

test('Apps detail mounts the Nimi-owned first-party surface with the exact app identity', async () => {
  const [detailSource, sectionSource] = await Promise.all([
    readFile(new URL(
      '../src/shell/renderer/features/apps/apps-detail-view.tsx',
      import.meta.url,
    ), 'utf8'),
    readFile(new URL(
      '../src/shell/renderer/features/apps/apps-ai-config-section.tsx',
      import.meta.url,
    ), 'utf8'),
  ]);

  assert.match(detailSource, /appsAIConfigCapabilityContracts\(registration\.appAccess\)/u);
  assert.match(detailSource, /DetailTabButton id="ai-models"/u);
  assert.match(detailSource, /requestedSection === 'ai-models' && aiModelsAvailable/u);
  assert.match(detailSource, /activeTab === 'ai-models'[\s\S]*AppsAIConfigSection/u);
  const accessPanelStart = detailSource.indexOf("activeTab === 'access'");
  const aiModelsPanelStart = detailSource.indexOf("activeTab === 'ai-models'");
  assert.ok(accessPanelStart >= 0 && aiModelsPanelStart > accessPanelStart);
  assert.doesNotMatch(detailSource.slice(accessPanelStart, aiModelsPanelStart), /AppsAIConfigSection/u);
  assert.match(detailSource, /appId=\{registration\.appId\}/u);
  assert.match(sectionSource, /consumer:\s*'nimi-first-party'/u);
  assert.match(sectionSource, /capabilityContracts=\{CANONICAL_CAPABILITY_IDS\}/u);
  assert.match(sectionSource, /useDesktopNimiAppAIConfig\(appId\)/u);
  assert.match(sectionSource, /useOverwriteDesktopNimiAppAIConfig\(appId\)/u);
  assert.match(sectionSource, /useDesktopNimiMachineLocalSelections\(\)/u);
  assert.match(sectionSource, /createDesktopCloudAIConfigModule\(sdk\)/u);
  assert.match(sectionSource, /buildAppsOneClickLocalAIConfig/u);
  assert.match(sectionSource, /apps-ai-config-one-click-local/u);
});

test('Apps AIConfig owner copy covers every canonical capability in both locales', () => {
  const enApps = readDesktopLocale('en').Apps;
  const zhApps = readDesktopLocale('zh').Apps;
  const en = enApps.aiConfig;
  const zh = zhApps.aiConfig;
  assert.equal(typeof enApps.detail.aiModelsTab, 'string');
  assert.equal(typeof zhApps.detail.aiModelsTab, 'string');
  const capabilityKeys = [
    'audioSynthesize',
    'audioTranscribe',
    'imageGenerate',
    'musicGenerate',
    'textEmbed',
    'textGenerate',
    'videoGenerate',
    'voiceCreate',
    'worldGenerate',
  ];

  for (const locale of [en, zh]) {
    assert.equal(typeof locale.title, 'string');
    assert.equal(typeof locale.description, 'string');
    assert.equal(typeof locale.cloudImpactConfirmation, 'string');
    assert.equal(typeof locale.oneClickLabel, 'string');
    assert.equal(typeof locale.oneClickHint, 'string');
    assert.equal(typeof locale.oneClickNoLocalModels, 'string');
    assert.equal(typeof locale.oneClickFailed, 'string');
    for (const key of capabilityKeys) {
      assert.equal(typeof locale.capability[key].label, 'string');
      assert.equal(typeof locale.capability[key].description, 'string');
    }
  }
});
