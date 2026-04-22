import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

const chatPageSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-page.tsx');
const chatContactsSidebarSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-contacts-sidebar.tsx');
const chatNimiSheetSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-ai-session-list-panel.tsx');
const chatHumanModeSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-human-mode-content.tsx');
const chatNimiModeSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-ai-mode-content.tsx');
const chatAgentAnchoredStageSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-anchored-avatar-stage.tsx');
const chatAgentSceneBackgroundSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-scene-background.tsx');
const chatAgentStageLayoutSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-avatar-stage-layout.ts');
const chatAgentModeSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-mode-content.tsx');
const chatGroupModeSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-group-mode-content.tsx');
const chatSideSheetSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-side-sheet.tsx');

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
  assert.match(chatSideSheetSource, /data-chat-side-sheet=/);
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
  assert.doesNotMatch(chatAgentSceneBackgroundSource, /ChatAgentAnchoredAvatarStage/u);

  // Stage layout contract: no placement-driven transcript width carve-out; the
  // chat domain occupies the full middle area with uniform mx-auto centering.
  assert.match(chatAgentStageLayoutSource, /scenePlacementClassName:/);
  assert.doesNotMatch(chatAgentStageLayoutSource, /sceneVeilClassName:/);
  assert.doesNotMatch(chatAgentStageLayoutSource, /actorUnderlayClassName:/);
  assert.match(chatAgentStageLayoutSource, /UNIFORM_CENTER_POSITION/);
  assert.match(chatAgentStageLayoutSource, /transcriptContentBottomReserveClassName: CHAT_AGENT_TRANSCRIPT_BOTTOM_RESERVE_CLASS/);

  // The old anchored stage implementation still exists as dead residue code, but
  // the active chat mode no longer imports it as a carrier path.
  assert.match(chatAgentAnchoredStageSource, /data-chat-agent-anchored-stage="true"/);
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
});
