import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { createAuthSlice } from '../src/shell/renderer/app-shell/providers/auth-slice';

const authMenuSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/auth/auth-menu.tsx'),
  'utf8',
);
const authMenuHandlersExtSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/auth/auth-menu-handlers-ext.ts'),
  'utf8',
);
const authHelpersSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/auth/auth-helpers.ts'),
  'utf8',
);
const authViewEmailSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/auth/auth-view-email.tsx'),
  'utf8',
);

test('setAuthSession keeps existing refresh token when refreshToken is undefined', () => {
  let state: Record<string, unknown> = {
    auth: {
      status: 'anonymous',
      user: null,
      token: '',
      refreshToken: '',
    },
    selectedChatId: null,
  };
  const set = (partial: unknown) => {
    const next = typeof partial === 'function'
      ? (partial as (prev: Record<string, unknown>) => Record<string, unknown>)(state)
      : (partial as Record<string, unknown>);
    state = {
      ...state,
      ...next,
    };
  };
  const slice = createAuthSlice(set as never);

  slice.setAuthSession({ id: 'u1' }, 'access-1', 'refresh-1');
  assert.equal((state.auth as { refreshToken: string }).refreshToken, 'refresh-1');

  slice.setAuthSession({ id: 'u1' }, 'access-2');
  assert.equal((state.auth as { refreshToken: string }).refreshToken, 'refresh-1');

  slice.setAuthSession({ id: 'u1' }, 'access-3', '');
  assert.equal((state.auth as { refreshToken: string }).refreshToken, '');
});

test('auth menu storage sync forwards persisted refresh token when available', () => {
  assert.match(authMenuSource, /setAuthSession\(latestUser, latestToken, latestRefreshToken \|\| undefined\)/);
  assert.match(authMenuSource, /dataSync\.setRefreshToken\(latestRefreshToken\)/);
});

test('desktop authorization keeps refresh token in auth store', () => {
  assert.match(
    authMenuHandlersExtSource,
    /setAuthSession\(\s*normalizedUser,\s*accessToken,\s*latestPersistedAuthSession\?\.refreshToken \|\| undefined,\s*\)/,
  );
});

test('auth view types include email_set_password', () => {
  assert.match(authHelpersSource, /\|\s*'email_set_password'/);
});

test('verify email otp sends onboarding users through password setup before login', () => {
  assert.match(
    authMenuHandlersExtSource,
    /if \(result\.loginState === OAuthLoginState\.NEEDS_ONBOARDING && result\.tokens\) \{/,
  );
  assert.match(authMenuHandlersExtSource, /dataSync\.setToken\(accessToken\)/);
  assert.match(authMenuHandlersExtSource, /dataSync\.setRefreshToken\(refreshToken\)/);
  assert.match(authMenuHandlersExtSource, /setters\.setPendingTokens\(result\.tokens\)/);
  assert.match(authMenuHandlersExtSource, /setters\.setView\('email_set_password'\)/);
  assert.match(
    authMenuHandlersExtSource,
    /handleLoginResult\(result, '验证码登录成功。', setters, desktopCtx, 'email_otp_verify'\)/,
  );
});

test('auth menu keeps otp source and clears temporary onboarding auth', () => {
  assert.match(
    authMenuSource,
    /const \[otpEntryView, setOtpEntryView\] = useState<'email_otp' \| 'email_register'>\('email_otp'\)/,
  );
  assert.match(
    authMenuSource,
    /const \[twoFactorReturnView, setTwoFactorReturnView\] = useState<AuthView>\('main'\)/,
  );
  assert.match(authMenuSource, /const clearPendingOnboardingState = \(\) => \{/);
  assert.match(authMenuSource, /dataSync\.setToken\(''\)/);
  assert.match(authMenuSource, /dataSync\.setRefreshToken\(''\)/);
  assert.match(authMenuSource, /if \(view === 'email_otp_verify'\) \{\s*setOtpCode\(''\);\s*setView\(otpEntryView\);/s);
  assert.match(authMenuSource, /else if \(view === 'email_set_password'\) \{\s*clearPendingOnboardingState\(\);\s*clearOtpFlowState\(\);\s*setView\(otpEntryView\);/s);
  assert.match(authMenuSource, /else if \(view === 'email_2fa'\) \{\s*setTempToken\(''\);\s*setTwoFactorCode\(''\);\s*setView\(twoFactorReturnView\);/s);
});

test('email auth views use register hint, password setup, and neutral otp copy', () => {
  assert.doesNotMatch(
    authViewEmailSource,
    /export function AuthViewEmailRegister\(props: \{\s*email: string;\s*password:/s,
  );
  assert.match(authViewEmailSource, /t\('Auth\.registerHint'\)/);
  assert.match(authViewEmailSource, /t\('Auth\.sendVerificationCode'\)/);
  assert.match(authViewEmailSource, /export function AuthViewEmailSetPassword/);
  assert.match(authViewEmailSource, /t\('Auth\.setPasswordHint'\)/);
  assert.match(authViewEmailSource, /t\('Auth\.verifyAndContinue'\)/);
});
