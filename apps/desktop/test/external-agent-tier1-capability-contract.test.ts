import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const desktopDir = path.resolve(import.meta.dirname, '..');

function readDesktopFile(relativePath: string): string {
  return readFileSync(path.join(desktopDir, relativePath), 'utf8');
}

test('desktop does not own external agent local AI action descriptors', () => {
  assert.equal(
    existsSync(path.join(desktopDir, 'src/runtime/external-agent/local-ai-actions.ts')),
    false,
  );
  const source = readDesktopFile('src/runtime/external-agent/index.ts');
  assert.doesNotMatch(source, /localAIActionDescriptors/);
  assert.doesNotMatch(source, /runtime\.local-ai\.models\./);
  assert.doesNotMatch(source, /external_agent_sync_action_descriptors/);
});

test('runtime bootstrap does not register app-local external agent descriptors', () => {
  const source = readDesktopFile('src/shell/renderer/infra/bootstrap/runtime-bootstrap.ts');
  assert.doesNotMatch(source, /resyncExternalAgentActionDescriptors/);
  assert.doesNotMatch(source, /external agent descriptor resync/);
  assert.doesNotMatch(source, /startExternalAgentActionBridge/);
});

test('tauri bootstrap does not expose app-local external agent action bridge commands', () => {
  const source = readDesktopFile('src-tauri/src/main_parts/app_bootstrap.rs');
  assert.doesNotMatch(source, /external_agent_sync_action_descriptors/);
  assert.doesNotMatch(source, /external_agent_complete_execution/);
});
