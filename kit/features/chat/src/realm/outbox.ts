import { normalizeRealmMessagePayload, type RealmMessageViewDto, type RealmSendMessageInputDto } from './codec.js';
import type {
  RealmChatErrorMessageResolver,
  RealmChatOfflineErrorPredicate,
  RealmChatOutboxSendResult,
  RealmChatOutboxStore,
  RealmChatOutboxStoreEntry,
  RealmChatSendService,
} from './types.js';
import { buildRealmTextMessageInput } from './messages.js';
import { asRecord, normalizeString } from './shared.js';

type SendMessageInputWithOutboxInput = {
  chatId: string;
  body: RealmSendMessageInputDto;
  service: RealmChatSendService;
  outbox: RealmChatOutboxStore;
  now?: () => number;
  isOfflineError?: RealmChatOfflineErrorPredicate;
  describeError?: RealmChatErrorMessageResolver;
  failureMessage?: string;
  onOffline?: (error: unknown, entry: RealmChatOutboxStoreEntry) => void;
};

type SendTextWithOutboxInput = {
  chatId: string;
  content: string;
  options?: Partial<RealmSendMessageInputDto>;
  service: RealmChatSendService;
  outbox: RealmChatOutboxStore;
  createClientMessageId: () => string;
  now?: () => number;
  isOfflineError?: RealmChatOfflineErrorPredicate;
  describeError?: RealmChatErrorMessageResolver;
  failureMessage?: string;
  onOffline?: (error: unknown, entry: RealmChatOutboxStoreEntry) => void;
};

type FlushOutboxInput = {
  chatId?: string;
  service: RealmChatSendService;
  outbox: RealmChatOutboxStore;
  isOfflineError?: RealmChatOfflineErrorPredicate;
  describeError?: RealmChatErrorMessageResolver;
  failureMessage?: string;
  stopOnOffline?: boolean;
  onOffline?: (error: unknown, entry: RealmChatOutboxStoreEntry) => void;
  onEntryError?: (error: unknown, entry: RealmChatOutboxStoreEntry) => void;
};

function defaultDescribeError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }
  return fallback;
}

function isOffline(
  error: unknown,
  predicate: RealmChatOfflineErrorPredicate | undefined,
): boolean {
  return Boolean(predicate?.(error));
}

function resolveMessageType(input: unknown): RealmMessageViewDto['type'] {
  const normalized = normalizeString(input).toUpperCase();
  return (normalized || 'TEXT') as RealmMessageViewDto['type'];
}

function ensureClientMessageId(value: unknown): string {
  const clientMessageId = normalizeString(value);
  if (!clientMessageId) {
    throw new Error('Realm chat clientMessageId is required');
  }
  return clientMessageId;
}

export function buildRealmChatOutboxMessageInput(
  content: string,
  options: Partial<RealmSendMessageInputDto> = {},
  clientMessageId: string,
): RealmSendMessageInputDto {
  return buildRealmTextMessageInput(content, {
    ...options,
    clientMessageId: ensureClientMessageId(clientMessageId),
  });
}

export function createRealmChatOutboxEntry(input: {
  chatId: string;
  body: RealmSendMessageInputDto;
  enqueuedAt: number;
  attempts?: number;
  status?: RealmChatOutboxStoreEntry['status'];
}): RealmChatOutboxStoreEntry {
  return {
    clientMessageId: ensureClientMessageId(input.body.clientMessageId),
    chatId: input.chatId,
    body: input.body,
    enqueuedAt: input.enqueuedAt,
    attempts: Number.isFinite(input.attempts) ? Math.max(0, Math.floor(input.attempts as number)) : 0,
    status: input.status || 'pending',
  };
}

export function toRealmChatOutboxPlaceholderMessage(
  entry: Pick<RealmChatOutboxStoreEntry, 'clientMessageId' | 'chatId' | 'body' | 'enqueuedAt'>,
  fallbackSenderId = 'local-user',
): RealmMessageViewDto {
  const body = asRecord(entry.body) ?? {};
  const payload = asRecord(body.payload);
  return {
    id: `offline:${entry.clientMessageId}`,
    chatId: entry.chatId,
    clientMessageId: entry.clientMessageId,
    createdAt: new Date(entry.enqueuedAt).toISOString(),
    isRead: true,
    payload: normalizeRealmMessagePayload(payload),
    senderId: normalizeString(body.senderId) || fallbackSenderId,
    text: typeof body.text === 'string' ? body.text : null,
    type: resolveMessageType(body.type),
  };
}

