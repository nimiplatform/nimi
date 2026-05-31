import { getPlatformClient, type RealmModel } from '@nimiplatform/kit/core/sdk-contract';
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
export type RealmCurrencyBalancesResponse = RealmModel<'CurrencyBalancesDto'>;
export type RealmCurrencyTransactionHistoryResponse = RealmModel<'CurrencyTransactionHistoryDto'>;
export type RealmSubscriptionResponse = RealmModel<'SubscriptionDto'>;
export type RealmSparkPackage = RealmModel<'SparkPackageDto'>;
export type RealmCreateSparkCheckoutInput = RealmModel<'CreateSparkCheckoutDto'>;
export type RealmSparkCheckoutSession = RealmModel<'SparkCheckoutSessionDto'>;
export type RealmWithdrawalEligibilityResponse = RealmModel<'CanWithdrawDto'>;
export type RealmWithdrawalHistoryResponse = RealmModel<'WithdrawalHistoryDto'>;
export type RealmCreateWithdrawalInput = RealmModel<'CreateWithdrawalDto'>;
export type RealmWithdrawalResponse = RealmModel<'WithdrawalDto'>;
export type RealmCreateGiftReviewInput = RealmModel<'CreateReviewDto'>;

export type CommerceCurrencyBalances = {
  sparkBalance: number;
  gemBalance: number;
};

