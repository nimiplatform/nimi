import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { readDesktopLocale } from './helpers/read-desktop-locale';

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
const chatAgentPresentationSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-shell-presentation.tsx');
const chatAgentPresentationSettingsSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-shell-presentation-settings.tsx');
const chatAgentCanonicalComposerSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-canonical-composer.tsx');
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
  assert.match(chatSideSheetSource, /sheetKey === 'settings'/);
  assert.match(chatSideSheetSource, /w-\[min\(500px,calc\(100vw-96px\)\)\]/);
  assert.match(chatSideSheetSource, /w-\[min\(340px,calc\(100vw-96px\)\)\]/);
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
  assert.match(chatAgentPresentationSource, /stagePanelProps:\s*undefined/);
  assert.match(chatAgentPresentationSource, /topContent:\s*schedulingFeedbackNode/);
  assert.match(chatAgentPresentationSettingsSource, /AgentCenterPanel/);
  assert.match(chatAgentPresentationSource, /importAgentCenterAvatarPackage/);
  assert.match(chatAgentPresentationSource, /getAgentCenterBackgroundAsset/);
  assert.doesNotMatch(chatAgentPresentationSource, /ChatAgentAvatarSettingsPanel/u);
  assert.doesNotMatch(chatAgentPresentationSource, /desktopAgentBackdropBindingQueryKey/u);
  assert.doesNotMatch(chatAgentPresentationSource, /avatarStagePlacement/u);
  assert.doesNotMatch(chatAgentPresentationSource, /useAgentAvatarPlacement/u);
});

test('agent composer avatar action is keyboard reachable and package preview remains absent', () => {
  assert.match(chatAgentCanonicalComposerSource, /<button\s+type="button"\s+data-agent-composer-avatar=\{avatarState\}/);
  assert.match(chatAgentCanonicalComposerSource, /aria-label=\{avatarLabel\}/);
  assert.match(chatAgentCanonicalComposerSource, /title=\{avatarTitle\}/);
  assert.match(chatAgentCanonicalComposerSource, /disabled=\{avatarDisabled\}/);
  assert.match(chatAgentPresentationSource, /onConfigure:\s*input\.onOpenAgentCenter/);
  assert.match(chatAgentPresentationSource, /onActivate:\s*handleComposerAvatarAction/);
  assert.doesNotMatch(chatAgentPresentationSource, /previewLoader|PackagePreview|Preview Avatar/u);
  assert.doesNotMatch(chatAgentCanonicalComposerSource, /previewLoader|PackagePreview|Preview Avatar/u);
});

test('Agent Center locale copy does not keep preview or deprecated companion-readiness keys', () => {
  const forbiddenKeys = [
    'agentCenterAvatarCompanionReadiness',
    'agentCenterAvatarPreview',
    'agentCenterPreviewUnavailable',
    'agentCenterAvatarSetupTitle',
    'agentCenterAvatarSetupDescription',
    'agentCenterAvatarAdvancedTitle',
    'agentCenterAvatarComposerHintReady',
    'agentCenterAvatarComposerHintBlocked',
    'agentCenterRuntimeState',
  ];
  for (const locale of ['en', 'zh']) {
    const chatBundle = readDesktopLocale(locale).Chat;
    for (const key of forbiddenKeys) {
      assert.equal(chatBundle[key], undefined, `${locale}.${key} should not remain in Agent Center copy`);
    }
  }
});
