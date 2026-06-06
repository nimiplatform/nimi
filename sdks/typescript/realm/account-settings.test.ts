import assert from 'node:assert/strict';
import test from 'node:test';

import {
  disableNimiRealmTwoFactor,
  enableNimiRealmTwoFactor,
  linkNimiRealmOAuth,
  loadNimiRealmCreatorEligibility,
  loadNimiRealmUserNotificationSettings,
  loadNimiRealmUserSettings,
  NIMI_REALM_OAUTH_PROVIDER,
  prepareNimiRealmTwoFactor,
  unlinkNimiRealmOAuth,
  updateNimiRealmPassword,
  updateNimiRealmUserNotificationSettings,
  updateNimiRealmUserSettings,
  type NimiRealmAccountSettingsApi,
} from './index';

test('Realm account/settings helpers map to generated Realm modules', async () => {
  const calls: Array<{ readonly method: string; readonly request: unknown }> = [];
  const realm = {
    account: {
      async getMySettings(request) {
        calls.push({ method: 'getMySettings', request });
        return { profileVisibility: 'PUBLIC' };
      },
      async updateMySettings(request) {
        calls.push({ method: 'updateMySettings', request });
        return { profileVisibility: 'FRIENDS' };
      },
      async getMyNotificationSettings(request) {
        calls.push({ method: 'getMyNotificationSettings', request });
        return { channels: { email: true } };
      },
      async updateMyNotificationSettings(request) {
        calls.push({ method: 'updateMyNotificationSettings', request });
        return { channels: { email: false } };
      },
      async getMyCreatorEligibility(request) {
        calls.push({ method: 'getMyCreatorEligibility', request });
        return { isEligible: true };
      },
    },
    auth: {
      async updatePassword(request) {
        calls.push({ method: 'updatePassword', request });
        return {};
      },
      async prepare2Fa(request) {
        calls.push({ method: 'prepare2Fa', request });
        return { secret: 'secret', otpauthUri: 'otpauth://nimi/test' };
      },
      async enable2Fa(request) {
        calls.push({ method: 'enable2Fa', request });
        return { success: true };
      },
      async disable2Fa(request) {
        calls.push({ method: 'disable2Fa', request });
        return { success: true };
      },
      async linkOauth(request) {
        calls.push({ method: 'linkOauth', request });
        return {};
      },
      async unlinkOauth(request) {
        calls.push({ method: 'unlinkOauth', request });
        return {};
      },
    },
  } as unknown as NimiRealmAccountSettingsApi;

  assert.equal((await loadNimiRealmUserSettings(realm)).profileVisibility, 'PUBLIC');
  assert.equal((await updateNimiRealmUserSettings(realm, { profileVisibility: 'FRIENDS' })).profileVisibility, 'FRIENDS');
  assert.equal((await loadNimiRealmUserNotificationSettings(realm)).channels?.email, true);
  assert.equal((await updateNimiRealmUserNotificationSettings(realm, { channels: { email: false } })).channels?.email, false);
  assert.equal((await loadNimiRealmCreatorEligibility(realm)).isEligible, true);
  assert.deepEqual(await updateNimiRealmPassword(realm, { newPassword: 'next' }), { ok: true });
  assert.equal((await prepareNimiRealmTwoFactor(realm)).secret, 'secret');
  assert.deepEqual(await enableNimiRealmTwoFactor(realm, { code: '123456' }), { enabled: true, success: true });
  assert.deepEqual(await disableNimiRealmTwoFactor(realm, { code: '654321' }), { enabled: false, success: true });
  assert.deepEqual(await linkNimiRealmOAuth(realm, NIMI_REALM_OAUTH_PROVIDER.GOOGLE, 'access'), { linked: true });
  assert.deepEqual(await unlinkNimiRealmOAuth(realm, NIMI_REALM_OAUTH_PROVIDER.GOOGLE), { linked: false });

  assert.deepEqual(calls.map((call) => call.method), [
    'getMySettings',
    'updateMySettings',
    'getMyNotificationSettings',
    'updateMyNotificationSettings',
    'getMyCreatorEligibility',
    'updatePassword',
    'prepare2Fa',
    'enable2Fa',
    'disable2Fa',
    'linkOauth',
    'unlinkOauth',
  ]);
  assert.deepEqual(calls[1]?.request, {
    path: {},
    body: { profileVisibility: 'FRIENDS' },
  });
  assert.deepEqual(calls[9]?.request, {
    path: {},
    body: {
      provider: NIMI_REALM_OAUTH_PROVIDER.GOOGLE,
      accessToken: 'access',
    },
  });
  assert.deepEqual(calls[10]?.request, {
    path: { provider: NIMI_REALM_OAUTH_PROVIDER.GOOGLE },
  });
});

test('Realm account/settings helpers fail closed on rejected two-factor operations', async () => {
  const realm = {
    account: {
      async getMySettings() { return {}; },
      async updateMySettings() { return {}; },
      async getMyNotificationSettings() { return {}; },
      async updateMyNotificationSettings() { return {}; },
      async getMyCreatorEligibility() { return { isEligible: false }; },
    },
    auth: {
      async updatePassword() { return {}; },
      async prepare2Fa() { return { secret: '', otpauthUri: '' }; },
      async enable2Fa() { return { success: false }; },
      async disable2Fa() { return { success: false }; },
      async linkOauth() { return {}; },
      async unlinkOauth() { return {}; },
    },
  } as unknown as NimiRealmAccountSettingsApi;

  await assert.rejects(
    () => prepareNimiRealmTwoFactor(realm),
    (error: unknown) => (error as { code?: string }).code === 'SDK_REALM_TWO_FACTOR_RESPONSE_INVALID',
  );
  await assert.rejects(
    () => enableNimiRealmTwoFactor(realm, { code: '123456' }),
    (error: unknown) => (error as { code?: string }).code === 'SDK_REALM_TWO_FACTOR_OPERATION_REJECTED',
  );
});
