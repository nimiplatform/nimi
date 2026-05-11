import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { createAuthSlice } from '../src/shell/renderer/app-shell/providers/auth-slice';

const authFlowSource = fs.readFileSync(
  path.join(import.meta.dirname, '../../../kit/auth/src/hooks/use-auth-flow.ts'),
  'utf8',
);
const authMenuHandlersExtSource = fs.readFileSync(
  path.join(import.meta.dirname, '../../../kit/auth/src/logic/auth-menu-handlers-ext.ts'),
  'utf8',
);
const authSessionStorageSource = fs.readFileSync(
  path.join(import.meta.dirname, '../../../kit/auth/src/logic/auth-session-storage.ts'),
  'utf8',
);
const authTypesSource = fs.readFileSync(
  path.join(import.meta.dirname, '../../../kit/auth/src/types/auth-types.ts'),
  'utf8',
);
const authViewMainSource = fs.readFileSync(
  path.join(import.meta.dirname, '../../../kit/auth/src/components/auth-view-main.tsx'),
  'utf8',
);
const authViewEmailSource = fs.readFileSync(
  path.join(import.meta.dirname, '../../../kit/auth/src/components/auth-view-email.tsx'),
  'utf8',
);
const webAuthMenuSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/auth/web-auth-menu.tsx'),
  'utf8',
);
const loginPageSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/auth/login-page.tsx'),
  'utf8',
);
const authStateWatcherSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/infra/bootstrap/auth-state-watcher.ts'),
  'utf8',
);
const runtimeBootstrapSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/infra/bootstrap/runtime-bootstrap.ts'),
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
  assert.match(
    authFlowSource,
    /setAuthSession: \(user, token, refreshToken\) => authSessionSetterRef\.current\(user, token, refreshToken\)/,
  );
  assert.match(authFlowSource, /void adapter\.applyToken\(''\)/);
});

