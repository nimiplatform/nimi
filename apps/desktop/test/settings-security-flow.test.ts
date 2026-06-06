import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  disableNimiRealmTwoFactor,
  enableNimiRealmTwoFactor,
  prepareNimiRealmTwoFactor,
  updateNimiRealmPassword,
} from '@nimiplatform/sdk/realm';

const securityPageSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/settings/settings-security-page.tsx'),
  'utf8',
);
const accountPageSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/settings/settings-account-panel.tsx'),
  'utf8',
);
const notificationsPageSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/settings/settings-preferences-panel.tsx'),
  'utf8',
);
const privacyPageSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/settings/settings-privacy-page.tsx'),
  'utf8',
);
const performancePageSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/settings/settings-performance-page.tsx'),
  'utf8',
);

test('SDK Realm security helpers behaviorally call password and 2FA APIs', async () => {
  const calls: string[] = [];
  const realm = {
    account: {
      getMyCreatorEligibility: async () => ({
        canCreateAgent: false,
        canCreateWorld: false,
        isEligible: false,
        message: '',
        status: 'ACTIVE',
        tier: 'FREE',
      }),
      getMyNotificationSettings: async () => ({}),
      getMySettings: async () => ({}),
      updateMyNotificationSettings: async () => ({}),
      updateMySettings: async () => ({}),
    },
    auth: {
      updatePassword: async (payload: { readonly body?: Record<string, unknown> }) => {
        calls.push(`password:${String(payload.body?.newPassword || '')}`);
        return {};
      },
      prepare2Fa: async () => {
        calls.push('prepare-2fa');
        return { secret: 'secret', otpauthUri: 'otpauth://nimi/test' };
      },
      enable2Fa: async (payload: { readonly body?: Record<string, unknown> }) => {
        calls.push(`enable-2fa:${String(payload.body?.code || '')}`);
        return { success: true };
      },
      disable2Fa: async (payload: { readonly body?: Record<string, unknown> }) => {
        calls.push(`disable-2fa:${String(payload.body?.code || '')}`);
        return { success: true };
      },
      linkOauth: async () => ({}),
      unlinkOauth: async () => ({}),
    },
  };

  const passwordResult = await updateNimiRealmPassword(realm as never, {
    newPassword: 'new-password-123',
  } as never);
  const prepareResult = await prepareNimiRealmTwoFactor(realm as never);
  const enableResult = await enableNimiRealmTwoFactor(realm as never, {
    code: '123456',
  } as never);
  const disableResult = await disableNimiRealmTwoFactor(realm as never, {
    code: '654321',
  } as never);

  assert.deepEqual(calls, [
    'password:new-password-123',
    'prepare-2fa',
    'enable-2fa:123456',
    'disable-2fa:654321',
  ]);
  assert.deepEqual(passwordResult, { ok: true });
  assert.equal(String((prepareResult as { secret?: string }).secret || ''), 'secret');
  assert.deepEqual(enableResult, { enabled: true, success: true });
  assert.deepEqual(disableResult, { enabled: false, success: true });
});

test('security page consumes SDK Realm security helpers instead of Realm security helper', () => {
  assert.match(securityPageSource, /prepareNimiRealmTwoFactor\(getDesktopRealm\(\)\)/);
  assert.match(securityPageSource, /updateNimiRealmPassword\(getDesktopRealm\(\)/);
  assert.match(securityPageSource, /enableNimiRealmTwoFactor\(getDesktopRealm\(\)/);
  assert.match(securityPageSource, /disableNimiRealmTwoFactor\(getDesktopRealm\(\)/);
  assert.doesNotMatch(securityPageSource, /dataSync\.(prepareTwoFactor|updatePassword|enableTwoFactor|disableTwoFactor)/);
});

test('settings pages consume SDK Realm account helpers instead of Realm account helper', () => {
  assert.match(notificationsPageSource, /loadNimiRealmUserNotificationSettings\(getDesktopRealm\(\)\)/);
  assert.match(notificationsPageSource, /updateNimiRealmUserNotificationSettings\(getDesktopRealm\(\)/);
  assert.match(privacyPageSource, /loadNimiRealmUserSettings\(getDesktopRealm\(\)\)/);
  assert.match(privacyPageSource, /updateNimiRealmUserSettings\(getDesktopRealm\(\)/);
  assert.match(performancePageSource, /loadNimiRealmCreatorEligibility\(getDesktopRealm\(\)\)/);
  assert.match(accountPageSource, /linkNimiRealmOAuth\(getDesktopRealm\(\)/);
  assert.match(accountPageSource, /unlinkNimiRealmOAuth\(getDesktopRealm\(\)/);
  assert.doesNotMatch(
    `${notificationsPageSource}\n${privacyPageSource}\n${performancePageSource}\n${accountPageSource}`,
    /dataSync\.(loadMySettings|updateMySettings|loadMyNotificationSettings|updateMyNotificationSettings|loadMyCreatorEligibility|linkOauth|unlinkOauth)/,
  );
});

test('security page hides TOTP setup secrets behind an explicit reveal toggle', () => {
  assert.match(securityPageSource, /const \[revealTwoFactorSecret, setRevealTwoFactorSecret\] = useState\(false\)/);
  assert.match(securityPageSource, /maskedTwoFactorSecret/);
  assert.match(securityPageSource, /SecuritySettings\.revealSecret/);
  assert.match(securityPageSource, /SecuritySettings\.copySecret/);
  assert.doesNotMatch(securityPageSource, /Secret: \{twoFactorSecret\}/);
  assert.doesNotMatch(securityPageSource, /URI: \{twoFactorUri\}/);
});

test('security page removes unpersisted login alerts toggle until backend persistence exists', () => {
  assert.doesNotMatch(securityPageSource, /const \[loginAlerts, setLoginAlerts\]/);
  assert.doesNotMatch(securityPageSource, /SecuritySettings\.loginAlertsTitle/);
  assert.doesNotMatch(securityPageSource, /SecuritySettings\.emailAlertsLabel/);
});
