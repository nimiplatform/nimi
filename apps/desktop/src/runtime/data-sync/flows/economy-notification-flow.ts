import { ReasonCode } from '@nimiplatform/sdk/types';
import type { Realm } from '@nimiplatform/sdk/realm';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import { createOfflineError, getOfflineCoordinator } from '@runtime/offline';

type CreateReviewDto = RealmModel<'CreateReviewDto'>;
type CreateSparkCheckoutDto = RealmModel<'CreateSparkCheckoutDto'>;
type CreateWithdrawalDto = RealmModel<'CreateWithdrawalDto'>;
type GiftTransactionRichDto = RealmModel<'GiftTransactionRichDto'>;
type RejectGiftDto = RealmModel<'RejectGiftDto'>;
type ReceivedGiftsResponseDto = RealmModel<'ReceivedGiftsResponseDto'>;
type SendGiftDto = RealmModel<'SendGiftDto'>;
type SparkCheckoutSessionDto = RealmModel<'SparkCheckoutSessionDto'>;
type SparkPackageDto = RealmModel<'SparkPackageDto'>;
type GiftListFetcher = (realm: Realm, limit: number, cursor?: string) => Promise<ReceivedGiftsResponseDto>;

type DataSyncApiCaller = <T>(task: (realm: Realm) => Promise<T>, fallbackMessage?: string) => Promise<T>;
type DataSyncErrorEmitter = (
  action: string,
  error: unknown,
  details?: Record<string, unknown>,
) => void;

function requireRecord<T extends Record<string, unknown>>(value: unknown, errorCode: string): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(errorCode);
  }
  return value as T;
}

function requireGiftPage(value: unknown): ReceivedGiftsResponseDto {
  const record = requireRecord<ReceivedGiftsResponseDto>(value, 'GIFT_TRANSACTION_CONTRACT_INVALID');
  if (!Array.isArray(record.items)) {
    throw new Error('GIFT_TRANSACTION_CONTRACT_INVALID');
  }
  return record;
}

async function findGiftTransactionInFeed(
  callApi: DataSyncApiCaller,
  fetchPage: GiftListFetcher,
  id: string,
): Promise<GiftTransactionRichDto | null> {
  const visitedCursors = new Set<string>();
  let cursor: string | undefined;

  while (true) {
    const payload = await callApi(
      (realm) => fetchPage(realm, 50, cursor),
      '加载礼物详情失败',
    );
    const page = requireGiftPage(payload);
    const match = page.items.find((item) => item?.id === id);
    if (match) {
      return requireRecord<GiftTransactionRichDto>(match, 'GIFT_TRANSACTION_CONTRACT_INVALID');
    }

    const nextCursor = typeof page.nextCursor === 'string' && page.nextCursor.trim()
      ? page.nextCursor.trim()
      : '';
    if (!nextCursor || visitedCursors.has(nextCursor)) {
      return null;
    }
    visitedCursors.add(nextCursor);
    cursor = nextCursor;
  }
}

function assertEconomyWriteOnline(action: string): void {
  if (getOfflineCoordinator().getTier() === 'L0') {
    return;
  }
  throw createOfflineError({
    source: 'realm',
    reasonCode: ReasonCode.REALM_UNAVAILABLE,
    message: `${action}需要在线连接后才能继续`,
    actionHint: 'retry-when-online',
  });
}

export async function loadCurrencyBalances(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
) {
  try {
    return await callApi(
      (realm) => realm.services.EconomyCurrencyGiftsService.economyControllerGetBalances(),
      '加载 Spark / Gem 余额失败',
    );
  } catch (error) {
    emitDataSyncError('load-currency-balances', error);
    throw error;
  }
}

export async function loadSparkTransactionHistory(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  limit = 30,
  cursor?: string,
) {
  try {
    return await callApi(
      (realm) => realm.services.EconomyCurrencyGiftsService.economyControllerGetSparkHistory(limit, cursor),
      '加载 Spark 流水失败',
    );
  } catch (error) {
    emitDataSyncError('load-spark-transaction-history', error, { limit, cursor: cursor || null });
    throw error;
  }
}

export async function loadGemTransactionHistory(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  limit = 30,
  cursor?: string,
) {
  try {
    return await callApi(
      (realm) => realm.services.EconomyCurrencyGiftsService.economyControllerGetGemHistory(limit, cursor),
      '加载 Gem 流水失败',
    );
  } catch (error) {
    emitDataSyncError('load-gem-transaction-history', error, { limit, cursor: cursor || null });
    throw error;
  }
}

export async function loadSubscriptionStatus(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
) {
  try {
    return await callApi(
      (realm) => realm.services.EconomyCurrencyGiftsService.economyControllerGetSubscription(),
      '加载订阅状态失败',
    );
  } catch (error) {
    emitDataSyncError('load-subscription-status', error);
    throw error;
  }
}

export async function loadSparkPackages(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
): Promise<SparkPackageDto[]> {
  try {
    return await callApi(
      (realm) => realm.services.EconomyCurrencyGiftsService.economyControllerGetSparkPackages(),
      '加载 Spark 充值套餐失败',
    ) as SparkPackageDto[];
  } catch (error) {
    emitDataSyncError('load-spark-packages', error);
    throw error;
  }
}