test('web auth session storage persists metadata only and never restores raw access tokens', () => {
  assert.doesNotMatch(authSessionStorageSource, /accessToken: z\.string\(\)\.optional\(\)/);
  assert.match(
    authSessionStorageSource,
    /export function loadPersistedAccessToken\(\): string \{\s*return '';\s*\}/s,
  );
  assert.match(authSessionStorageSource, /export function persistAuthSessionMetadata\(/);

  const repoRoot = path.join(import.meta.dirname, '../../..');
  const authSessionStorageModuleUrl = pathToFileURL(
    path.join(import.meta.dirname, '../../../kit/auth/src/logic/auth-session-storage.ts'),
  ).href;
  const script = `
    const storage = new Map();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem(key) { return storage.has(key) ? storage.get(key) : null; },
        setItem(key, value) { storage.set(key, String(value)); },
        removeItem(key) { storage.delete(key); },
      },
    });
    globalThis.__NIMI_IMPORT_META_ENV__ = { VITE_NIMI_SHELL_MODE: 'web' };
    const mod = await import(${JSON.stringify(authSessionStorageModuleUrl)});
    mod.persistAuthSessionMetadata({
      user: { id: 'u1' },
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    const session = mod.loadPersistedAuthSession();
    const token = mod.loadPersistedAccessToken();
    process.stdout.write(JSON.stringify({
      session,
      token,
      raw: storage.get(mod.WEB_AUTH_SESSION_KEY),
    }));
  `;
  const output = execFileSync(process.execPath, ['--input-type=module', '--import', 'tsx/esm', '-e', script], {
    cwd: path.join(repoRoot, 'apps/desktop'),
    encoding: 'utf8',
  });
  const parsed = JSON.parse(output) as {
    session?: { user?: { id?: string }; expiresAt?: string };
    token?: string;
    raw?: string;
  };

  assert.equal(parsed.token, '');
  assert.equal(parsed.session?.user?.id, 'u1');
  assert.equal(typeof parsed.session?.expiresAt, 'string');
  assert.doesNotMatch(String(parsed.raw || ''), /"accessToken"/);
  assert.doesNotMatch(String(parsed.raw || ''), /"refreshToken"/);
  assert.match(String(parsed.raw || ''), /"user":\{"id":"u1"\}/);
});

test('desktop callback authorize view and persisted-session probe are removed', () => {
  assert.doesNotMatch(authFlowSource, /desktopCallbackRequest/);
  assert.doesNotMatch(authFlowSource, /desktopProbeStatus/);
  assert.doesNotMatch(authFlowSource, /desktop_authorize/);
  assert.doesNotMatch(authFlowSource, /restoreSession\?\.\(\)/);
  assert.doesNotMatch(authTypesSource, /DesktopCallbackRequest/);
});

test('login page no longer preserves authenticated web shell for desktop callback URLs', () => {
  assert.doesNotMatch(loginPageSource, /hasDesktopCallbackRequestInLocation/);
  assert.match(loginPageSource, /if \(authStatus === 'authenticated'\) \{/);
  assert.match(loginPageSource, /continueOauthNextIfPresent\(window\.location\.search\)/);
  assert.match(loginPageSource, /return <Navigate to="\/" replace \/>;/);
});

// The Wave A2 hard-cut deleted handleConfirmDesktopAuthorization and the
// shell-auth-page non-runtime branch that used to applyToken/persistSession on
// the web side of a `desktop_callback` flow. Spec K-ACCSVC-008 forbids the
// kit/desktop from being a refresh-token custody owner; the regression lock
// has migrated to kit/test/desktop-callback-no-exchange.test.ts.

test('auth-menu-handlers-ext no longer holds refresh tokens via handleConfirmDesktopAuthorization', () => {
  assert.doesNotMatch(authMenuHandlersExtSource, /export\s+async\s+function\s+handleConfirmDesktopAuthorization/);
  assert.doesNotMatch(authMenuHandlersExtSource, /submitDesktopCallbackResult/);
});

test('shell-auth-page no longer persists access/refresh tokens after desktop browser auth', () => {
  const shellAuthPageSource = fs.readFileSync(
    path.join(import.meta.dirname, '../../../kit/auth/src/components/shell-auth-page.tsx'),
    'utf8',
  );
  assert.doesNotMatch(shellAuthPageSource, /result\.accessToken/);
  assert.doesNotMatch(shellAuthPageSource, /result\.refreshToken/);
  assert.doesNotMatch(shellAuthPageSource, /adapter\.applyToken\(result\./);
});

test('auth state watcher observes Runtime projection without shared desktop session persistence', () => {
  assert.doesNotMatch(authStateWatcherSource, /persistSharedDesktopSession/);
  assert.doesNotMatch(authStateWatcherSource, /auth_session_save|auth_session_load|auth_session_clear/);
  assert.match(authStateWatcherSource, /message: 'phase:auth-projection-observed'/);
  assert.match(authStateWatcherSource, /dataSync\.setToken\(''\)/);
  assert.match(authStateWatcherSource, /dataSync\.setRefreshToken\(''\)/);
  assert.match(authStateWatcherSource, /dataSync\.clearProactiveRefreshTimer\(\)/);
});

test('desktop bootstrap reads Runtime account projection and has no shared-auth auto-login owner', () => {
  const watcherIndex = runtimeBootstrapSource.indexOf('startAuthStateWatcher();');
  assert.notEqual(watcherIndex, -1);
  assert.doesNotMatch(runtimeBootstrapSource, /bootstrapAuthSession\(/);
  assert.match(runtimeBootstrapSource, /createLocalFirstPartyRuntimePlatformClient\(/);
  assert.match(runtimeBootstrapSource, /runtime\.account\.getAccountSessionStatus\(\{\s*caller: accountCaller,\s*\}\)/s);
  assert.match(runtimeBootstrapSource, /runtime\.account\.getAccessToken\(\{\s*caller: accountCaller,\s*requestedScopes: \[\],\s*\}\)/s);
});

test('web auth adapter stores browser metadata instead of calling shared desktop session persistence in web mode', () => {
  const desktopAuthAdapterSource = fs.readFileSync(
    path.join(import.meta.dirname, '../src/shell/renderer/features/auth/desktop-auth-adapter.ts'),
    'utf8',
  );
  assert.match(
    desktopAuthAdapterSource,
    /if \(isWebShellMode\(\)\) \{\s*const updatedAt = new Date\(\)\.toISOString\(\);\s*persistAuthSessionMetadata\(\{\s*user,\s*updatedAt,\s*expiresAt: resolveSessionExpiry\(accessToken, updatedAt\),\s*\}\);\s*return;\s*\}/s,
  );
  assert.doesNotMatch(
    desktopAuthAdapterSource,
    /if \(isWebShellMode\(\)\) \{\s*persistAuthSession\(\{\s*accessToken,\s*refreshToken,\s*user,/s,
  );
  assert.match(
    desktopAuthAdapterSource,
    /if \(isWebShellMode\(\)\) \{\s*clearPersistedAccessToken\(\);\s*return;\s*\}/s,
  );
  assert.match(desktopAuthAdapterSource, /restoreSession: async \(\) => localFirstPartyBlocked\('restoreSession'\)/);
  assert.doesNotMatch(desktopAuthAdapterSource, /realm\.services\.AuthService\.refreshToken\(\)/);
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
    /handleLoginResult\(\s*result,\s*AUTH_COPY\.otpVerifySuccess,\s*setters,\s*adapter,\s*'email_otp_verify',?\s*\)/s,
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
