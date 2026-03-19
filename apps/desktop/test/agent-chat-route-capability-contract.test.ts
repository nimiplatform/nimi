import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CORE_DATA_API_CAPABILITIES } from '../src/shell/renderer/infra/bootstrap/runtime-bootstrap-utils';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(testDir, '..');

function readDesktopFile(relativePath: string): string {
  return readFileSync(path.join(desktopDir, relativePath), 'utf8');
}

test('core data capability registry exposes agent chat route resolution for mods', () => {
  assert.equal(
    CORE_DATA_API_CAPABILITIES.agentChatRouteResolve,
    'data-api.core.agent.chat.route.resolve',
  );
});

test('core bootstrap registers agent chat route resolution against the desktop route endpoint', () => {
  const source = readDesktopFile('src/shell/renderer/infra/bootstrap/core-capabilities.ts');
  assert.match(source, /agentChatRouteResolve/);
  assert.match(source, /DesktopService\.desktopControllerResolveChatRoute/);
  assert.match(source, /targetType:\s*'AGENT'/);
  assert.doesNotMatch(source, /resolveAgentChatRouteFallback/);
  assert.doesNotMatch(source, /Agent chats are routed to local execution by host fallback policy/);
});
