import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(testDir, '..');

function readDesktopFile(relativePath: string): string {
  return readFileSync(path.join(desktopDir, relativePath), 'utf8');
}

test('core chat flow filters agent threads out of product chat data', () => {
  const source = readDesktopFile('src/runtime/data-sync/flows/chat-flow.ts');
  assert.match(source, /function isHumanChatThread/);
  assert.match(source, /isAgent\?: unknown/);
  assert.match(source, /\.isAgent !== true/);
  assert.match(source, /items:\s*filterHumanChatItems/);
});

test('core chat UI no longer infers agent threads from handle prefixes', () => {
  const chatListSource = readDesktopFile('src/shell/renderer/features/chats/chat-list.tsx');
  const timelineSource = readDesktopFile('src/shell/renderer/features/turns/message-timeline-utils.tsx');
  assert.match(chatListSource, /kind="human"/);
  assert.doesNotMatch(chatListSource, /startsWith\('~'\)/);
  assert.doesNotMatch(timelineSource, /startsWith\('~'\)/);
});
