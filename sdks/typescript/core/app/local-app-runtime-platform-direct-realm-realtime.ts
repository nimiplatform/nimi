import type { Ack } from '../../core-generated/runtime-protobuf/runtime/v1/common.js';
import type {
  AckRealmRealtimeEventsRequest,
  AckRealmRealtimeEventsResponse,
  CloseRealmRealtimeChannelRequest,
  CloseRealmRealtimeChannelResponse,
  CloseRealmRealtimeSubscriptionRequest,
  CloseRealmRealtimeSubscriptionResponse,
  OpenRealmRealtimeChannelRequest,
  OpenRealmRealtimeChannelResponse,
  RealmChatAttachmentPayload,
  RealmChatDurableEvent,
  RealmChatMessage,
  RealmChatMessagePayload,
  RealmChatMessageReply,
  RealmChatUserSummary,
  SubscribeRealmRealtimeEventsRequest,
  SubscribeRealmRealtimeEventsResponse,
} from '../../core-generated/runtime-protobuf/runtime/v1/realm_realtime.js';
import {
  RealmAttachmentDisplayKind,
  RealmAttachmentTargetType,
  RealmChatMessageType,
} from '../../core-generated/runtime-protobuf/runtime/v1/realm_realtime.js';
import {
  createNimiRealmRealtimeClient,
  type NimiRealmRealtimeClient,
  type NimiRealmRealtimeShell,
} from './local-app-runtime-platform-realm-realtime.js';
import { asRecord } from './local-app-runtime-platform-validation.js';
import {
  invalidRuntimeRealtimeProjection as invalid,
  projectRuntimeAck,
  projectRuntimeEnum,
  projectRuntimeOptionalTimestamp,
  projectRuntimeRealtimeControl,
  projectRuntimeTimestamp,
} from './local-app-runtime-platform-direct-realtime-shared.js';

export type NimiRealmRealtimeRuntime = {
  readonly openRealmRealtimeChannel: (request: OpenRealmRealtimeChannelRequest) => Promise<OpenRealmRealtimeChannelResponse>;
  readonly subscribeRealmRealtimeEvents: (request: SubscribeRealmRealtimeEventsRequest, options?: { readonly signal?: AbortSignal }) => AsyncIterable<SubscribeRealmRealtimeEventsResponse>;
  readonly ackRealmRealtimeEvents: (request: AckRealmRealtimeEventsRequest) => Promise<AckRealmRealtimeEventsResponse>;
  readonly closeRealmRealtimeSubscription: (request: CloseRealmRealtimeSubscriptionRequest) => Promise<CloseRealmRealtimeSubscriptionResponse>;
  readonly closeRealmRealtimeChannel: (request: CloseRealmRealtimeChannelRequest) => Promise<CloseRealmRealtimeChannelResponse>;
};

// @nimi-authority: rule.nimi.sdks.realm-consumer.r048
// @nimi-authority: rule.nimi.sdks.feature-clients.r107
export function createNimiRealmRealtimeRuntimeClient(
  runtime: NimiRealmRealtimeRuntime,
): NimiRealmRealtimeClient {
  const shell: NimiRealmRealtimeShell = {
    open: async () => {
      const response = await runtime.openRealmRealtimeChannel({});
      return {
        realtimeSessionId: response.realtimeSessionId,
        channelId: response.channelId,
        generation: response.generation,
        control: projectRuntimeRealtimeControl(response.status),
      };
    },
    subscribe: async (input) => {
      const source = record(input, 'Realm Realtime subscription input');
      const controller = new AbortController();
      const events = runtime.subscribeRealmRealtimeEvents({
        channelId: text(source.channelId),
        target: runtimeTarget(source.target),
      }, { signal: controller.signal });
      return {
        events: (async function* () {
          for await (const event of events) yield projectEvent(event);
        })(),
        cancel: async () => controller.abort(),
      };
    },
    ack: async (input) => {
      const source = record(input, 'Realm Realtime acknowledgement input');
      const response = await runtime.ackRealmRealtimeEvents({
        channelId: text(source.channelId),
        subscriptionId: text(source.subscriptionId),
        cursor: decimal(source.cursor),
      });
      return ackEnvelope(response.ack);
    },
    closeSubscription: async (input) => {
      const source = record(input, 'Realm Realtime close subscription input');
      const response = await runtime.closeRealmRealtimeSubscription({
        channelId: text(source.channelId),
        subscriptionId: text(source.subscriptionId),
      });
      return ackEnvelope(response.ack);
    },
    closeChannel: async (input) => {
      const source = record(input, 'Realm Realtime close channel input');
      const response = await runtime.closeRealmRealtimeChannel({ channelId: text(source.channelId) });
      return ackEnvelope(response.ack);
    },
  };
  return createNimiRealmRealtimeClient(shell);
}

