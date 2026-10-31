import assert from 'node:assert/strict';
import test from 'node:test';
import { createHomeNavigation } from '../src/shell/renderer/app-shell/providers/home-navigation.js';
import { nimiComposerDraftRef } from '../src/shell/renderer/features/chat/chat-nimi-composer-draft.js';

test('Nimi landing and thread drafts survive leaving the page without overriding each other or a new account', async () => {
  const navigation = createHomeNavigation();
  const landing = nimiComposerDraftRef(navigation, null, '');
  landing.current = 'unsent landing message';
  await navigation.push({ id: 'chat', chat: { mode: 'ai' } });
  await navigation.switchChatSide('human');
  await navigation.switchChatSide('companion');
  assert.equal(nimiComposerDraftRef(navigation, null, '').current, 'unsent landing message');
  const thread = nimiComposerDraftRef(navigation, 'thread-a', 'saved on disk');
  assert.equal(thread.current, 'saved on disk');
  thread.current = '';
  assert.equal(nimiComposerDraftRef(navigation, 'thread-a', 'saved on disk').current, '', 'clearing the field must not resurrect a disk draft');
  assert.equal(landing.current, 'unsent landing message');
  navigation.reset({ id: 'home' });
  landing.current = 'late old-account write';
  assert.equal(nimiComposerDraftRef(navigation, null, '').current, '');
  navigation.dispose();
});
