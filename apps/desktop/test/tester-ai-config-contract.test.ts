import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readDesktopSource(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'shell', 'renderer', 'features', 'tester', relativePath), 'utf8');
}

test('tester model config contract: tester settings uses dedicated AIConfig scope and shared panel', () => {
  const scopeSource = readDesktopSource('tester-ai-config.ts');
  const pageSource = readDesktopSource('tester-page.tsx');
  const settingsSource = readDesktopSource('tester-settings-dialog.tsx');

  assert.match(scopeSource, /surfaceId:\s*'tester'/);
  assert.match(settingsSource, /ModelConfigPanel/);
  assert.match(settingsSource, /useDesktopModelConfigProfileController/);
  assert.match(settingsSource, /parseImageParams/);
  assert.match(settingsSource, /parseVideoParams/);
  assert.match(pageSource, /aiConfigSurface\.aiConfig\.get\(TESTER_AI_SCOPE_REF\)/);
  assert.match(pageSource, /aiConfigSurface\.aiConfig\.subscribe\(TESTER_AI_SCOPE_REF/);
  assert.match(pageSource, /aiConfigSurface\.aiConfig\.update\(TESTER_AI_SCOPE_REF/);
});

test('tester model config contract: tester execution reads canonical scope bindings and params', () => {
  const pageSource = readDesktopSource('tester-page.tsx');
  const videoPanelSource = readDesktopSource(path.join('panels', 'panel-video-generate.tsx'));

  assert.match(pageSource, /bindingFromTesterConfig\(testerConfig, activeCapability\)/);
  assert.match(pageSource, /handleSettingsParamsChange\('image\.generate'/);
  assert.match(pageSource, /handleSettingsParamsChange\('video\.generate'/);
  assert.match(videoPanelSource, /params:\s*VideoParamsState/);
  assert.match(videoPanelSource, /props\.binding \?\? state\.binding/);
});
