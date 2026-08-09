import type {
  CreatorEligibilityResponseDto,
  Me2faOperationResultDto,
  Me2faPrepareResponseDto,
  Me2faVerifyDto,
  OAuthLoginDto,
  OAuthProvider,
  RealmTypedCallOptions,
  RealmTypedClient,
  UpdatePasswordRequestDto,
  UpdateUserNotificationSettingsDto,
  UpdateUserSettingsDto,
  UserNotificationSettingsDto,
  UserSettingsDto,
} from '../core-generated/realm-typed-client';
import { createNimiError } from '../types';

export type NimiRealmUserSettings = UserSettingsDto;
export type NimiRealmUpdateUserSettingsInput = UpdateUserSettingsDto;
export type NimiRealmUserNotificationSettings = UserNotificationSettingsDto;
export type NimiRealmUpdateUserNotificationSettingsInput = UpdateUserNotificationSettingsDto;
export type NimiRealmCreatorEligibility = CreatorEligibilityResponseDto;
export type NimiRealmUpdatePasswordInput = UpdatePasswordRequestDto;
export type NimiRealmTwoFactorPrepareOutput = Me2faPrepareResponseDto;
export type NimiRealmTwoFactorVerifyInput = Me2faVerifyDto;
export type NimiRealmOAuthLinkInput = OAuthLoginDto;

export interface NimiRealmPasswordUpdateView {
  readonly ok: true;
}

export interface NimiRealmTwoFactorView {
  readonly enabled: boolean;
  readonly success: boolean;
}

export interface NimiRealmOAuthLinkView {
  readonly linked: boolean;
}

export interface NimiRealmAccountSettingsApi {
  readonly account: Pick<
    RealmTypedClient,
    | 'getMyCreatorEligibility'
    | 'getMyNotificationSettings'
    | 'getMySettings'
    | 'updateMyNotificationSettings'
    | 'updateMySettings'
  >;
  readonly auth: Pick<
    RealmTypedClient,
    | 'updatePassword'
    | 'prepare2Fa'
    | 'enable2Fa'
    | 'disable2Fa'
    | 'linkOauth'
    | 'unlinkOauth'
  >;
}

export async function loadNimiRealmUserSettings(
  realm: NimiRealmAccountSettingsApi,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmUserSettings> {
  return realm.account.getMySettings({ path: {} }, options);
}

export async function updateNimiRealmUserSettings(
  realm: NimiRealmAccountSettingsApi,
  input: NimiRealmUpdateUserSettingsInput,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmUserSettings> {
  return realm.account.updateMySettings({ path: {}, body: input }, options);
}

export async function loadNimiRealmUserNotificationSettings(
  realm: NimiRealmAccountSettingsApi,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmUserNotificationSettings> {
  return realm.account.getMyNotificationSettings({ path: {} }, options);
}

export async function updateNimiRealmUserNotificationSettings(
  realm: NimiRealmAccountSettingsApi,
  input: NimiRealmUpdateUserNotificationSettingsInput,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmUserNotificationSettings> {
  return realm.account.updateMyNotificationSettings({ path: {}, body: input }, options);
}

export async function loadNimiRealmCreatorEligibility(
  realm: NimiRealmAccountSettingsApi,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmCreatorEligibility> {
  return realm.account.getMyCreatorEligibility({ path: {} }, options);
}

export async function updateNimiRealmPassword(
  realm: NimiRealmAccountSettingsApi,
  input: NimiRealmUpdatePasswordInput,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmPasswordUpdateView> {
  await realm.auth.updatePassword({ path: {}, body: input }, options);
  return { ok: true };
}

export async function prepareNimiRealmTwoFactor(
  realm: NimiRealmAccountSettingsApi,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmTwoFactorPrepareOutput> {
  const response = await realm.auth.prepare2Fa({ path: {} }, options);
  if (!response.secret || !response.otpauthUri) {
    throw accountSettingsError({
      reasonCode: 'SDK_REALM_TWO_FACTOR_RESPONSE_INVALID',
      message: 'Realm two-factor prepare response is malformed.',
      actionHint: 'check_realm_two_factor_response',
    });
  }
  return response;
}

export async function enableNimiRealmTwoFactor(
  realm: NimiRealmAccountSettingsApi,
  input: NimiRealmTwoFactorVerifyInput,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmTwoFactorView> {
  const response = await realm.auth.enable2Fa({ path: {}, body: input }, options);
  return normalizeTwoFactorOperationResult(response, true);
}

export async function disableNimiRealmTwoFactor(
  realm: NimiRealmAccountSettingsApi,
  input: NimiRealmTwoFactorVerifyInput,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmTwoFactorView> {
  const response = await realm.auth.disable2Fa({ path: {}, body: input }, options);
  return normalizeTwoFactorOperationResult(response, false);
}

export async function linkNimiRealmOAuth(
  realm: NimiRealmAccountSettingsApi,
  input: NimiRealmOAuthLinkInput,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmOAuthLinkView> {
  await realm.auth.linkOauth({ path: {}, body: input }, options);
  return { linked: true };
}

export async function unlinkNimiRealmOAuth(
  realm: NimiRealmAccountSettingsApi,
  provider: OAuthProvider,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmOAuthLinkView> {
  await realm.auth.unlinkOauth({ path: { provider } }, options);
  return { linked: false };
}

function normalizeTwoFactorOperationResult(
  response: Me2faOperationResultDto,
  enabled: boolean,
): NimiRealmTwoFactorView {
  if (response.success !== true) {
    throw accountSettingsError({
      reasonCode: 'SDK_REALM_TWO_FACTOR_OPERATION_REJECTED',
      message: 'Realm two-factor operation was not accepted.',
      actionHint: 'check_realm_two_factor_state',
    });
  }
  return {
    enabled,
    success: true,
  };
}

function accountSettingsError(input: {
  readonly reasonCode: string;
  readonly message: string;
  readonly actionHint: string;
}): Error {
  return createNimiError({
    message: input.message,
    reasonCode: input.reasonCode,
    actionHint: input.actionHint,
    source: 'sdk',
  });
}
