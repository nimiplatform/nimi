import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const desktopDir = resolve(import.meta.dirname, '..');
const repoDir = resolve(desktopDir, '../..');

function readRepo(relativePath: string): string {
  return readFileSync(resolve(repoDir, relativePath), 'utf8');
}

test('runtime AI bridge metadata helper is migrated to SDK host route access', () => {
  assert.equal(existsSync(resolve(desktopDir, 'src/runtime/llm-adapter/execution/runtime-ai-bridge.ts')), false);

  const desktopAccess = readRepo('apps/desktop/src/shell/renderer/infra/runtime-route-host-access.ts');

  assert.match(desktopAccess, /surfaceId:\s*'desktop\.renderer'/);
  assert.match(desktopAccess, /callerKind:\s*'desktop-core'/);
  assert.doesNotMatch(desktopAccess, /@runtime\/llm-adapter/);
});
