import assert from 'node:assert/strict';
import test from 'node:test';
import {
  disableRealmTwoFactor,
  enableRealmTwoFactor,
  linkRealmOAuth,
  loadRealmCreatorEligibility,
  loadRealmUserNotificationSettings,
  loadRealmUserSettings,
  prepareRealmTwoFactor,
  unlinkRealmOAuth,
  updateRealmPassword,
  updateRealmUserNotificationSettings,
  updateRealmUserSettings,
} from '../src/realm/index.js';

test('Realm account settings helpers project typed service calls without owning truth', async () => {
  const calls: string[] = [];
  const realm = {
    services: {
      MeService: {
        getMySettings: async () => {
          calls.push('get-settings');
          return { profileVisibility: 'PUBLIC' };
        },
        updateMySettings: async (input: Record<string, unknown>) => {
          calls.push(`update-settings:${String(input.profileVisibility || '')}`);
          return { profileVisibility: input.profileVisibility };
        },
        getMyNotificationSettings: async () => {
          calls.push('get-notifications');
          return { channels: { inApp: true } };
        },
        updateMyNotificationSettings: async (input: Record<string, unknown>) => {
          calls.push('update-notifications');
          return input;
        },
        getMyCreatorEligibility: async () => {
          calls.push('creator-eligibility');
          return {
            isEligible: true,
            tier: 'PRO',
            status: 'ACTIVE',
            canCreateAgent: true,
            canCreateWorld: true,
            message: 'ok',
          };
        },
      },
      AuthService: {
        updatePassword: async (input: Record<string, unknown>) => {
          calls.push(`password:${String(input.newPassword || '')}`);
          return {};
        },
        linkOauth: async (input: Record<string, unknown>) => {
          calls.push(`link:${String(input.provider || '')}`);
          return {};
        },
        unlinkOauth: async (provider: string) => {
          calls.push(`unlink:${provider}`);
          return {};
        },
      },
      MeTwoFactorService: {
        prepareTwoFactor: async () => {
          calls.push('prepare-2fa');
          return { secret: 'secret', otpauthUri: 'otpauth://nimi/test' };
        },
        enableTwoFactor: async (input: Record<string, unknown>) => {
          calls.push(`enable-2fa:${String(input.code || '')}`);
          return {};
        },
        disableTwoFactor: async (input: Record<string, unknown>) => {
          calls.push(`disable-2fa:${String(input.code || '')}`);
          return {};
        },
      },
    },
  };

  assert.equal((await loadRealmUserSettings(realm as never)).profileVisibility, 'PUBLIC');
  assert.equal((await updateRealmUserSettings(realm as never, { profileVisibility: 'FRIENDS' } as never)).profileVisibility, 'FRIENDS');
  assert.equal((await loadRealmUserNotificationSettings(realm as never)).channels?.inApp, true);
  assert.equal((await updateRealmUserNotificationSettings(realm as never, { channels: { inApp: false } } as never)).channels?.inApp, false);
  assert.equal((await loadRealmCreatorEligibility(realm as never)).tier, 'PRO');
  assert.deepEqual(await updateRealmPassword(realm as never, { newPassword: 'pw' } as never), { ok: true });
  assert.equal((await prepareRealmTwoFactor(realm as never)).secret, 'secret');
  assert.deepEqual(await enableRealmTwoFactor(realm as never, { code: '123456' } as never), { enabled: true });
  assert.deepEqual(await disableRealmTwoFactor(realm as never, { code: '654321' } as never), { enabled: false });
  assert.deepEqual(await linkRealmOAuth(realm as never, 'GOOGLE' as never, 'token'), { linked: true });
  assert.deepEqual(await unlinkRealmOAuth(realm as never, 'GOOGLE' as never), { linked: false });

  assert.deepEqual(calls, [
    'get-settings',
    'update-settings:FRIENDS',
    'get-notifications',
    'update-notifications',
    'creator-eligibility',
    'password:pw',
    'prepare-2fa',
    'enable-2fa:123456',
    'disable-2fa:654321',
    'link:GOOGLE',
    'unlink:GOOGLE',
  ]);
});
