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

test('D-BOOT-011: exit handler cleans up shell state before quit and only stops managed daemons', () => {
  const source = readFileSync(EXIT_HANDLER_PATH, 'utf-8');
  const stopPollingIndex = source.indexOf('dataSync.stopAllPolling();');
  const clearRefreshIndex = source.indexOf('dataSync.clearProactiveRefreshTimer();');
  const stopWatcherIndex = source.indexOf('stopAuthStateWatcher();');
  const managedGuardIndex = source.indexOf('if (options.managed) {');
  const stopRuntimeBridgeIndex = source.indexOf('await stopRuntimeBridge();');
  const completeQuitIndex = source.indexOf('await completeMenuBarQuit();');

  assert.ok(stopPollingIndex !== -1, 'exit handler must stop DataSync polling');
  assert.ok(clearRefreshIndex !== -1, 'exit handler must clear the proactive refresh timer');
  assert.ok(stopWatcherIndex !== -1, 'exit handler must stop the auth watcher');
  assert.ok(managedGuardIndex !== -1, 'exit handler must guard daemon stop behind options.managed');
  assert.ok(stopRuntimeBridgeIndex !== -1, 'exit handler must stop the runtime bridge on managed quit');
  assert.ok(completeQuitIndex !== -1, 'exit handler must complete the menu bar quit flow');
  assert.ok(stopPollingIndex < clearRefreshIndex, 'polling stop must happen before proactive refresh cleanup');
  assert.ok(clearRefreshIndex < stopWatcherIndex, 'proactive refresh cleanup must happen before auth watcher shutdown');
  assert.ok(stopWatcherIndex < managedGuardIndex, 'shell cleanup must finish before managed daemon shutdown guard');
  assert.ok(managedGuardIndex < stopRuntimeBridgeIndex, 'managed daemon shutdown must stay inside the managed guard');
  assert.ok(stopRuntimeBridgeIndex < completeQuitIndex, 'runtime bridge stop must happen before final app quit');
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
