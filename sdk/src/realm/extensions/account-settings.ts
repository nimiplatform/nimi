import type { Realm } from '../client.js';
import type { RealmModel } from '../generated/type-helpers.js';

export type RealmUserSettingsDto = RealmModel<'UserSettingsDto'>;
export type RealmUpdateUserSettingsInput = RealmModel<'UpdateUserSettingsDto'>;
export type RealmUserNotificationSettingsDto = RealmModel<'UserNotificationSettingsDto'>;
export type RealmUpdateUserNotificationSettingsInput = RealmModel<'UpdateUserNotificationSettingsDto'>;
export type RealmCreatorEligibilityDto = RealmModel<'CreatorEligibilityResponseDto'>;
export type RealmUpdatePasswordInput = RealmModel<'UpdatePasswordRequestDto'>;
export type RealmTwoFactorPrepareOutput = RealmModel<'MeTwoFactorPrepareOutput'>;
export type RealmTwoFactorVerifyInput = RealmModel<'MeTwoFactorVerifyInput'>;
export type RealmOAuthProvider = RealmModel<'OAuthProvider'>;

export type RealmPasswordUpdateProjection = {
  ok: true;
};

export type RealmTwoFactorProjection = {
  enabled: boolean;
};

export type RealmOAuthLinkProjection = {
  linked: boolean;
};

export async function loadRealmUserSettings(
  realm: Pick<Realm, 'services'>,
): Promise<RealmUserSettingsDto> {
  return realm.services.MeService.getMySettings();
}

export async function updateRealmUserSettings(
  realm: Pick<Realm, 'services'>,
  input: RealmUpdateUserSettingsInput,
): Promise<RealmUserSettingsDto> {
  return realm.services.MeService.updateMySettings(input);
}

export async function loadRealmUserNotificationSettings(
  realm: Pick<Realm, 'services'>,
): Promise<RealmUserNotificationSettingsDto> {
  return realm.services.MeService.getMyNotificationSettings();
}

export async function updateRealmUserNotificationSettings(
  realm: Pick<Realm, 'services'>,
  input: RealmUpdateUserNotificationSettingsInput,
): Promise<RealmUserNotificationSettingsDto> {
  return realm.services.MeService.updateMyNotificationSettings(input);
}

export async function loadRealmCreatorEligibility(
  realm: Pick<Realm, 'services'>,
): Promise<RealmCreatorEligibilityDto> {
  return realm.services.MeService.getMyCreatorEligibility();
}

export async function updateRealmPassword(
  realm: Pick<Realm, 'services'>,
  input: RealmUpdatePasswordInput,
): Promise<RealmPasswordUpdateProjection> {
  await realm.services.AuthService.updatePassword(input);
  return { ok: true };
}

export async function prepareRealmTwoFactor(
  realm: Pick<Realm, 'services'>,
): Promise<RealmTwoFactorPrepareOutput> {
  return await realm.services.MeTwoFactorService.prepareTwoFactor() as RealmTwoFactorPrepareOutput;
}

export async function enableRealmTwoFactor(
  realm: Pick<Realm, 'services'>,
  input: RealmTwoFactorVerifyInput,
): Promise<RealmTwoFactorProjection> {
  await realm.services.MeTwoFactorService.enableTwoFactor(input);
  return { enabled: true };
}

export async function disableRealmTwoFactor(
  realm: Pick<Realm, 'services'>,
  input: RealmTwoFactorVerifyInput,
): Promise<RealmTwoFactorProjection> {
  await realm.services.MeTwoFactorService.disableTwoFactor(input);
  return { enabled: false };
}

export async function linkRealmOAuth(
  realm: Pick<Realm, 'services'>,
  provider: RealmOAuthProvider,
  accessToken: string,
): Promise<RealmOAuthLinkProjection> {
  await realm.services.AuthService.linkOauth({ provider, accessToken });
  return { linked: true };
}

export async function unlinkRealmOAuth(
  realm: Pick<Realm, 'services'>,
  provider: RealmOAuthProvider,
): Promise<RealmOAuthLinkProjection> {
  await realm.services.AuthService.unlinkOauth(provider);
  return { linked: false };
}
