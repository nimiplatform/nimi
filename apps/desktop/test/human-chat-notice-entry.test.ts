import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import type { Notification } from 'electron';
import { createHumanChatNoticeRegistry } from '../src-electron/human-chat-notice-registry.js';
import { openHumanChatNotice } from '../src/shell/renderer/features/relationship/human-chat-entry.js';
import { createHomeNavigation } from '../src/shell/renderer/app-shell/providers/home-navigation.js';

class NativeNotice extends EventEmitter {
  closed = 0;
  close() { this.closed += 1; this.emit('close', { reason: 'applicationHidden' }); }
}

test('Windows timeout retains the notice for click and account invalidation', () => {
  const registry = createHumanChatNoticeRegistry();
  const notice = new NativeNotice();
  const dismissed = new NativeNotice();
  registry.retain(notice as unknown as Notification);
  registry.retain(dismissed as unknown as Notification);
  notice.emit('close', { reason: 'timedOut' });
  dismissed.emit('close', { reason: 'userCanceled' });
  registry.clear();
  assert.equal(notice.closed, 1);
  assert.equal(dismissed.closed, 0);
  registry.clear();
  assert.equal(notice.closed, 1);
});

test('a timed-out notice still delivers its click and releases after activation', () => {
  const registry = createHumanChatNoticeRegistry();
  const notice = new NativeNotice();
  let clicked = 0;
  registry.retain(notice as unknown as Notification);
  notice.once('click', () => { clicked += 1; });
  notice.emit('close', { reason: 'timedOut' });
  notice.emit('click');
  registry.clear();
  assert.equal(clicked, 1);
  assert.equal(notice.closed, 0);
});

test('named and aggregate notice targets commit before the native focus can acknowledge old chat', async () => {
  const navigation = createHomeNavigation();
  for (const chatId of ['chat-b', null]) {
    await navigation.push({ id: 'contacts', chat: { mode: 'human', threadId: 'chat-a' } });
    let focused = 0;
    await openHumanChatNotice({ navigation, chatId, isCurrent: () => true, report: () => {}, focus: async () => {
      focused += 1;
      const opened = navigation.getSnapshot().current.destination;
      assert.equal(opened.chat?.threadId, chatId ?? undefined);
      if (chatId === null) assert.equal(opened.conversationFilter, 'human');
    } });
    assert.equal(focused, 1);
  }
});

test('a blocked editor receives feedback and remains available to finish the operation', async () => {
  const navigation = createHomeNavigation();
  await navigation.push({ id: 'settings', settingsSection: 'profile' });
  const unguard = navigation.registerLeaveGuard(() => 'busy');
  const results: string[] = [];
  let focused = 0;
  try {
    await openHumanChatNotice({ navigation, chatId: 'chat-b', isCurrent: () => true,
      report: result => { results.push(result.status); }, focus: async () => { focused += 1; } });
    assert.deepEqual(results, ['busy']);
    assert.ok(focused > 0);
    assert.equal(navigation.getSnapshot().current.destination.id, 'settings');
  } finally { unguard(); }
  await openHumanChatNotice({ navigation, chatId: 'chat-b', isCurrent: () => false,
    report: () => assert.fail('stale click'), focus: async () => assert.fail('stale focus') });
  assert.equal(navigation.getSnapshot().current.destination.id, 'settings');
});
