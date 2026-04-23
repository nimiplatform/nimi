import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

const chatPageSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-page.tsx');
const chatContactsSidebarSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-contacts-sidebar.tsx');
const chatNimiSheetSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-nimi-session-list-panel.tsx');
const chatHumanModeSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-human-mode-content.tsx');
const chatNimiModeSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-nimi-mode-content.tsx');
const chatAgentSceneBackgroundSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-scene-background.tsx');
const chatAgentModeSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-mode-content.tsx');
const chatGroupModeSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-group-mode-content.tsx');
const chatSideSheetSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-shared-side-sheet.tsx');

test('chat page split layout keeps contacts on the far-right transparent rail', () => {
  assert.match(chatPageSource, /data-chat-page-layout="split"/);
  assert.match(chatPageSource, /ChatContactsSidebar/);
  assert.match(chatContactsSidebarSource, /data-chat-contacts-sidebar-chrome="transparent"/);
  assert.match(chatContactsSidebarSource, /className="ml-4 mr-1 flex h-full w-14 shrink-0 flex-col items-center bg-transparent py-2"/);
  assert.doesNotMatch(chatContactsSidebarSource, /border-l/u);
});

test('chat page uses transient side sheets; agent mode keeps the scene background but no longer mounts a desktop-local avatar overlay carrier path', () => {
  assert.match(chatPageSource, /chatSettingsOpen/);
  assert.match(chatPageSource, /nimiThreadListOpen/);
  assert.match(chatSideSheetSource, /data-chat-shared-side-sheet=/);
  assert.match(chatNimiSheetSource, /ChatSideSheet/);
  assert.doesNotMatch(chatNimiSheetSource, /Assistant status/u);
  assert.match(chatHumanModeSource, /ChatSideSheet/);
  assert.match(chatNimiModeSource, /ChatSideSheet/);
  assert.match(chatGroupModeSource, /ChatSideSheet/);

  // Agent mode mounts the scene background (glass + mask only) inside the canonical
  // shell, but Pack 4 decommissions the desktop-local avatar overlay mount.
  assert.match(chatAgentModeSource, /sceneBackground=\{sceneBackground\}/);
  assert.match(chatAgentModeSource, /ChatAgentSceneBackground/);
  assert.doesNotMatch(chatAgentModeSource, /ChatAgentAvatarOverlay/);

  // Scene background is purely decorative: Layer 0 glass + Layer 1 in-app mask.
  // It must not render the avatar or placement-driven scene-actor slot.
  assert.match(chatAgentSceneBackgroundSource, /data-chat-agent-scene-background="true"/);
  assert.match(chatAgentSceneBackgroundSource, /data-chat-agent-scene-layer="glass"/);
  assert.match(chatAgentSceneBackgroundSource, /data-chat-agent-scene-layer="mask"/);
  assert.doesNotMatch(chatAgentSceneBackgroundSource, /data-chat-agent-scene-actor/u);
  assert.doesNotMatch(chatAgentModeSource, /chat-agent-avatar-overlay/);
});

test('chat page startup keeps agent mode lazy-loaded while removing the desktop-local avatar overlay lazy boundary', () => {
  assert.match(chatPageSource, /const ChatAgentModeContent = lazy\(async \(\) => \{/);
  assert.match(chatPageSource, /import\('\.\/chat-agent-mode-content'\)/);
  assert.match(chatPageSource, /ChatModeSurfaceErrorBoundary/);
  assert.match(chatPageSource, /Agent mode is temporarily unavailable/);

  assert.doesNotMatch(chatAgentModeSource, /const ChatAgentAvatarOverlay = lazy/);
  assert.doesNotMatch(chatAgentModeSource, /import\('\.\/chat-agent-avatar-overlay'\)/);
  assert.doesNotMatch(chatAgentModeSource, /ChatAvatarOverlayErrorBoundary/);
  assert.match(chatAgentModeSource, /CanonicalConversationShell/);
});

test('agent shell presentation disables stage panel props so desktop chat cannot present a co-equal local avatar carrier route', () => {
  const source = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-shell-presentation.tsx');
  assert.match(source, /stagePanelProps:\s*undefined/);
  assert.match(source, /topContent:\s*schedulingFeedbackNode/);
  assert.equal((source.match(/ChatAgentAvatarAppLauncher/g) || []).length, 2);
  assert.doesNotMatch(source, /avatarStagePlacement/u);
  assert.doesNotMatch(source, /useAgentAvatarPlacement/u);
});
