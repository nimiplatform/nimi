import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  disableTwoFactor,
  enableTwoFactor,
  prepareTwoFactor,
  updatePassword,
} from '../src/runtime/data-sync/flows/settings-flow';

const securityPageSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/settings/settings-security-page.tsx'),
  'utf8',
);

test('security settings flow behaviorally calls password and 2FA APIs', async () => {
  const calls: string[] = [];
  const callApi = async <T>(task: (realm: unknown) => Promise<T>): Promise<T> =>
    task({
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
    });
  const emitDataSyncError = () => undefined;

  const passwordResult = await updatePassword(callApi as never, emitDataSyncError, {
    newPassword: 'new-password-123',
  } as never);
  const prepareResult = await prepareTwoFactor(callApi as never, emitDataSyncError);
  const enableResult = await enableTwoFactor(callApi as never, emitDataSyncError, {
    code: '123456',
  } as never);
  const disableResult = await disableTwoFactor(callApi as never, emitDataSyncError, {
    code: '654321',
  } as never);

  assert.deepEqual(calls, [
    'password:new-password-123',
    'prepare-2fa',
    'enable-2fa:123456',
    'disable-2fa:654321',
  ]);
  assert.deepEqual(passwordResult, { success: true });
  assert.equal(String((prepareResult as { secret?: string }).secret || ''), 'secret');
  assert.deepEqual(enableResult, { enabled: true });
  assert.deepEqual(disableResult, { enabled: false });
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
