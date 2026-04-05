import type { RealmServiceRegistry } from '@nimiplatform/sdk/realm';
import type { UseChatComposerOptions } from '../headless.js';
import type {
  RealmMessageViewDto,
  RealmSendMessageInputDto,
} from './codec.js';
import type { ChatComposerAdapter, ChatComposerSubmitInput } from '../types.js';

type HumanChatsService = RealmServiceRegistry['HumanChatsService'];

export type RealmChatViewDto =
  Awaited<ReturnType<HumanChatsService['getChatById']>>;
export type RealmListChatsResultDto =
  Awaited<ReturnType<HumanChatsService['listChats']>>;
export type RealmListMessagesResultDto =
  Awaited<ReturnType<HumanChatsService['listMessages']>>;
export type RealmStartChatInputDto =
  Parameters<HumanChatsService['startChat']>[0];
export type RealmStartChatResultDto =
  Awaited<ReturnType<HumanChatsService['startChat']>>;
export type RealmChatSyncResultDto =
  Awaited<ReturnType<HumanChatsService['syncChatEvents']>>;
export type RealmChatEventEnvelopeDto =
  NonNullable<RealmChatSyncResultDto['events']>[number];
export type RealmChatSessionState = {
  chatId: string;
  sessionId: string;
  resumeToken: string;
  lastAckSeq: number;
};
export type RealmChatSessionReadyPayload = {
  chatId: string;
  sessionId: string;
  resumeToken: string;
  lastAckSeq: number;
};
export type RealmChatSessionSyncRequiredPayload = {
  chatId: string;
  requestedAfterSeq: number;
};
export type RealmChatRealtimeSocket = {
  connected: boolean;
  emit: (event: string, payload: unknown) => void;
  on: (event: string, handler: (payload: unknown) => void) => void;
  off: (event: string, handler: (payload: unknown) => void) => void;
  disconnect: () => void;
};
export type RealmChatRealtimeSocketFactory = (input: {
  baseUrl: string;
  token: string;
  socketPath?: string;
}) => RealmChatRealtimeSocket;
export type RealmChatEventEnvelope = RealmChatEventEnvelopeDto & {
  eventId: string;
  chatId: string;
  kind: string;
  seq: number;
  sessionId: string;
};
export type RealmChatTimelineMessage = RealmMessageViewDto & {
  deliveryState: 'sent' | 'pending' | 'failed';
  deliveryError?: string | null;
  localPreviewUrl?: string | null;
  localUploadState?: 'uploading' | null;
};
export type RealmChatTimelineDisplayModel = {
  isMe: boolean;
  kind: 'text' | 'gift' | 'image' | 'video';
  isGiftMessage: boolean;
  isImageMessage: boolean;
  isVideoMessage: boolean;
  isMediaMessage: boolean;
  resolvedText: string;
  localPreviewUrl: string | null;
  isUploadingMedia: boolean;
  showDeliveryState: boolean;
  deliveryState: RealmChatTimelineMessage['deliveryState'];
  deliveryError: string | null;
};
export type RealmChatOutboxEntryLike = {
  clientMessageId: string;
  chatId: string;
  body?: unknown;
  enqueuedAt: number;
  status: 'pending' | 'failed' | 'sent' | string;
  failReason?: string | null;
};
export type RealmChatUploadPlaceholderLike = {
  id: string;
  chatId: string;
  previewUrl: string;
  kind: 'image' | 'video' | string;
  senderId: string;
  createdAt: string;
};
export type UseRealmMessageTimelineOptions = {
  messagesData?: {
    items?: readonly RealmMessageViewDto[];
    offlineOutbox?: readonly RealmChatOutboxEntryLike[];
  } | null;
  currentUserId: string;
  uploadPlaceholders?: readonly RealmChatUploadPlaceholderLike[];
};
export type RealmChatService = {
  listChats: (limit?: number, cursor?: string) => Promise<RealmListChatsResultDto>;
  getChatById: (chatId: string) => Promise<RealmChatViewDto>;
  startChat: (input: RealmStartChatInputDto) => Promise<RealmStartChatResultDto>;
  listMessages: (
    chatId: string,
    limit?: number,
    cursor?: string,
  ) => Promise<RealmListMessagesResultDto>;
  sendMessage: (
    chatId: string,
    input: RealmSendMessageInputDto,
  ) => Promise<RealmMessageViewDto>;
  markChatRead: (chatId: string) => Promise<void>;
  syncChatEvents: (
    chatId: string,
    afterSeq: number,
    limit?: number,
  ) => Promise<RealmChatSyncResultDto>;
};
export type RealmChatSendService = Pick<RealmChatService, 'sendMessage'>;
export type UseRealmChatRealtimeControllerOptions = {
  authStatus: string;
  authToken?: string | null;
  fallbackToken?: string | null;
  realtimeBaseUrl?: string | null;
  selectedChatId: string | null;
  currentUserId: string;
  socketPath?: string;
  createSocket: RealmChatRealtimeSocketFactory;
  onSocketReachableChange?: (reachable: boolean) => void;
  flushChatOutbox?: () => Promise<void> | void;
  flushSocialOutbox?: () => Promise<void> | void;
  invalidateChats?: () => Promise<void> | void;
  invalidateMessages?: (chatId: string) => Promise<void> | void;
  invalidateNotifications?: () => Promise<void> | void;
  syncChatEvents: (
    chatId: string,
    afterSeq: number,
    limit: number,
  ) => Promise<RealmChatSyncResultDto>;
  loadMessages: (chatId: string) => Promise<unknown>;
  applyChatEvent: (input: {
    event: RealmChatEventEnvelope;
    selectedChatId: string | null;
    currentUserId: string;
  }) => void;
  applySyncSnapshot: (
    chatId: string,
    snapshot: RealmChatSyncResultDto['snapshot'],
  ) => void;
};
export type RealmChatComposerAdapterOptions<TAttachment = never> = {
  chatId: string;
  service?: RealmChatSendService;
  messageOptions?: Partial<RealmSendMessageInputDto>;
  resolveMessageInput?: (
    input: ChatComposerSubmitInput<TAttachment>,
  ) => RealmSendMessageInputDto | Promise<RealmSendMessageInputDto>;
  onResponse?: (
    message: RealmMessageViewDto,
    input: ChatComposerSubmitInput<TAttachment>,
  ) => Promise<void> | void;
};
export type UseRealmChatComposerOptions<TAttachment = never> =
  Omit<UseChatComposerOptions<TAttachment>, 'adapter'>
  & RealmChatComposerAdapterOptions<TAttachment>;

export type RealmChatComposerAdapter<TAttachment = never> = ChatComposerAdapter<TAttachment>;
