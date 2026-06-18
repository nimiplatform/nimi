import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(testDir, '..');
const repoRoot = path.resolve(desktopDir, '../..');

function readDesktopFile(relativePath: string): string {
  return readFileSync(path.join(desktopDir, relativePath), 'utf8');
}

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('core chat flow filters agent threads out of product chat data', () => {
  const source = readDesktopFile('src/shell/renderer/features/chat/data/realm-human-chat-data.ts');
  const kitHumanProjectionSource = readRepoFile('kit/features/chat/src/realm/human.ts');
  assert.match(source, /filterRealmDirectHumanChats/);
  assert.match(source, /@nimiplatform\/kit\/features\/chat\/realm/);
  assert.doesNotMatch(source, /function isHumanChatThread/);
  assert.match(kitHumanProjectionSource, /export function isRealmDirectHumanChat/);
  assert.match(kitHumanProjectionSource, /sourceRef\?: unknown/);
  assert.match(kitHumanProjectionSource, /runtimeSourceRef\?: unknown/);
  assert.match(kitHumanProjectionSource, /sourceLike\.sourceRef !== null && sourceLike\.sourceRef !== undefined/);
  assert.match(kitHumanProjectionSource, /sourceLike\.runtimeSourceRef !== null && sourceLike\.runtimeSourceRef !== undefined/);
  assert.match(kitHumanProjectionSource, /export function filterRealmDirectHumanChats/);
});

test('core human chat UI no longer infers agent threads from handle prefixes', () => {
  const humanThreadModelSource = readRepoFile('kit/features/chat/src/realm/human.ts');
  const timelineSource = readDesktopFile('src/shell/renderer/features/turns/message-timeline-utils.tsx');
  assert.match(humanThreadModelSource, /export function getRealmHumanTargetId/);
  assert.match(humanThreadModelSource, /chat\.otherUser\?\.id/);
  assert.doesNotMatch(humanThreadModelSource, /startsWith\('~'\)/);
  assert.doesNotMatch(timelineSource, /startsWith\('~'\)/);
});
