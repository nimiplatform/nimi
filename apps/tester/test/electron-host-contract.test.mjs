import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

const requiredCommands = [
  'tester_run_history_load',
  'tester_run_history_save',
  'tester_image_history_load',
  'tester_image_history_save',
  'tester_export_save',
  'tester_artifact_save',
  'resolve_world_tour_fixture',
  'claim_world_tour_viewer_launch',
  'save_world_tour_viewer_preset',
  'world_tour_render_acceptance_save',
  'world_tour_render_acceptance_load',
  'open_world_tour_window',
];

test('tester owns an Electron host beside the Tauri host', () => {
  for (const relativePath of [
    'src-electron/main.ts',
    'src-electron/preload.cts',
    'src-electron/commands/tester-commands.ts',
    'tsconfig.electron.json',
  ]) {
    assert.equal(existsSync(path.join(root, relativePath)), true, `${relativePath} should exist`);
  }

  const packageJson = readJson('package.json');
  assert.match(packageJson.scripts['dev:electron'], /electron/);
  assert.match(packageJson.scripts['build:electron'], /tsconfig\.electron\.json/);
  assert.match(packageJson.scripts['test:e2e:electron'], /electron-acceptance/);
  assert.equal(packageJson.devDependencies['@grpc/grpc-js'], undefined, 'tester must not own raw gRPC');
  assert.match(packageJson.devDependencies.electron || '', /^\^?42\./);
  assert.match(packageJson.devDependencies.playwright || '', /^\^?1\./);
  assert.match(packageJson.devDependencies.tsx || '', /^\^?4\./);
});

test('Electron host keeps Runtime bridge in Kit and app commands in tester', () => {
  const mainSource = read('src-electron/main.ts');
  const preloadSource = read('src-electron/preload.cts');
  const commandSource = read('src-electron/commands/tester-commands.ts');

  assert.match(mainSource, /registerNimiElectronRuntimeBridge/);
  assert.match(mainSource, /createTesterElectronCommandHandlers/);
  assert.match(mainSource, /BrowserWindow/);
  assert.match(mainSource, /contextIsolation:\s*true/);
  assert.match(mainSource, /nodeIntegration:\s*false/);
  assert.match(mainSource, /sandbox:\s*true/);
  assert.doesNotMatch(mainSource, /sandbox:\s*false/);
  assert.match(mainSource, /preload/);
  assert.match(mainSource, /setWindowOpenHandler/);
  assert.match(mainSource, /will-navigate/);
  assert.match(mainSource, /isTesterRendererUrl/);
  assert.doesNotMatch(mainSource, /new Set\(\['file:\/\/'\]\)/);
  assert.match(preloadSource, /@nimiplatform\/kit\/shell\/electron\/preload-cjs/);
  assert.match(preloadSource, /installNimiElectronRuntimeBridge/);

  for (const command of requiredCommands) {
    assert.match(commandSource, new RegExp(command));
  }
  assert.doesNotMatch(commandSource, /@grpc\/grpc-js/);
  assert.doesNotMatch(commandSource, /runtime\/internal/);
  assert.doesNotMatch(mainSource, /runtime\/internal/);
});

test('Electron spike evidence is not part of the accepted host', () => {
  assert.equal(existsSync(path.join(root, 'src-electron/spike')), false);
  assert.doesNotMatch(read('AGENTS.md'), /src-electron\/spike/);
});
