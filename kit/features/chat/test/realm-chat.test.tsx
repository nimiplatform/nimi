import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ChatComposerResizeHandle,
  ChatComposerShell,
  ChatPanelState,
  ChatStreamStatus,
  ChatThreadHeader,
  RealmChatTimeline,
} from '../src/ui.js';
import {
  advanceRealmChatSessionAck,
  applyRealmRealtimeMessageToChatsResult,
  applyRealmRealtimeMessageUpdateToChatsResult,
  applyRealmRealtimeMessageUpdateToMessagesResult,
  buildRealmStartChatInput,
  buildRealmTextMessageInput,
  createRealmChatResourceAttachmentPayload,
  createRealmChatSessionOpenPayload,
  createRealmChatSessionState,
  createRealmChatComposerAdapter,
  extractRealmChatAttachmentTargetId,
  filterRealmDirectHumanChats,
  getRealmChatTimelineDisplayModel,
  getRealmHumanChatTitle,
  getRealmHumanTargetId,
  isRealmDirectHumanChat,
  listRealmChatMessages,
  mergeRealmRealtimeMessageIntoMessagesResult,
  normalizeRealmChatLimit,
  normalizeRealmRealtimeMessagePayload,
  resolveCanonicalRealmHumanChatId,
  resolveRealmChatAttachmentPreviewText,
  resolveRealmChatMediaUrl,
  resolveRealmChatSyncRequest,
  rememberRealmChatSeenEvent,
  countPendingRealmChatOutboxEntries,
  flushRealmChatOutbox,
  sendRealmChatMessage,
  sendRealmChatTextMessageWithOutbox,
  startRealmChatWithTarget,
  syncRealmChatEvents,
  collapseRealmHumanChatsToTargets,
  toRealmHumanConversationThreadSummary,
  toRealmChatOutboxPlaceholderMessage,
  toRealmHumanTargetSummary,
  useRealmMessageTimeline,
  useRealmChatRealtimeController,
  useRealmChatComposer,
  type RealmChatOutboxStore,
  type RealmChatOutboxStoreEntry,
  type RealmChatSendService,
  type RealmChatSyncResultDto,
  type RealmChatService,
  type RealmChatViewDto,
  type RealmChatRealtimeSocket,
  type RealmMessageViewDto,
  type UseRealmChatRealtimeControllerOptions,
} from '../src/realm.js';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

function flush() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function dispatchTextareaValue(element: HTMLTextAreaElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
  descriptor?.set?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount();
      await flush();
    });
  }
  container?.remove();
  root = null;
  container = null;
});

function ComposerHarness({
  chatId,
  service,
}: {
  chatId: string;
  service: RealmChatService;
}) {
  const composer = useRealmChatComposer({
    chatId,
    service,
  });

  return (
    <div>
      <textarea
        ref={composer.textareaRef}
        value={composer.text}
        onInput={(event) => composer.handleTextChange(event as never)}
        onKeyDown={(event) => composer.handleKeyDown(event)}
      />
      <button type="button" onClick={() => {
        void composer.handleSubmit();
      }}>
        send
      </button>
      <div data-testid="error">{composer.error || ''}</div>
    </div>
  );
}

class FakeRealmChatSocket implements RealmChatRealtimeSocket {
  connected = false;
  emitted: Array<{ event: string; payload: unknown }> = [];
  private handlers = new Map<string, Set<(payload: unknown) => void>>();

  emit(event: string, payload: unknown) {
    this.emitted.push({ event, payload });
  }

  on(event: string, handler: (payload: unknown) => void) {
    const bucket = this.handlers.get(event) ?? new Set();
    bucket.add(handler);
    this.handlers.set(event, bucket);
  }

  off(event: string, handler: (payload: unknown) => void) {
    this.handlers.get(event)?.delete(handler);
  }

  disconnect() {
    this.connected = false;
  }

  trigger(event: string, payload: unknown = undefined) {
    if (event === 'connect') {
      this.connected = true;
    }
    if (event === 'disconnect') {
      this.connected = false;
    }
    for (const handler of this.handlers.get(event) ?? []) {
      handler(payload);
    }
  }
}

function RealtimeHarness({
  socket,
  onApplyChatEvent,
  onSyncChatEvents,
  authToken = 'token-1',
  resolveAuthToken,
  onCreateSocket,
}: {
  socket: FakeRealmChatSocket;
  onApplyChatEvent: NonNullable<UseRealmChatRealtimeControllerOptions['applyChatEvent']>;
  onSyncChatEvents: UseRealmChatRealtimeControllerOptions['syncChatEvents'];
  authToken?: string | null;
  resolveAuthToken?: UseRealmChatRealtimeControllerOptions['resolveAuthToken'];
  onCreateSocket?: (input: { baseUrl: string; token: string; socketPath?: string }) => void;
}) {
  useRealmChatRealtimeController({
    authStatus: 'authenticated',
    authToken,
    resolveAuthToken,
    realtimeBaseUrl: 'https://realm.example.com',
    selectedChatId: 'chat-1',
    currentUserId: 'user-1',
    createSocket: (input) => {
      onCreateSocket?.(input);
      return socket;
    },
    onSocketReachableChange: () => {},
    flushChatOutbox: async () => {},
    flushSocialOutbox: async () => {},
    invalidateChats: async () => {},
    invalidateMessages: async () => {},
    invalidateNotifications: async () => {},
    syncChatEvents: onSyncChatEvents,
    loadMessages: async () => undefined,
    applyChatEvent: onApplyChatEvent,
    applySyncSnapshot: () => {},
  });

  return <div data-testid="realtime-harness">ready</div>;
}

