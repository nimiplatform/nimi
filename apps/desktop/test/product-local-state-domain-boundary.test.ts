import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '../../..');

function read(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('Desktop product-local state uses Kit storage mechanics, not direct browser storage', () => {
  const productLocalStorageModules = [
    'apps/desktop/src/shell/renderer/features/settings/settings-storage.ts',
    'apps/desktop/src/shell/renderer/features/settings/settings-device-preferences.ts',
    'apps/desktop/src/shell/renderer/features/chat/chat-settings-storage.ts',
    'apps/desktop/src/shell/renderer/features/developer/developer-tools-storage.ts',
    'apps/desktop/src/shell/renderer/features/support/support-storage.ts',
    'apps/desktop/src/shell/renderer/features/runtime-config/runtime-config-storage-persist.ts',
    'apps/desktop/src/shell/renderer/features/runtime-config/runtime-config-local-model-center-progress-cache.ts',
    'apps/desktop/src/shell/renderer/app-shell/providers/desktop-ai-config-storage.ts',
    'apps/desktop/src/shell/renderer/i18n/index.ts',
  ];

  for (const file of productLocalStorageModules) {
    const source = read(file);
    assert.match(source, /@nimiplatform\/kit\/core\/storage-json/, `${file} must consume Kit storage helpers`);
    assert.doesNotMatch(source, /\b(?:globalThis\.)?(?:window\.)?(?:localStorage|sessionStorage)\./, `${file} must not access browser storage directly`);
  }
});

test('Desktop local storage residue stays product-local and secretless', () => {
  const runtimeConfigPersist = read('apps/desktop/src/shell/renderer/features/runtime-config/runtime-config-storage-persist.ts');
  const runtimeConfigNormalize = read('apps/desktop/src/shell/renderer/features/runtime-config/runtime-config-storage-normalize.ts');
  const aiConfigStorage = read('apps/desktop/src/shell/renderer/app-shell/providers/desktop-ai-config-storage.ts');
  const chatSettings = read('apps/desktop/src/shell/renderer/features/chat/chat-settings-storage.ts');
  const agentShellAdapter = read('apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-adapter.tsx');

  assert.match(runtimeConfigPersist, /Connectors are NOT persisted to localStorage/);
  assert.match(runtimeConfigPersist, /models:\s*\[\]/);
  assert.match(runtimeConfigPersist, /nodeMatrix:\s*\[\]/);
  assert.doesNotMatch(runtimeConfigPersist, /tokenApiKey|localOpenAiApiKey/);
  assert.match(runtimeConfigNormalize, /Connectors are NOT loaded from localStorage/);

  assert.match(aiConfigStorage, /createScopedAIConfigStore/);
  assert.match(aiConfigStorage, /aiConfigScopeKeyFromRef/);
  assert.doesNotMatch(aiConfigStorage, /function loadAIConfig\(/);
  assert.doesNotMatch(aiConfigStorage, /function persistAIConfig\(/);
  assert.doesNotMatch(aiConfigStorage, /LEGACY_SINGLE_KEY/);

  assert.doesNotMatch(chatSettings, /AGENT_CHAT_BEHAVIOR_SETTINGS_STORAGE_KEY/);
  assert.doesNotMatch(chatSettings, /persistStoredAgentChatExperienceSettings/);
  assert.doesNotMatch(agentShellAdapter, /persistStoredAgentChatExperienceSettings/);
  assert.doesNotMatch(agentShellAdapter, /\b(?:globalThis\.)?(?:window\.)?(?:localStorage|sessionStorage)\./);
});

test('Tester proves product-local persistence through the same Kit helper boundary', () => {
  const testerPreferences = read('apps/tester/src/tester/tester-preferences.ts');
  const testerAiConfigStore = read('apps/tester/src/tester/tester-ai-config-store.ts');
  const testerContract = read('apps/tester/test/tester-contract.test.mjs');

  assert.match(testerPreferences, /from '@nimiplatform\/kit\/core\/storage-json'/);
  assert.match(testerPreferences, /readStorageJsonFrom/);
  assert.match(testerPreferences, /writeStorageJsonTo/);
  assert.match(testerPreferences, /removeStorageKeyFrom/);
  assert.doesNotMatch(testerPreferences, /JSON\.parse\(raw\)/);
  assert.doesNotMatch(testerPreferences, /JSON\.stringify\(normalized\)/);

  assert.match(testerAiConfigStore, /from '@nimiplatform\/kit\/core\/storage-json'/);
  assert.match(testerAiConfigStore, /createScopedAIConfigStore/);
  assert.match(testerContract, /tester product-local persistence consumes Kit core storage helpers/);
});
