import { getPlatformClient } from '@nimiplatform/sdk';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import { useMemo } from 'react';
import {
  normalizeCommerceGiftCatalog,
  useSendGiftDialog,
  type UseSendGiftDialogOptions,
  type UseSendGiftDialogResult,
  useGiftInbox,
  type UseGiftInboxOptions,
  type UseGiftInboxResult,
} from './headless.js';
import type {
  CommerceGiftAdapter,
  CommerceGiftInboxAdapter,
  CommerceGiftParty,
  CommerceGiftStatus,
  CommerceGiftSummary,
  CommerceGiftTransaction,
} from './types.js';

function realm() {
  return getPlatformClient().realm;
}

export type RealmGiftCatalogResponse = RealmModel<'GiftCatalogItemDto'>[];
export type RealmSendGiftInput = RealmModel<'SendGiftDto'>;
export type RealmReceivedGiftsResponse = RealmModel<'ReceivedGiftsResponseDto'>;
export type RealmRejectGiftInput = RealmModel<'RejectGiftDto'>;

export type RealmCommerceGiftService = {
  listGiftCatalog: () => Promise<RealmGiftCatalogResponse>;
  sendGift: (input: RealmSendGiftInput) => Promise<void>;
  listReceivedGifts: (limit?: number, cursor?: string) => Promise<RealmReceivedGiftsResponse>;
  listSentGifts: (limit?: number, cursor?: string) => Promise<RealmReceivedGiftsResponse>;
  acceptGift: (giftTransactionId: string) => Promise<void>;
  rejectGift: (giftTransactionId: string, input: RealmRejectGiftInput) => Promise<void>;
};

export type RealmCommerceGiftAdapterOptions = {
  service?: RealmCommerceGiftService;
};

export type UseRealmSendGiftDialogOptions = Omit<UseSendGiftDialogOptions, 'adapter'> & {
  service?: RealmCommerceGiftService;
};

