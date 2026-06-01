import type { JsonObject } from '@nimiplatform/sdk/types';

export type PersistentOutboxEntry = {
  clientMessageId: string;
  chatId: string;
  body: JsonObject;
  enqueuedAt: number;
  attempts: number;
  status: 'pending' | 'failed';
  failReason?: string;
};

export type SocialMutationKind =
  | 'post-like'
  | 'post-unlike';

export type PersistentSocialMutationEntry = {
  id: string;
  kind: SocialMutationKind;
  payload: JsonObject;
  enqueuedAt: number;
  attempts: number;
  status: 'pending' | 'failed';
  failReason?: string;
};

export const OFFLINE_OUTBOX_MAX_ENTRIES = 1000;
export const OFFLINE_CACHE_MAX_CHATS = 20;
export const OFFLINE_CACHE_MAX_MESSAGES_PER_CHAT = 50;