function runtimeTarget(value: unknown): SubscribeRealmRealtimeEventsRequest['target'] {
  const target = record(value, 'Realm Realtime target');
  if (target.type === 'chat') {
    return { oneofKind: 'chat', chat: { chatId: text(target.chatId) } };
  }
  if (target.type === 'presence') return { oneofKind: 'presence', presence: {} };
  if (target.type === 'inbox') return { oneofKind: 'inbox', inbox: {} };
  return invalid('Realm Realtime target');
}

function ackEnvelope(value: Ack | undefined) {
  return { ack: projectRuntimeAck(value) };
}

function projectEvent(value: SubscribeRealmRealtimeEventsResponse) {
  return {
    realtimeSessionId: value.realtimeSessionId,
    channelId: value.channelId,
    subscriptionId: value.subscriptionId,
    generation: value.generation,
    sequence: value.sequence,
    correlationId: value.correlationId,
    occurredAt: projectRuntimeTimestamp(value.occurredAt),
    event: projectDataEvent(value),
  };
}

function projectDataEvent(value: SubscribeRealmRealtimeEventsResponse) {
  switch (value.event.oneofKind) {
    case 'control': return { type: 'control', control: projectRuntimeRealtimeControl(value.event.control) };
    case 'chat': return projectChatEvent(value.event.chat);
    case 'typing': return {
      type: 'typing', chatId: value.event.typing.chatId, userId: value.event.typing.userId,
      isTyping: value.event.typing.isTyping, expiresAt: projectRuntimeTimestamp(value.event.typing.expiresAt),
    };
    case 'presence': return {
      type: 'presence', userId: value.event.presence.userId, isOnline: value.event.presence.isOnline,
      presenceRevision: value.event.presence.presenceRevision,
      occurredAt: projectRuntimeTimestamp(value.event.presence.occurredAt),
    };
    case 'snapshot': return {
      type: 'snapshot', chatId: value.event.snapshot.chatId,
      otherUser: value.event.snapshot.otherUser ? projectDirectRealmChatUserSummary(value.event.snapshot.otherUser) : null,
      messages: value.event.snapshot.messages.map(projectDirectRealmChatMessage),
      throughCursor: value.event.snapshot.throughCursor,
      unreadCount: value.event.snapshot.unreadCount,
      appliedAt: projectRuntimeTimestamp(value.event.snapshot.appliedAt),
    };
    case 'inbox': return {
      type: 'inbox', chatId: value.event.inbox.chatId,
      highWatermarkSeq: value.event.inbox.highWatermarkSeq,
      occurredAt: projectRuntimeTimestamp(value.event.inbox.occurredAt),
    };
    default: return invalid('Realm Realtime event kind');
  }
}

function projectChatEvent(value: RealmChatDurableEvent) {
  let kind: 'message-created' | 'message-edited' | 'message-recalled' | 'chat-read';
  let payload: Record<string, unknown>;
  switch (value.event.oneofKind) {
    case 'messageCreated':
      kind = 'message-created';
      payload = { message: projectDirectRealmChatMessage(requiredMessage(value.event.messageCreated.message)) };
      break;
    case 'messageEdited':
      kind = 'message-edited';
      payload = { message: projectDirectRealmChatMessage(requiredMessage(value.event.messageEdited.message)) };
      break;
    case 'messageRecalled':
      kind = 'message-recalled';
      payload = {
        chatId: value.event.messageRecalled.chatId,
        messageId: value.event.messageRecalled.messageId,
        recalledAt: projectRuntimeTimestamp(value.event.messageRecalled.recalledAt),
      };
      break;
    case 'chatRead':
      kind = 'chat-read';
      payload = {
        chatId: value.event.chatRead.chatId,
        readerId: value.event.chatRead.readerId,
        readThroughMessageId: nullableText(value.event.chatRead.readThroughMessageId),
        readAt: projectRuntimeTimestamp(value.event.chatRead.readAt),
      };
      break;
    default: return invalid('Realm Chat event kind');
  }
  return {
    type: 'chat', streamId: value.streamId, cursor: value.cursor, eventId: value.eventId,
    chatId: value.chatId, actorId: value.actorId,
    occurredAt: projectRuntimeTimestamp(value.occurredAt), kind, payload,
  };
}

export function projectDirectRealmChatMessage(value: RealmChatMessage) {
  return {
    id: value.id,
    chatId: value.chatId,
    senderId: value.senderId,
    clientMessageId: nullableText(value.clientMessageId),
    messageType: messageType(value.type),
    text: value.text ?? null,
    payload: projectMessagePayload(value.payload),
    isRead: value.isRead,
    replyTo: value.replyTo ? projectReply(value.replyTo) : null,
    createdAt: projectRuntimeTimestamp(value.createdAt),
    editedAt: projectRuntimeOptionalTimestamp(value.editedAt),
  };
}

