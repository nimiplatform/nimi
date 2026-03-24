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
const sidebarPrimitiveSource = readRepo('kit/ui/src/components/sidebar.tsx');
const desktopStylesSource = readWorkspace('src/shell/renderer/styles.css');
const adoptionTable = readRepo('spec/platform/kernel/tables/nimi-ui-adoption.yaml');
const designContractSource = readRepo('spec/platform/kernel/design-pattern-contract.md');
const designOverviewSource = readRepo('spec/platform/design-pattern.md');

test('platform design adoption table registers the four governed desktop sidebar modules', () => {
  assert.match(adoptionTable, /id: desktop\.chat\.sidebar/);
  assert.match(adoptionTable, /module: apps\/desktop\/src\/shell\/renderer\/features\/chats\/chat-list\.tsx/);
  assert.match(adoptionTable, /id: desktop\.contacts\.sidebar/);
  assert.match(adoptionTable, /module: apps\/desktop\/src\/shell\/renderer\/features\/contacts\/contacts-view\.tsx/);
  assert.match(adoptionTable, /id: desktop\.runtime\.sidebar/);
  assert.match(adoptionTable, /module: apps\/desktop\/src\/shell\/renderer\/features\/runtime-config\/runtime-config-panel-view\.tsx/);
  assert.match(adoptionTable, /id: desktop\.settings\.sidebar/);
  assert.match(adoptionTable, /module: apps\/desktop\/src\/shell\/renderer\/features\/settings\/settings-panel-body\.tsx/);
});

test('sidebar family contract is anchored in platform design authority', () => {
  assert.match(designContractSource, /P-DESIGN-014/u);
  assert.match(designContractSource, /P-DESIGN-020/u);
  assert.match(designContractSource, /P-DESIGN-090/u);
  assert.match(designOverviewSource, /Nimi Design Pattern/u);
  assert.match(designOverviewSource, /shared primitive families/i);
  assert.match(designOverviewSource, /@nimiplatform\/nimi-kit\/ui/u);
});

test('governed sidebar modules import and use the shared sidebar primitive', () => {
  for (const source of [chatListSource, contactsViewSource, runtimePanelSource, settingsPanelSource]) {
    assert.match(source, /@nimiplatform\/nimi-kit\/ui/);
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
  assert.match(sidebarPrimitiveSource, /export function SidebarShell/u);
  assert.match(sidebarPrimitiveSource, /export function SidebarHeader/u);
  assert.match(sidebarPrimitiveSource, /export function SidebarSearch/u);
  assert.match(sidebarPrimitiveSource, /export function SidebarSection/u);
  assert.match(sidebarPrimitiveSource, /export function SidebarItem/u);
  assert.match(sidebarPrimitiveSource, /export function SidebarResizeHandle/u);
});

test('desktop renderer stylesheet does not redefine shared .nimi authorities', () => {
  assert.doesNotMatch(desktopStylesSource, /(^|\n)\s*\.nimi-[^\n]*\{/u);
  assert.doesNotMatch(desktopStylesSource, /--nimi-[a-z0-9-]+\s*:/u);
});
