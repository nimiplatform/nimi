import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const desktopDir = resolve(import.meta.dirname, '..');
const repoDir = resolve(desktopDir, '../..');

function readRepo(relativePath: string): string {
  return readFileSync(resolve(repoDir, relativePath), 'utf8');
}

test('LLM health check behavior is SDK-owned and Desktop consumes configured host access', () => {
  assert.equal(existsSync(resolve(desktopDir, 'src/runtime/llm-adapter/execution/health-check.ts')), false);

  const desktopAccess = readRepo('apps/desktop/src/shell/renderer/infra/runtime-route-host-access.ts');
  const bootstrap = readRepo('apps/desktop/src/shell/renderer/infra/bootstrap/runtime-bootstrap-conversation-route-runtime.ts');

  assert.match(desktopAccess, /createHostRuntimeRouteAccessSurface/);
  assert.match(desktopAccess, /appId:\s*'nimi\.desktop'/);
  assert.match(bootstrap, /desktopRuntimeRouteAccess\.checkLocalHealth/);
  assert.doesNotMatch(bootstrap, /@runtime\/llm-adapter/);
});