export function projectDirectRealmChatUserSummary(value: RealmChatUserSummary) {
  return {
    id: value.id,
    handle: value.handle,
    displayName: value.displayName,
    avatarUrl: nullableText(value.avatarUrl),
    status: nullableText(value.status),
    presenceStatus: nullableText(value.presenceStatus),
    presenceText: nullableText(value.presenceText),
    presenceEmoji: nullableText(value.presenceEmoji),
    createdAt: projectRuntimeTimestamp(value.createdAt),
  };
}

function projectReply(value: RealmChatMessageReply) {
  return {
    id: value.id,
    senderId: value.senderId,
    messageType: messageType(value.type),
    text: value.text,
    payload: projectMessagePayload(value.payload),
  };
}

function projectMessagePayload(value: RealmChatMessagePayload | undefined): Record<string, unknown> | null {
  switch (value?.payload.oneofKind) {
    case 'text': return { type: 'text', content: value.payload.text.content };
    case 'attachment': return { type: 'attachment', attachment: projectAttachment(value.payload.attachment) };
    case 'postRef': return { type: 'post-ref', postId: value.payload.postRef.postId };
    case 'userRef': return {
      type: 'user-ref', userId: value.payload.userRef.userId,
      snapshot: value.payload.userRef.snapshot ? { ...value.payload.userRef.snapshot } : null,
    };
    case 'linkRef': return {
      type: 'link-ref', url: value.payload.linkRef.url, title: nullableText(value.payload.linkRef.title),
    };
    case 'friendRequest': return {
      type: 'friend-request', requestId: value.payload.friendRequest.requestId,
      status: value.payload.friendRequest.status,
      requestMessage: nullableText(value.payload.friendRequest.requestMessage),
    };
    case 'system': return {
      type: 'system', code: nullableText(value.payload.system.code),
      message: nullableText(value.payload.system.message),
    };
    case undefined: return null;
    default: return invalid('Realm Chat message payload');
  }
}

function projectAttachment(value: RealmChatAttachmentPayload): Record<string, unknown> {
  return {
    targetType: projectRuntimeEnum(value.targetType, {
      [RealmAttachmentTargetType.RESOURCE]: 'resource',
      [RealmAttachmentTargetType.ASSET]: 'asset',
      [RealmAttachmentTargetType.BUNDLE]: 'bundle',
    }, 'Realm attachment target'),
    targetId: value.targetId,
    displayKind: value.displayKind === RealmAttachmentDisplayKind.UNSPECIFIED ? null : projectRuntimeEnum(value.displayKind, {
      [RealmAttachmentDisplayKind.IMAGE]: 'image',
      [RealmAttachmentDisplayKind.VIDEO]: 'video',
      [RealmAttachmentDisplayKind.AUDIO]: 'audio',
      [RealmAttachmentDisplayKind.TEXT]: 'text',
      [RealmAttachmentDisplayKind.CARD]: 'card',
    }, 'Realm attachment display kind'),
    title: nullableText(value.title),
    subtitle: nullableText(value.subtitle),
    url: nullableText(value.url),
    thumbnail: nullableText(value.thumbnail),
    width: value.width,
    height: value.height,
    duration: value.duration,
    preview: value.preview ? projectAttachment(value.preview) : null,
  };
}

function messageType(value: RealmChatMessageType) {
  return projectRuntimeEnum(value, {
    [RealmChatMessageType.TEXT]: 'text',
    [RealmChatMessageType.ATTACHMENT]: 'attachment',
    [RealmChatMessageType.POST_REF]: 'post-ref',
    [RealmChatMessageType.USER_REF]: 'user-ref',
    [RealmChatMessageType.LINK_REF]: 'link-ref',
    [RealmChatMessageType.FRIEND_REQUEST]: 'friend-request',
    [RealmChatMessageType.SYSTEM]: 'system',
    [RealmChatMessageType.RECALL]: 'recall',
  }, 'Realm Chat message type');
}

function requiredMessage(value: RealmChatMessage | undefined): RealmChatMessage {
  return value ?? invalid('Realm Chat message');
}

function nullableText(value: string): string | null {
  return value === '' ? null : value;
}

function record(value: unknown, label: string): Record<string, unknown> {
  return asRecord(value) ?? invalid(label);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : invalid('Realm Realtime text');
}

function decimal(value: unknown): string {
  return typeof value === 'string' && /^(0|[1-9][0-9]*)$/u.test(value)
    ? value
    : invalid('Realm Realtime decimal');
}
