import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CANONICAL_CAPABILITY_IDS } from '@nimiplatform/kit/core/runtime-capabilities';
import {
  APPS_AI_CONFIG_APP_ACCESS_DOMAIN,
  AppsAIConfigSection,
  appsAIConfigCapabilityContracts,
  partitionAppsAIConfigCapabilities,
} from '../src/shell/renderer/features/apps/apps-ai-config-section.js';
import { readDesktopLocale } from './helpers/read-desktop-locale.js';
import { DesktopRendererBindingProvider } from '../src/shell/renderer/renderer/binding-context.js';
import type { DesktopCanonicalRendererBindings } from '../src/shell/renderer/renderer/contract.js';
import { desktopNimiAppAIConfigQueryKey } from '../src/shell/renderer/features/chat/chat-nimi-app-ai-config.js';
import { initI18n } from '../src/shell/renderer/i18n/index.js';
import { AppStoreProvider } from '../src/shell/renderer/app-shell/providers/app-store.js';
import { createAppStore } from '../src/shell/renderer/app-shell/providers/app-store-factory.js';

(globalThis as { React?: typeof React }).React = React;

test('an observed empty AIConfig still shows declared capabilities before the collapsed catalog', async () => {
  await initI18n();
  const queryClient = new QueryClient();
  const store = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference: () => undefined });
  const appId = 'example.unconfigured';
  queryClient.setQueryData(desktopNimiAppAIConfigQueryKey(appId), {
    config: null, revision: 'revision-1', effectiveSelections: [],
  });
  // Static rendering reads cached owner data; no SDK mutation or effect runs.
  const bindings = { app: { commands: {} }, sdk: {} } as DesktopCanonicalRendererBindings;
  try {
    const html = renderToStaticMarkup(React.createElement(QueryClientProvider, { client: queryClient },
      React.createElement(AppStoreProvider, { store }, React.createElement(DesktopRendererBindingProvider, { bindings },
        React.createElement(AppsAIConfigSection, {
          appId, appDisplayName: 'Unconfigured App', allowedRoutes: ['local', 'cloud'],
          declaredCapabilityRefs: ['text.generate'], onAIConfigChanged: () => undefined,
        })))));
    assert.match(html, /data-nimi-model-config-section="declared"/u);
    assert.match(html, /data-nimi-model-config-capability="text.generate"/u);
    assert.doesNotMatch(html, /data-nimi-model-config-capability="image.generate"/u);
    assert.doesNotMatch(html, /data-nimi-model-config-section-toggle="declared"/u);
    assert.match(html, /data-nimi-model-config-section-toggle="rest"/u);
    assert.doesNotMatch(html, /AI 模型/u);
  } finally {
    queryClient.clear();
  }
});

test('Apps AIConfig composes exact canonical capabilities only for runtime consumers', () => {
  assert.deepEqual(appsAIConfigCapabilityContracts(['realm.data']), []);
  assert.deepEqual(
    appsAIConfigCapabilityContracts(['realm.data', APPS_AI_CONFIG_APP_ACCESS_DOMAIN]),
    CANONICAL_CAPABILITY_IDS,
  );
  assert.ok(CANONICAL_CAPABILITY_IDS.includes('voice.create'));
  assert.ok(CANONICAL_CAPABILITY_IDS.includes('audio.synthesize'));
});

test('Apps AIConfig capability grouping keeps declared, configured, and rest apart in canonical order', () => {
  const plan = partitionAppsAIConfigCapabilities({
    declaredRefs: ['audio.synthesize', 'text.generate'],
    configuredContracts: ['text.generate', 'image.generate', 'legacy.unknown'],
  });
  assert.deepEqual(plan.declared, ['audio.synthesize', 'text.generate']);
  assert.deepEqual(plan.configuredOthers, ['image.generate', 'legacy.unknown']);
  assert.equal(plan.rest.length, CANONICAL_CAPABILITY_IDS.length - 3);
  const canonicalIndex = (contract: string) => CANONICAL_CAPABILITY_IDS.indexOf(contract);
  assert.deepEqual(
    [...plan.rest].sort((left, right) => canonicalIndex(left) - canonicalIndex(right)),
    [...plan.rest],
  );
  assert.ok(plan.rest.every((contract) => canonicalIndex(contract) >= 0));
  assert.deepEqual(
    new Set([...plan.declared, ...plan.configuredOthers, ...plan.rest].filter((contract) => contract !== 'legacy.unknown')),
    new Set(CANONICAL_CAPABILITY_IDS),
  );
});

