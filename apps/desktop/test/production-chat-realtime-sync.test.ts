import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { QueryClient } from '@tanstack/react-query';
import type { NimiRealmRealtimeClient, NimiRealmRealtimeEvent, NimiRealmRealtimeSubscription } from '@nimiplatform/sdk/app';
import { connectProductionChatRealtimeSync } from '../src/shell/renderer/infra/realtime/production-chat-realtime-sync.js';
import { getOfflineCoordinator } from '../src/shell/renderer/infra/offline/coordinator.js';
import {
  clearDesktopNimiClientSession,
  configureDesktopRuntimeRealmSession,
  setDesktopNimiClientSessionForTests,
} from '../src/shell/renderer/infra/sdk/desktop-nimi-client-session.js';

const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}

const opened: Awaited<ReturnType<NimiRealmRealtimeClient['open']>> = {
  realtimeSessionId: 'session-1', channelId: 'channel-1', generation: '1',
  control: {
    realtimeSessionId: 'session-1', channelId: 'channel-1', subscriptionId: '', adapterKind: 'realm',
    lifecycle: 'ready', generation: '1', sequence: '1', correlationId: '', backpressure: 'normal',
    bufferedItems: 0, bufferCapacity: 128, terminalReason: '', actionHint: '', occurredAt: null,
  },
};
const chatEvent: NimiRealmRealtimeEvent = {
  realtimeSessionId: 'session-1', channelId: 'channel-1', subscriptionId: 'chat-sub', generation: '1',
  sequence: '1', correlationId: '', occurredAt: { seconds: '1', nanos: 0 },
  event: {
    type: 'chat', kind: 'chat-read', streamId: 'chat-stream', cursor: '1', eventId: 'event-1',
    chatId: 'chat-1', actorId: 'user-1', occurredAt: { seconds: '1', nanos: 0 },
    payload: { chatId: 'chat-1', readerId: 'user-1', readThroughMessageId: null, readAt: { seconds: '1', nanos: 0 } },
  },
};

function controlledSubscription(events: readonly NimiRealmRealtimeEvent[] = []) {
  const queued = [...events];
  let done = false, nextCalls = 0, cancellations = 0;
  let pending: ReturnType<typeof deferred<IteratorResult<NimiRealmRealtimeEvent>>> | null = null;
  const cancel = async () => {
    if (done) return;
    done = true; cancellations += 1;
    pending?.resolve({ done: true, value: undefined });
  };
  const subscription: NimiRealmRealtimeSubscription = {
    cancel,
    [Symbol.asyncIterator]: () => ({
      next: async () => {
        nextCalls += 1;
        if (done) return { done: true, value: undefined };
        const event = queued.shift();
        if (event) return { done: false, value: event };
        pending = deferred<IteratorResult<NimiRealmRealtimeEvent>>();
        return pending.promise;
      },
      return: async () => { await cancel(); return { done: true, value: undefined }; },
    }),
  };
  return { subscription, nextCalls: () => nextCalls, cancellations: () => cancellations };
}

function realtimeFixture(overrides: Partial<NimiRealmRealtimeClient> = {}) {
  const closedChannels: string[] = [], closedSubscriptions: string[] = [];
  const acknowledgements: Parameters<NimiRealmRealtimeClient['ack']>[0][] = [];
  let opens = 0;
  const ack = { ok: true, reasonCode: 'ACTION_EXECUTED', actionHint: '' };
  const client: NimiRealmRealtimeClient = {
    open: async () => { opens += 1; return opened; },
    subscribe: async () => { throw new Error('unexpected subscription'); },
    ack: async input => { acknowledgements.push(input); return ack; },
    closeSubscription: async input => { closedSubscriptions.push(input.subscriptionId); return ack; },
    closeChannel: async input => { closedChannels.push(input.channelId); return ack; },
    ...overrides,
  };
  return { client, closedChannels, closedSubscriptions, acknowledgements, opens: () => opens };
}

async function installClient(t: TestContext, realtime: NimiRealmRealtimeClient) {
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  const session = await configureDesktopRuntimeRealmSession({ appId: 'nimi.desktop', runtimeTransport: { type: 'electron-ipc' } });
  setDesktopNimiClientSessionForTests({
    ...session,
    localAppClient: { ...session.localAppClient, realm: { ...session.localAppClient.realm, realtime } },
  });
  const queryClient = new QueryClient();
  const cleanups: Array<() => void> = [];
  t.after(async () => {
    for (const cleanup of cleanups) cleanup();
    await flush();
    clearDesktopNimiClientSession();
    getOfflineCoordinator().markRealmSocketReachability('unknown');
    queryClient.clear();
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  });
  return { queryClient, document, onCleanup: (cleanup: () => void) => { cleanups.push(cleanup); } };
}

test('a channel opened after stop is closed without subscribing', async (t) => {
  const pending = deferred<typeof opened>();
  let subscriptions = 0;
  const fixture = realtimeFixture({
    open: () => pending.promise,
    subscribe: async () => { subscriptions += 1; return controlledSubscription().subscription; },
  });
  const { queryClient, onCleanup } = await installClient(t, fixture.client);
  const stop = connectProductionChatRealtimeSync({ queryClient, selectedChatId: null });
  onCleanup(stop);
  stop(); clearDesktopNimiClientSession();
  pending.resolve(opened); await flush();
  assert.equal(subscriptions, 0);
  assert.deepEqual(fixture.closedChannels, ['channel-1']);
});