export type UseRealmGiftInboxOptions = Omit<UseGiftInboxOptions, 'adapter'> & {
  service?: RealmCommerceGiftService;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function normalizeGiftStatus(value: unknown): CommerceGiftStatus {
  switch (value) {
    case 'ACCEPTED':
    case 'REJECTED':
    case 'EXPIRED':
    case 'REFUNDED':
      return value;
    default:
      return 'PENDING';
  }
}

function normalizeGiftParty(value: unknown, fallbackId?: string | null): CommerceGiftParty | null {
  const record = asRecord(value);
  const id = asString(record?.id) || asString(fallbackId);
  const displayName = asString(record?.displayName);
  const handle = asString(record?.handle);
  const avatarUrl = asString(record?.avatarUrl);
  const isAgent = record?.isAgent === true;
  if (!id && !displayName && !handle && !avatarUrl && !isAgent) {
    return null;
  }
  return {
    id: id || undefined,
    displayName,
    handle,
    avatarUrl,
    isAgent,
  };
}

export function normalizeRealmGiftSummary(value: unknown): CommerceGiftSummary | null {
  const record = asRecord(value);
  const id = asString(record?.id);
  if (!id) {
    return null;
  }
  const gift = asRecord(record?.gift);
  return {
    id,
    sparkCost: asNumber(record?.sparkCost),
    gemToReceiver: asNumber(record?.gemToReceiver),
    status: normalizeGiftStatus(record?.status),
    createdAt: asString(record?.createdAt),
    message: asString(record?.message),
    gift: gift ? {
      name: asString(gift.name),
      emoji: asString(gift.emoji),
    } : null,
    sender: normalizeGiftParty(record?.sender, asString(record?.senderId)),
    receiver: normalizeGiftParty(record?.receiver, asString(record?.receiverId)),
  };
}

export function normalizeRealmGiftTransaction(value: unknown): CommerceGiftTransaction | null {
  const summary = normalizeRealmGiftSummary(value);
  if (!summary) {
    return null;
  }
  const record = asRecord(value);
  return {
    ...summary,
    expiresAt: asString(record?.expiresAt),
    acceptedAt: asString(record?.acceptedAt),
    rejectedAt: asString(record?.rejectedAt),
    rejectReason: asString(record?.rejectReason),
  };
}

export function normalizeRealmReceivedGiftsResponse(
  value: RealmReceivedGiftsResponse,
): CommerceGiftSummary[] {
  const record = asRecord(value);
  const items = Array.isArray(record?.items) ? record.items : [];
  return items
    .map((item) => normalizeRealmGiftSummary(item))
    .filter((item): item is CommerceGiftSummary => item !== null);
}

function requireGiftPage(value: unknown): { items: unknown[]; nextCursor: string } {
  const record = asRecord(value);
  if (!Array.isArray(record?.items)) {
    throw new Error('GIFT_TRANSACTION_CONTRACT_INVALID');
  }
  return {
    items: record.items,
    nextCursor: asString(record.nextCursor) || '',
  };
}

async function findGiftTransactionInFeed(
  fetchPage: (limit: number, cursor?: string) => Promise<RealmReceivedGiftsResponse>,
  giftTransactionId: string,
): Promise<CommerceGiftTransaction | null> {
  const visitedCursors = new Set<string>();
  let cursor: string | undefined;

  while (true) {
    const payload = await fetchPage(50, cursor);
    const page = requireGiftPage(payload);
    const match = page.items.find((item) => {
      const record = asRecord(item);
      return asString(record?.id) === giftTransactionId;
    });
    if (match) {
      return normalizeRealmGiftTransaction(match);
    }
    const nextCursor = page.nextCursor.trim();
    if (!nextCursor || visitedCursors.has(nextCursor)) {
      return null;
    }
    visitedCursors.add(nextCursor);
    cursor = nextCursor;
  }
}

export const realmCommerceGiftService: RealmCommerceGiftService = {
  async listGiftCatalog() {
    return realm().services.EconomyCurrencyGiftsService.economyControllerGetGiftCatalog();
  },
  async sendGift(input) {
    await realm().services.EconomyCurrencyGiftsService.economyControllerSendGift(input);
  },
  async listReceivedGifts(limit = 20, cursor) {
    return realm().services.EconomyCurrencyGiftsService.economyControllerGetReceivedGifts(limit, cursor);
  },
  async listSentGifts(limit = 20, cursor) {
    return realm().services.EconomyCurrencyGiftsService.economyControllerGetSentGifts(limit, cursor);
  },
  async acceptGift(giftTransactionId) {
    await realm().services.EconomyCurrencyGiftsService.economyControllerAcceptGift(giftTransactionId.trim());
  },
  async rejectGift(giftTransactionId, input) {
    await realm().services.EconomyCurrencyGiftsService.economyControllerRejectGift(giftTransactionId.trim(), input);
  },
};

export function createRealmCommerceGiftAdapter({
  service = realmCommerceGiftService,
}: RealmCommerceGiftAdapterOptions = {}): CommerceGiftAdapter {
  return {
    listGiftCatalog: async () => normalizeCommerceGiftCatalog(await service.listGiftCatalog()),
    sendGift: async (input) => {
      await service.sendGift(input);
    },
  };
}

export async function loadRealmGiftTransaction(
  giftTransactionId: string,
  service: RealmCommerceGiftService = realmCommerceGiftService,
): Promise<CommerceGiftTransaction> {
  const normalizedId = giftTransactionId.trim();
  if (!normalizedId) {
    throw new Error('Gift transaction id is required');
  }

  const receivedGift = await findGiftTransactionInFeed(
    (limit, cursor) => service.listReceivedGifts(limit, cursor),
    normalizedId,
  );
  if (receivedGift) {
    return receivedGift;
  }

  const sentGift = await findGiftTransactionInFeed(
    (limit, cursor) => service.listSentGifts(limit, cursor),
    normalizedId,
  );
  if (sentGift) {
    return sentGift;
  }

  throw new Error('GIFT_TRANSACTION_NOT_FOUND');
}

export function createRealmCommerceGiftInboxAdapter({
  service = realmCommerceGiftService,
}: RealmCommerceGiftAdapterOptions = {}): CommerceGiftInboxAdapter {
  return {
    listReceivedGifts: async (limit = 50) =>
      normalizeRealmReceivedGiftsResponse(await service.listReceivedGifts(limit)),
    getGiftTransaction: async (giftTransactionId) =>
      loadRealmGiftTransaction(giftTransactionId, service),
    acceptGift: async (giftTransactionId) => {
      await service.acceptGift(giftTransactionId);
    },
    rejectGift: async (giftTransactionId, input) => {
      await service.rejectGift(giftTransactionId, input);
    },
  };
}

export function useRealmSendGiftDialog({
  service = realmCommerceGiftService,
  open,
  receiverId,
  onSent,
}: UseRealmSendGiftDialogOptions): UseSendGiftDialogResult {
  const adapter = useMemo(
    () => createRealmCommerceGiftAdapter({ service }),
    [service],
  );
  return useSendGiftDialog({
    open,
    receiverId,
    adapter,
    onSent,
  });
}

export function useRealmGiftInbox({
  service = realmCommerceGiftService,
  enabled,
  currentUserId,
  selectedGiftTransactionId,
  limit,
  onActionSuccess,
  onError,
}: UseRealmGiftInboxOptions): UseGiftInboxResult {
  const adapter = useMemo(
    () => createRealmCommerceGiftInboxAdapter({ service }),
    [service],
  );
  return useGiftInbox({
    enabled,
    currentUserId,
    selectedGiftTransactionId,
    adapter,
    limit,
    onActionSuccess,
    onError,
  });
}