test('Apps AIConfig capability grouping tolerates empty declaration and configuration', () => {
  const plan = partitionAppsAIConfigCapabilities({ declaredRefs: [], configuredContracts: [] });
  assert.deepEqual(plan.declared, []);
  assert.deepEqual(plan.configuredOthers, []);
  assert.deepEqual(plan.rest, CANONICAL_CAPABILITY_IDS);
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
  assert.match(detailSource, /appId=\{identity\.appId\}/u);
  assert.match(detailSource, /allowedRoutes=\{registration\.aiConfigAllowedRoutes\}/u);
  assert.match(detailSource, /declaredCapabilityRefs=\{registration\.capabilityContractRefs\}/u);
  assert.match(detailSource, /declaredCapabilityRefs=\{entry\.appInfo\?\.capabilityContractRefs/u);
  assert.doesNotMatch(sectionSource, /consumer:\s*'nimi-first-party'/u);
  assert.match(sectionSource, /capabilityContracts=\{CANONICAL_CAPABILITY_IDS\}/u);
  assert.match(sectionSource, /capabilitySections=\{capabilitySections\}/u);
  assert.match(sectionSource, /allowedRoutes=\{allowedRoutes\}/u);
  assert.doesNotMatch(sectionSource, /headerSlot=/u);
  assert.doesNotMatch(sectionSource, /parentos/iu);
  assert.match(sectionSource, /useDesktopNimiAppAIConfig\(appId\)/u);
  assert.match(sectionSource, /useOverwriteDesktopNimiAppAIConfig\(appId\)/u);
  assert.match(sectionSource, /effectiveSelections=\{appAIConfig\.data\?\.effectiveSelections\}/u);
  assert.doesNotMatch(sectionSource, /projectDesktopAIConfigEffectiveSelections/u);
  assert.match(sectionSource, /listOptions\(query\)/u);
  assert.doesNotMatch(sectionSource, /createDesktopCloudAIConfigModule/u);
  assert.doesNotMatch(sectionSource, /buildAppsOneClickLocalAIConfig|machineSelections|oneClickFailure/u);
  assert.match(sectionSource, /overwriteAppAIConfig\.mutateAsync\(input\)[\s\S]*onAIConfigChanged\(result\)/u);
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
  assert.match(viewSource, /onAIConfigChanged=\{\(result\) => onAIConfigChanged\(selectedEntry\.identity\.entryKey, result\)\}/u);
  assert.match(panelSource, /onAIConfigChanged=\{acknowledgeAIConfigMutation\}/u);
  assert.match(controllerSource, /applyAppsPanelAIConfigAcknowledgement\(projectionRef\.current, entryKey, result\)/u);
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
    'audioSeparate',
    'imageFaceSwap',
    'imageGenerate',
    'musicGenerate',
    'musicTranscribe',
    'audioVoiceConvert',
    'realtimeInteract',
    'textEmbed',
    'textAnnotate',
    'textDecide',
    'textGenerate',
    'videoFaceSwap',
    'videoGenerate',
    'visionLocate',
    'voiceCreate',
    'worldGenerate',
  ];

  for (const locale of [en, zh]) {
    assert.equal(typeof locale.title, 'string');
    assert.equal(typeof locale.description, 'string');
    assert.equal(typeof locale.sections.declared, 'string');
    assert.equal(typeof locale.sections.configuredOthers, 'string');
    assert.equal(typeof locale.sections.rest, 'string');
    for (const key of capabilityKeys) {
      assert.equal(typeof locale.capability[key].label, 'string');
      assert.equal(typeof locale.capability[key].description, 'string');
    }
  }
  assert.equal(capabilityKeys.length, CANONICAL_CAPABILITY_IDS.length);
});