test('late subscriptions after stop are cancelled before any next and cleanup uses the captured client', async (t) => {
  const presence = controlledSubscription(), inbox = controlledSubscription();
  const pendingPresence = deferred<NimiRealmRealtimeSubscription>();
  const pendingInbox = deferred<NimiRealmRealtimeSubscription>();
  const fixture = realtimeFixture({
    subscribe: input => input.target.type === 'presence' ? pendingPresence.promise : pendingInbox.promise,
  });
  const { queryClient, onCleanup } = await installClient(t, fixture.client);
  const stop = connectProductionChatRealtimeSync({ queryClient, selectedChatId: null });
  onCleanup(stop);
  await flush();
  clearDesktopNimiClientSession();
  assert.doesNotThrow(stop);
  pendingPresence.resolve(presence.subscription); pendingInbox.resolve(inbox.subscription); await flush();
  assert.equal(presence.nextCalls(), 0); assert.equal(inbox.nextCalls(), 0);
  assert.equal(presence.cancellations(), 1); assert.equal(inbox.cancellations(), 1);
  assert.deepEqual(fixture.closedChannels, ['channel-1']);
});

test('stop during chat invalidation prevents a late acknowledgement or future pull', async (t) => {
  const pendingInvalidation = deferred<void>();
  const presence = controlledSubscription(), inbox = controlledSubscription(), chat = controlledSubscription([chatEvent]);
  const fixture = realtimeFixture({ subscribe: async input => input.target.type === 'chat' ? chat.subscription
    : input.target.type === 'presence' ? presence.subscription : inbox.subscription });
  const { queryClient, onCleanup } = await installClient(t, fixture.client);
  t.mock.method(queryClient, 'invalidateQueries', async (filters?: { queryKey?: readonly unknown[] }) => {
    if (filters?.queryKey?.[0] === 'messages') await pendingInvalidation.promise;
  });
  const stop = connectProductionChatRealtimeSync({ queryClient, selectedChatId: 'chat-1' });
  onCleanup(stop);
  await flush();
  assert.equal(chat.nextCalls(), 1);
  stop(); pendingInvalidation.resolve(); await flush();
  assert.deepEqual(fixture.acknowledgements, []);
  assert.equal(chat.nextCalls(), 1);
  assert.equal(chat.cancellations(), 1);
  assert.deepEqual(fixture.closedSubscriptions, ['chat-sub']);
  assert.deepEqual(fixture.closedChannels, ['channel-1']);
});

test('one failed consumer closes its channel and peers including a late subscription without reopening', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const presence = controlledSubscription(), chat = controlledSubscription();
  const failedInbox = deferred<NimiRealmRealtimeSubscription>(), lateChat = deferred<NimiRealmRealtimeSubscription>();
  const fixture = realtimeFixture({ subscribe: async input => input.target.type === 'presence' ? presence.subscription
    : input.target.type === 'inbox' ? failedInbox.promise : lateChat.promise });
  const { queryClient, document, onCleanup } = await installClient(t, fixture.client);
  const stop = connectProductionChatRealtimeSync({ queryClient, selectedChatId: 'chat-1' });
  onCleanup(stop);
  await flush(); assert.equal(presence.nextCalls(), 1);
  failedInbox.reject(new Error('REALM_UNAVAILABLE')); await flush();
  assert.equal(presence.cancellations(), 1);
  assert.deepEqual(fixture.closedChannels, ['channel-1']);
  lateChat.resolve(chat.subscription); await flush();
  assert.equal(chat.cancellations(), 1); assert.equal(chat.nextCalls(), 0);
  t.mock.timers.tick(15_000); document.dispatchEvent(new Event('visibilitychange')); await flush();
  assert.equal(fixture.opens(), 1, 'Desktop does not become a second reconnect owner');
  assert.equal(getOfflineCoordinator().getStatus().realm.socket, 'unreachable');
});

test('an active chat still invalidates and acknowledges before consuming its next event', async (t) => {
  const presence = controlledSubscription(), inbox = controlledSubscription(), chat = controlledSubscription([chatEvent]);
  const fixture = realtimeFixture({ subscribe: async input => input.target.type === 'chat' ? chat.subscription
    : input.target.type === 'presence' ? presence.subscription : inbox.subscription });
  const { queryClient, onCleanup } = await installClient(t, fixture.client);
  const keys: unknown[][] = [];
  t.mock.method(queryClient, 'invalidateQueries', async (filters?: { queryKey?: readonly unknown[] }) => {
    if (filters?.queryKey) keys.push([...filters.queryKey]);
  });
  const stop = connectProductionChatRealtimeSync({ queryClient, selectedChatId: 'chat-1' });
  onCleanup(stop);
  await flush();
  assert.ok(keys.some(key => key[0] === 'chats'));
  assert.ok(keys.some(key => key[0] === 'messages' && key[1] === 'chat-1'));
  assert.deepEqual(fixture.acknowledgements, [{ channelId: 'channel-1', subscriptionId: 'chat-sub', cursor: '1' }]);
  assert.equal(chat.nextCalls(), 2);
  assert.deepEqual(fixture.closedChannels, []);
});
