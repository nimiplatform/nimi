import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, relativePath), 'utf8');
}

const chatSettingsStorageSource = readSource('../src/shell/renderer/features/chat/chat-settings-storage.ts');
const chatAgentShellAdapterSource = readSource('../src/shell/renderer/features/chat/chat-agent-shell-adapter.tsx');
const hardcutTestSource = readSource('chat-agent-behavior-storage-hardcut.test.ts');
const highRiskAdmissionsSource = readSource('../../../.nimi/spec/high-risk-admissions.yaml');

test('agent chat behavior settings no longer have a durable renderer storage key', () => {
  assert.doesNotMatch(chatSettingsStorageSource, /AGENT_CHAT_BEHAVIOR_SETTINGS_STORAGE_KEY/);
  assert.doesNotMatch(chatSettingsStorageSource, /nimi\.chat\.settings\.agent\.behavior\.v1/);
  assert.doesNotMatch(chatSettingsStorageSource, /loadStoredAgentChatExperienceSettings/);
  assert.doesNotMatch(chatSettingsStorageSource, /persistStoredAgentChatExperienceSettings/);
});

test('agent shell keeps behavior settings in process state instead of localStorage', () => {
  assert.match(chatAgentShellAdapterSource, /createDefaultAgentChatExperienceSettings\(\)/);
  assert.match(chatAgentShellAdapterSource, /setBehaviorSettingsState\(normalizeAgentChatExperienceSettings\(nextSettings\)\)/);
  assert.doesNotMatch(chatAgentShellAdapterSource, /loadStoredAgentChatExperienceSettings/);
  assert.doesNotMatch(chatAgentShellAdapterSource, /persistStoredAgentChatExperienceSettings/);
  assert.doesNotMatch(chatAgentShellAdapterSource, /localStorage/);
  assert.doesNotMatch(chatAgentShellAdapterSource, /sessionStorage/);
});

test('agent behavior storage hardcut does not use closed topic packets as active oracle', () => {
  const closedTopicOraclePattern = new RegExp(`${String.raw`\.nimi`}\\/topics\\/closed`);

  assert.match(
    highRiskAdmissionsSource,
    /canonical_high_risk_admission_requires_explicit_write_to_tracked_truth/,
  );
  assert.doesNotMatch(hardcutTestSource, closedTopicOraclePattern);
});
