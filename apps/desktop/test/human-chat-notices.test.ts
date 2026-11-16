import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import type { RealmChatViewDto } from '@nimiplatform/kit/features/chat/realm';
import { createHumanChatNoticeTracker } from '../src/shell/renderer/features/realtime/human-chat-notices.js';
import { humanChatNoticeRequest, humanChatNoticeTarget, OPEN_HUMAN_CHAT_NOTICE } from '../src/shell/shared/human-chat-notice.js';

function chat(chatId: string, id: string, minute: number, options: { senderId?: string; isRead?: boolean; type?: 'TEXT' | 'RECALL' } = {}) {
  const createdAt = new Date(Date.UTC(2026, 10, 16, 2, minute)).toISOString();
  return {
    id: chatId,
    unreadCount: options.isRead ? 0 : 1,
    otherUser: { id: 'eric', displayName: 'Eric', handle: '@eric' },
    lastMessage: {
      id, chatId, senderId: options.senderId ?? 'eric', createdAt,
      isRead: options.isRead ?? false, type: options.type ?? 'TEXT',
    },
  } as RealmChatViewDto;
}

test('the first snapshot establishes a baseline and live notices identify the sender once', () => {
  const tracker = createHumanChatNoticeTracker();
  const baseline = chat('known', 'old', 4);
  assert.equal(tracker.refresh([baseline]), null);
  assert.equal(tracker.change(baseline), null);
  const newer = chat('known', 'new', 5);
  assert.deepEqual(tracker.change(newer), { kind: 'arrival', chatId: 'known', sender: 'Eric' });
  assert.equal(tracker.change(newer), null);
  assert.deepEqual(tracker.change(chat('first-seen', 'first', 3)), { kind: 'unread', chatId: 'first-seen', sender: 'Eric' });
});

test('own, read and recalled messages never become arrivals and reconnect coalesces new unread', () => {
  const tracker = createHumanChatNoticeTracker();
  tracker.refresh([chat('known', 'old', 0), chat('another', 'before', 0, { isRead: true })]);
  assert.equal(tracker.change(chat('known', 'mine', 1, { senderId: 'halliday' })), null);
  assert.equal(tracker.change(chat('known', 'already-read', 2, { isRead: true })), null);
  assert.equal(tracker.change(chat('known', 'recalled', 3, { type: 'RECALL' })), null);
  const recovered = [chat('known', 'after', 4), chat('another', 'after-2', 4)];
  assert.deepEqual(tracker.refresh(recovered), { kind: 'summary' });
  assert.equal(tracker.refresh(recovered), null);
  assert.equal(tracker.change(recovered[0]!), null);
});

test('the native notice request and click target admit neither message text nor arbitrary navigation', () => {
  const notice = { kind: 'arrival', chatId: 'chat-1', sender: 'Eric' };
  assert.equal(humanChatNoticeRequest.safeParse({ generation: 'current', notice }).success, true);
  assert.equal(humanChatNoticeRequest.safeParse({ generation: 'current', notice: { ...notice, text: 'private body' } }).success, false);
  assert.equal(humanChatNoticeTarget.safeParse({ generation: 'current', chatId: 'chat-1' }).success, true);
  assert.equal(humanChatNoticeTarget.safeParse({ generation: 'current', url: 'https://example.test' }).success, false);
});

test('the Desktop preload receives a native click for the exact human conversation', () => {
  const { installNimiElectronRuntimeBridge } = createRequire(import.meta.url)('@nimiplatform/kit/shell/electron/preload-cjs') as typeof import('@nimiplatform/kit/shell/electron/preload-cjs');
  const hooks: unknown[] = [];
  const listeners = new Map<string, (event: unknown, payload: unknown) => void>();
  const bridge = installNimiElectronRuntimeBridge({
    contextBridge: { exposeInMainWorld: (_key, hook) => { hooks.push(hook); } },
    ipcRenderer: {
      invoke: async () => assert.fail('Notification opening must arrive as an event'),
      on: (channel, listener) => { listeners.set(channel, listener); },
      removeListener: (channel) => { listeners.delete(channel); },
    },
  });
  const [hook] = hooks as [import('@nimiplatform/kit/shell/electron/preload-cjs').NimiElectronRuntimeHook];
  const target = { generation: 'current-home-account', chatId: 'chat-eric' };
  const received: unknown[] = [];
  const unsubscribe = hook.listen(OPEN_HUMAN_CHAT_NOTICE, event => received.push(humanChatNoticeTarget.parse(event.payload)));
  const channel = bridge.listenChannelPrefix + OPEN_HUMAN_CHAT_NOTICE;
  const notify = listeners.get(channel);
  assert.ok(notify);
  notify({}, target);
  assert.deepEqual(received, [target]);
  unsubscribe();
  assert.equal(listeners.has(channel), false);
});

test('reconnect uses unread growth even when the latest message is outgoing', () => {
  const tracker = createHumanChatNoticeTracker();
  tracker.refresh([chat('known', 'old', 0, { isRead: true })]);
  const recovered = chat('known', 'mine', 2, { senderId: 'halliday' });
  assert.deepEqual(tracker.refresh([recovered]), { kind: 'summary' });
  assert.equal(tracker.refresh([recovered]), null);
});