export type RealmCommerceGiftService = {
  getBalances: () => Promise<RealmCurrencyBalancesResponse>;
  listSparkTransactionHistory: (limit?: number, cursor?: string) => Promise<RealmCurrencyTransactionHistoryResponse>;
  listGemTransactionHistory: (limit?: number, cursor?: string) => Promise<RealmCurrencyTransactionHistoryResponse>;
  getSubscriptionStatus: () => Promise<RealmSubscriptionResponse>;
  listSparkPackages: () => Promise<RealmSparkPackage[]>;
  createSparkCheckout: (input: RealmCreateSparkCheckoutInput) => Promise<RealmSparkCheckoutSession>;
  getWithdrawalEligibility: () => Promise<RealmWithdrawalEligibilityResponse>;
  listWithdrawalHistory: (limit?: number, cursor?: string) => Promise<RealmWithdrawalHistoryResponse>;
  createWithdrawal: (input: RealmCreateWithdrawalInput) => Promise<RealmWithdrawalResponse>;
  listGiftCatalog: () => Promise<RealmGiftCatalogResponse>;
  sendGift: (input: RealmSendGiftInput) => Promise<void>;
  listReceivedGifts: (limit?: number, cursor?: string) => Promise<RealmReceivedGiftsResponse>;
  listSentGifts: (limit?: number, cursor?: string) => Promise<RealmReceivedGiftsResponse>;
  acceptGift: (giftTransactionId: string) => Promise<void>;
  rejectGift: (giftTransactionId: string, input: RealmRejectGiftInput) => Promise<void>;
  createGiftReview: (input: RealmCreateGiftReviewInput) => Promise<void>;
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

function asCurrencyAmount(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : 0;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }
  return 0;
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

export function normalizeRealmCurrencyBalances(
  value: RealmCurrencyBalancesResponse,
): CommerceCurrencyBalances {
  const record = asRecord(value);
  return {
    sparkBalance: asCurrencyAmount(record?.sparkBalance),
    gemBalance: asCurrencyAmount(record?.gemBalance),
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
  async getBalances() {
    return realm().services.EconomyCurrencyGiftsService.economyControllerGetBalances();
  },
  async listSparkTransactionHistory(limit = 30, cursor) {
    return realm().services.EconomyCurrencyGiftsService.economyControllerGetSparkHistory(limit, cursor);
  },
  async listGemTransactionHistory(limit = 30, cursor) {
    return realm().services.EconomyCurrencyGiftsService.economyControllerGetGemHistory(limit, cursor);
  },
  async getSubscriptionStatus() {
    return realm().services.EconomyCurrencyGiftsService.economyControllerGetSubscription();
  },
  async listSparkPackages() {
    return realm().services.EconomyCurrencyGiftsService.economyControllerGetSparkPackages();
  },
  async createSparkCheckout(input) {
    return realm().services.EconomyCurrencyGiftsService.economyControllerCreateSparkCheckout(input);
  },
  async getWithdrawalEligibility() {
    return realm().services.EconomyCurrencyGiftsService.economyControllerCanWithdraw();
  },
  async listWithdrawalHistory(limit = 20, cursor) {
    return realm().services.EconomyCurrencyGiftsService.economyControllerGetWithdrawalHistory(limit, cursor);
  },
  async createWithdrawal(input) {
    return realm().services.EconomyCurrencyGiftsService.economyControllerCreateWithdrawal(input);
  },
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
  async createGiftReview(input) {
    await realm().services.ReviewsEconomyTrustService.reviewControllerCreateReview(input);
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

export async function loadRealmCurrencyBalances(
  service: Pick<RealmCommerceGiftService, 'getBalances'> = realmCommerceGiftService,
): Promise<CommerceCurrencyBalances> {
  return normalizeRealmCurrencyBalances(await service.getBalances());
}

export async function loadRealmSparkTransactionHistory(
  limit = 30,
  cursor?: string,
  service: Pick<RealmCommerceGiftService, 'listSparkTransactionHistory'> = realmCommerceGiftService,
): Promise<RealmCurrencyTransactionHistoryResponse> {
  return service.listSparkTransactionHistory(limit, cursor);
}

export async function loadRealmGemTransactionHistory(
  limit = 30,
  cursor?: string,
  service: Pick<RealmCommerceGiftService, 'listGemTransactionHistory'> = realmCommerceGiftService,
): Promise<RealmCurrencyTransactionHistoryResponse> {
  return service.listGemTransactionHistory(limit, cursor);
}

export async function loadRealmSubscriptionStatus(
  service: Pick<RealmCommerceGiftService, 'getSubscriptionStatus'> = realmCommerceGiftService,
): Promise<RealmSubscriptionResponse> {
  return service.getSubscriptionStatus();
}

export async function loadRealmSparkPackages(
  service: Pick<RealmCommerceGiftService, 'listSparkPackages'> = realmCommerceGiftService,
): Promise<RealmSparkPackage[]> {
  return service.listSparkPackages();
}

export async function createRealmSparkCheckout(
  input: RealmCreateSparkCheckoutInput,
  service: Pick<RealmCommerceGiftService, 'createSparkCheckout'> = realmCommerceGiftService,
): Promise<RealmSparkCheckoutSession> {
  return service.createSparkCheckout(input);
}

export async function loadRealmWithdrawalEligibility(
  service: Pick<RealmCommerceGiftService, 'getWithdrawalEligibility'> = realmCommerceGiftService,
): Promise<RealmWithdrawalEligibilityResponse> {
  return service.getWithdrawalEligibility();
}

export async function loadRealmWithdrawalHistory(
  limit = 20,
  cursor?: string,
  service: Pick<RealmCommerceGiftService, 'listWithdrawalHistory'> = realmCommerceGiftService,
): Promise<RealmWithdrawalHistoryResponse> {
  return service.listWithdrawalHistory(limit, cursor);
}

export async function createRealmWithdrawal(
  input: RealmCreateWithdrawalInput,
  service: Pick<RealmCommerceGiftService, 'createWithdrawal'> = realmCommerceGiftService,
): Promise<RealmWithdrawalResponse> {
  return service.createWithdrawal(input);
}

export async function acceptRealmGift(
  giftTransactionId: string,
  service: Pick<RealmCommerceGiftService, 'acceptGift'> = realmCommerceGiftService,
): Promise<void> {
  const normalizedId = giftTransactionId.trim();
  if (!normalizedId) {
    throw new Error('Gift transaction id is required');
  }
  await service.acceptGift(normalizedId);
}

export async function rejectRealmGift(
  giftTransactionId: string,
  input: RealmRejectGiftInput,
  service: Pick<RealmCommerceGiftService, 'rejectGift'> = realmCommerceGiftService,
): Promise<void> {
  const normalizedId = giftTransactionId.trim();
  if (!normalizedId) {
    throw new Error('Gift transaction id is required');
  }
  await service.rejectGift(normalizedId, input);
}

export async function createRealmGiftReview(
  input: RealmCreateGiftReviewInput,
  service: Pick<RealmCommerceGiftService, 'createGiftReview'> = realmCommerceGiftService,
): Promise<void> {
  await service.createGiftReview(input);
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
