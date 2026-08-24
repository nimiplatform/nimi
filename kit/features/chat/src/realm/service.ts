import type { RealmHumanChatModule, RealmModel } from '@nimiplatform/kit/core/sdk-contract';
import { useMemo } from 'react';
import {
  useChatComposer,
  type UseChatComposerResult,
} from '../headless.js';
import type { RealmMessageViewDto, RealmSendMessageInputDto } from './codec.js';
import { buildRealmTextMessageInput, normalizeRealmMessageView } from './messages.js';
import type {
  RealmChatComposerAdapter,
  RealmChatComposerAdapterOptions,
  RealmChatService,
  RealmChatSyncResultDto,
  RealmChatViewDto,
  RealmListChatsResultDto,
  RealmListMessagesResultDto,
  RealmStartChatInputDto,
  RealmStartChatResultDto,
  UseRealmChatComposerOptions,
} from './types.js';

function projectRealmMessageView(input: unknown): RealmMessageViewDto {
  const projected = normalizeRealmMessageView(input);
  if (!projected) {
    throw new Error('Realm chat message projection failed');
  }
  return projected;
}

export function projectRealmChatView(input: RealmModel<'ChatViewDto'>): RealmChatViewDto {
  return {
    ...input,
    lastMessage: normalizeRealmMessageView(input.lastMessage),
  };
}

function projectRealmListChatsResult(input: RealmModel<'ListChatsResultDto'>): RealmListChatsResultDto {
  return {
    ...input,
    items: input.items.map((item) => projectRealmChatView(item)),
  };
}

