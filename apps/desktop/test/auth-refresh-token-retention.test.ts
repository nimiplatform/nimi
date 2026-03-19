import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { createAuthSlice } from '../src/shell/renderer/app-shell/providers/auth-slice';

const authFlowSource = fs.readFileSync(
  path.join(import.meta.dirname, '../../_libs/shell-auth/src/hooks/use-auth-flow.ts'),
  'utf8',
);
const authMenuHandlersExtSource = fs.readFileSync(
  path.join(import.meta.dirname, '../../_libs/shell-auth/src/logic/auth-menu-handlers-ext.ts'),
  'utf8',
);
const authTypesSource = fs.readFileSync(
  path.join(import.meta.dirname, '../../_libs/shell-auth/src/types/auth-types.ts'),
  'utf8',
);
const authViewMainSource = fs.readFileSync(
  path.join(import.meta.dirname, '../../_libs/shell-auth/src/components/auth-view-main.tsx'),
  'utf8',
);
const authViewEmailSource = fs.readFileSync(
  path.join(import.meta.dirname, '../../_libs/shell-auth/src/components/auth-view-email.tsx'),
  'utf8',
);
const webAuthMenuSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/auth/web-auth-menu.tsx'),
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
  assert.match(authFlowSource, /externalSetAuthSession\?\.\(latestUser, latestToken, latestRefreshToken \|\| undefined\)/);
  assert.match(authFlowSource, /void adapter\.applyToken\(latestToken, latestRefreshToken \|\| undefined\)/);
});

test('desktop authorization keeps refresh token in auth store', () => {
  assert.match(
    authMenuHandlersExtSource,
    /setAuthSession\(\s*normalizedUser,\s*accessToken,\s*latestPersistedAuthSession\?\.refreshToken \|\| undefined,\s*\)/,
  );
});

test('auth view types include email_set_password', () => {
  assert.match(authTypesSource, /\|\s*'email_set_password'/);
  assert.match(authTypesSource, /export type EmbeddedAuthStage = 'logo' \| 'email' \| 'credential'/);
});

test('verify email otp sends onboarding users through password setup before login', () => {
  assert.match(
    authMenuHandlersExtSource,
    /if \(result\.tokens && shouldPromptPasswordSetupAfterEmailOtp\(result\)\) \{/,
  );
  assert.match(authMenuHandlersExtSource, /await adapter\.applyToken\(accessToken, refreshToken\)/);
  assert.match(authMenuHandlersExtSource, /setters\.setPendingTokens\(result\.tokens\)/);
  assert.match(authMenuHandlersExtSource, /setters\.setView\('email_set_password'\)/);
  assert.match(
    authMenuHandlersExtSource,
    /handleLoginResult\(result, '验证码登录成功。', setters, desktopCtx, adapter, 'email_otp_verify'\)/,
  );
});

test('embedded auth menu uses inline stages and clears temporary onboarding auth', () => {
  assert.match(
    authFlowSource,
    /const \[embeddedStage, setEmbeddedStage\] = useState<EmbeddedAuthStage>\('logo'\)/,
  );
  assert.match(authFlowSource, /const \[showAlternatives, setShowAlternatives\] = useState\(false\)/);
  assert.match(
    authFlowSource,
    /const \[twoFactorReturnView, setTwoFactorReturnView\] = useState<AuthView>\('main'\)/,
  );
  assert.match(authFlowSource, /const clearPendingOnboardingState = \(\) => \{/);
  assert.match(authFlowSource, /void adapter\.applyToken\(''\)/);
  assert.match(authFlowSource, /if \(view === 'email_otp_verify'\) \{\s*setOtpCode\(''\);\s*setView\('main'\);\s*setEmbeddedStage\('credential'\);/s);
  assert.match(authFlowSource, /else if \(view === 'email_set_password'\) \{\s*clearPendingOnboardingState\(\);\s*clearOtpFlowState\(\);\s*setView\('main'\);\s*setEmbeddedStage\('credential'\);/s);
  assert.match(authFlowSource, /else if \(view === 'email_2fa'\) \{\s*setTempToken\(''\);\s*setTwoFactorCode\(''\);/s);
  assert.match(authFlowSource, /else if \(view === 'wallet_select'\) \{\s*setView\('main'\);\s*setEmbeddedStage\('email'\);\s*setShowAlternatives\(true\);/s);
});

test('embedded auth main view renders inline email bar and provider panel', () => {
  assert.match(webAuthMenuSource, /logoTrigger: E2E_IDS\.loginLogoTrigger/);
  assert.match(webAuthMenuSource, /emailInput: E2E_IDS\.loginEmailInput/);
  assert.match(webAuthMenuSource, /alternativeToggle: E2E_IDS\.loginAlternativeToggle/);
  assert.match(webAuthMenuSource, /alternativePanel: E2E_IDS\.loginAlternativePanel/);
  assert.match(webAuthMenuSource, /emailSubmitArrow: E2E_IDS\.loginEmailSubmitArrow/);
  assert.match(authViewMainSource, /disabled=\{pending \|\| Boolean\(googleDisabledReason\)\}/);
});

test('email auth views use inline credential flow, password setup, and neutral otp copy', () => {
  assert.match(authViewEmailSource, /export function AuthViewEmailLogin/);
  assert.match(authViewEmailSource, /data-testid=\{testIds\?\.passwordInput\}/);
  assert.match(authViewEmailSource, /data-testid=\{testIds\?\.otpButton\}/);
  assert.match(webAuthMenuSource, /passwordInput: E2E_IDS\.loginPasswordInput/);
  assert.match(webAuthMenuSource, /otpButton: E2E_IDS\.loginOtpButton/);
  assert.match(authViewEmailSource, /t\('Auth\.useEmailCodeInstead'\)/);
  assert.match(authViewEmailSource, /export function AuthViewEmailSetPassword/);
  assert.match(authViewEmailSource, /t\('Auth\.setPasswordHint'\)/);
  assert.match(authViewEmailSource, /t\('Auth\.verifyAndContinue'\)/);
});