export async function countPendingRealmChatOutboxEntries(
  outbox: RealmChatOutboxStore,
): Promise<number> {
  const entries = await outbox.getChatOutboxEntries();
  return entries.filter((entry) => entry.status === 'pending').length;
}

export async function sendRealmChatMessageInputWithOutbox({
  chatId,
  service,
  outbox,
  body,
  now = () => Date.now(),
  isOfflineError,
  describeError = defaultDescribeError,
  failureMessage = 'Failed to send chat message',
  onOffline,
}: SendMessageInputWithOutboxInput): Promise<RealmChatOutboxSendResult> {
  const clientMessageId = ensureClientMessageId(body.clientMessageId);
  const entry = createRealmChatOutboxEntry({
    chatId,
    body,
    enqueuedAt: now(),
    attempts: 0,
    status: 'pending',
  });
  await outbox.upsertChatOutboxEntry(entry);

  try {
    const message = await service.sendMessage(chatId, body);
    await outbox.markChatOutboxSent(clientMessageId);
    return {
      kind: 'sent',
      clientMessageId,
      message,
    };
  } catch (error) {
    const existing = await outbox.getChatOutboxEntry(clientMessageId);
    if (existing && isOffline(error, isOfflineError)) {
      const nextEntry = {
        ...existing,
        attempts: existing.attempts + 1,
        status: 'pending',
      };
      await outbox.upsertChatOutboxEntry(nextEntry);
      onOffline?.(error, nextEntry);
      return {
        kind: 'queued',
        clientMessageId,
        entry: nextEntry,
        placeholder: toRealmChatOutboxPlaceholderMessage(nextEntry),
      };
    }

    if (existing) {
      await outbox.markChatOutboxFailed(
        clientMessageId,
        describeError(error, failureMessage),
      );
    }
    throw error;
  }
}

export async function sendRealmChatTextMessageWithOutbox({
  chatId,
  content,
  options = {},
  createClientMessageId,
  ...rest
}: SendTextWithOutboxInput): Promise<RealmChatOutboxSendResult> {
  const clientMessageId = normalizeString(options.clientMessageId) || ensureClientMessageId(createClientMessageId());
  return sendRealmChatMessageInputWithOutbox({
    chatId,
    body: buildRealmChatOutboxMessageInput(content, {
      ...options,
      clientMessageId,
    }, clientMessageId),
    ...rest,
  });
}

export const sendRealmChatMessageWithOutbox = sendRealmChatTextMessageWithOutbox;

export async function flushRealmChatOutbox({
  chatId,
  service,
  outbox,
  isOfflineError,
  describeError = defaultDescribeError,
  failureMessage = 'Failed to replay chat message',
  stopOnOffline = true,
  onOffline,
  onEntryError,
}: FlushOutboxInput): Promise<RealmMessageViewDto[]> {
  const pending = (await outbox.getChatOutboxEntries(chatId))
    .slice()
    .sort((left, right) => left.enqueuedAt - right.enqueuedAt);
  const flushed: RealmMessageViewDto[] = [];

  for (const entry of pending) {
    if (entry.status !== 'pending') {
      continue;
    }
    try {
      const message = await service.sendMessage(entry.chatId, entry.body);
      await outbox.markChatOutboxSent(entry.clientMessageId);
      flushed.push(message);
    } catch (error) {
      if (isOffline(error, isOfflineError)) {
        const nextEntry = {
          ...entry,
          attempts: entry.attempts + 1,
          status: 'pending',
        };
        await outbox.upsertChatOutboxEntry(nextEntry);
        onOffline?.(error, nextEntry);
        if (stopOnOffline) {
          break;
        }
        continue;
      }

      await outbox.markChatOutboxFailed(
        entry.clientMessageId,
        describeError(error, failureMessage),
      );
      onEntryError?.(error, entry);
    }
  }

  return flushed;
}
