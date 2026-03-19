import type { JsonObject } from '@runtime/net/json';

/** D-OFFLINE-001: Three-tier degradation model */
export type OfflineTier = 'L0' | 'L1' | 'L2';

export type OfflineTierChange = {
  from: OfflineTier;
  to: OfflineTier;
  timestamp: number;
  reason: 'realm_offline' | 'realm_reconnect' | 'runtime_offline' | 'runtime_reconnect';
};

export type ConnectivityStatus = {
  realm: { reachable: boolean; lastCheckedAt: number };
  runtime: { reachable: boolean; lastCheckedAt: number };
};

/** D-OFFLINE-002: Persistent outbox entry with enqueued_at timestamp */
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
  | 'friend-add'
  | 'friend-remove'
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

/** D-OFFLINE-002: Maximum outbox size */
export const OUTBOX_MAX_ENTRIES = 1000;

/** D-OFFLINE-004: Reconnect backoff initial delay */
export const RECONNECT_INITIAL_DELAY_MS = 1000;

/** D-OFFLINE-004: Reconnect backoff max delay */
export const RECONNECT_MAX_DELAY_MS = 30_000;

/** D-OFFLINE-005: Cache limits */
export const CACHE_MAX_CHATS = 20;
export const CACHE_MAX_MESSAGES_PER_CHAT = 50;
