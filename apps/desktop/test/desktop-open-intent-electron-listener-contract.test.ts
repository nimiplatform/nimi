import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Desktop Open renderer listener uses the shared shell bridge for Tauri and Electron', async () => {
  const source = await readFile(new URL(
    '../src/shell/renderer/infra/desktop-open/desktop-open-intent-listener.ts',
    import.meta.url,
  ), 'utf8');
  assert.match(source, /hasNimiShellRuntime\(\)/u);
  assert.match(source, /listenShell\(DESKTOP_OPEN_INTENT_EVENT/u);
  assert.doesNotMatch(source, /hasTauriRuntime|listenTauri/u);
});
