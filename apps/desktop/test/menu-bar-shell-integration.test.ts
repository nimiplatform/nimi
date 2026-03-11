import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SHELL_MODE_PATH = resolve(import.meta.dirname, '../../_libs/shell-core/src/shell-mode.ts');
const EXIT_HANDLER_PATH = resolve(import.meta.dirname, '../src/shell/renderer/infra/bootstrap/exit-handler.ts');
const RUNTIME_BRIDGE_PATH = resolve(import.meta.dirname, '../src/shell/renderer/bridge/runtime-bridge.ts');
const APP_BOOTSTRAP_PATH = resolve(import.meta.dirname, '../src-tauri/src/main_parts/app_bootstrap.rs');
const MENU_BAR_NAVIGATION_PATH = resolve(import.meta.dirname, '../src/shell/renderer/infra/menu-bar/menu-bar-navigation-listener.ts');
const RUNTIME_PANEL_CONTROLLER_PATH = resolve(import.meta.dirname, '../src/shell/renderer/features/runtime-config/runtime-config-panel-controller.ts');

test('shell mode exposes enableMenuBarShell flag', () => {
  const source = readFileSync(SHELL_MODE_PATH, 'utf-8');
  assert.match(source, /enableMenuBarShell/);
  assert.match(source, /isMacDesktopEnvironment/);
});

test('exit handler only reacts to explicit menu bar quit events', () => {
  const source = readFileSync(EXIT_HANDLER_PATH, 'utf-8');
  assert.match(source, /menu-bar:\/\/quit-requested/);
  assert.match(source, /completeMenuBarQuit/);
  assert.doesNotMatch(source, /tauri:\/\/close-requested/);
});

test('renderer bridge exposes menu bar health sync and quit finalize actions', () => {
  const source = readFileSync(RUNTIME_BRIDGE_PATH, 'utf-8');
  assert.match(source, /syncMenuBarRuntimeHealth/);
  assert.match(source, /completeMenuBarQuit/);
});

test('menu bar runtime navigation updates both persisted state and live runtime page', () => {
  const listenerSource = readFileSync(MENU_BAR_NAVIGATION_PATH, 'utf-8');
  const controllerSource = readFileSync(RUNTIME_PANEL_CONTROLLER_PATH, 'utf-8');
  assert.match(listenerSource, /dispatchRuntimeConfigOpenPage/);
  assert.match(controllerSource, /addRuntimeConfigOpenPageListener/);
});

test('tauri bootstrap intercepts close requests and exit requests for menu bar shell', () => {
  const source = readFileSync(APP_BOOTSTRAP_PATH, 'utf-8');
  assert.match(source, /CloseRequested/);
  assert.match(source, /window_for_close\.hide/);
  assert.match(source, /RunEvent::ExitRequested/);
  assert.match(source, /menu_bar_shell::request_quit/);
});
