import type { NimiRealmTransferredFile } from '@nimiplatform/sdk/realm';
import type { JsonObject } from '@nimiplatform/sdk/types';

/** Storage identity, never an authorization credential. */
export type OfflineAccountScope = {
  readonly realmEnvironmentId: string;
  readonly accountId: string;
};

export type OfflineAccessScope = OfflineAccountScope & { readonly generation: number };

export function offlineScopeKey(scope: OfflineAccountScope): string {
  if (!scope.realmEnvironmentId?.trim() || !scope.accountId?.trim()) {
    throw new Error('OFFLINE_ACCOUNT_SCOPE_REQUIRED');
  }
  return JSON.stringify([scope.realmEnvironmentId, scope.accountId]);
}

export type HumanChatDraft = {
  peerAccountId: string;
  text: string;
  attachmentNames: string[];
};

export type PersistentOutboxEntry = {
  clientMessageId: string;
  chatId: string;
  body: JsonObject;
  enqueuedAt: number;
  attempts: number;
  status: 'pending' | 'failed';
  /** Enables recovery by person without inventing a Chat identity. */
  peerAccountId?: string;
  failReason?: string;
  transferredFile?: NimiRealmTransferredFile;
};

export const OFFLINE_OUTBOX_MAX_ENTRIES = 1000;
export const OFFLINE_CACHE_MAX_CHATS = 20;
export const OFFLINE_CACHE_MAX_MESSAGES_PER_CHAT = 50;
