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
  const pageSource = readDesktopSource('tester-page.tsx');
  const settingsSource = readDesktopSource('tester-settings-dialog.tsx');
  const hookSource = readDesktopSource('tester-model-config-hook.ts');

  assert.match(scopeSource, /surfaceId:\s*'tester'/);
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

  assert.match(pageSource, /bindingFromTesterConfig\(testerConfig, activeCapability\)/);
  assert.match(pageSource, /handleSettingsParamsChange\('image\.generate'/);
  assert.match(pageSource, /handleSettingsParamsChange\('video\.generate'/);
  assert.match(pageSource, /parseAudioSynthesizeParams/);
  assert.match(pageSource, /handleSettingsParamsChange\('audio\.synthesize'/);
  assert.match(hookSource, /media\.tts\.listVoices/);
  assert.match(hookSource, /audioSynthesizeVoiceOptions/);
  assert.match(videoPanelSource, /params:\s*VideoParamsState/);
  assert.match(videoPanelSource, /props\.binding \?\? state\.binding/);
});

test('tester model config contract: audio synthesize editor locale keys exist', () => {
  const requiredKeys = [
    'capability.audioSynthesize.title',
    'editor.audioSynthesize.parametersLabel',
    'editor.audioSynthesize.voiceIdLabel',
    'editor.audioSynthesize.voiceIdHint',
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
