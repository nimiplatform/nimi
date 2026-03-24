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

const chatListSource = readWorkspace('src/shell/renderer/features/chats/chat-list.tsx');
const contactsViewSource = readWorkspace('src/shell/renderer/features/contacts/contacts-view.tsx');
const runtimePanelSource = readWorkspace('src/shell/renderer/features/runtime-config/runtime-config-panel-view.tsx');
const settingsPanelSource = readWorkspace('src/shell/renderer/features/settings/settings-panel-body.tsx');
const sidebarPrimitiveSource = readWorkspace('src/shell/renderer/components/sidebar.tsx');
const sidebarsTable = readRepo('spec/desktop/kernel/tables/renderer-design-sidebars.yaml');
const shellContractSource = readRepo('spec/desktop/kernel/ui-shell-contract.md');
const settingsSpecSource = readRepo('spec/desktop/settings.md');
const runtimeSpecSource = readRepo('spec/desktop/runtime-config.md');

test('sidebar governance table registers the four governed desktop sidebars', () => {
  assert.match(sidebarsTable, /id: chat\.sidebar/);
  assert.match(sidebarsTable, /module: features\/chats\/chat-list\.tsx/);
  assert.match(sidebarsTable, /id: contacts\.sidebar/);
  assert.match(sidebarsTable, /module: features\/contacts\/contacts-view\.tsx/);
  assert.match(sidebarsTable, /id: runtime\.sidebar/);
  assert.match(sidebarsTable, /module: features\/runtime-config\/runtime-config-panel-view\.tsx/);
  assert.match(sidebarsTable, /id: settings\.sidebar/);
  assert.match(sidebarsTable, /module: features\/settings\/settings-panel-body\.tsx/);
  assert.equal((sidebarsTable.match(/family: desktop-sidebar-v1/g) || []).length, 4);
});

test('sidebar family contract is anchored in shell and domain specs', () => {
  assert.match(shellContractSource, /D-SHELL-023/u);
  assert.match(shellContractSource, /D-SHELL-024/u);
  assert.match(shellContractSource, /D-SHELL-025/u);
  assert.match(settingsSpecSource, /D-SHELL-023/u);
  assert.match(runtimeSpecSource, /D-SHELL-023/u);
});

test('governed sidebar modules import and use the shared sidebar primitive', () => {
  for (const source of [chatListSource, contactsViewSource, runtimePanelSource, settingsPanelSource]) {
    assert.match(source, /@renderer\/components\/sidebar\.js/);
    assert.match(source, /SidebarShell/);
    assert.match(source, /SidebarHeader/);
  }

  assert.match(chatListSource, /SidebarSearch/);
  assert.match(chatListSource, /kind="entity-row"/);
  assert.match(contactsViewSource, /SidebarSearch/);
  assert.match(contactsViewSource, /primaryAction=/);
  assert.match(contactsViewSource, /'category-row', 'entity-row'/);
  assert.match(runtimePanelSource, /SidebarSection/);
  assert.match(runtimePanelSource, /kind="nav-row"/);
  assert.match(settingsPanelSource, /SidebarSection/);
  assert.match(settingsPanelSource, /kind="nav-row"/);
  assert.match(contactsViewSource, /SidebarResizeHandle/);
  assert.match(runtimePanelSource, /SidebarResizeHandle/);
  assert.match(settingsPanelSource, /SidebarResizeHandle/);
});

test('shared sidebar primitive exports the required public surface', () => {
  assert.match(sidebarPrimitiveSource, /export function SidebarShell/);
  assert.match(sidebarPrimitiveSource, /export function SidebarHeader/);
  assert.match(sidebarPrimitiveSource, /export function SidebarSearch/);
  assert.match(sidebarPrimitiveSource, /export function SidebarSection/);
  assert.match(sidebarPrimitiveSource, /export function SidebarItem/);
  assert.match(sidebarPrimitiveSource, /export function SidebarResizeHandle/);
});
