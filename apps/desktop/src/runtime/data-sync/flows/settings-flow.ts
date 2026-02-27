import type { Realm } from '@nimiplatform/sdk/realm';
import type { UpdateUserNotificationSettingsDto } from '@nimiplatform/sdk/realm';
import type { UpdateUserSettingsDto } from '@nimiplatform/sdk/realm';
import type { UserNotificationSettingsDto } from '@nimiplatform/sdk/realm';
import type { UserSettingsDto } from '@nimiplatform/sdk/realm';

type DataSyncApiCaller = (task: (realm: Realm) => Promise<any>, fallbackMessage?: string) => Promise<any>;
type DataSyncErrorEmitter = (
  action: string,
  error: unknown,
  details?: Record<string, unknown>,
) => void;

export type CreatorEligibility = {
  isEligible: boolean;
  tier: 'FREE' | 'PRO' | 'MAX';
  status: 'ACTIVE' | 'CANCELED' | 'PAST_DUE' | 'PAUSED';
  canCreateAgent: boolean;
  canCreateWorld: boolean;
  message: string;
};

function normalizeTier(value: unknown): 'FREE' | 'PRO' | 'MAX' {
  if (value === 'PRO' || value === 'MAX') {
    return value;
  }
  return 'FREE';
}

function normalizeSubscriptionStatus(
  value: unknown,
): 'ACTIVE' | 'CANCELED' | 'PAST_DUE' | 'PAUSED' {
  if (value === 'CANCELED' || value === 'PAST_DUE' || value === 'PAUSED') {
    return value;
  }
  return 'ACTIVE';
}

export async function loadMySettings(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
): Promise<UserSettingsDto> {
  try {
    return await callApi(
      (realm) => realm.services.MeService.getMySettings(),
      '加载隐私设置失败',
    );
  } catch (error) {
    emitDataSyncError('load-my-settings', error);
    throw error;
  }
}

export async function updateMySettings(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  payload: UpdateUserSettingsDto,
): Promise<UserSettingsDto> {
  try {
    return await callApi(
      (realm) => realm.services.MeService.updateMySettings(payload),
      '保存隐私设置失败',
    );
  } catch (error) {
    emitDataSyncError('update-my-settings', error);
    throw error;
  }
}

export async function loadMyNotificationSettings(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
): Promise<UserNotificationSettingsDto> {
  try {
    return await callApi(
      (realm) => realm.services.MeService.getMyNotificationSettings(),
      '加载通知设置失败',
    );
  } catch (error) {
    emitDataSyncError('load-my-notification-settings', error);
    throw error;
  }
}

export async function updateMyNotificationSettings(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  payload: UpdateUserNotificationSettingsDto,
): Promise<UserNotificationSettingsDto> {
  try {
    return await callApi(
      (realm) => realm.services.MeService.updateMyNotificationSettings(payload),
      '保存通知设置失败',
    );
  } catch (error) {
    emitDataSyncError('update-my-notification-settings', error);
    throw error;
  }
}

export async function loadMyCreatorEligibility(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
): Promise<CreatorEligibility> {
  try {
    const payload = await callApi(
      (realm) => realm.services.MeService.getMyCreatorEligibility(),
      '加载创作者资格失败',
    );
    const data = payload && typeof payload === 'object'
      ? payload as Record<string, unknown>
      : {};
    return {
      isEligible: data.isEligible === true,
      tier: normalizeTier(data.tier),
      status: normalizeSubscriptionStatus(data.status),
      canCreateAgent: data.canCreateAgent === true,
      canCreateWorld: data.canCreateWorld === true,
      message: typeof data.message === 'string' ? data.message : '',
    };
  } catch (error) {
    emitDataSyncError('load-my-creator-eligibility', error);
    throw error;
  }
}
