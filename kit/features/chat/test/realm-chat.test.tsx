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
  applyRealmMessageToChatsResult,
  applyRealmMessageUpdateToChatsResult,
  applyRealmMessageUpdateToMessagesResult,
  buildRealmStartChatInput,
  buildRealmTextMessageInput,
  createRealmChatResourceAttachmentPayload,
  createRealmChatComposerAdapter,
  extractRealmChatAttachmentTargetId,
  filterRealmDirectHumanChats,
  getRealmChatTimelineDisplayModel,
  getRealmHumanChatTitle,
  getRealmHumanTargetId,
  isRealmDirectHumanChat,
  listRealmChatMessages,
  mergeRealmMessageIntoMessagesResult,
  normalizeRealmChatLimit,
  normalizeRealmMessageView,
  resolveCanonicalRealmHumanChatId,
  resolveRealmChatAttachmentPreviewText,
  resolveRealmChatMediaUrl,
  sendRealmChatMessage,
  startRealmChatWithTarget,
  syncRealmChatEvents,
  collapseRealmHumanChatsToTargets,
  toRealmHumanConversationThreadSummary,
  toRealmHumanTargetSummary,
  useRealmMessageTimeline,
  useRealmChatComposer,
  type RealmChatService,
  type RealmChatViewDto,
  type RealmMessageViewDto,
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

function TimelineHarness(input: {
  messagesData: Parameters<typeof useRealmMessageTimeline>[0]['messagesData'];
  uploadPlaceholders?: Parameters<typeof useRealmMessageTimeline>[0]['uploadPlaceholders'];
}) {
  const messages = useRealmMessageTimeline({
    messagesData: input.messagesData,
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

  it('normalizes generated Realm message payloads', () => {
    const message = normalizeRealmMessageView({
      id: 'msg-1',
      chatId: 'chat-1',
      senderId: 'user-2',
      type: 'TEXT',
      text: 'hello confirmed',
      payload: { content: 'hello confirmed' },
      createdAt: '2026-03-24T10:00:00.000Z',
    });
    expect(message).toMatchObject({
      id: 'msg-1',
      chatId: 'chat-1',
      senderId: 'user-2',
      text: 'hello confirmed',
    });
  });

  it('rejects unknown message types and accepts generated canonical message types', () => {
    expect(normalizeRealmMessageView({
      id: 'msg-unsupported',
      chatId: 'chat-1',
      senderId: 'user-1',
      type: 'UNSUPPORTED',
      createdAt: '2026-03-21T00:00:00.000Z',
      isRead: false,
      payload: null,
    })).toBeNull();

    expect(normalizeRealmMessageView({
      id: 'msg-text',
      chatId: 'chat-1',
      senderId: 'user-1',
      type: 'TEXT',
      createdAt: '2026-03-21T00:00:00.000Z',
      isRead: false,
      payload: null,
    })?.type).toBe('TEXT');
  });

  it('merges confirmed messages into chat list state', () => {
    const result = applyRealmMessageToChatsResult({
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

  it('merges confirmed and upload placeholder messages for timeline state', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <TimelineHarness
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

    expect(container.querySelector('[data-testid="timeline-count"]')?.textContent).toBe('2');
  });

  it('derives a stable display model for uploading media timeline messages', () => {
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

  it('keeps newer confirmed message evidence during conflict handling', () => {
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

    expect(mergeRealmMessageIntoMessagesResult({
      items: [newer],
      nextBefore: null,
      nextAfter: null,
    }, older).items[0]?.text).toBe('new state');

    expect(applyRealmMessageUpdateToMessagesResult({
      items: [newer],
      nextBefore: null,
      nextAfter: null,
    }, older)?.items[0]?.isRead).toBe(true);

    expect(applyRealmMessageUpdateToChatsResult({
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

  it('renders the default realm chat timeline UI with avatars and media', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <RealmChatTimeline
          currentUserId="user-1"
          messages={[
            {
              id: 'text-1',
              chatId: 'chat-1',
              senderId: 'user-2',
              type: 'TEXT',
              text: 'Hello',
              payload: { content: 'Hello' },
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
        />,
      );
      await flush();
    });

    expect(container.textContent).toContain('Hello');
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
