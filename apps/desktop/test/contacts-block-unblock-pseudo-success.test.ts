import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import test from 'node:test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const viewSource = readFileSync(resolve(__dirname, '../src/shell/renderer/features/contacts/contacts-view.tsx'), 'utf8');
const panelSource = readFileSync(resolve(__dirname, '../src/shell/renderer/features/contacts/contacts-panel.tsx'), 'utf8');

function extractFunction(source: string, name: string): string {
  const marker = `const ${name} = async`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} must be async`);
  const nextMarker = source.indexOf('\n  const ', start + marker.length);
  assert.notEqual(nextMarker, -1, `${name} section must be bounded`);
  return source.slice(start, nextMarker);
}

test('contacts block action waits for parent DataSync mutation before success UI updates', () => {
  const section = extractFunction(viewSource, 'handleBlockUser');

  assert.match(section, /await props\.onBlockFriend\?\.\(contact\)/);
  assert.doesNotMatch(section, /setBlockedUsers/);
  assert.doesNotMatch(section, /newMap\.set\(contact\.id/);
  assert.match(section, /setBlockingContact\(null\)/);
});

test('contacts unblock action waits for parent DataSync mutation before success UI updates', () => {
  const section = extractFunction(viewSource, 'handleUnblockUser');

  assert.match(section, /await props\.onUnblockUser\?\.\(contact\)/);
  assert.doesNotMatch(section, /setBlockedUsers/);
  assert.doesNotMatch(section, /newMap\.delete\(contact\.id/);
  assert.match(section, /setUnblockingContact\(null\)/);
});

test('contacts panel rethrows block and unblock mutation failures after feedback', () => {
  const blockSection = panelSource.slice(
    panelSource.indexOf('const onBlockFriend = useCallback'),
    panelSource.indexOf('const onUnblockUser = useCallback'),
  );
  const unblockSection = panelSource.slice(
    panelSource.indexOf('const onUnblockUser = useCallback'),
    panelSource.indexOf('const onMessage = useCallback'),
  );

  assert.match(blockSection, /setFeedback\(\{/);
  assert.match(blockSection, /throw error;/);
  assert.match(unblockSection, /setFeedback\(\{/);
  assert.match(unblockSection, /throw error;/);
});
