import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const EXIT_HANDLER_PATH = resolve(import.meta.dirname, '../src/shell/renderer/infra/bootstrap/exit-handler.ts');
const RUNTIME_BRIDGE_PATH = resolve(import.meta.dirname, '../src/shell/renderer/bridge/runtime-bridge.ts');
const APP_BOOTSTRAP_PATH = resolve(import.meta.dirname, '../src-tauri/src/main_parts/app_bootstrap.rs');
const MENU_BAR_ACTIONS_PATH = resolve(import.meta.dirname, '../src-tauri/src/menu_bar_shell/actions.rs');
const MENU_BAR_MENU_PATH = resolve(import.meta.dirname, '../src-tauri/src/menu_bar_shell/menu.rs');
const MENU_BAR_STATE_PATH = resolve(import.meta.dirname, '../src-tauri/src/menu_bar_shell/state.rs');
const MENU_BAR_NAVIGATION_PATH = resolve(import.meta.dirname, '../src/shell/renderer/infra/menu-bar/menu-bar-navigation-listener.ts');
const RUNTIME_PANEL_CONTROLLER_PATH = resolve(import.meta.dirname, '../src/shell/renderer/features/runtime-config/runtime-config-panel-controller.ts');

test('exit handler only reacts to explicit menu bar quit events', () => {
  const source = readFileSync(EXIT_HANDLER_PATH, 'utf-8');
  assert.match(source, /menu-bar:\/\/quit-requested/);
  assert.match(source, /completeMenuBarQuit/);
  assert.doesNotMatch(source, /tauri:\/\/close-requested/);
});

test('D-BOOT-011: exit handler cleans up shell state without stopping the OS-managed Runtime', () => {
  const source = readFileSync(EXIT_HANDLER_PATH, 'utf-8');
  const stopWatcherIndex = source.indexOf('stopAuthStateWatcher();');
  const completeQuitIndex = source.indexOf('await completeMenuBarQuit();');

  assert.ok(stopWatcherIndex !== -1, 'exit handler must stop the auth watcher');
  assert.ok(completeQuitIndex !== -1, 'exit handler must complete the menu bar quit flow');
  assert.ok(stopWatcherIndex < completeQuitIndex, 'shell cleanup must finish before final app quit');
  assert.doesNotMatch(source, /stopRuntimeBridge|runtime_bridge_stop/);
});

test('D-BOOT-011: native menu bar exposes no Runtime stop path', () => {
  const actionsSource = readFileSync(MENU_BAR_ACTIONS_PATH, 'utf-8');
  const menuSource = readFileSync(MENU_BAR_MENU_PATH, 'utf-8');
  const stateSource = readFileSync(MENU_BAR_STATE_PATH, 'utf-8');

  assert.doesNotMatch(actionsSource, /MENU_ID_STOP_RUNTIME|RuntimeAction::Stop|stop_daemon/);
  assert.doesNotMatch(menuSource, /stop_runtime|Stop Runtime/);
  assert.doesNotMatch(stateSource, /stop_enabled|Some\("stop"\)/);
});

test('renderer bridge exposes menu bar health sync and quit finalize actions', () => {
  const source = readFileSync(RUNTIME_BRIDGE_PATH, 'utf-8');
  assert.match(source, /syncMenuBarRuntimeHealth/);
  assert.match(source, /completeMenuBarQuit/);
});

test('menu bar runtime navigation updates both persisted state and live runtime page', () => {
  const listenerSource = readFileSync(MENU_BAR_NAVIGATION_PATH, 'utf-8');
  const actionsSource = readFileSync(MENU_BAR_ACTIONS_PATH, 'utf-8');
  const controllerSource = readFileSync(RUNTIME_PANEL_CONTROLLER_PATH, 'utf-8');
  assert.match(listenerSource, /runtimeConfigNavigation\.openPage/);
  assert.match(controllerSource, /runtimeConfigNavigation\.subscribe/);
  assert.match(controllerSource, /runtimeConfigNavigation\.get/);
  assert.doesNotMatch(listenerSource, /page:\s*'local'/);
  assert.match(actionsSource, /Some\("models"\)/);
});

test('tauri bootstrap intercepts close requests and exit requests for menu bar shell', () => {
  const source = readFileSync(APP_BOOTSTRAP_PATH, 'utf-8');
  assert.match(source, /CloseRequested/);
  assert.match(source, /window_for_close\.hide/);
  assert.match(source, /RunEvent::ExitRequested/);
  assert.match(source, /menu_bar_shell::request_quit/);
  assert.match(source, /menu_bar_shell::is_enabled\(\)/);
});