function TimelineHarness(input: {
  messagesData: Parameters<typeof useRealmMessageTimeline>[0]['messagesData'];
  currentUserId: string;
  uploadPlaceholders?: Parameters<typeof useRealmMessageTimeline>[0]['uploadPlaceholders'];
}) {
  const messages = useRealmMessageTimeline({
    messagesData: input.messagesData,
    currentUserId: input.currentUserId,
    uploadPlaceholders: input.uploadPlaceholders,
  });
  return <div data-testid="timeline-count">{messages.length}</div>;
}

function createMemoryRealmChatOutbox(
  initialEntries: readonly RealmChatOutboxStoreEntry[] = [],
): RealmChatOutboxStore & { entries: Map<string, RealmChatOutboxStoreEntry> } {
  const entries = new Map<string, RealmChatOutboxStoreEntry>();
  for (const entry of initialEntries) {
    entries.set(entry.clientMessageId, entry);
  }
  return {
    entries,
    async upsertChatOutboxEntry(entry) {
      entries.set(entry.clientMessageId, entry);
    },
    async getChatOutboxEntry(clientMessageId) {
      return entries.get(clientMessageId);
    },
    async getChatOutboxEntries(chatId) {
      const values = Array.from(entries.values());
      return (chatId ? values.filter((entry) => entry.chatId === chatId) : values)
        .sort((left, right) => left.enqueuedAt - right.enqueuedAt);
    },
    async markChatOutboxSent(clientMessageId) {
      entries.delete(clientMessageId);
    },
    async markChatOutboxFailed(clientMessageId, reason) {
      const entry = entries.get(clientMessageId);
      if (entry) {
        entries.set(clientMessageId, { ...entry, status: 'failed', failReason: reason });
      }
    },
  };
}

