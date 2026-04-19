import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const desktopDir = path.resolve(import.meta.dirname, '..');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(desktopDir, relativePath), 'utf8');
}

test('agent shell settings content mounts ChatAgentAvatarBindingSettings', () => {
  const source = readSource('src/shell/renderer/features/chat/chat-agent-shell-presentation.tsx');
  assert.match(source, /import\s+\{\s*ChatAgentAvatarBindingSettings\s*\}/);
  assert.match(source, /presenceContent=\{\(/);
  assert.match(source, /<ChatAgentAvatarBindingSettings/);
});

test('ChatSettingsPanel AI mode routes presenceContent into the avatar module detail', () => {
  const source = readSource('src/shell/renderer/features/chat/chat-settings-panel.tsx');
  assert.match(source, /presenceContent\?: ReactNode/);
  assert.match(source, /{props\.presenceContent}/);
  assert.match(source, /presenceContent=\{presenceContent\}/);
  assert.match(source, /activeModuleId === 'avatar'/);
  assert.match(source, /avatarSummary=\{avatarSummary\}/);
});
