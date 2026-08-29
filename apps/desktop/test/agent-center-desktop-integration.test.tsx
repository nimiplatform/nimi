import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { resolveAgentCenterIdentityBadge } from '../src/shell/renderer/features/chat/chat-agent-shell-presentation-settings.js';

const appRoot = path.resolve(import.meta.dirname, '..');

test('Desktop Agent Center uses the canonical handle Manager and keeps its entry visible', async () => {
  const settingsSource = await readFile(path.join(
    appRoot,
    'src/shell/renderer/features/chat/chat-agent-shell-presentation-settings.tsx',
  ), 'utf8');
  const runtimeSource = await readFile(path.join(
    appRoot,
    'src/shell/renderer/features/chat/chat-agent-shell-adapter-runtime.ts',
  ), 'utf8');
  const presentationSource = await readFile(path.join(
    appRoot,
    'src/shell/renderer/features/chat/chat-agent-shell-presentation.tsx',
  ), 'utf8');

  assert.match(settingsSource, /session=\{input\.runtimeAgentCenterAdapter\}/u);
  assert.match(runtimeSource, /createAppAgentCenterSession\(\{/u);
  assert.match(runtimeSource, /handle:\s*agentHandle/u);
  assert.match(runtimeSource, /bindings\.sdk\.appProduct\(\)\.agentConfigure/u);
  assert.doesNotMatch(runtimeSource, /desktop-nimi-client-session|getDesktopAgentConfigureClient/u);
  assert.doesNotMatch(runtimeSource, /getDesktopLocalAppVoiceAssetsClient|voiceAssetsClient/u);
  assert.match(runtimeSource, /createDesktopAgentCenterHostMechanics\(\{/u);
  assert.match(runtimeSource, /resourcePackPlacement/u);
  assert.match(runtimeSource, /shellBridge\.openResourcePackInZhiyu/u);
  assert.doesNotMatch(runtimeSource, /openAgentCenterResourcePackInZhiyu/u);
  assert.match(runtimeSource, /avatarHandoff:\s*bindings\.app\.commands\.avatarHandoff/u);
  assert.match(runtimeSource, /runtimeAgentCenterAdapter\?\.dispose\(\)/u);
  assert.doesNotMatch(runtimeSource, /createFirstPartyAgentCenterSession|createNimiRuntimeAgentMemoryManager/u);
  assert.doesNotMatch(runtimeSource, /accountProduct|listVoiceAssets|listLocalAppVoiceAssets/u);
  assert.doesNotMatch(presentationSource, /onOpenAgentCenter=\{undefined\}/u);
});

test('Desktop Agent Center identity keeps readable context and hides technical source ids', () => {
  assert.equal(resolveAgentCenterIdentityBadge({
    displayName: '王袆',
    handle: 'world-character-73687b5e',
    worldName: null,
  }), null);
  assert.equal(resolveAgentCenterIdentityBadge({
    displayName: '王袆',
    handle: 'world-character-73687b5e',
    worldName: '明初文坛',
  }), '明初文坛');
  assert.equal(resolveAgentCenterIdentityBadge({
    displayName: 'Aster',
    handle: '@aster',
    worldName: null,
  }), '~aster');
});
