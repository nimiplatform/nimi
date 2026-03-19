import type { Realm, RequestAccountDeletionInput, RequestAccountDeletionOutput, RequestDataExportInput, RequestDataExportOutput } from '@nimiplatform/sdk/realm';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import {
  requestAccountDeletion as requestRealmAccountDeletion,
  requestDataExport as requestRealmDataExport,
} from '@nimiplatform/sdk/realm';

type MeTwoFactorPrepareOutput = RealmModel<'MeTwoFactorPrepareOutput'>;
type MeTwoFactorVerifyInput = RealmModel<'MeTwoFactorVerifyInput'>;
type OAuthProvider = RealmModel<'OAuthProvider'>;
type UpdatePasswordRequestDto = RealmModel<'UpdatePasswordRequestDto'>;
type UpdateUserNotificationSettingsDto = RealmModel<'UpdateUserNotificationSettingsDto'>;
type UpdateUserSettingsDto = RealmModel<'UpdateUserSettingsDto'>;
type UserNotificationSettingsDto = RealmModel<'UserNotificationSettingsDto'>;
type UserSettingsDto = RealmModel<'UserSettingsDto'>;

type DataSyncApiCaller = <T>(task: (realm: Realm) => Promise<T>, fallbackMessage?: string) => Promise<T>;
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

export async function updatePassword(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  payload: UpdatePasswordRequestDto,
): Promise<{ success: boolean }> {
  try {
    await callApi(
      (realm) => realm.services.AuthService.updatePassword(payload),
      '修改密码失败',
    );
    return {
      success: true,
    };
  } catch (error) {
    emitDataSyncError('update-password', error);
    throw error;
  }
}

export async function prepareTwoFactor(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
): Promise<MeTwoFactorPrepareOutput> {
  try {
    return await callApi(
      (realm) => realm.services.MeTwoFactorService.prepareTwoFactor(),
      '生成 2FA 配置失败',
    ) as MeTwoFactorPrepareOutput;
  } catch (error) {
    emitDataSyncError('prepare-two-factor', error);
    throw error;
  }
}

export async function enableTwoFactor(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  payload: MeTwoFactorVerifyInput,
): Promise<{ enabled: boolean }> {
  try {
    await callApi(
      (realm) => realm.services.MeTwoFactorService.enableTwoFactor(payload),
      '启用 2FA 失败',
    );
    return {
      enabled: true,
    };
  } catch (error) {
    emitDataSyncError('enable-two-factor', error);
    throw error;
  }
}

export async function disableTwoFactor(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  payload: MeTwoFactorVerifyInput,
): Promise<{ enabled: boolean }> {
  try {
    await callApi(
      (realm) => realm.services.MeTwoFactorService.disableTwoFactor(payload),
      '停用 2FA 失败',
    );
    return {
      enabled: false,
    };
  } catch (error) {
    emitDataSyncError('disable-two-factor', error);
    throw error;
  }
}

export async function linkOauth(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  provider: OAuthProvider,
  accessToken: string,
): Promise<{ linked: boolean }> {
  try {
    await callApi(
      (realm) => realm.services.AuthService.linkOauth({ provider, accessToken }),
      '绑定第三方账号失败',
    );
    return {
      linked: true,
    };
  } catch (error) {
    emitDataSyncError('link-oauth', error, { provider });
    throw error;
  }
}

export async function unlinkOauth(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  provider: OAuthProvider,
): Promise<{ linked: boolean }> {
  try {
    await callApi(
      (realm) => realm.services.AuthService.unlinkOauth(provider),
      '解绑第三方账号失败',
    );
    return {
      linked: false,
    };
  } catch (error) {
    emitDataSyncError('unlink-oauth', error, { provider });
    throw error;
  }
}

export async function requestDataExport(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  payload: RequestDataExportInput,
): Promise<RequestDataExportOutput> {
  try {
    return await callApi(
      (realm) => requestRealmDataExport(realm, payload),
      '请求数据导出失败',
    );
  } catch (error) {
    emitDataSyncError('request-data-export', error);
    throw error;
  }
}

export async function requestAccountDeletion(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  payload: RequestAccountDeletionInput,
): Promise<RequestAccountDeletionOutput> {
  try {
    return await callApi(
      (realm) => requestRealmAccountDeletion(realm, payload),
      '请求删除账号失败',
    );
  } catch (error) {
    emitDataSyncError('request-account-deletion', error);
    throw error;
  }
}
