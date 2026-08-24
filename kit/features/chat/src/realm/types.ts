import type { RealmModel } from '@nimiplatform/kit/core/sdk-contract';
import type { UseChatComposerOptions } from '../headless.js';
import type {
  RealmMessageViewDto,
  RealmSendMessageInputDto,
} from './codec.js';
import type { ChatComposerAdapter, ChatComposerSubmitInput } from '../types.js';

type RealmGeneratedChatViewDto = RealmModel<'ChatViewDto'>;
type RealmGeneratedListChatsResultDto = RealmModel<'ListChatsResultDto'>;
type RealmGeneratedListMessagesResultDto = RealmModel<'ListMessagesResultDto'>;
export type RealmChatViewDto = Omit<RealmGeneratedChatViewDto, 'lastMessage'> & {
  readonly lastMessage?: RealmMessageViewDto | null;
};
export type RealmListChatsResultDto = Omit<RealmGeneratedListChatsResultDto, 'items' | 'nextCursor'> & {
  readonly items: readonly RealmChatViewDto[];
  readonly nextCursor?: string | null;
};
export type RealmListMessagesResultDto = Omit<RealmGeneratedListMessagesResultDto, 'items' | 'nextAfter' | 'nextBefore'> & {
  readonly items: readonly RealmMessageViewDto[];
  readonly nextAfter?: string | null;
  readonly nextBefore?: string | null;
};
export type RealmStartChatInputDto = RealmModel<'StartChatInputDto'>;
export type RealmStartChatResultDto = RealmModel<'StartChatResultDto'>;
export type RealmChatSyncResultDto = RealmModel<'ChatSyncResultDto'>;
export type RealmChatTimelineMessage = RealmMessageViewDto & {
  deliveryState: 'sent' | 'pending' | 'failed';
  deliveryError?: string | null;
  localPreviewUrl?: string | null;
  localUploadState?: 'uploading' | null;
};
export type RealmChatTimelineDisplayModel = {
  isMe: boolean;
  kind: 'text' | 'image' | 'video';
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
  } | null;
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
