import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { CANONICAL_CAPABILITY_IDS } from '@nimiplatform/kit/core/runtime-capabilities';
import {
  APPS_AI_CONFIG_APP_ACCESS_DOMAIN,
  appsAIConfigCapabilityContracts,
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
  assert.match(detailSource, /appId=\{registration\.appId\}/u);
  assert.match(sectionSource, /consumer:\s*'nimi-first-party'/u);
  assert.match(sectionSource, /capabilityContracts=\{CANONICAL_CAPABILITY_IDS\}/u);
  assert.match(sectionSource, /useDesktopNimiAppAIConfig\(appId\)/u);
  assert.match(sectionSource, /useOverwriteDesktopNimiAppAIConfig\(appId\)/u);
  assert.match(sectionSource, /useDesktopNimiMachineLocalSelections\(\)/u);
  assert.match(sectionSource, /createDesktopCloudAIConfigModule\(sdk\)/u);
});

test('Apps AIConfig owner copy covers every canonical capability in both locales', () => {
  const en = readDesktopLocale('en').Apps.aiConfig;
  const zh = readDesktopLocale('zh').Apps.aiConfig;
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
    for (const key of capabilityKeys) {
      assert.equal(typeof locale.capability[key].label, 'string');
      assert.equal(typeof locale.capability[key].description, 'string');
    }
  }
});
