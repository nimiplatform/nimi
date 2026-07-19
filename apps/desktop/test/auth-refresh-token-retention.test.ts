import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { createAuthSlice } from '../src/shell/renderer/app-shell/providers/auth-slice';

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

test('setAuthSession keeps renderer auth projection token-free', () => {
  let state: Record<string, unknown> = {
    auth: {
      status: 'anonymous',
      user: null,
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

  slice.setAuthSession({ id: 'u1' });
  assert.equal('token' in (state.auth as Record<string, unknown>), false);
  assert.equal('accessToken' in (state.auth as Record<string, unknown>), false);
  assert.equal('refreshToken' in (state.auth as Record<string, unknown>), false);

  slice.clearAuthSession();
  assert.equal('token' in (state.auth as Record<string, unknown>), false);
  assert.equal('accessToken' in (state.auth as Record<string, unknown>), false);
  assert.equal('refreshToken' in (state.auth as Record<string, unknown>), false);
});

test('login page no longer preserves authenticated web shell for desktop callback URLs', () => {
  assert.doesNotMatch(loginPageSource, /hasDesktopCallbackRequestInLocation/);
  assert.match(loginPageSource, /if \(authStatus === 'authenticated'\) \{/);
  assert.match(loginPageSource, /continueOauthNextIfPresent\(window\.location\.search\)/);
  assert.doesNotMatch(
    loginPageSource,
    /import\s*\{[^}]*\bNavigate\b[^}]*\}\s*from\s*'react-router-dom'/,
  );
  assert.match(loginPageSource, /return null;/);
});

test('auth state watcher observes Runtime projection without shared desktop session persistence', () => {
  assert.doesNotMatch(authStateWatcherSource, /persistSharedDesktopSession/);
  assert.doesNotMatch(authStateWatcherSource, /auth_session_save|auth_session_load|auth_session_clear/);
  assert.match(authStateWatcherSource, /desktopBridge\.getRuntimeAccountSessionStatus\(\)/);
  assert.match(authStateWatcherSource, /desktopBridge\.subscribeRuntimeAccountSessionEvents\(afterSequence/);
  assert.match(authStateWatcherSource, /message: 'phase:runtime-account-stream:subscribed'/);
  assert.doesNotMatch(authStateWatcherSource, /dataSync/);
});

test('desktop bootstrap reads Runtime account projection and has no shared-auth auto-login owner', () => {
  const watcherIndex = runtimeBootstrapSource.indexOf('startAuthStateWatcher();');
  assert.notEqual(watcherIndex, -1);
  assert.doesNotMatch(runtimeBootstrapSource, /bootstrapAuthSession\(/);
  assert.match(runtimeBootstrapSource, /configureDesktopRuntimeRealmSession\(/);
  assert.match(runtimeBootstrapSource, /desktopBridge\.getRuntimeAccountSessionStatus\(\)/);
  assert.doesNotMatch(runtimeBootstrapSource, /createNimiDesktopShellRuntimeAccountCaller\(/);
  assert.doesNotMatch(runtimeBootstrapSource, /accountRuntime\.account\.getAccountSessionStatus/);
  assert.doesNotMatch(runtimeBootstrapSource, /getAccessToken|refreshAccountSession/);
  assert.doesNotMatch(runtimeBootstrapSource, /createLocalFirstPartyRuntimePlatformClient\(/);
});

test('web auth adapter is Web-owned and stores browser metadata without shared desktop session persistence', () => {
  const desktopAuthAdapterSource = fs.readFileSync(
    path.join(import.meta.dirname, '../../web/src/desktop-adapter/web-auth-adapter.ts'),
    'utf8',
  );
  assert.match(
    desktopAuthAdapterSource,
    /const updatedAt = new Date\(\)\.toISOString\(\);\s*persistAuthSessionMetadata\(\{\s*user,\s*updatedAt,\s*expiresAt: resolveSessionExpiry\(accessToken, updatedAt\),\s*\}\);/s,
  );
  assert.doesNotMatch(
    desktopAuthAdapterSource,
    /if \(isWebShellMode\(\)\) \{\s*persistAuthSession\(\{\s*accessToken,\s*refreshToken,\s*user,/s,
  );
  assert.match(
    desktopAuthAdapterSource,
    /clearPersistedSession: async \(\) => \{\s*clearPersistedAccessToken\(\);\s*\}/s,
  );
  assert.doesNotMatch(desktopAuthAdapterSource, /isWebShellMode|localFirstPartyBlocked/);
  assert.match(desktopAuthAdapterSource, /Web auth session restore requires browser-owned session authority/);
  assert.doesNotMatch(desktopAuthAdapterSource, /realm\.services\.AuthService\.refreshToken\(\)/);
});

test('embedded auth menu passes Desktop E2E wiring ids into Kit main view', () => {
  assert.match(webAuthMenuSource, /logoTrigger: E2E_IDS\.loginLogoTrigger/);
  assert.match(webAuthMenuSource, /emailInput: E2E_IDS\.loginEmailInput/);
  assert.match(webAuthMenuSource, /alternativeToggle: E2E_IDS\.loginAlternativeToggle/);
  assert.match(webAuthMenuSource, /alternativePanel: E2E_IDS\.loginAlternativePanel/);
  assert.match(webAuthMenuSource, /emailSubmitArrow: E2E_IDS\.loginEmailSubmitArrow/);
});

test('embedded auth menu passes Desktop E2E wiring ids into Kit email view', () => {
  assert.match(webAuthMenuSource, /passwordInput: E2E_IDS\.loginPasswordInput/);
  assert.match(webAuthMenuSource, /otpButton: E2E_IDS\.loginOtpButton/);
});