export async function createSparkCheckout(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  input: CreateSparkCheckoutDto,
): Promise<SparkCheckoutSessionDto> {
  try {
    assertEconomyWriteOnline('创建 Spark 充值');
    return await callApi(
      (realm) => realm.services.EconomyCurrencyGiftsService.economyControllerCreateSparkCheckout(input),
      '创建 Spark 充值会话失败',
    ) as SparkCheckoutSessionDto;
  } catch (error) {
    emitDataSyncError('create-spark-checkout', error, {
      packageId: input?.packageId || null,
    });
    throw error;
  }
}

export async function loadWithdrawalEligibility(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
) {
  try {
    return await callApi(
      (realm) => realm.services.EconomyCurrencyGiftsService.economyControllerCanWithdraw(),
      '加载提现资格失败',
    );
  } catch (error) {
    emitDataSyncError('load-withdrawal-eligibility', error);
    throw error;
  }
}

export async function loadWithdrawalHistory(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  limit = 20,
  cursor?: string,
) {
  try {
    return await callApi(
      (realm) => realm.services.EconomyCurrencyGiftsService.economyControllerGetWithdrawalHistory(limit, cursor),
      '加载提现记录失败',
    );
  } catch (error) {
    emitDataSyncError('load-withdrawal-history', error, { limit, cursor: cursor || null });
    throw error;
  }
}

export async function createWithdrawal(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  input: CreateWithdrawalDto,
) {
  try {
    assertEconomyWriteOnline('创建提现申请');
    return await callApi(
      (realm) => realm.services.EconomyCurrencyGiftsService.economyControllerCreateWithdrawal(input),
      '创建提现申请失败',
    );
  } catch (error) {
    emitDataSyncError('create-withdrawal', error, {
      gemAmount: input?.gemAmount || null,
    });
    throw error;
  }
}

export async function loadGiftCatalog(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
) {
  try {
    return await callApi(
      (realm) => realm.services.EconomyCurrencyGiftsService.economyControllerGetGiftCatalog(),
      '加载礼物目录失败',
    );
  } catch (error) {
    emitDataSyncError('load-gift-catalog', error);
    throw error;
  }
}

export async function sendGift(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  input: SendGiftDto,
) {
  try {
    assertEconomyWriteOnline('发送礼物');
    return await callApi(
      (realm) => realm.services.EconomyCurrencyGiftsService.economyControllerSendGift(input),
      '发送礼物失败',
    );
  } catch (error) {
    emitDataSyncError('send-gift', error, {
      receiverId: input?.receiverId || null,
      giftId: input?.giftId || null,
    });
    throw error;
  }
}

export async function acceptGift(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  giftTransactionId: string,
) {
  const normalizedId = String(giftTransactionId || '').trim();
  if (!normalizedId) {
    throw new Error('礼物交易 ID 不能为空');
  }
  try {
    assertEconomyWriteOnline('接受礼物');
    return await callApi(
      (realm) => realm.services.EconomyCurrencyGiftsService.economyControllerAcceptGift(normalizedId),
      '接受礼物失败',
    );
  } catch (error) {
    emitDataSyncError('accept-gift', error, { giftTransactionId: normalizedId });
    throw error;
  }
}

export async function rejectGift(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  giftTransactionId: string,
  input: RejectGiftDto,
) {
  const normalizedId = String(giftTransactionId || '').trim();
  if (!normalizedId) {
    throw new Error('礼物交易 ID 不能为空');
  }
  try {
    return await callApi(
      (realm) => realm.services.EconomyCurrencyGiftsService.economyControllerRejectGift(normalizedId, input),
      '拒收礼物失败',
    );
  } catch (error) {
    emitDataSyncError('reject-gift', error, {
      giftTransactionId: normalizedId,
      reason: input?.reason || null,
    });
    throw error;
  }
}

export async function loadGiftTransaction(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  id: string,
): Promise<GiftTransactionRichDto> {
  const normalizedId = String(id || '').trim();
  if (!normalizedId) {
    throw new Error('礼物交易 ID 不能为空');
  }
  try {
    const receivedGift = await findGiftTransactionInFeed(
      callApi,
      (realm, limit, cursor) => realm.services.EconomyCurrencyGiftsService.economyControllerGetReceivedGifts(limit, cursor),
      normalizedId,
    );
    if (receivedGift) {
      return receivedGift;
    }

    const sentGift = await findGiftTransactionInFeed(
      callApi,
      (realm, limit, cursor) => realm.services.EconomyCurrencyGiftsService.economyControllerGetSentGifts(limit, cursor),
      normalizedId,
    );
    if (sentGift) {
      return sentGift;
    }

    throw new Error('GIFT_TRANSACTION_NOT_FOUND');
  } catch (error) {
    emitDataSyncError('load-gift-transaction', error, { id: normalizedId });
    throw error;
  }
}

export async function loadReceivedGifts(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  limit = 20,
  cursor?: string,
): Promise<ReceivedGiftsResponseDto> {
  try {
    return await callApi(
      (realm) => realm.services.EconomyCurrencyGiftsService.economyControllerGetReceivedGifts(limit, cursor),
      '加载已收礼物失败',
    ) as ReceivedGiftsResponseDto;
  } catch (error) {
    emitDataSyncError('load-received-gifts', error, {
      limit,
      cursor: cursor || null,
    });
    throw error;
  }
}

export async function createGiftReview(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  input: CreateReviewDto,
) {
  try {
    return await callApi(
      (realm) => realm.services.ReviewsEconomyTrustService.reviewControllerCreateReview(input),
      '提交评价失败',
    );
  } catch (error) {
    emitDataSyncError('create-gift-review', error, {
      giftTransactionId: input?.giftTransactionId || null,
      rating: input?.rating || null,
    });
    throw error;
  }
}
