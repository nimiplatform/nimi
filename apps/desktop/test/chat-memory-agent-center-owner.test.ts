import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const desktopRoot = path.join(import.meta.dirname, '..');
const agentShellAdapterSource = fs.readFileSync(
  path.join(desktopRoot, 'src/shell/renderer/features/chat/chat-agent-shell-adapter.tsx'),
  'utf8',
);
const agentCenterPlacementSource = fs.readFileSync(
  path.join(desktopRoot, 'src/shell/renderer/features/chat/chat-agent-shell-presentation-settings.tsx'),
  'utf8',
);
test('Agent Center memory projection is owned by Kit, not Desktop slots', () => {
  assert.match(agentCenterPlacementSource, /@nimiplatform\/kit\/features\/agent-center/);
  assert.doesNotMatch(agentShellAdapterSource, /ChatAgentCognitionPanel/);
});
