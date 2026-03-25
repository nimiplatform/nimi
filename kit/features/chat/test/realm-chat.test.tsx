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
  buildRealmTextMessageInput,
  createRealmChatSessionOpenPayload,
  createRealmChatSessionState,
  createRealmChatComposerAdapter,
  getRealmChatTimelineDisplayModel,
  normalizeRealmRealtimeMessagePayload,
  resolveRealmChatMediaUrl,
  resolveRealmChatSyncRequest,
  rememberRealmChatSeenEvent,
  sendRealmChatMessage,
  syncRealmChatEvents,
  useRealmMessageTimeline,
  useRealmChatRealtimeController,
  useRealmChatComposer,
  type RealmChatSyncResultDto,
  type RealmChatService,
  type RealmChatRealtimeSocket,
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
}: {
  socket: FakeRealmChatSocket;
  onApplyChatEvent: NonNullable<UseRealmChatRealtimeControllerOptions['applyChatEvent']>;
  onSyncChatEvents: UseRealmChatRealtimeControllerOptions['syncChatEvents'];
}) {
  useRealmChatRealtimeController({
    authStatus: 'authenticated',
    authToken: 'token-1',
    realtimeBaseUrl: 'https://realm.example.com',
    selectedChatId: 'chat-1',
    currentUserId: 'user-1',
    createSocket: () => socket,
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

describe('chat realm helpers', () => {
  it('builds a default TEXT payload for realm chat messages', () => {
    expect(buildRealmTextMessageInput('  hello realm  ')).toMatchObject({
      type: 'TEXT',
      text: 'hello realm',
      payload: { content: 'hello realm' },
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
    const syncChatEventsSpy = vi.fn(async () => ({
      items: [],
      snapshot: null,
    }));
    const service = {
      listChats: async () => ({ items: [] }),
      getChatById: async () => ({ id: 'chat-1' }),
      startChat: async () => ({ chatId: 'chat-1' }),
      listMessages: async () => ({ items: [] }),
      sendMessage,
      markChatRead: async () => {},
      syncChatEvents: syncChatEventsSpy,
    } as unknown as RealmChatService;

    await sendRealmChatMessage('chat-1', 'hello helper', service);
    await syncRealmChatEvents('chat-1', 12, 300, service);

    expect(sendMessage).toHaveBeenCalledWith('chat-1', expect.objectContaining({
      text: 'hello helper',
    }));
    expect(syncChatEventsSpy).toHaveBeenCalledWith('chat-1', 12, 300);
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
              isAgent: false,
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
      payload: { amount: 5 },
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
      type: 'IMAGE',
      text: null,
      payload: null,
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
              payload: { amount: 5 },
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
              type: 'IMAGE',
              text: null,
              payload: null,
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