function projectRealmListMessagesResult(input: RealmModel<'ListMessagesResultDto'>): RealmListMessagesResultDto {
  return {
    ...input,
    items: input.items.map((item) => projectRealmMessageView(item)),
  };
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeChatId(chatId: string): string {
  return String(chatId || '').trim();
}

export function normalizeRealmChatLimit(limit: number, fallback: number, max: number): number {
  if (!Number.isFinite(limit) || limit <= 0) {
    return fallback;
  }
  return Math.min(max, Math.floor(limit));
}

export function createRealmChatService(humanChats: RealmHumanChatModule): RealmChatService {
  return {
    async listChats(limit = 20, cursor) {
      return projectRealmListChatsResult(await humanChats.listChats({
        path: {},
        query: {
          limit: normalizeRealmChatLimit(limit, 20, 100),
          cursor,
        },
      }));
    },
    async getChatById(chatId) {
      return projectRealmChatView(await humanChats.getChatById({
        path: { chatId: normalizeChatId(chatId) },
      }));
    },
    async startChat(input) {
      return humanChats.startChat({
        path: {},
        body: input,
      });
    },
    async listMessages(chatId, limit = 50, cursor) {
      return projectRealmListMessagesResult(await humanChats.listMessages({
        path: { chatId: normalizeChatId(chatId) },
        query: {
          limit: normalizeRealmChatLimit(limit, 50, 100),
          before: cursor,
        },
      }));
    },
    async sendMessage(chatId, input) {
      return projectRealmMessageView(await humanChats.sendMessage({
        path: { chatId: normalizeChatId(chatId) },
        body: input,
      }));
    },
    async markChatRead(chatId) {
      await humanChats.markChatRead({
        path: { chatId: normalizeChatId(chatId) },
      });
    },
    async syncChatEvents(chatId, afterSeq, limit = 200) {
      return humanChats.syncChatEvents({
        path: { chatId: normalizeChatId(chatId) },
        query: {
          limit: normalizeRealmChatLimit(limit, 200, 500),
          afterSeq: Number.isFinite(afterSeq) ? Math.max(0, Math.floor(afterSeq)) : 0,
        },
      });
    },
  };
}

export const realmChatService: RealmChatService = createUnavailableRealmChatService();

function createUnavailableRealmChatService(): RealmChatService {
  const unavailable = async (): Promise<never> => {
    throw new Error('Realm chat service requires an explicit Realm humanChats module.');
  };
  return {
    listChats: unavailable,
    getChatById: unavailable,
    startChat: unavailable,
    listMessages: unavailable,
    sendMessage: unavailable,
    markChatRead: unavailable,
    syncChatEvents: unavailable,
  };
}

export async function listRealmChats(
  limit = 20,
  cursor?: string,
  service: Pick<RealmChatService, 'listChats'> = realmChatService,
): Promise<RealmListChatsResultDto> {
  return service.listChats(normalizeRealmChatLimit(limit, 20, 100), cursor);
}

export async function getRealmChat(chatId: string, service: RealmChatService = realmChatService): Promise<RealmChatViewDto> {
  const normalizedChatId = normalizeChatId(chatId);
  if (!normalizedChatId) {
    throw new Error('Chat id is required');
  }
  return service.getChatById(normalizedChatId);
}

export async function startRealmChat(input: RealmStartChatInputDto, service: RealmChatService = realmChatService): Promise<RealmStartChatResultDto> {
  return service.startChat(input);
}

export function buildRealmStartChatInput(
  targetAccountId: string,
  initialMessage?: string | null,
): RealmStartChatInputDto {
  const normalizedTargetAccountId = normalizeString(targetAccountId);
  if (!normalizedTargetAccountId) {
    throw new Error('Target account id is required');
  }

  const normalizedMessage = normalizeString(initialMessage);
  if (!normalizedMessage) {
    return {
      targetAccountId: normalizedTargetAccountId,
    };
  }
  const textInput = buildRealmTextMessageInput(normalizedMessage);
  return {
    targetAccountId: normalizedTargetAccountId,
    text: textInput.text,
    type: textInput.type,
    payload: textInput.payload as RealmStartChatInputDto['payload'],
  };
}

export async function startRealmChatWithTarget(
  targetAccountId: string,
  initialMessage?: string | null,
  service: Pick<RealmChatService, 'startChat' | 'getChatById'> = realmChatService,
): Promise<RealmStartChatResultDto & { chat: RealmChatViewDto }> {
  const result = await service.startChat(buildRealmStartChatInput(targetAccountId, initialMessage));
  const chatId = normalizeChatId(result.chatId);
  if (!chatId) {
    throw new Error('Chat id is required');
  }
  const chat = await service.getChatById(chatId);
  return { ...result, chat };
}

export async function listRealmChatMessages(
  chatId: string,
  limit = 50,
  cursor?: string,
  service: Pick<RealmChatService, 'listMessages'> = realmChatService,
): Promise<RealmListMessagesResultDto> {
  const normalizedChatId = normalizeChatId(chatId);
  if (!normalizedChatId) {
    throw new Error('Chat id is required');
  }
  return service.listMessages(normalizedChatId, normalizeRealmChatLimit(limit, 50, 100), cursor);
}

export async function sendRealmChatMessage(chatId: string, input: string | RealmSendMessageInputDto, service: RealmChatService = realmChatService): Promise<RealmMessageViewDto> {
  const normalizedChatId = normalizeChatId(chatId);
  if (!normalizedChatId) {
    throw new Error('Chat id is required');
  }
  return service.sendMessage(normalizedChatId, typeof input === 'string' ? buildRealmTextMessageInput(input) : input);
}

export async function markRealmChatRead(
  chatId: string,
  service: Pick<RealmChatService, 'markChatRead'> = realmChatService,
): Promise<void> {
  const normalizedChatId = normalizeChatId(chatId);
  if (!normalizedChatId) {
    throw new Error('Chat id is required');
  }
  await service.markChatRead(normalizedChatId);
}

export async function syncRealmChatEvents(
  chatId: string,
  afterSeq: number,
  limit = 200,
  service: Pick<RealmChatService, 'syncChatEvents'> = realmChatService,
): Promise<RealmChatSyncResultDto> {
  const normalizedChatId = normalizeChatId(chatId);
  if (!normalizedChatId) {
    throw new Error('Chat id is required');
  }
  const normalizedAfterSeq = Number.isFinite(afterSeq) ? Math.max(0, Math.floor(afterSeq)) : 0;
  return service.syncChatEvents(normalizedChatId, normalizedAfterSeq, normalizeRealmChatLimit(limit, 200, 500));
}

export function createRealmChatComposerAdapter<TAttachment = never>({
  chatId,
  service = realmChatService,
  messageOptions = {},
  resolveMessageInput,
  onResponse,
}: RealmChatComposerAdapterOptions<TAttachment>): RealmChatComposerAdapter<TAttachment> {
  return {
    submit: async (input) => {
      const normalizedChatId = normalizeChatId(chatId);
      if (!normalizedChatId) {
        throw new Error('Chat id is required');
      }
      const payload = resolveMessageInput
        ? await resolveMessageInput(input)
        : buildRealmTextMessageInput(input.text, messageOptions);
      const message = await service.sendMessage(normalizedChatId, payload);
      await onResponse?.(message, input);
    },
  };
}

export function useRealmChatComposer<TAttachment = never>({
  chatId,
  service = realmChatService,
  messageOptions,
  resolveMessageInput,
  onResponse,
  ...composerOptions
}: UseRealmChatComposerOptions<TAttachment>): UseChatComposerResult<TAttachment> {
  const adapter = useMemo(
    () => createRealmChatComposerAdapter<TAttachment>({
      chatId,
      service,
      messageOptions,
      resolveMessageInput,
      onResponse,
    }),
    [chatId, messageOptions, onResponse, resolveMessageInput, service],
  );

  return useChatComposer<TAttachment>({
    ...composerOptions,
    adapter,
  });
}
