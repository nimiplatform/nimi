import type { RealmModel, RealmTypedClient } from '@nimiplatform/kit/core/sdk-contract';
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

export type RealmGiftCatalogResponse = readonly RealmModel<'GiftCatalogItemDto'>[];
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
  listSparkPackages: () => Promise<readonly RealmSparkPackage[]>;
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

export type RealmCommerceGiftClient = Pick<
  RealmTypedClient,
  | 'economyControllerAcceptGift'
  | 'economyControllerCanWithdraw'
  | 'economyControllerCreateSparkCheckout'
  | 'economyControllerCreateWithdrawal'
  | 'economyControllerGetBalances'
  | 'economyControllerGetGemHistory'
  | 'economyControllerGetGiftCatalog'
  | 'economyControllerGetReceivedGifts'
  | 'economyControllerGetSentGifts'
  | 'economyControllerGetSparkHistory'
  | 'economyControllerGetSparkPackages'
  | 'economyControllerGetSubscription'
  | 'economyControllerGetWithdrawalHistory'
  | 'economyControllerRejectGift'
  | 'economyControllerSendGift'
  | 'reviewControllerCreateReview'
>;

export type RealmCommerceGiftClientInput =
  | RealmCommerceGiftClient
  | { readonly generated: RealmCommerceGiftClient };

export type RealmCommerceGiftAdapterOptions = {
  readonly service: RealmCommerceGiftService;
};

export type UseRealmSendGiftDialogOptions = Omit<UseSendGiftDialogOptions, 'adapter'> & {
  readonly service: RealmCommerceGiftService;
};

export type UseRealmGiftInboxOptions = Omit<UseGiftInboxOptions, 'adapter'> & {
  readonly service: RealmCommerceGiftService;
};

