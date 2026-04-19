import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

const chatContactsSidebarSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-contacts-sidebar.tsx');

test('chat contacts sidebar uses transparent chrome instead of a card background', () => {
  assert.match(chatContactsSidebarSource, /data-chat-contacts-sidebar-chrome="transparent"/);
  assert.match(chatContactsSidebarSource, /className="ml-4 mr-1 flex h-full w-14 shrink-0 flex-col items-center bg-transparent py-2"/);
  assert.match(chatContactsSidebarSource, /data-chat-nimi-thread-toggle="true"/);
  assert.match(chatContactsSidebarSource, /data-chat-settings-toggle="true"/);
  assert.match(chatContactsSidebarSource, /border-t border-white\/70/);
  assert.doesNotMatch(chatContactsSidebarSource, /border-l/u);
  assert.doesNotMatch(chatContactsSidebarSource, /bg-\[var\(--nimi-app-background,#f3f1ee\)\]/u);
});
