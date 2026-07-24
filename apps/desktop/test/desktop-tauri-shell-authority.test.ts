import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '../../..');

function read(path: string): string {
  return readFileSync(resolve(root, path), 'utf8');
}

function specCommands(): string[] {
  const source = read('.nimi/spec/desktop/kernel/tables/ipc-commands.yaml');
  return [...source.matchAll(/^\s*-\s*command:\s*([A-Za-z0-9_]+)\s*$/gm)]
    .flatMap((match) => (match[1] ? [match[1]] : []))
    .sort();
}

function appRegisteredCommands(): string[] {
  const source = read('apps/desktop/src-tauri/src/main_parts/app_bootstrap.rs');
  const handlerIndex = source.indexOf('.invoke_handler(');
  assert.notEqual(handlerIndex, -1, 'Desktop app bootstrap must register invoke handler');
  const listStart = source.indexOf('nimi_shell_tauri::nimi_shell_tauri_oauth_runtime_bridge_handler![', handlerIndex);
  assert.notEqual(listStart, -1, 'Desktop invoke handler must use the Kit oauth/runtime bridge macro');
  const listEnd = source.indexOf('])', listStart);
  assert.notEqual(listEnd, -1, 'Desktop invoke handler list must close');
  const body = source.slice(listStart, listEnd);
  return [...body.matchAll(/^\s*(?:crate::|super::|menu_bar_shell::|chat_ai_store::|local_runtime::)?(?:[A-Za-z0-9_]+::)*([A-Za-z0-9_]+),\s*$/gm)]
    .flatMap((match) => (match[1] ? [match[1]] : []))
    .filter((name) => name !== 'runtime_defaults')
    .sort();
}

function kitInjectedCommands(): string[] {
  const source = read('kit/shell/tauri/src/command_registration.rs');
  const macroIndex = source.indexOf('macro_rules! nimi_shell_tauri_oauth_runtime_bridge_handler');
  assert.notEqual(macroIndex, -1, 'Kit command registration macro must exist');
  const body = source.slice(macroIndex, source.indexOf(']', macroIndex));
  return [
    'runtime_defaults',
    ...[...body.matchAll(/\$crate::capabilities::(?:[A-Za-z0-9_]+::)*([A-Za-z0-9_]+),/g)]
      .flatMap((match) => (match[1] ? [match[1]] : [])),
  ].sort();
}

test('Desktop Tauri registered invoke commands match active IPC spec exactly', () => {
  const registered = [...new Set([...appRegisteredCommands(), ...kitInjectedCommands()])].sort();
  const spec = specCommands();
  assert.deepEqual(registered, spec);
});

test('Desktop command classification does not claim Tester World-Tour commands', () => {
  const source = read('config/desktop-command-execution-classification.yaml');
  assert.doesNotMatch(source, /open_world_tour_window/);
  assert.doesNotMatch(source, /claim_world_tour_viewer_launch/);
  assert.doesNotMatch(source, /world_tour_render_acceptance_(?:load|save)/);
});
