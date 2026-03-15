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
const authViewMainSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/auth/auth-view-main.tsx'),
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
  assert.match(authHelpersSource, /export type EmbeddedAuthStage = 'logo' \| 'email' \| 'credential'/);
});

test('verify email otp sends onboarding users through password setup before login', () => {
  assert.match(
    authMenuHandlersExtSource,
    /if \(result\.tokens && shouldPromptPasswordSetupAfterEmailOtp\(result\)\) \{/,
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

test('embedded auth menu uses inline stages and clears temporary onboarding auth', () => {
  assert.match(
    authMenuSource,
    /const \[embeddedStage, setEmbeddedStage\] = useState<EmbeddedAuthStage>\('logo'\)/,
  );
  assert.match(authMenuSource, /const \[showAlternatives, setShowAlternatives\] = useState\(false\)/);
  assert.match(
    authMenuSource,
    /const \[twoFactorReturnView, setTwoFactorReturnView\] = useState<AuthView>\('main'\)/,
  );
  assert.doesNotMatch(authMenuSource, /showLoginModal/);
  assert.match(authMenuSource, /const clearPendingOnboardingState = \(\) => \{/);
  assert.match(authMenuSource, /dataSync\.setToken\(''\)/);
  assert.match(authMenuSource, /dataSync\.setRefreshToken\(''\)/);
  assert.match(authMenuSource, /if \(view === 'email_otp_verify'\) \{\s*setOtpCode\(''\);\s*setView\('main'\);\s*setEmbeddedStage\('credential'\);/s);
  assert.match(authMenuSource, /else if \(view === 'email_set_password'\) \{\s*clearPendingOnboardingState\(\);\s*clearOtpFlowState\(\);\s*setView\('main'\);\s*setEmbeddedStage\('credential'\);/s);
  assert.match(authMenuSource, /else if \(view === 'email_2fa'\) \{\s*setTempToken\(''\);\s*setTwoFactorCode\(''\);/s);
  assert.match(authMenuSource, /else if \(view === 'wallet_select'\) \{\s*setView\('main'\);\s*setEmbeddedStage\('email'\);\s*setShowAlternatives\(true\);/s);
});

test('embedded auth main view renders inline email bar and provider panel', () => {
  assert.match(authViewMainSource, /data-testid=\{E2E_IDS\.loginEmailInput\}/);
  assert.match(authViewMainSource, /data-testid=\{E2E_IDS\.loginAlternativeToggle\}/);
  assert.match(authViewMainSource, /data-testid=\{E2E_IDS\.loginAlternativePanel\}/);
  assert.match(authViewMainSource, /data-testid=\{E2E_IDS\.loginEmailSubmitArrow\}/);
  assert.match(authViewMainSource, /disabled=\{pending \|\| Boolean\(googleDisabledReason\)\}/);
  assert.match(authMenuSource, /data-testid=\{E2E_IDS\.loginLogoTrigger\}/);
});

test('email auth views use inline credential flow, password setup, and neutral otp copy', () => {
  assert.match(authViewEmailSource, /export function AuthViewEmailLogin/);
  assert.match(authViewEmailSource, /data-testid=\{E2E_IDS\.loginPasswordInput\}/);
  assert.match(authViewEmailSource, /data-testid=\{E2E_IDS\.loginOtpButton\}/);
  assert.match(authViewEmailSource, /t\('Auth\.useEmailCodeInstead'\)/);
  assert.match(authViewEmailSource, /export function AuthViewEmailSetPassword/);
  assert.match(authViewEmailSource, /t\('Auth\.setPasswordHint'\)/);
  assert.match(authViewEmailSource, /t\('Auth\.verifyAndContinue'\)/);
});
