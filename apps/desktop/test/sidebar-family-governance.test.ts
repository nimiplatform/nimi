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
const chatRelationshipRailSource = readWorkspace('src/shell/renderer/features/chat/chat-relationship-rail.tsx');
const runtimePanelSource = readWorkspace('src/shell/renderer/features/runtime-config/runtime-config-panel-view.tsx');
const settingsPanelSource = readWorkspace('src/shell/renderer/features/settings/settings-panel-body.tsx');
const desktopStylesSource = readWorkspace('src/shell/renderer/styles.css');
const adoptionTable = readRepo('.nimi/spec/desktop/kernel/tables/nimi-kit-adoption.yaml');
const compositionsTable = readRepo('.nimi/spec/desktop/kernel/tables/nimi-kit-compositions.yaml');
const designContractSource = readRepo('.nimi/spec/platform/kernel/design-pattern-contract.md');
const designOverviewSource = readRepo('.nimi/spec/platform/design-pattern.md');

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
});

test('sidebar family contract is anchored in platform design authority', () => {
  assert.match(designContractSource, /P-DESIGN-014/u);
  assert.match(designContractSource, /P-DESIGN-020/u);
  assert.match(designContractSource, /P-DESIGN-090/u);
  assert.match(designContractSource, /shared primitive families/i);
  assert.match(designContractSource, /@nimiplatform\/kit\/ui/u);
  assert.match(designOverviewSource, /does not define product rules/u);
  assert.match(designOverviewSource, /\.nimi\/spec\/platform\/kernel\/design-pattern-contract\.md/u);
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
    assert.match(source, /CanonicalConversationShell/);
  }
  assert.match(chatRelationshipRailSource, /E2E_IDS\.chatList/);
  assert.match(chatRelationshipRailSource, /E2E_IDS\.chatRow/);
  assert.doesNotMatch(chatRelationshipRailSource, /components\/sidebar\.js/);
});

test('desktop renderer stylesheet does not redefine shared .nimi authorities', () => {
  assert.doesNotMatch(desktopStylesSource, /(^|\n)\s*\.nimi-[^\n]*\{/u);
  assert.doesNotMatch(desktopStylesSource, /--nimi-[a-z0-9-]+\s*:/u);
});
