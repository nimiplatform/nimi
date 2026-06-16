import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const runTauriDevSource = fs.readFileSync(
  path.join(root, 'scripts/run-tauri-dev.mjs'),
  'utf8',
);

test('tester renderer dev command only owns the Vite long-running process', () => {
  assert.equal(
    packageJson.scripts['dev:renderer'],
    'vite --host 127.0.0.1 --port 1468 --strictPort',
  );
});

test('tester Tauri dev command performs renderer port preflight before Tauri supervises beforeDevCommand', () => {
  const preflightIndex = runTauriDevSource.indexOf('ensureRendererPortAvailable();');
  const spawnIndex = runTauriDevSource.indexOf('const child = spawn(command, commandArgs');

  assert.ok(preflightIndex > -1, 'dev command must run renderer port preflight');
  assert.ok(spawnIndex > preflightIndex, 'renderer port preflight must finish before Tauri starts');
  assert.match(runTauriDevSource, /process\.execPath, \['scripts\/ensure-dev-renderer-port\.mjs'\]/);
});

test('tester Tauri dev command does not self-signal when the Tauri child exits', () => {
  assert.match(runTauriDevSource, /const SIGNAL_EXIT_CODES = new Map/);
  assert.match(runTauriDevSource, /let activeTauriChild = null/);
  assert.match(runTauriDevSource, /function terminateProcessTree\(child\)/);
  assert.match(runTauriDevSource, /process\.on\(signal, \(\) => exitFromSignal\(signal\)\)/);
  assert.doesNotMatch(runTauriDevSource, /process\.kill\(process\.pid, signal\)/);
});