type ServiceOption<TService> = {
  readonly service: TService;
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

function resolveRealmCommerceGiftClient(input: RealmCommerceGiftClientInput): RealmCommerceGiftClient {
  return 'generated' in input ? input.generated : input;
}

function emptyRealmRequest() {
  return { path: {} };
}

function paginationRealmRequest(limit: number, cursor?: string) {
  const normalizedCursor = asString(cursor);
  return {
    path: {},
    query: {
      limit,
      ...(normalizedCursor ? { cursor: normalizedCursor } : {}),
    },
  };
}

export function createRealmCommerceGiftService(
  input: RealmCommerceGiftClientInput,
): RealmCommerceGiftService {
  const client = resolveRealmCommerceGiftClient(input);
  return {
    async getBalances() {
      return client.economyControllerGetBalances(emptyRealmRequest());
    },
    async listSparkTransactionHistory(limit = 30, cursor) {
      return client.economyControllerGetSparkHistory(paginationRealmRequest(limit, cursor));
    },
    async listGemTransactionHistory(limit = 30, cursor) {
      return client.economyControllerGetGemHistory(paginationRealmRequest(limit, cursor));
    },
    async getSubscriptionStatus() {
      return client.economyControllerGetSubscription(emptyRealmRequest());
    },
    async listSparkPackages() {
      return client.economyControllerGetSparkPackages(emptyRealmRequest());
    },
    async createSparkCheckout(body) {
      return client.economyControllerCreateSparkCheckout({ path: {}, body });
    },
    async getWithdrawalEligibility() {
      return client.economyControllerCanWithdraw(emptyRealmRequest());
    },
    async listWithdrawalHistory(limit = 20, cursor) {
      return client.economyControllerGetWithdrawalHistory(paginationRealmRequest(limit, cursor));
    },
    async createWithdrawal(body) {
      return client.economyControllerCreateWithdrawal({ path: {}, body });
    },
    async listGiftCatalog() {
      return client.economyControllerGetGiftCatalog(emptyRealmRequest());
    },
    async sendGift(body) {
      await client.economyControllerSendGift({ path: {}, body });
    },
    async listReceivedGifts(limit = 20, cursor) {
      return client.economyControllerGetReceivedGifts(paginationRealmRequest(limit, cursor));
    },
    async listSentGifts(limit = 20, cursor) {
      return client.economyControllerGetSentGifts(paginationRealmRequest(limit, cursor));
    },
    async acceptGift(giftTransactionId) {
      await client.economyControllerAcceptGift({ path: { id: giftTransactionId.trim() } });
    },
    async rejectGift(giftTransactionId, body) {
      await client.economyControllerRejectGift({ path: { giftId: giftTransactionId.trim() }, body });
    },
    async createGiftReview(body) {
      await client.reviewControllerCreateReview({ path: {}, body });
    },
  };
}

export function createRealmCommerceGiftAdapter({
  service,
}: RealmCommerceGiftAdapterOptions): CommerceGiftAdapter {
  return {
    listGiftCatalog: async () => normalizeCommerceGiftCatalog(await service.listGiftCatalog()),
    sendGift: async (input) => {
      await service.sendGift(input);
    },
  };
}

export async function loadRealmCurrencyBalances(
  { service }: ServiceOption<Pick<RealmCommerceGiftService, 'getBalances'>>,
): Promise<CommerceCurrencyBalances> {
  return normalizeRealmCurrencyBalances(await service.getBalances());
}

export async function loadRealmSparkTransactionHistory(
  {
    service,
    limit = 30,
    cursor,
  }: ServiceOption<Pick<RealmCommerceGiftService, 'listSparkTransactionHistory'>> & {
    readonly limit?: number;
    readonly cursor?: string;
  },
): Promise<RealmCurrencyTransactionHistoryResponse> {
  return service.listSparkTransactionHistory(limit, cursor);
}

export async function loadRealmGemTransactionHistory(
  {
    service,
    limit = 30,
    cursor,
  }: ServiceOption<Pick<RealmCommerceGiftService, 'listGemTransactionHistory'>> & {
    readonly limit?: number;
    readonly cursor?: string;
  },
): Promise<RealmCurrencyTransactionHistoryResponse> {
  return service.listGemTransactionHistory(limit, cursor);
}

export async function loadRealmSubscriptionStatus(
  { service }: ServiceOption<Pick<RealmCommerceGiftService, 'getSubscriptionStatus'>>,
): Promise<RealmSubscriptionResponse> {
  return service.getSubscriptionStatus();
}

export async function loadRealmSparkPackages(
  { service }: ServiceOption<Pick<RealmCommerceGiftService, 'listSparkPackages'>>,
): Promise<readonly RealmSparkPackage[]> {
  return service.listSparkPackages();
}

export async function createRealmSparkCheckout(
  {
    service,
    input,
  }: ServiceOption<Pick<RealmCommerceGiftService, 'createSparkCheckout'>> & {
    readonly input: RealmCreateSparkCheckoutInput;
  },
): Promise<RealmSparkCheckoutSession> {
  return service.createSparkCheckout(input);
}

export async function loadRealmWithdrawalEligibility(
  { service }: ServiceOption<Pick<RealmCommerceGiftService, 'getWithdrawalEligibility'>>,
): Promise<RealmWithdrawalEligibilityResponse> {
  return service.getWithdrawalEligibility();
}

export async function loadRealmWithdrawalHistory(
  {
    service,
    limit = 20,
    cursor,
  }: ServiceOption<Pick<RealmCommerceGiftService, 'listWithdrawalHistory'>> & {
    readonly limit?: number;
    readonly cursor?: string;
  },
): Promise<RealmWithdrawalHistoryResponse> {
  return service.listWithdrawalHistory(limit, cursor);
}

export async function createRealmWithdrawal(
  {
    service,
    input,
  }: ServiceOption<Pick<RealmCommerceGiftService, 'createWithdrawal'>> & {
    readonly input: RealmCreateWithdrawalInput;
  },
): Promise<RealmWithdrawalResponse> {
  return service.createWithdrawal(input);
}

export async function acceptRealmGift(
  {
    service,
    giftTransactionId,
  }: ServiceOption<Pick<RealmCommerceGiftService, 'acceptGift'>> & {
    readonly giftTransactionId: string;
  },
): Promise<void> {
  const normalizedId = giftTransactionId.trim();
  if (!normalizedId) {
    throw new Error('Gift transaction id is required');
  }
  await service.acceptGift(normalizedId);
}

export async function rejectRealmGift(
  {
    service,
    giftTransactionId,
    input,
  }: ServiceOption<Pick<RealmCommerceGiftService, 'rejectGift'>> & {
    readonly giftTransactionId: string;
    readonly input: RealmRejectGiftInput;
  },
): Promise<void> {
  const normalizedId = giftTransactionId.trim();
  if (!normalizedId) {
    throw new Error('Gift transaction id is required');
  }
  await service.rejectGift(normalizedId, input);
}

export async function createRealmGiftReview(
  {
    service,
    input,
  }: ServiceOption<Pick<RealmCommerceGiftService, 'createGiftReview'>> & {
    readonly input: RealmCreateGiftReviewInput;
  },
): Promise<void> {
  await service.createGiftReview(input);
}

export async function loadRealmGiftTransaction(
  {
    service,
    giftTransactionId,
  }: ServiceOption<RealmCommerceGiftService> & {
    readonly giftTransactionId: string;
  },
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
  service,
}: RealmCommerceGiftAdapterOptions): CommerceGiftInboxAdapter {
  return {
    listReceivedGifts: async (limit = 50) =>
      normalizeRealmReceivedGiftsResponse(await service.listReceivedGifts(limit)),
    getGiftTransaction: async (giftTransactionId) =>
      loadRealmGiftTransaction({ service, giftTransactionId }),
    acceptGift: async (giftTransactionId) => {
      await service.acceptGift(giftTransactionId);
    },
    rejectGift: async (giftTransactionId, input) => {
      await service.rejectGift(giftTransactionId, input);
    },
  };
}

export function useRealmSendGiftDialog({
  service,
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
  service,
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
