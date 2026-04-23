import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const desktopDir = path.resolve(import.meta.dirname, '..');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(desktopDir, relativePath), 'utf8');
}

test('agent shell settings content mounts ChatAgentAvatarSettingsPanel', () => {
  const source = readSource('src/shell/renderer/features/chat/chat-agent-shell-presentation.tsx');
  assert.match(source, /import\s+\{\s*ChatAgentAvatarSettingsPanel\s*\}/);
  assert.match(source, /presenceContent=\{\(/);
  assert.match(source, /<ChatAgentAvatarSettingsPanel/);
});

test('ChatSettingsPanel AI mode routes presenceContent into an avatar-app shell summary instead of local binding copy', () => {
  const source = readSource('src/shell/renderer/features/chat/chat-shared-settings-panel.tsx');
  assert.match(source, /presenceContent\?: ReactNode/);
  assert.match(source, /{props\.presenceContent}/);
  assert.match(source, /path\[0\] === 'avatar'/);
  assert.match(source, /avatarSummary=\{avatarSummary\}/);
  assert.match(source, /Review avatar model status, open this chat in Nimi Avatar, and adjust local shell appearance here\./);
  assert.doesNotMatch(source, /Import VRM or Live2D and bind it locally/);
});

test('agent avatar settings panel exposes wave-4 instance actions through the live inventory surface', () => {
  const source = readSource('src/shell/renderer/features/chat/chat-agent-avatar-settings-panel.tsx');
  assert.match(source, /getSubjectUserId:\s*requireRuntimeSubjectUserId/);
  assert.match(source, /avatarSessionLinkLiveInventoryRefresh/);
  assert.match(source, /avatarSessionLinkRevealAction/);
  assert.match(source, /avatarSessionLinkRetargetAction/);
  assert.match(source, /avatarSessionLinkCloseAction/);
  assert.match(source, /launchPolicy\.autoRefreshLiveInventory/);
  assert.match(source, /ChatAgentAvatarAppLauncher[\s\S]*defaultLaunchTarget=\{launchPolicy\.defaultLaunchTarget\}/);
  assert.match(source, /hasAvatarInstanceInLiveInventory/);
  assert.match(source, /CLOSE_CONFIRMATION_ATTEMPTS/);
  assert.match(source, /avatarSessionLinkInstanceNotLive/);
  assert.match(source, /avatarSessionLinkCloseStillLive/);
  assert.match(source, /avatarSessionLinkCloseUnconfirmed/);
});

test('instance action handlers stay out of runtime profile and launch-policy mutation paths', () => {
  const source = readSource('src/shell/renderer/features/chat/chat-agent-avatar-settings-panel.tsx');
  const runInstanceActionBlock = source.match(/const runInstanceAction = async[\s\S]*?const handleRevealInstance = async/);
  const handleCloseBlock = source.match(/const handleCloseInstance = async[\s\S]*?return \(/);

  assert.ok(runInstanceActionBlock);
  assert.ok(handleCloseBlock);
  assert.doesNotMatch(runInstanceActionBlock?.[0] || '', /setPresentationProfile/);
  assert.doesNotMatch(runInstanceActionBlock?.[0] || '', /persistStoredAgentAvatarLaunchPolicy/);
  assert.doesNotMatch(handleCloseBlock?.[0] || '', /setPresentationProfile/);
  assert.doesNotMatch(handleCloseBlock?.[0] || '', /persistStoredAgentAvatarLaunchPolicy/);
});
