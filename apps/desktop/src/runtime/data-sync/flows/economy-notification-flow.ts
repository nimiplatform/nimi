import type { Realm } from '@nimiplatform/sdk/realm';
import type { MarkNotificationsReadInputDto } from '@nimiplatform/sdk/realm';
import type { CreateReviewDto } from '@nimiplatform/sdk/realm';
import type { CreateSparkCheckoutDto } from '@nimiplatform/sdk/realm';
import type { CreateWithdrawalDto } from '@nimiplatform/sdk/realm';
import type { RejectGiftDto } from '@nimiplatform/sdk/realm';
import type { SendGiftDto } from '@nimiplatform/sdk/realm';
import type { SparkCheckoutSessionDto } from '@nimiplatform/sdk/realm';
import type { SparkPackageDto } from '@nimiplatform/sdk/realm';

type DataSyncApiCaller = (task: (realm: Realm) => Promise<any>, fallbackMessage?: string) => Promise<any>;
type DataSyncErrorEmitter = (
  action: string,
  error: unknown,
  details?: Record<string, unknown>,
) => void;

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

export async function claimGift(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  giftTransactionId: string,
) {
  const normalizedId = String(giftTransactionId || '').trim();
  if (!normalizedId) {
    throw new Error('礼物交易 ID 不能为空');
  }
  try {
    return await callApi(
      (realm) => realm.services.EconomyCurrencyGiftsService.economyControllerClaimGift(normalizedId),
      '领取礼物失败',
    );
  } catch (error) {
    emitDataSyncError('claim-gift', error, { giftTransactionId: normalizedId });
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

export async function loadNotificationUnreadCount(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
) {
  try {
    return await callApi(
      (realm) => realm.services.NotificationService.getUnreadCount(),
      '加载通知未读数失败',
    );
  } catch (error) {
    emitDataSyncError('load-notification-unread-count', error);
    throw error;
  }
}

export async function loadNotifications(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  options?: {
    type?: 'SYSTEM' | 'INTERACTION' | 'POST_LIKE' | 'POST_COMMENT' | 'MENTION';
    unreadOnly?: boolean;
    limit?: number;
    cursor?: string;
  },
) {
  try {
    return await callApi(
      (realm) => realm.services.NotificationService.listNotifications(
        options?.type,
        options?.unreadOnly,
        options?.limit,
        options?.cursor,
      ),
      '加载通知列表失败',
    );
  } catch (error) {
    emitDataSyncError('load-notifications', error, {
      type: options?.type || null,
      unreadOnly: options?.unreadOnly ?? null,
      limit: options?.limit ?? null,
      cursor: options?.cursor || null,
    });
    throw error;
  }
}

export async function markNotificationsRead(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  input: MarkNotificationsReadInputDto,
) {
  try {
    await callApi(
      (realm) => realm.services.NotificationService.markNotificationsRead(input),
      '标记通知已读失败',
    );
    return { ok: true };
  } catch (error) {
    emitDataSyncError('mark-notifications-read', error, {
      markAllBefore: input?.markAllBefore || null,
      count: Array.isArray(input?.ids) ? input.ids.length : 0,
    });
    throw error;
  }
}

export async function markNotificationRead(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  notificationId: string,
) {
  const normalizedId = String(notificationId || '').trim();
  if (!normalizedId) {
    throw new Error('通知 ID 不能为空');
  }
  try {
    await callApi(
      (realm) => realm.services.NotificationService.markNotificationRead(normalizedId),
      '标记通知已读失败',
    );
    return { id: normalizedId };
  } catch (error) {
    emitDataSyncError('mark-notification-read', error, { notificationId: normalizedId });
    throw error;
  }
}
