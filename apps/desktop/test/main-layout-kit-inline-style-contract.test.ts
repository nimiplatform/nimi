import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const PANEL_STACK_PATH = resolve(import.meta.dirname, '../src/shell/renderer/app-shell/layouts/main-layout-panel-stack.tsx');
const SETTINGS_MENU_PATH = resolve(import.meta.dirname, '../src/shell/renderer/app-shell/layouts/main-layout-settings-menu.tsx');
const MAIN_LAYOUT_VIEW_PATH = resolve(import.meta.dirname, '../src/shell/renderer/app-shell/layouts/main-layout-view.tsx');

test('main layout shell avoids inline style exceptions outside kit allowlist', () => {
  const panelStack = readFileSync(PANEL_STACK_PATH, 'utf-8');
  const settingsMenu = readFileSync(SETTINGS_MENU_PATH, 'utf-8');
  const mainLayoutView = readFileSync(MAIN_LAYOUT_VIEW_PATH, 'utf-8');

  assert.doesNotMatch(panelStack, /style=\{\{\s*display:/);
  assert.doesNotMatch(settingsMenu, /style=\{\{\s*top:/);
  assert.doesNotMatch(settingsMenu, /style=\{\{[^}]*left:/);
  assert.doesNotMatch(mainLayoutView, /style=\{\{\s*mixBlendMode:/);
  assert.match(panelStack, /runtimeActive \? 'flex' : 'hidden'/);
  assert.match(mainLayoutView, /mix-blend-multiply/);
});
