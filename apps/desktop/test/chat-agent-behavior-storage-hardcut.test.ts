import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, relativePath), 'utf8');
}

const chatSettingsStorageSource = readSource('../src/shell/renderer/features/chat/chat-settings-storage.ts');
const chatAgentShellAdapterSource = readSource('../src/shell/renderer/features/chat/chat-agent-shell-adapter.tsx');
const packetSource = readSource(
  '../../../.nimi/topics/ongoing/2026-04-24-governance-runtime-desktop-gate-repair/packet-wave-2-desktop-agent-chat-behavior-storage-hardcut.md',
);

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

test('packet claims only finding-0010 for the agent behavior storage hardcut', () => {
  assert.match(packetSource, /finding_claims:\n  - finding-0010/);
  assert.doesNotMatch(packetSource, /finding_claims:[\s\S]*finding-0013/);
  assert.doesNotMatch(packetSource, /finding_claims:[\s\S]*finding-0016/);
  assert.doesNotMatch(packetSource, /finding_claims:[\s\S]*finding-0023/);
});
