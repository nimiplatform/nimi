import assert from 'node:assert/strict';
import test from 'node:test';
import { createHomeNavigation } from '../src/shell/renderer/app-shell/providers/home-navigation.js';
import { createHumanAttachmentDrafts } from '../src/shell/renderer/features/chat/chat-human-attachment-drafts.js';
import type { PendingAttachment } from '../src/shell/renderer/features/turns/turn-input-attachments.js';

test('live human attachment files survive flip but are released on account scope loss', async () => {
  const navigation = createHomeNavigation();
  const revoked: string[] = [];
  const cache = createHumanAttachmentDrafts(navigation, url => revoked.push(url));
  const file = { previewUrl: 'blob:alice', name: 'photo.png' } as PendingAttachment;
  cache.set('alice', [file]);
  await navigation.push({ id: 'chat', chat: { mode: 'human', targetId: 'alice', threadId: 'chat-a' } });
  await navigation.switchChatSide('companion');
  await navigation.switchChatSide('human');
  assert.equal(cache.get('alice')[0], file);
  assert.deepEqual(cache.get('bob'), []);
  assert.deepEqual(revoked, []);
  navigation.reset({ id: 'home' });
  assert.deepEqual(revoked, ['blob:alice']);
  assert.deepEqual(cache.get('alice'), []);
  cache.set('alice', [file]);
  assert.deepEqual(cache.get('alice'), [], 'the retired composer cannot restore old files');
  navigation.dispose();
});
