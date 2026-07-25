import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readWorkspace(relativePath: string): string {
  return readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

function readRepo(relativePath: string): string {
  return readFileSync(path.join(import.meta.dirname, '..', '..', '..', relativePath), 'utf8');
}

const chatPageSource = readWorkspace('src/shell/renderer/features/chat/chat-page.tsx');
const chatAiModeContentSource = readWorkspace('src/shell/renderer/features/chat/chat-nimi-mode-content.tsx');
const chatAgentModeContentSource = readWorkspace('src/shell/renderer/features/chat/chat-agent-mode-content.tsx');
const chatHumanModeContentSource = readWorkspace('src/shell/renderer/features/chat/chat-human-mode-content.tsx');
const chatCanonicalModeFrameSource = readWorkspace('src/shell/renderer/features/chat/chat-canonical-mode-frame.tsx');
const chatRelationshipRailSource = readWorkspace('src/shell/renderer/features/chat/chat-relationship-rail.tsx');
const mainLayoutViewSource = readWorkspace('src/shell/renderer/app-shell/layouts/main-layout-view.tsx');
const mainLayoutTopbarSource = readWorkspace('src/shell/renderer/app-shell/layouts/main-layout-topbar.tsx');
const mainLayoutSettingsMenuSource = readWorkspace('src/shell/renderer/app-shell/layouts/main-layout-settings-menu.tsx');
const runtimePanelSource = readWorkspace('src/shell/renderer/features/runtime-config/runtime-config-panel-view.tsx');
const settingsPanelSource = readWorkspace('src/shell/renderer/features/settings/settings-panel-body.tsx');
const desktopStylesSource = readWorkspace('src/shell/renderer/styles.css');
const adoptionTable = readRepo('config/desktop-shell-ui-kit-adoption.yaml');
const compositionsTable = readRepo('config/desktop-shell-ui-kit-compositions.yaml');
const designContractSource = readRepo('.nimi/spec/platform/ui-design-system.authority.yaml');
const desktopShellUiAuthoritySource = readRepo('.nimi/spec/desktop/shell-ui.authority.yaml');

test('desktop kit registries align with the desktop chat relationship rail refactor', () => {
  assert.doesNotMatch(adoptionTable, /features\/chats\/chat-list\.tsx/);
  assert.doesNotMatch(adoptionTable, /id: desktop\.contacts\.sidebar/);
  assert.doesNotMatch(adoptionTable, /module: apps\/desktop\/src\/shell\/renderer\/features\/contacts\/contacts-view\.tsx/);
  assert.match(adoptionTable, /id: desktop\.runtime\.sidebar/);
  assert.match(adoptionTable, /module: apps\/desktop\/src\/shell\/renderer\/features\/runtime-config\/runtime-config-panel-view\.tsx/);
  assert.match(adoptionTable, /id: desktop\.settings\.sidebar/);
  assert.match(adoptionTable, /module: apps\/desktop\/src\/shell\/renderer\/features\/settings\/settings-panel-body\.tsx/);
  assert.match(compositionsTable, /id: desktop\.chat\.relationship_rail/);
  assert.match(compositionsTable, /module: apps\/desktop\/src\/shell\/renderer\/features\/chat\/chat-relationship-rail\.tsx/);
  assert.match(compositionsTable, /component: ChatRelationshipRail/);
  assert.match(compositionsTable, /classification: app_owned_composition/);
  assert.match(compositionsTable, /id: desktop\.shell\.main_layout_view/);
  assert.match(compositionsTable, /module: apps\/desktop\/src\/shell\/renderer\/app-shell\/layouts\/main-layout-view\.tsx/);
  assert.match(compositionsTable, /component: MainLayoutView/);
  assert.match(compositionsTable, /id: desktop\.shell\.main_layout_topbar/);
  assert.match(compositionsTable, /module: apps\/desktop\/src\/shell\/renderer\/app-shell\/layouts\/main-layout-topbar\.tsx/);
  assert.match(compositionsTable, /component: MainLayoutTopBar/);
  assert.match(compositionsTable, /id: desktop\.shell\.settings_menu/);
  assert.match(compositionsTable, /module: apps\/desktop\/src\/shell\/renderer\/app-shell\/layouts\/main-layout-settings-menu\.tsx/);
  assert.match(compositionsTable, /component: MainLayoutSettingsMenu/);
});

test('sidebar family contract is anchored in platform and Desktop authority', () => {
  assert.match(designContractSource, /id: rule\.nimi\.platform\.ui-design-system\.p-design-001a/u);
  assert.match(designContractSource, /single cross-app authority for shared primitive families/u);
  assert.match(designContractSource, /id: rule\.nimi\.platform\.ui-design-system\.p-design-010/u);
  assert.match(designContractSource, /Kit delivers accessible token-styled shared primitives for surface, action, overlay, sidebar/u);
  assert.match(designContractSource, /id: rule\.nimi\.platform\.ui-design-system\.p-design-014/u);
  assert.match(designContractSource, /Shared sidebars and shell navigation use the nimi-sidebar-v1 family/u);
  assert.match(desktopShellUiAuthoritySource, /id: rule\.nimi\.desktop\.shell-ui\.r023/u);
  assert.match(desktopShellUiAuthoritySource, /Runtime Config and Settings use desktop-sidebar-v1/u);
  assert.match(desktopShellUiAuthoritySource, /id: rule\.nimi\.desktop\.shell-ui\.r025/u);
  assert.match(desktopShellUiAuthoritySource, /route dynamic width through SidebarShell and SidebarResizeHandle/u);
});

test('governed sidebar modules import and use the shared sidebar primitive', () => {
  for (const source of [runtimePanelSource, settingsPanelSource]) {
    assert.match(source, /@nimiplatform\/kit\/ui/);
    assert.match(source, /SidebarShell/);
    assert.match(source, /SidebarHeader/);
  }

  assert.match(runtimePanelSource, /SidebarSection/);
  assert.match(runtimePanelSource, /kind="nav-row"/);
  assert.match(settingsPanelSource, /SidebarSection/);
  assert.match(settingsPanelSource, /kind="nav-row"/);
  assert.match(runtimePanelSource, /SidebarResizeHandle/);
  assert.match(settingsPanelSource, /SidebarResizeHandle/);
});

test('chat surface composes the canonical shell with an app-owned relationship rail', () => {
  assert.match(chatPageSource, /ChatRelationshipRail/);
  assert.match(chatPageSource, /ChatHumanModeContent/);
  assert.match(chatPageSource, /ChatNimiModeContent/);
  assert.match(chatPageSource, /ChatAgentModeContent/);
  assert.match(chatPageSource, /E2E_IDS\.chatPage/);
  for (const source of [chatHumanModeContentSource, chatAiModeContentSource, chatAgentModeContentSource]) {
    assert.match(source, /ChatCanonicalModeFrame/);
  }
  assert.match(chatCanonicalModeFrameSource, /CanonicalConversationShell/);
  assert.match(chatRelationshipRailSource, /E2E_IDS\.chatList/);
  assert.match(chatRelationshipRailSource, /E2E_IDS\.chatRow/);
  assert.doesNotMatch(chatRelationshipRailSource, /components\/sidebar\.js/);
});

test('app shell kit compositions are registered with their direct kit imports', () => {
  assert.match(mainLayoutViewSource, /@nimiplatform\/kit\/ui/);
  assert.match(mainLayoutViewSource, /AmbientBackground/);
  assert.match(mainLayoutViewSource, /ScrollArea/);
  assert.match(mainLayoutViewSource, /Tooltip/);

  assert.match(mainLayoutTopbarSource, /@nimiplatform\/kit\/ui/);
  assert.match(mainLayoutTopbarSource, /Tooltip/);

  assert.match(mainLayoutSettingsMenuSource, /@nimiplatform\/kit\/ui/);
  assert.match(mainLayoutSettingsMenuSource, /ScrollArea/);
  assert.match(mainLayoutSettingsMenuSource, /Surface/);
});

test('desktop renderer stylesheet does not redefine shared .nimi authorities', () => {
  assert.match(desktopStylesSource, /^@scope \(\.nimi-ui-module--desktop\) \{/u);
  assert.doesNotMatch(desktopStylesSource, /(^|\n)\s*\.nimi-(?!ui-module--desktop\b)[^\n]*\{/u);
  assert.doesNotMatch(desktopStylesSource, /--nimi-(?!ui-module-desktop-)[a-z0-9-]+\s*:/u);
});