describe('chat realm helpers', () => {
  it('builds a default TEXT payload for realm chat messages', () => {
    expect(buildRealmTextMessageInput('  hello realm  ')).toMatchObject({
      type: 'TEXT',
      text: 'hello realm',
      payload: { content: 'hello realm' },
    });
  });

  it('owns direct human chat filtering and canonical target projection', () => {
    const chats = [
      {
        id: 'chat-older',
        createdAt: '2026-04-01T00:00:00.000Z',
        updatedAt: '2026-04-01T00:00:00.000Z',
        lastMessageAt: '2026-04-01T00:00:00.000Z',
        unreadCount: 0,
        otherUser: {
          id: 'user-1',
          displayName: '',
          handle: '~alice',
          avatarUrl: '/alice.png',
        },
        lastMessage: {
          id: 'msg-older',
          chatId: 'chat-older',
          senderId: 'user-1',
          type: 'TEXT',
          text: 'older',
          createdAt: '2026-04-01T00:00:00.000Z',
          isRead: true,
          payload: { content: 'older' },
        },
      },
      {
        id: 'chat-newer',
        createdAt: '2026-04-02T00:00:00.000Z',
        updatedAt: '2026-04-02T00:00:00.000Z',
        lastMessageAt: '2026-04-02T00:00:00.000Z',
        unreadCount: 2,
        otherUser: {
          id: 'user-1',
          displayName: 'Alice',
          handle: 'alice',
          avatarUrl: '/alice.png',
        },
        lastMessage: {
          id: 'msg-newer',
          chatId: 'chat-newer',
          senderId: 'user-1',
          type: 'TEXT',
          text: '',
          createdAt: '2026-04-02T00:00:00.000Z',
          isRead: false,
          payload: { content: 'newer' },
        },
      },
      {
        id: 'chat-source',
        createdAt: '2026-04-03T00:00:00.000Z',
        updatedAt: '2026-04-03T00:00:00.000Z',
        lastMessageAt: '2026-04-03T00:00:00.000Z',
        unreadCount: 9,
        sourceRef: 'realm-persona:persona-1',
        runtimeSourceRef: 'runtime-source-1',
        otherUser: {
          id: 'persona-1',
          displayName: 'Persona',
          handle: 'persona',
        },
        lastMessage: null,
      },
      {
        id: 'chat-missing-id',
        otherUser: {
          displayName: 'Bob',
        },
      },
      {
        id: 'chat-malformed',
        otherUser: 'user-3',
      },
    ] as unknown as readonly RealmChatViewDto[];
    const aliceNewer = chats[1] as RealmChatViewDto;

    expect(isRealmDirectHumanChat(chats[0])).toBe(true);
    expect(isRealmDirectHumanChat(chats[2])).toBe(false);
    expect(isRealmDirectHumanChat(chats[3])).toBe(false);
    expect(isRealmDirectHumanChat(chats[4])).toBe(false);
    expect(filterRealmDirectHumanChats(chats).map((chat) => chat.id)).toEqual(['chat-older', 'chat-newer']);

    const collapsed = collapseRealmHumanChatsToTargets(filterRealmDirectHumanChats(chats));
    expect(collapsed.map((chat) => chat.id)).toEqual(['chat-newer']);
    expect(resolveCanonicalRealmHumanChatId(filterRealmDirectHumanChats(chats), 'user-1')).toBe('chat-newer');
    expect(getRealmHumanTargetId(aliceNewer)).toBe('user-1');
    expect(getRealmHumanChatTitle(aliceNewer)).toBe('Alice');

    expect(toRealmHumanTargetSummary(aliceNewer, {
      noMessagesFallback: 'No messages',
      unknownTitle: 'Unknown',
    })).toMatchObject({
      id: 'user-1',
      source: 'human',
      canonicalSessionId: 'chat-newer',
      title: 'Alice',
      handle: '@alice',
      previewText: 'newer',
      unreadCount: 2,
      metadata: {
        otherUserId: 'user-1',
      },
    });

    expect(toRealmHumanConversationThreadSummary(aliceNewer, {
      formatUpdatedAt: ({ timestamp }) => `formatted:${timestamp}`,
    })).toMatchObject({
      id: 'chat-newer',
      mode: 'human',
      title: 'Alice',
      updatedAt: 'formatted:2026-04-02T00:00:00.000Z',
      targetId: 'user-1',
    });
  });

  it('submits through the realm chat composer adapter', async () => {
    const sendMessage = vi.fn(async () => ({
      id: 'msg-1',
      chatId: 'chat-1',
      text: 'hello realm',
      type: 'TEXT',
    }));
    const onResponse = vi.fn(async () => {});
    const adapter = createRealmChatComposerAdapter({
      chatId: 'chat-1',
      service: {
        listChats: async () => ({ items: [] }),
        getChatById: async () => ({ id: 'chat-1' }),
        startChat: async () => ({ chatId: 'chat-1' }),
        listMessages: async () => ({ items: [] }),
        sendMessage,
        markChatRead: async () => {},
        syncChatEvents: async () => ({ items: [], snapshot: null }),
      } as unknown as RealmChatService,
      onResponse,
    });

    await adapter.submit({
      text: 'hello realm',
      attachments: [],
    });

    expect(sendMessage).toHaveBeenCalledWith('chat-1', expect.objectContaining({
      type: 'TEXT',
      text: 'hello realm',
      payload: { content: 'hello realm' },
    }));
    expect(onResponse).toHaveBeenCalledTimes(1);
  });

  it('binds realm chat service into useChatComposer', async () => {
    const sendMessage = vi.fn(async () => ({
      id: 'msg-1',
      chatId: 'chat-1',
      text: 'hello from hook',
      type: 'TEXT',
    }));

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <ComposerHarness
          chatId="chat-1"
          service={{
            listChats: async () => ({ items: [] }),
            getChatById: async () => ({ id: 'chat-1' }),
            startChat: async () => ({ chatId: 'chat-1' }),
            listMessages: async () => ({ items: [] }),
            sendMessage,
            markChatRead: async () => {},
            syncChatEvents: async () => ({ items: [], snapshot: null }),
          } as unknown as RealmChatService}
        />,
      );
      await flush();
    });

    const textarea = container.querySelector('textarea');
    expect(textarea).toBeTruthy();
    dispatchTextareaValue(textarea as HTMLTextAreaElement, 'hello from hook');

    await act(async () => {
      textarea?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await flush();
    });

    expect(sendMessage).toHaveBeenCalledWith('chat-1', expect.objectContaining({
      text: 'hello from hook',
    }));
  });

  it('routes convenience helpers through the realm chat service', async () => {
    const sendMessage = vi.fn(async () => ({
      id: 'msg-1',
      chatId: 'chat-1',
      text: 'hello helper',
      type: 'TEXT',
    }));
    const startChat = vi.fn(async () => ({ chatId: 'chat-started' }));
    const getChatById = vi.fn(async (chatId: string) => ({ id: chatId }));
    const listMessages = vi.fn(async () => ({ items: [] }));
    const syncChatEventsSpy = vi.fn(async () => ({
      items: [],
      snapshot: null,
    }));
    const service = {
      listChats: async () => ({ items: [] }),
      getChatById,
      startChat,
      listMessages,
      sendMessage,
      markChatRead: async () => {},
      syncChatEvents: syncChatEventsSpy,
    } as unknown as RealmChatService;

    await sendRealmChatMessage('chat-1', 'hello helper', service);
    await startRealmChatWithTarget(' user-2 ', ' hello start ', service);
    await listRealmChatMessages(' chat-1 ', 250, 'cursor-1', service);
    await listRealmChatMessages('chat-1', 0, 'cursor-2', service);
    await syncRealmChatEvents('chat-1', 12, 300, service);
    await syncRealmChatEvents('chat-1', -1, 999, service);

    expect(sendMessage).toHaveBeenCalledWith('chat-1', expect.objectContaining({
      text: 'hello helper',
    }));
    expect(buildRealmStartChatInput(' user-2 ', ' hello start ')).toEqual({
      targetAccountId: 'user-2',
      type: 'TEXT',
      text: 'hello start',
      payload: { content: 'hello start' },
    });
    expect(startChat).toHaveBeenCalledWith(expect.objectContaining({
      targetAccountId: 'user-2',
      type: 'TEXT',
      text: 'hello start',
      payload: { content: 'hello start' },
    }));
    expect(getChatById).toHaveBeenCalledWith('chat-started');
    expect(normalizeRealmChatLimit(0, 20, 100)).toBe(20);
    expect(normalizeRealmChatLimit(250, 20, 100)).toBe(100);
    expect(listMessages).toHaveBeenCalledWith('chat-1', 100, 'cursor-1');
    expect(listMessages).toHaveBeenCalledWith('chat-1', 50, 'cursor-2');
    expect(syncChatEventsSpy).toHaveBeenCalledWith('chat-1', 12, 300);
    expect(syncChatEventsSpy).toHaveBeenCalledWith('chat-1', 0, 500);
  });

  it('queues realm chat sends before transport and returns an offline placeholder', async () => {
    const offlineError = new Error('realm offline');
    const outbox = createMemoryRealmChatOutbox();
    const onOffline = vi.fn();
    const service: RealmChatSendService = {
      sendMessage: vi.fn(async () => {
        throw offlineError;
      }),
    };

    const result = await sendRealmChatTextMessageWithOutbox({
      chatId: 'chat-1',
      content: 'hello offline',
      service,
      outbox,
      createClientMessageId: () => 'cm-1',
      now: () => 10,
      isOfflineError: (error) => error === offlineError,
      onOffline,
    });

    expect(onOffline).toHaveBeenCalledWith(offlineError, expect.objectContaining({
      clientMessageId: 'cm-1',
      attempts: 1,
    }));
    expect(result).toMatchObject({
      kind: 'queued',
      clientMessageId: 'cm-1',
      entry: {
        attempts: 1,
        status: 'pending',
      },
    });
    expect(result.kind === 'queued' ? result.placeholder : null).toMatchObject({
      id: 'offline:cm-1',
      chatId: 'chat-1',
      clientMessageId: 'cm-1',
      text: 'hello offline',
      payload: { content: 'hello offline' },
    });
    expect(await countPendingRealmChatOutboxEntries(outbox)).toBe(1);
    expect(outbox.entries.get('cm-1')).toMatchObject({
      attempts: 1,
      status: 'pending',
      body: {
        clientMessageId: 'cm-1',
        text: 'hello offline',
        payload: { content: 'hello offline' },
      },
    });
  });

  it('flushes pending realm chat outbox entries in FIFO order', async () => {
    const outbox = createMemoryRealmChatOutbox([
      {
        clientMessageId: 'later',
        chatId: 'chat-1',
        body: { clientMessageId: 'later', text: 'later', type: 'TEXT', payload: { content: 'later' } },
        enqueuedAt: 20,
        attempts: 0,
        status: 'pending',
      },
      {
        clientMessageId: 'earlier',
        chatId: 'chat-1',
        body: { clientMessageId: 'earlier', text: 'earlier', type: 'TEXT', payload: { content: 'earlier' } },
        enqueuedAt: 10,
        attempts: 0,
        status: 'pending',
      },
    ]);
    const replayed: string[] = [];
    const service: RealmChatSendService = {
      sendMessage: vi.fn(async (chatId, body) => {
        replayed.push(String(body.clientMessageId || ''));
        return {
          id: `server:${String(body.clientMessageId || '')}`,
          chatId,
          clientMessageId: body.clientMessageId,
          senderId: 'user-1',
          createdAt: '2026-03-24T10:00:00.000Z',
          isRead: true,
          text: body.text,
          type: 'TEXT' as const,
          payload: body.payload,
        };
      }),
    };

    const flushed = await flushRealmChatOutbox({ chatId: 'chat-1', service, outbox });

    expect(replayed).toEqual(['earlier', 'later']);
    expect(flushed.map((message) => message.id)).toEqual(['server:earlier', 'server:later']);
    expect(await countPendingRealmChatOutboxEntries(outbox)).toBe(0);
  });

  it('projects outbox entries into stable Realm message placeholders', () => {
    const entry: RealmChatOutboxStoreEntry = {
      clientMessageId: 'cm-2',
      chatId: 'chat-1',
      body: { clientMessageId: 'cm-2', type: 'TEXT', text: 'queued', payload: { content: 'queued' } },
      enqueuedAt: Date.parse('2026-03-24T10:00:00.000Z'),
      attempts: 1,
      status: 'pending',
    };
    expect(toRealmChatOutboxPlaceholderMessage(entry)).toMatchObject({
      id: 'offline:cm-2',
      senderId: 'local-user',
      text: 'queued',
      payload: { content: 'queued' },
      type: 'TEXT',
    });
  });

  it('normalizes realtime payload and deduplicates seen events', () => {
    const message = normalizeRealmRealtimeMessagePayload({
      id: 'msg-1',
      roomId: 'chat-1',
      senderId: 'user-2',
      type: 'TEXT',
      text: 'hello realtime',
      payload: { content: 'hello realtime' },
      createdAt: '2026-03-24T10:00:00.000Z',
    });
    expect(message).toMatchObject({
      id: 'msg-1',
      chatId: 'chat-1',
      senderId: 'user-2',
      text: 'hello realtime',
    });

    const seen = new Map<string, number>();
    expect(rememberRealmChatSeenEvent(seen, 'chat:event:1')).toBe(false);
    expect(rememberRealmChatSeenEvent(seen, 'chat:event:1')).toBe(true);
  });

  it('rejects unknown realtime message types and accepts canonical message types', () => {
    expect(normalizeRealmRealtimeMessagePayload({
      id: 'msg-unsupported',
      chatId: 'chat-1',
      senderId: 'user-1',
      type: 'UNSUPPORTED',
      createdAt: '2026-03-21T00:00:00.000Z',
      isRead: false,
      payload: null,
    })).toBeNull();

    expect(normalizeRealmRealtimeMessagePayload({
      id: 'msg-text',
      chatId: 'chat-1',
      senderId: 'user-1',
      type: 'TEXT',
      createdAt: '2026-03-21T00:00:00.000Z',
      isRead: false,
      payload: null,
    })?.type).toBe('TEXT');
  });

  it('merges realtime messages into chat list state', () => {
    const result = applyRealmRealtimeMessageToChatsResult({
      current: {
        items: [
          {
            id: 'chat-1',
            createdAt: '2026-03-24T08:00:00.000Z',
            updatedAt: '2026-03-24T09:00:00.000Z',
            unreadCount: 0,
            lastMessageAt: '2026-03-24T09:00:00.000Z',
            otherUser: {
              id: 'user-2',
              createdAt: '2026-03-24T08:00:00.000Z',
              displayName: 'Alex',
              handle: 'alex',
            },
            lastMessage: {
              id: 'old-msg',
              chatId: 'chat-1',
              senderId: 'user-1',
              type: 'TEXT',
              text: 'older',
              createdAt: '2026-03-24T09:00:00.000Z',
              isRead: true,
              payload: { content: 'older' },
            },
          },
        ],
        nextCursor: '',
      },
      message: {
        id: 'msg-2',
        chatId: 'chat-1',
        senderId: 'user-2',
        type: 'TEXT',
        text: 'newer',
        createdAt: '2026-03-24T10:00:00.000Z',
        isRead: false,
        payload: { content: 'newer' },
      },
      currentUserId: 'user-1',
      selectedChatId: null,
    });

    expect(result.found).toBe(true);
    expect(result.shouldMarkRead).toBe(false);
    expect(result.data?.items?.[0]).toMatchObject({
      id: 'chat-1',
      unreadCount: 1,
      lastMessageAt: '2026-03-24T10:00:00.000Z',
    });
  });

  it('derives open/ack/sync payloads for realm chat sessions', () => {
    const session = createRealmChatSessionState({
      chatId: 'chat-1',
      sessionId: 'session-1',
      resumeToken: 'resume-1',
      lastAckSeq: 4,
    });

    expect(createRealmChatSessionOpenPayload('chat-1', session)).toEqual({
      chatId: 'chat-1',
      resumeToken: 'resume-1',
      lastAckSeq: 4,
    });

    const ack = advanceRealmChatSessionAck(session, {
      actorId: 'user-2',
      chatId: 'chat-1',
      eventId: 'event-5',
      kind: 'message.created',
      occurredAt: '2026-03-24T10:01:00.000Z',
      payload: {},
      seq: 5,
      sessionId: 'session-1',
    });
    expect(ack).toEqual({
      nextSession: {
        chatId: 'chat-1',
        sessionId: 'session-1',
        resumeToken: 'resume-1',
        lastAckSeq: 5,
      },
      ackPayload: {
        chatId: 'chat-1',
        sessionId: 'session-1',
        ackSeq: 5,
      },
    });

    expect(resolveRealmChatSyncRequest({
      payload: {
        chatId: 'chat-1',
        requestedAfterSeq: 0,
      },
      selectedChatId: 'chat-1',
      session,
    })).toEqual({
      chatId: 'chat-1',
      requestedAfterSeq: 4,
    });
  });

  it('runs the realm realtime controller over an injected socket', async () => {
    const socket = new FakeRealmChatSocket();
    const applyChatEvent = vi.fn();
    const syncChatEvents: UseRealmChatRealtimeControllerOptions['syncChatEvents'] = vi.fn(
      async (_chatId: string, _afterSeq: number, _limit: number): Promise<RealmChatSyncResultDto> => ({
        events: [],
        highWatermarkSeq: 4,
        mode: 'delta',
      }),
    );

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <RealtimeHarness
          socket={socket}
          onApplyChatEvent={applyChatEvent}
          onSyncChatEvents={syncChatEvents}
        />,
      );
      await flush();
    });

    await act(async () => {
      socket.trigger('connect');
      await flush();
    });

    expect(socket.emitted).toContainEqual({
      event: 'chat:session.open',
      payload: {
        chatId: 'chat-1',
        resumeToken: undefined,
        lastAckSeq: 0,
      },
    });

    await act(async () => {
      socket.trigger('chat:session.ready', {
        chatId: 'chat-1',
        sessionId: 'session-1',
        resumeToken: 'resume-1',
        lastAckSeq: 3,
      });
      socket.trigger('chat:event', {
        actorId: 'user-2',
        chatId: 'chat-1',
        eventId: 'event-4',
        kind: 'message.created',
        occurredAt: '2026-03-24T10:00:00.000Z',
        payload: {
          message: {
            id: 'msg-4',
            chatId: 'chat-1',
            senderId: 'user-2',
            type: 'TEXT',
            text: 'hello',
            createdAt: '2026-03-24T10:00:00.000Z',
            isRead: false,
            payload: { content: 'hello' },
          },
        },
        seq: 4,
        sessionId: 'session-1',
      });
      socket.trigger('chat:session.sync_required', {
        chatId: 'chat-1',
        requestedAfterSeq: 0,
      });
      await flush();
    });

    expect(applyChatEvent).toHaveBeenCalledWith({
      event: expect.objectContaining({
        eventId: 'event-4',
        chatId: 'chat-1',
        seq: 4,
      }),
      selectedChatId: 'chat-1',
      currentUserId: 'user-1',
    });
    expect(socket.emitted).toContainEqual({
      event: 'chat:event.ack',
      payload: {
        chatId: 'chat-1',
        sessionId: 'session-1',
        ackSeq: 4,
      },
    });
    expect(syncChatEvents).toHaveBeenCalledWith('chat-1', 4, 200);
  });

  it('resolves realm realtime auth token just before socket creation', async () => {
    const socket = new FakeRealmChatSocket();
    const createdTokens: string[] = [];
    const resolveAuthToken = vi.fn(async () => 'resolved-token-1');

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <RealtimeHarness
          socket={socket}
          authToken={null}
          resolveAuthToken={resolveAuthToken}
          onCreateSocket={({ token }) => createdTokens.push(token)}
          onApplyChatEvent={() => {}}
          onSyncChatEvents={async () => ({
            events: [],
            highWatermarkSeq: 0,
            mode: 'delta',
          })}
        />,
      );
      await flush();
    });

    expect(resolveAuthToken).toHaveBeenCalledTimes(1);
    expect(createdTokens).toEqual(['resolved-token-1']);
  });

  it('merges remote, offline, and upload placeholder messages for timeline state', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <TimelineHarness
          currentUserId="user-1"
          messagesData={{
            items: [
              {
                id: 'msg-1',
                chatId: 'chat-1',
                senderId: 'user-2',
                type: 'TEXT',
                text: 'hello',
                createdAt: '2026-03-24T09:00:00.000Z',
                isRead: false,
                payload: { content: 'hello' },
              },
            ],
            offlineOutbox: [
              {
                clientMessageId: 'client-2',
                chatId: 'chat-1',
                enqueuedAt: Date.parse('2026-03-24T09:01:00.000Z'),
                status: 'pending',
                body: {
                  type: 'TEXT',
                  text: 'queued',
                  payload: { content: 'queued' },
                },
              },
            ],
          }}
          uploadPlaceholders={[
            {
              id: 'upload-1',
              chatId: 'chat-1',
              previewUrl: '/preview.png',
              kind: 'image',
              senderId: 'user-1',
              createdAt: '2026-03-24T09:02:00.000Z',
            },
          ]}
        />,
      );
      await flush();
    });

    expect(container.querySelector('[data-testid="timeline-count"]')?.textContent).toBe('3');
  });

  it('derives a stable display model for gift and uploading media timeline messages', () => {
    expect(getRealmChatTimelineDisplayModel({
      id: 'gift-1',
      chatId: 'chat-1',
      senderId: 'user-2',
      type: 'GIFT',
      text: null,
      payload: { interactionId: 'gift-1', amount: 5 },
      createdAt: '2026-03-24T09:00:00.000Z',
      isRead: true,
      deliveryState: 'sent',
      deliveryError: null,
      localPreviewUrl: null,
      localUploadState: null,
    }, 'user-1')).toMatchObject({
      isMe: false,
      kind: 'gift',
      isGiftMessage: true,
      isMediaMessage: false,
      showDeliveryState: false,
      resolvedText: '',
    });

    expect(getRealmChatTimelineDisplayModel({
      id: 'upload-1',
      chatId: 'chat-1',
      senderId: 'user-1',
      type: 'ATTACHMENT',
      text: null,
      payload: {
        attachment: {
          targetType: 'RESOURCE',
          targetId: 'resource-preview-upload-1',
          displayKind: 'IMAGE',
          url: '/preview.png',
        },
      },
      createdAt: '2026-03-24T09:01:00.000Z',
      isRead: true,
      deliveryState: 'pending',
      deliveryError: null,
      localPreviewUrl: '/preview.png',
      localUploadState: 'uploading',
    }, 'user-1')).toMatchObject({
      isMe: true,
      kind: 'image',
      isImageMessage: true,
      isMediaMessage: true,
      localPreviewUrl: '/preview.png',
      isUploadingMedia: true,
      showDeliveryState: true,
      deliveryState: 'pending',
    });

    expect(getRealmChatTimelineDisplayModel({
      id: 'attachment-1',
      chatId: 'chat-1',
      senderId: 'user-2',
      type: 'ATTACHMENT',
      text: null,
      payload: {
        attachment: {
          targetType: 'ASSET',
          targetId: 'asset-1',
          displayKind: 'CARD',
          title: 'Original Song',
          preview: {
            targetType: 'RESOURCE',
            targetId: 'resource-preview-1',
            displayKind: 'IMAGE',
            url: '/resources/resource-preview-1',
          },
        },
      },
      createdAt: '2026-03-24T09:02:00.000Z',
      isRead: true,
      deliveryState: 'sent',
      deliveryError: null,
      localPreviewUrl: null,
      localUploadState: null,
    }, 'user-1')).toMatchObject({
      isMe: false,
      kind: 'image',
      isImageMessage: true,
      isMediaMessage: true,
      resolvedText: 'Original Song',
    });

    expect(
      resolveRealmChatMediaUrl({
        attachment: {
          displayKind: 'CARD',
          preview: {
            displayKind: 'IMAGE',
            url: '/resources/resource-preview-1',
          },
        },
      }, 'https://realm.example'),
    ).toBe('https://realm.example/resources/resource-preview-1');
    expect(
      resolveRealmChatMediaUrl({
        attachment: {
          displayKind: 'CARD',
          preview: {
            url: '/resources/resource-preview-without-kind',
          },
        },
      }, 'https://realm.example'),
    ).toBe('https://realm.example/resources/resource-preview-without-kind');

    expect(
      resolveRealmChatMediaUrl({
        attachment: {
          displayKind: 'IMAGE',
          url: '/resources/resource-2',
        },
      }, ''),
    ).toBe('');
    expect(
      resolveRealmChatMediaUrl({
        attachment: {
          displayKind: 'IMAGE',
          url: 'https://cdn.example/resource-2',
        },
      }, ''),
    ).toBe('https://cdn.example/resource-2');
  });

  it('shares Realm chat attachment resource payload and preview helpers', () => {
    expect(extractRealmChatAttachmentTargetId({ resourceId: ' resource-1 ' })).toBe('resource-1');
    expect(() => extractRealmChatAttachmentTargetId({ storageRef: 'legacy-ref' } as never)).toThrow('chat-attachment-target-id-required');
    expect(createRealmChatResourceAttachmentPayload(' resource-1 ')).toEqual({
      attachment: {
        targetType: 'RESOURCE',
        targetId: 'resource-1',
      },
    });
    expect(resolveRealmChatAttachmentPreviewText({
      attachment: {
        title: 'Original Song',
        displayKind: 'CARD',
      },
    })).toBe('Original Song');
    expect(resolveRealmChatAttachmentPreviewText({
      attachment: {
        displayKind: 'CARD',
        preview: {
          displayKind: 'IMAGE',
        },
      },
    })).toBe('Image');
    expect(resolveRealmChatAttachmentPreviewText({ imageId: 'legacy-image' })).toBe('');
  });

  it('resolves canonical attachment urls and nested previews without legacy ids', () => {
    expect(resolveRealmChatMediaUrl({
      attachment: { url: 'https://cdn.example.com/media.mp4' },
      imageId: 'legacy-image',
    }, '')).toBe('https://cdn.example.com/media.mp4');
    expect(resolveRealmChatMediaUrl({
      attachment: { url: '/resources/resource-1' },
    }, 'https://realm.example.com/')).toBe('https://realm.example.com/resources/resource-1');
    expect(resolveRealmChatMediaUrl({
      attachment: {
        displayKind: 'CARD',
        preview: { url: '/resources/resource-preview-1' },
      },
    }, 'https://realm.example.com/')).toBe('https://realm.example.com/resources/resource-preview-1');
    expect(resolveRealmChatMediaUrl({ imageId: 'legacy-image' }, 'https://realm.example.com')).toBe('');
    expect(resolveRealmChatMediaUrl({ videoId: 'legacy-video' }, 'https://realm.example.com')).toBe('');
  });

  it('keeps newer realtime message evidence during conflict handling', () => {
    const newer: RealmMessageViewDto = {
      id: 'msg-1',
      chatId: 'chat-1',
      senderId: 'user-1',
      type: 'TEXT',
      text: 'new state',
      payload: { content: 'new state' },
      isRead: true,
      createdAt: '2026-03-10T10:00:00.000Z',
      clientMessageId: 'cm-1',
    };
    const older = {
      ...newer,
      text: 'stale replay',
      payload: { content: 'stale replay' },
      isRead: false,
      createdAt: '2026-03-10T09:59:00.000Z',
    };

    expect(mergeRealmRealtimeMessageIntoMessagesResult({
      items: [newer],
      nextBefore: null,
      nextAfter: null,
    }, older).items[0]?.text).toBe('new state');

    expect(applyRealmRealtimeMessageUpdateToMessagesResult({
      items: [newer],
      nextBefore: null,
      nextAfter: null,
    }, older)?.items[0]?.isRead).toBe(true);

    expect(applyRealmRealtimeMessageUpdateToChatsResult({
      current: {
        items: [{
          id: 'chat-1',
          createdAt: '2026-03-10T09:58:00.000Z',
          updatedAt: '2026-03-10T10:00:00.000Z',
          otherUser: {
            id: 'user-1',
            createdAt: '2026-03-10T09:58:00.000Z',
            displayName: 'Alex',
            handle: 'alex',
          },
          lastMessage: newer,
          lastMessageAt: newer.createdAt,
          unreadCount: 0,
        }],
        nextCursor: null,
      },
      chatId: 'chat-1',
      message: older,
    }).data?.items[0]?.lastMessage?.text).toBe('new state');
  });

  it('renders the default realm chat timeline UI with avatar and gift slots', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <RealmChatTimeline
          currentUserId="user-1"
          messages={[
            {
              id: 'gift-1',
              chatId: 'chat-1',
              senderId: 'user-2',
              type: 'GIFT',
              text: null,
              payload: { interactionId: 'gift-1', amount: 5 },
              createdAt: '2026-03-24T09:00:00.000Z',
              isRead: true,
              deliveryState: 'sent',
              deliveryError: null,
              localPreviewUrl: null,
              localUploadState: null,
            },
            {
              id: 'upload-1',
              chatId: 'chat-1',
              senderId: 'user-1',
              type: 'ATTACHMENT',
              text: null,
              payload: {
                attachment: {
                  targetType: 'RESOURCE',
                  targetId: 'resource-preview-upload-1',
                  displayKind: 'IMAGE',
                  url: '/preview.png',
                },
              },
              createdAt: '2026-03-24T09:10:00.000Z',
              isRead: true,
              deliveryState: 'pending',
              deliveryError: null,
              localPreviewUrl: '/preview.png',
              localUploadState: 'uploading',
            },
          ]}
          uploadingMediaLabel="Uploading..."
          renderAvatar={({ isMe }) => <span data-testid={isMe ? 'avatar-self' : 'avatar-other'} />}
          renderGiftMessage={() => <span data-testid="gift-slot">gift</span>}
        />,
      );
      await flush();
    });

    expect(container.querySelector('[data-testid="gift-slot"]')?.textContent).toBe('gift');
    expect(container.querySelector('[data-testid="avatar-self"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="avatar-other"]')).toBeTruthy();
    expect(container.textContent).toContain('Uploading...');
  });

  it('resolves protected timeline media through the owner adapter without Kit bearer custody', async () => {
    const dispose = vi.fn();
    const resolveMediaSource = vi.fn(async () => ({
      url: 'blob:nimi-runtime-media-1',
      dispose,
    }));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <RealmChatTimeline
          currentUserId="user-1"
          messages={[{
            id: 'media-1',
            chatId: 'chat-1',
            senderId: 'user-2',
            type: 'ATTACHMENT',
            text: null,
            payload: {
              attachment: {
                targetType: 'RESOURCE',
                targetId: 'resource-1',
                displayKind: 'IMAGE',
                url: 'https://realm.example.test/media/resource-1',
              },
            },
            createdAt: '2026-03-24T09:20:00.000Z',
            isRead: true,
            deliveryState: 'sent',
            deliveryError: null,
            localPreviewUrl: null,
            localUploadState: null,
          }]}
          resolveMediaSource={resolveMediaSource}
        />,
      );
      await flush();
    });

    expect(resolveMediaSource).toHaveBeenCalledWith(expect.objectContaining({
      sourceUrl: 'https://realm.example.test/media/resource-1',
      kind: 'image',
    }));
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:nimi-runtime-media-1');

    await act(async () => {
      root?.unmount();
      await flush();
    });
    root = null;
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('renders stream status UI for streaming and interrupted states', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <div>
          <ChatStreamStatus
            mode="streaming"
            partialText=""
            avatar={<span data-testid="stream-avatar" />}
            actions={<button type="button">Stop</button>}
          />
          <ChatStreamStatus
            mode="interrupted"
            partialText="Partial answer"
            errorMessage="Socket closed"
            interruptedSuffix={<span data-testid="interrupted-flag">[Interrupted]</span>}
          />
        </div>,
      );
      await flush();
    });

    expect(container.querySelector('[data-testid="stream-avatar"]')).toBeTruthy();
    expect(container.textContent).toContain('Stop');
    expect(container.querySelector('[data-testid="interrupted-flag"]')).toBeTruthy();
    expect(container.textContent).toContain('Socket closed');
  });

  it('renders thread header and panel state shells', async () => {
    const onTitleClick = vi.fn();

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <div>
          <ChatThreadHeader
            title="Alex"
            onTitleClick={onTitleClick}
            titleAriaLabel="Open profile"
          />
          <ChatPanelState dataTestId="chat-state" activeChatId="chat-1" tone="error">
            Failed to load
          </ChatPanelState>
        </div>,
      );
      await flush();
    });

    const button = container.querySelector('button');
    expect(button?.textContent).toBe('Alex');
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onTitleClick).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="chat-state"]')?.getAttribute('data-active-chat-id')).toBe('chat-1');
    expect(container.textContent).toContain('Failed to load');
  });

  it('renders composer shell and resize handle', async () => {
    const onMouseDown = vi.fn();

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <div>
          <ChatComposerResizeHandle ariaLabel="Resize composer" onMouseDown={onMouseDown} />
          <ChatComposerShell height={240}>
            <div data-testid="composer-shell-child">composer</div>
          </ChatComposerShell>
        </div>,
      );
      await flush();
    });

    const separator = container.querySelector('[role="separator"]');
    expect(separator?.getAttribute('aria-label')).toBe('Resize composer');
    separator?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(onMouseDown).toHaveBeenCalledTimes(1);
    const shell = container.querySelector('[data-testid="composer-shell-child"]')?.parentElement;
    expect(shell?.getAttribute('style')).toContain('height: 240px');
  });
});
