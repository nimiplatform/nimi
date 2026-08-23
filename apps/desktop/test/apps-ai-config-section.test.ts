import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { CANONICAL_CAPABILITY_IDS } from '@nimiplatform/kit/core/runtime-capabilities';
import {
  APPS_AI_CONFIG_APP_ACCESS_DOMAIN,
  appsAIConfigCapabilityContracts,
  buildAppsOneClickLocalAIConfig,
} from '../src/shell/renderer/features/apps/apps-ai-config-section.js';
import { createNimiCloudAIConfigCapabilityIntent } from '@nimiplatform/kit/core/sdk-contract';
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
  assert.match(detailSource, /aiModelsAvailable \? \[\{ value: 'ai-models'/u);
  assert.match(detailSource, /requestedSection === 'ai-models' && aiModelsAvailable/u);
  assert.match(detailSource, /activeTab === 'ai-models'[\s\S]*AppsAIConfigSection/u);
  const accessPanelStart = detailSource.indexOf("activeTab === 'access'");
  const aiModelsPanelStart = detailSource.indexOf("activeTab === 'ai-models'");
  assert.ok(accessPanelStart >= 0 && aiModelsPanelStart > accessPanelStart);
  assert.doesNotMatch(detailSource.slice(accessPanelStart, aiModelsPanelStart), /AppsAIConfigSection/u);
  assert.match(detailSource, /appId=\{registration\.appId\}/u);
  assert.match(detailSource, /allowedRoutes=\{registration\.aiConfigAllowedRoutes\}/u);
  assert.doesNotMatch(sectionSource, /consumer:\s*'nimi-first-party'/u);
  assert.match(sectionSource, /capabilityContracts=\{CANONICAL_CAPABILITY_IDS\}/u);
  assert.match(sectionSource, /allowedRoutes=\{allowedRoutes\}/u);
  assert.match(sectionSource, /headerSlot=\{allowedRoutes\.includes\('local'\)/u);
  assert.doesNotMatch(sectionSource, /parentos/iu);
  assert.match(sectionSource, /useDesktopNimiAppAIConfig\(appId\)/u);
  assert.match(sectionSource, /useOverwriteDesktopNimiAppAIConfig\(appId\)/u);
  assert.match(sectionSource, /effectiveSelections=\{appAIConfig\.data\?\.effectiveSelections\}/u);
  assert.doesNotMatch(sectionSource, /projectDesktopAIConfigEffectiveSelections/u);
  assert.match(sectionSource, /listOptions\(query\)/u);
  assert.doesNotMatch(sectionSource, /createDesktopCloudAIConfigModule/u);
  assert.match(sectionSource, /buildAppsOneClickLocalAIConfig/u);
  assert.match(sectionSource, /apps-ai-config-one-click-local/u);
  assert.match(sectionSource, /machineSelections\.refetch\(\)/u);
  assert.match(sectionSource, /appAIConfig\.refetch\(\)/u);
  assert.match(sectionSource, /staleTime:\s*0/u);
  assert.match(sectionSource, /refetchOnMount:\s*'always'/u);
  assert.match(sectionSource, /refetchOnWindowFocus:\s*'always'/u);
  assert.match(sectionSource, /result\.outcome === 'conflict'[\s\S]*setOneClickFailure\('conflict'\)/u);
  assert.match(sectionSource, /overwriteAppAIConfig\.mutateAsync\(input\)[\s\S]*onAIConfigChanged\(result\)/u);
});

test('Apps one-click Local writes route-only intent and preserves capabilities without machine selection', () => {
  const preservedCloud = createNimiCloudAIConfigCapabilityIntent({
    capabilityContract: 'audio.transcribe',
    connectorRef: 'connector:audio',
    implementation: {
      implementationId: 'cloud.audio', driverId: 'cloud', driverDialect: 'test/cloud/v1',
    },
    providerModelTarget: {
      provider: 'provider-a', providerModelId: 'audio-1', remoteModelCatalogId: 'catalog-audio-1',
    },
  });
  const current = [{
    capabilityContract: 'text.generate',
    requiredFeatures: ['input.image'],
    defaults: { fields: { maxTokens: { kind: { oneofKind: 'numberValue' as const, numberValue: 256 } } } },
    route: { oneofKind: 'cloud' as const, cloud: preservedCloud.route.oneofKind === 'cloud' ? preservedCloud.route.cloud : null! },
  }, preservedCloud];

  const next = buildAppsOneClickLocalAIConfig(current, ['text.generate']);
  const text = next.find((entry) => entry.capabilityContract === 'text.generate');
  const audio = next.find((entry) => entry.capabilityContract === 'audio.transcribe');
  assert.deepEqual(text?.route, { oneofKind: 'local', local: {} });
  assert.deepEqual(text?.requiredFeatures, ['input.image']);
  assert.equal(text?.defaults?.fields.maxTokens?.kind.oneofKind, 'numberValue');
  assert.deepEqual(audio, preservedCloud);
  assert.doesNotMatch(JSON.stringify(next), /loadoutRef/u);
});

test('Apps AIConfig mutations refresh the canonical card summary lane', async () => {
  const sources = await Promise.all([
    'apps-ai-config-section.tsx',
    'apps-detail-view.tsx',
    'apps-panel-view.tsx',
    'apps-panel.tsx',
    'apps-panel-controller.ts',
  ].map((fileName) => readFile(new URL(
    `../src/shell/renderer/features/apps/${fileName}`,
    import.meta.url,
  ), 'utf8')));
  const sectionSource = sources[0]!;
  const detailSource = sources[1]!;
  const viewSource = sources[2]!;
  const panelSource = sources[3]!;
  const controllerSource = sources[4]!;

  assert.match(sectionSource, /onAIConfigChanged\(result\)/u);
  assert.match(detailSource, /onAIConfigChanged=\{onAIConfigChanged\}/u);
  assert.match(viewSource, /onAIConfigChanged=\{\(result\) => onAIConfigChanged\(selectedEntry\.registration\.appId, result\)\}/u);
  assert.match(panelSource, /onAIConfigChanged=\{acknowledgeAIConfigMutation\}/u);
  assert.match(controllerSource, /applyAppsPanelAIConfigAcknowledgement\(projectionRef\.current, appId, result\)/u);
  assert.match(controllerSource, /setProjection\(acknowledged\)[\s\S]*void reload\(true\)/u);
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
