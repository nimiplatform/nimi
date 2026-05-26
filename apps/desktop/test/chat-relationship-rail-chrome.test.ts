import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

const chatRelationshipRailSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-relationship-rail.tsx');

test('chat relationship rail uses transparent chrome instead of a card background', () => {
  assert.match(chatRelationshipRailSource, /data-chat-relationship-rail-chrome="transparent"/);
  assert.match(chatRelationshipRailSource, /className="ml-4 mr-1 flex h-full w-14 shrink-0 flex-col items-center bg-transparent py-2"/);
  assert.match(chatRelationshipRailSource, /data-chat-nimi-thread-toggle="true"/);
  assert.match(chatRelationshipRailSource, /data-chat-settings-toggle="true"/);
  assert.match(chatRelationshipRailSource, /border-t border-white\/70/);
  assert.doesNotMatch(chatRelationshipRailSource, /border-l/u);
  assert.doesNotMatch(chatRelationshipRailSource, /bg-\[var\(--nimi-app-background,#f3f1ee\)\]/u);
});
