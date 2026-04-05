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
    mod.persistAuthSession({ accessToken: 'access-123', user: { id: 'u1' } });
    const session = mod.loadPersistedAuthSession();
    const token = mod.loadPersistedAccessToken();
    process.stdout.write(JSON.stringify({
      session,
      token,
      raw: storage.get(mod.WEB_AUTH_SESSION_KEY),
    }));
  `;
  const output = execFileSync(process.execPath, ['--import', 'tsx/esm', '-e', script], {
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

test('desktop callback auth flow upgrades main view after async session restore', () => {
  assert.match(
    authFlowSource,
    /const hasDesktopCallbackSession =\s*authStatus === 'authenticated'\s*\|\|\s*Boolean\(desktopCallbackToken\)\s*\|\|\s*Boolean\(desktopCallbackUser\);/s,
  );
  assert.match(
    authFlowSource,
    /if \(!desktopCallbackRequest \|\| !hasDesktopCallbackSession\) \{\s*return;\s*\}\s*\n\s*setView\(\(current\) => \(current === 'main' \? 'desktop_authorize' : current\)\);\s*\n\s*\}, \[desktopCallbackRequest, hasDesktopCallbackSession\]\);/s,
  );
});

test('login page detects desktop callback from shared hash-aware helper', () => {
  assert.match(loginPageSource, /import \{ hasDesktopCallbackRequestInLocation \} from '@nimiplatform\/nimi-kit\/auth';/);
  assert.match(loginPageSource, /const hasDesktopCallback = hasDesktopCallbackRequestInLocation\(\{\s*search: location\.search,\s*hash: typeof window !== 'undefined' \? window\.location\.hash : '',\s*\}\);/s);
});

test('desktop authorization preserves refresh token by leaving it undefined in auth store update', () => {
  assert.match(
    authMenuHandlersExtSource,
    /setAuthSession\(\s*normalizedUser,\s*accessToken,\s*refreshToken \|\| undefined,\s*\)/,
  );
});

test('desktop authorization can restore a same-origin session before submitting desktop callback', () => {
  assert.match(authMenuHandlersExtSource, /const restored = await adapter\.restoreSession\?\.\(\);/);
  assert.match(authMenuHandlersExtSource, /throw new Error\(AUTH_COPY\.desktopSessionMissing\);/);
  assert.match(authMenuHandlersExtSource, /await adapter\.applyToken\(accessToken, refreshToken \|\| undefined\);/);
  assert.match(
    authMenuHandlersExtSource,
    /await adapter\.persistSession\?\.\(\{\s*accessToken,\s*refreshToken,\s*user: normalizedUser \?\? desktopCtx\.desktopCallbackUser,\s*\}\);/s,
  );
});

test('desktop-browser auth persists the restored session immediately after browser authorization', () => {
  const shellAuthPageSource = fs.readFileSync(
    path.join(import.meta.dirname, '../../../kit/auth/src/components/shell-auth-page.tsx'),
    'utf8',
  );
  assert.match(
    shellAuthPageSource,
    /await adapter\.persistSession\?\.\(\{\s*accessToken: result\.accessToken,\s*user,\s*\}\);/s,
  );
});

test('auth state watcher persists shared desktop session after desktop auth becomes authenticated', () => {
  assert.match(authStateWatcherSource, /import \{ persistSharedDesktopSession \} from '@renderer\/features\/auth\/shared-auth-session';/);
  assert.match(
    authStateWatcherSource,
    /void persistSharedDesktopSession\(\{\s*realmBaseUrl,\s*accessToken: auth\.token,\s*refreshToken: auth\.refreshToken,\s*user: state\.auth\.user,\s*\}\)/s,
  );
  assert.match(authStateWatcherSource, /message: 'phase:auth-persist:done'/);
  assert.match(authStateWatcherSource, /message: 'phase:auth-persist:failed'/);
});

test('web auth adapter stores browser metadata instead of calling shared desktop session persistence in web mode', () => {
  const desktopAuthAdapterSource = fs.readFileSync(
    path.join(import.meta.dirname, '../src/shell/renderer/features/auth/desktop-auth-adapter.ts'),
    'utf8',
  );
  assert.match(
    desktopAuthAdapterSource,
    /if \(isWebShellMode\(\)\) \{\s*persistAuthSession\(\{\s*accessToken,\s*refreshToken,\s*user,\s*\}\);\s*return;\s*\}/s,
  );
  assert.match(
    desktopAuthAdapterSource,
    /if \(isWebShellMode\(\)\) \{\s*clearPersistedAccessToken\(\);\s*return;\s*\}/s,
  );
  assert.match(desktopAuthAdapterSource, /restoreSession: async \(\) => \{/);
  assert.match(desktopAuthAdapterSource, /realm\.services\.AuthService\.refreshToken\(\)/);
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
    /handleLoginResult\(\s*result,\s*AUTH_COPY\.otpVerifySuccess,\s*setters,\s*desktopCtx,\s*adapter,\s*'email_otp_verify',?\s*\)/s,
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
