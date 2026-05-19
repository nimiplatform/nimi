import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readDesktopSource(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'shell', 'renderer', 'features', 'tester', relativePath), 'utf8');
}

function readModelConfigLocale(locale: 'en' | 'zh'): Record<string, unknown> {
  const source = fs.readFileSync(
    path.join(import.meta.dirname, '..', 'src', 'shell', 'renderer', 'locales', locale, '55-ModelConfig.json'),
    'utf8',
  );
  return JSON.parse(source) as Record<string, unknown>;
}

function getLocalePath(locale: Record<string, unknown>, dottedPath: string): unknown {
  return dottedPath.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[segment];
  }, locale);
}

test('tester model config contract: tester settings uses dedicated AIConfig scope and kit hub', () => {
  const scopeSource = readDesktopSource('tester-ai-config.ts');
  const identitySource = readDesktopSource('tester-app-identity.ts');
  const pageSource = readDesktopSource('tester-page.tsx');
  const settingsSource = readDesktopSource('tester-settings-dialog.tsx');
  const hookSource = readDesktopSource('tester-model-config-hook.ts');

  assert.match(identitySource, /TESTER_APP_ID\s*=\s*'nimi\.tester'/);
  assert.match(identitySource, /ownerId:\s*TESTER_APP_ID/);
  assert.match(identitySource, /surfaceId:\s*TESTER_AI_SURFACE_ID/);
  assert.match(scopeSource, /TESTER_AI_SCOPE_REF/);
  assert.match(hookSource, /useModelConfigProfileController/);
  assert.match(settingsSource, /ModelConfigCapabilityDetail/);
  assert.match(settingsSource, /ProfileConfigSection/);
  // Hub composition: tester no longer builds MODULE_DESCRIPTORS or local profile copy.
  assert.doesNotMatch(settingsSource, /MODULE_DESCRIPTORS/);
  assert.doesNotMatch(settingsSource, /createProfileCopy/);
  assert.match(pageSource, /bootstrapTesterAIConfigScope\(aiConfigSurface\)/);
  assert.match(pageSource, /aiConfigSurface\.aiConfig\.subscribe\(TESTER_AI_SCOPE_REF/);
});

test('tester model config contract: tester execution reads canonical scope bindings and params', () => {
  const pageSource = readDesktopSource('tester-page.tsx');
  const videoPanelSource = readDesktopSource(path.join('panels', 'panel-video-generate.tsx'));
  const hookSource = readDesktopSource('tester-model-config-hook.ts');
  const voiceAssetSource = readDesktopSource('tester-voice-assets.ts');

  assert.match(pageSource, /bindingFromTesterConfig\(testerConfig, activeCapability\)/);
  assert.match(pageSource, /handleSettingsParamsChange\('image\.generate'/);
  assert.match(pageSource, /handleSettingsParamsChange\('video\.generate'/);
  assert.match(pageSource, /parseAudioSynthesizeParams/);
  assert.match(pageSource, /handleSettingsParamsChange\('audio\.synthesize'/);
  assert.match(hookSource, /media\.tts\.listVoices/);
  assert.match(hookSource, /listTesterVoiceAssets/);
  assert.match(voiceAssetSource, /getAccountSessionStatus/);
  assert.match(voiceAssetSource, /client\.voice\.listAssets/);
  assert.match(hookSource, /audioSynthesizeVoiceOptions/);
  assert.match(hookSource, /kind:\s*'voice_asset_id'/);
  assert.match(videoPanelSource, /params:\s*VideoParamsState/);
  assert.match(videoPanelSource, /props\.binding \?\? state\.binding/);
});

test('tester app identity contract: embedded implementation no longer claims desktop-shaped Tester identity', () => {
  const files = [
    'tester-ai-config.ts',
    'tester-runtime.ts',
    'tester-voice-assets.ts',
    'tester-model-config-hook.ts',
    path.join('panels', 'panel-image-generate.tsx'),
    path.join('panels', 'panel-video-generate.tsx'),
    path.join('panels', 'panel-audio-synthesize.tsx'),
    path.join('panels', 'panel-voice-asset.tsx'),
    path.join('panels', 'panel-world-tour.tsx'),
  ];
  for (const file of files) {
    const source = readDesktopSource(file);
    assert.doesNotMatch(source, /ownerId:\s*'desktop'/, file);
    assert.doesNotMatch(source, /core\.tester/, file);
    assert.doesNotMatch(source, /core:runtime/, file);
    assert.doesNotMatch(source, /appId:\s*'nimi\.desktop'/, file);
    assert.doesNotMatch(source, /nimi\.desktop\.local-first-party/, file);
  }
});

test('tester app storage contract: durable renderer history uses Tester App storage commands', () => {
  const historySource = readDesktopSource('tester-history.ts');
  const utilsSource = readDesktopSource('tester-utils.ts');
  const worldTourSharedSource = readDesktopSource('world-tour-shared.ts');

  assert.match(historySource, /tester_run_history_load/);
  assert.match(historySource, /tester_run_history_save/);
  assert.match(utilsSource, /tester_image_history_load/);
  assert.match(utilsSource, /tester_image_history_save/);
  assert.match(worldTourSharedSource, /world_tour_render_acceptance_load/);
  assert.match(worldTourSharedSource, /world_tour_render_acceptance_save/);
  assert.doesNotMatch(historySource, /localStorage/);
  assert.doesNotMatch(worldTourSharedSource, /localStorage/);
});

test('tester model config contract: audio synthesize editor locale keys exist', () => {
  const requiredKeys = [
    'capability.audioSynthesize.title',
    'editor.audioSynthesize.parametersLabel',
    'editor.audioSynthesize.voiceRefLabel',
    'editor.audioSynthesize.voiceRefHint',
    'editor.audioSynthesize.speakingRateLabel',
    'editor.audioSynthesize.volumeLabel',
    'editor.audioSynthesize.pitchSemitonesLabel',
    'editor.audioSynthesize.languageHintLabel',
    'editor.audioSynthesize.responseFormatLabel',
    'editor.common.seedLabel',
    'editor.common.randomPlaceholder',
    'editor.common.noneLabel',
  ];

  for (const localeName of ['en', 'zh'] as const) {
    const locale = readModelConfigLocale(localeName);
    for (const key of requiredKeys) {
      const value = getLocalePath(locale, key);
      assert.equal(typeof value, 'string', `${localeName} ${key}`);
      assert.notEqual(value, '', `${localeName} ${key}`);
    }
  }
});
