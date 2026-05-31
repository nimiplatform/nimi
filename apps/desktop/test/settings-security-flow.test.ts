import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  disableRealmTwoFactor,
  enableRealmTwoFactor,
  prepareRealmTwoFactor,
  updateRealmPassword,
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
const dataSyncFacadeSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/runtime/data-sync/facade.ts'),
  'utf8',
);
const dataSyncActionsSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/runtime/data-sync/facade-actions.ts'),
  'utf8',
);

test('SDK Realm security helpers behaviorally call password and 2FA APIs', async () => {
  const calls: string[] = [];
  const realm = {
    services: {
      AuthService: {
        updatePassword: async (payload: Record<string, unknown>) => {
          calls.push(`password:${String(payload.newPassword || '')}`);
          return {};
        },
      },
      MeTwoFactorService: {
        prepareTwoFactor: async () => {
          calls.push('prepare-2fa');
          return { secret: 'secret', uri: 'otpauth://nimi/test' };
        },
        enableTwoFactor: async (payload: Record<string, unknown>) => {
          calls.push(`enable-2fa:${String(payload.code || '')}`);
          return {};
        },
        disableTwoFactor: async (payload: Record<string, unknown>) => {
          calls.push(`disable-2fa:${String(payload.code || '')}`);
          return {};
        },
      },
    },
  };

  const passwordResult = await updateRealmPassword(realm as never, {
    newPassword: 'new-password-123',
  } as never);
  const prepareResult = await prepareRealmTwoFactor(realm as never);
  const enableResult = await enableRealmTwoFactor(realm as never, {
    code: '123456',
  } as never);
  const disableResult = await disableRealmTwoFactor(realm as never, {
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
  assert.deepEqual(enableResult, { enabled: true });
  assert.deepEqual(disableResult, { enabled: false });
});

test('security page consumes SDK Realm security helpers instead of DataSync security flow', () => {
  assert.match(securityPageSource, /prepareRealmTwoFactor\(getPlatformClient\(\)\.realm\)/);
  assert.match(securityPageSource, /updateRealmPassword\(getPlatformClient\(\)\.realm/);
  assert.match(securityPageSource, /enableRealmTwoFactor\(getPlatformClient\(\)\.realm/);
  assert.match(securityPageSource, /disableRealmTwoFactor\(getPlatformClient\(\)\.realm/);
  assert.doesNotMatch(securityPageSource, /dataSync\.(prepareTwoFactor|updatePassword|enableTwoFactor|disableTwoFactor)/);
});

test('settings pages consume SDK Realm account helpers instead of DataSync settings flow', () => {
  assert.match(notificationsPageSource, /loadRealmUserNotificationSettings\(getPlatformClient\(\)\.realm\)/);
  assert.match(notificationsPageSource, /updateRealmUserNotificationSettings\(getPlatformClient\(\)\.realm/);
  assert.match(privacyPageSource, /loadRealmUserSettings\(getPlatformClient\(\)\.realm\)/);
  assert.match(privacyPageSource, /updateRealmUserSettings\(getPlatformClient\(\)\.realm/);
  assert.match(performancePageSource, /loadRealmCreatorEligibility\(getPlatformClient\(\)\.realm\)/);
  assert.match(accountPageSource, /linkRealmOAuth\(getPlatformClient\(\)\.realm/);
  assert.match(accountPageSource, /unlinkRealmOAuth\(getPlatformClient\(\)\.realm/);
  assert.doesNotMatch(
    `${notificationsPageSource}\n${privacyPageSource}\n${performancePageSource}\n${accountPageSource}`,
    /dataSync\.(loadMySettings|updateMySettings|loadMyNotificationSettings|updateMyNotificationSettings|loadMyCreatorEligibility|linkOauth|unlinkOauth)/,
  );
});

test('DataSync no longer exposes the Desktop settings/security facade', () => {
  assert.doesNotMatch(
    `${dataSyncFacadeSource}\n${dataSyncActionsSource}`,
    /loadMySettings|updateMySettings|loadMyNotificationSettings|updateMyNotificationSettings|loadMyCreatorEligibility|updatePassword|prepareTwoFactor|enableTwoFactor|disableTwoFactor|linkOauth|unlinkOauth/,
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
