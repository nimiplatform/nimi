import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const sdkRoot = process.cwd();
const repoRoot = path.resolve(sdkRoot, '..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function listSettingsSurfaceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const next = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listSettingsSurfaceFiles(next);
    }
    return /\.(ts|tsx)$/.test(entry.name) ? [next] : [];
  }).sort();
}

function readTesterSettingsSurface(): string {
  const route = path.join(repoRoot, 'apps/tester/src/shell/routes/settings.tsx');
  const modules = listSettingsSurfaceFiles(path.join(repoRoot, 'apps/tester/src/shell/routes/settings'));
  return [route, ...modules].map((filePath) => fs.readFileSync(filePath, 'utf8')).join('\n');
}

test('Tester consumes SDK error and offline typed projections as a second app', () => {
  const settings = readTesterSettingsSurface();
  const testerSettingsContract = read('apps/tester/test/tester-settings-surface.test.mjs');

  assert.match(settings, /extractNimiErrorFields/);
  assert.match(settings, /from '@nimiplatform\/sdk\/types'/);
  assert.match(settings, /reason_code:\s*ReasonCode\.RUNTIME_CALL_FAILED/);
  assert.match(settings, /trace_id:\s*'tester-runtime-trace'/);
  assert.match(settings, /runtimeReasonProjection\.traceId/);
  assert.match(testerSettingsContract, /extractNimiErrorFields/);

  assert.match(settings, /createOfflineNimiError/);
  assert.match(settings, /classifyOfflineError\(createOfflineNimiError\(/);
  assert.match(testerSettingsContract, /createOfflineNimiError/);
});

test('Tester consumes SDK retry and runtime reason-code helpers as a second app', () => {
  const workbench = read('apps/tester/src/tester/tester-workbench.tsx');
  const testerContract = read('apps/tester/test/tester-contract.test.mjs');
  const settings = readTesterSettingsSurface();

  assert.match(workbench, /requestWithRetry/);
  assert.match(workbench, /from '@nimiplatform\/sdk\/types'/);
  assert.match(workbench, /executor:\s*loadTesterRunHistory/);
  assert.match(testerContract, /requestWithRetry/);

  assert.match(settings, /extractRuntimeReasonCodeFromError/);
});

test('Tester consumes SDK AIProfile, Nimi App, and world-evolution surfaces as a second app', () => {
  const testerStore = read('apps/tester/src/tester/tester-ai-config-store.ts');
  const settings = readTesterSettingsSurface();
  const testerContract = read('apps/tester/test/tester-contract.test.mjs');
  const testerAiProfileSurface = read('apps/tester/test/tester-ai-profile-surface.test.mjs');
  const testerSettingsContract = read('apps/tester/test/tester-settings-surface.test.mjs');
  const testerScaffoldContract = read('apps/tester/test/scaffold-boundary.test.mjs');
  const testerTauriMain = read('apps/tester/src-tauri/src/main.rs');

  assert.match(testerStore, /createHostAIProfileSurface/);
  assert.match(testerStore, /parseAIProfile/);
  assert.match(settings, /from '@nimiplatform\/kit\/features\/model-config\/headless'/);
  assert.match(testerContract, /tester AI config is the Kit model-config surface in Settings with real SDK AIProfiles/);
  assert.match(testerAiProfileSurface, /Tester consumes the SDK host AIProfile surface for preview and apply/);

  const testerAiConfigSettings = read('apps/tester/src/shell/ai/tester-ai-config-settings.tsx');
  assert.match(testerAiConfigSettings, /from '@nimiplatform\/sdk\/ai'/);
  assert.doesNotMatch(testerAiConfigSettings, /applyAIProfileToConfig/);

  assert.match(settings, /parseNimiAppBridgeProjection/);
  assert.match(settings, /parseAccountAppLibraryRecord/);
  assert.match(settings, /from '@nimiplatform\/sdk\/app'/);
  assert.match(testerSettingsContract, /tester settings consumes SDK Nimi App bridge projection parser/);
  assert.match(testerScaffoldContract, /ADMISSION\.md/);
  assert.doesNotMatch(settings, /ADMISSION_STATUSES|RELEASE_DESCRIPTOR_CLASSES|VERIFICATION_STATES/);
  assert.doesNotMatch(settings, /apps\/desktop/);
  assert.match(testerTauriMain, /nimi_shell_tauri::platform_projection::apps_bridge/);

  assert.match(settings, /loadTesterWorldEvolutionSelectorReadProjection/);
});
