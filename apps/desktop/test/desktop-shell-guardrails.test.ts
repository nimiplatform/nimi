import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { isExpectedAnonymousSessionError, toAuthUserRecord } from '../src/shell/renderer/features/auth/auth-session-utils';
import { confirmDialog, openExternalUrl } from '@nimiplatform/kit/shell/renderer/bridge';
import { ReasonCode } from '@nimiplatform/sdk/types';

type WindowLike = {
  __NIMI_TAURI_TEST__?: {
    invoke?: (command: string, payload?: unknown) => Promise<unknown> | unknown;
    listen?: (eventName: string, handler: (event: { payload: unknown }) => void) => (() => void) | Promise<() => void>;
  };
  confirm?: (message?: string) => boolean;
  open?: (url?: string | URL, target?: string, features?: string) => unknown;
  location?: {
    origin?: string;
    href?: string;
  };
};

function installWindowMock(windowMock: WindowLike): () => void {
  const globalRecord = globalThis as Record<string, unknown>;
  const previousWindow = globalRecord.window;
  globalRecord.window = windowMock;
  return () => {
    if (typeof previousWindow === 'undefined') {
      delete globalRecord.window;
    } else {
      globalRecord.window = previousWindow;
    }
  };
}

test('auth session utils only coerce object user payloads and keep anonymous session errors explicit', () => {
  assert.deepEqual(toAuthUserRecord({ id: 'user-1' }), { id: 'user-1' });
  assert.equal(toAuthUserRecord(null), null);
  assert.equal(toAuthUserRecord(['user-1']), null);

  assert.equal(isExpectedAnonymousSessionError({ reasonCode: ReasonCode.AUTH_TOKEN_INVALID }), true);
  assert.equal(isExpectedAnonymousSessionError(new Error('HTTP_401 unauthorized')), true);
  assert.equal(isExpectedAnonymousSessionError(new Error('contract mismatch')), false);
});

test('openExternalUrl rejects non-http protocols before invoking browser APIs', async () => {
  let opened = false;
  const restoreWindow = installWindowMock({
    open: () => {
      opened = true;
      return {};
    },
    location: {
      origin: 'https://app.nimi.example',
      href: 'https://app.nimi.example/login',
    },
  });

  try {
    await assert.rejects(
      () => openExternalUrl('javascript:alert(1)'),
      /Only http\/https URLs are supported/,
    );
    assert.equal(opened, false);
  } finally {
    restoreWindow();
  }
});

test('confirmDialog falls back to window.confirm outside Tauri', async () => {
  let confirmMessage = '';
  const restoreWindow = installWindowMock({
    confirm: (message?: string) => {
      confirmMessage = String(message || '');
      return true;
    },
  });

  try {
    const result = await confirmDialog({
      title: 'Discard pending changes',
      description: 'Discard the pending settings changes?',
      level: 'warning',
    });
    assert.equal(result.confirmed, true);
    assert.equal(confirmMessage, 'Discard the pending settings changes?');
  } finally {
    restoreWindow();
  }
});

test('confirmDialog invokes the fixed tauri command and payload shape', async () => {
  let observedCommand = '';
  let observedPayload: unknown = null;
  const restoreWindow = installWindowMock({
    __NIMI_TAURI_TEST__: {
      invoke: async (command, payload) => {
        observedCommand = command;
        observedPayload = payload;
        return { confirmed: false };
      },
    },
  });

  try {
    const result = await confirmDialog({
      title: 'Discard pending changes',
      description: 'Discard the pending settings changes?',
      level: 'warning',
    });
    assert.equal(result.confirmed, false);
    assert.equal(observedCommand, 'confirm_dialog');
    assert.deepEqual(observedPayload, {
      payload: {
        title: 'Discard pending changes',
        description: 'Discard the pending settings changes?',
        level: 'warning',
      },
    });
  } finally {
    restoreWindow();
  }
});

test('proxyHttp fallback blocks private-network absolute URLs outside the app origin', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('fetch should not be reached for blocked private URLs');
  }) as typeof fetch;

  try {
    const restoreWindow = installWindowMock({
      location: {
        origin: 'https://app.nimi.example',
        href: 'https://app.nimi.example/settings',
      },
    });
    try {
      const { proxyHttp } = await import('../src/shell/renderer/bridge/runtime-bridge/http');
      await assert.rejects(
        () => proxyHttp({ url: 'http://169.254.169.254/latest/meta-data' }),
        /禁止访问私有网络地址/,
      );
    } finally {
      restoreWindow();
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('desktop shell source guardrails keep auth helpers centralized', () => {
  const desktopTauriConfigSource = fs.readFileSync(
    path.join(import.meta.dirname, '../src-tauri/tauri.conf.json'),
    'utf8',
  );
  const desktopRendererRoot = path.join(import.meta.dirname, '../src/shell/renderer');
  const authMenuSource = fs.readFileSync(
    path.join(import.meta.dirname, '../src/shell/renderer/features/auth/web-auth-menu.tsx'),
    'utf8',
  );
  const mainSource = fs.readFileSync(
    path.join(import.meta.dirname, '../src/shell/renderer/main.tsx'),
    'utf8',
  );
  const authAdapterSource = fs.readFileSync(
    path.join(import.meta.dirname, '../src/shell/renderer/features/auth/desktop-auth-adapter.ts'),
    'utf8',
  );
  const logoutSource = fs.readFileSync(
    path.join(import.meta.dirname, '../src/shell/renderer/features/auth/logout.ts'),
    'utf8',
  );
  const bootstrapAuthSource = fs.readFileSync(
    path.join(import.meta.dirname, '../src/shell/renderer/infra/bootstrap/runtime-bootstrap-auth.ts'),
    'utf8',
  );
  const runtimeBootstrapSource = fs.readFileSync(
    path.join(import.meta.dirname, '../src/shell/renderer/infra/bootstrap/runtime-bootstrap.ts'),
    'utf8',
  );
  const smokeDriverSource = fs.readFileSync(
    path.join(import.meta.dirname, '../src/shell/renderer/infra/bootstrap/desktop-macos-smoke-driver-deps.ts'),
    'utf8',
  );
  const sessionLoggingSource = fs.readFileSync(
    path.join(import.meta.dirname, '../src-tauri/src/main_parts/session_logging.rs'),
    'utf8',
  );
  const systemResourcesSource = fs.readFileSync(
    path.join(import.meta.dirname, '../src-tauri/src/main_parts/defaults_and_commands/system_resources.rs'),
    'utf8',
  );
  assert.doesNotMatch(authMenuSource, /function toAuthUserRecord/);
  assert.match(mainSource, /createRendererEntryModuleLoader/);
  assert.match(mainSource, /describeRendererEntryFailureReason/);
  assert.match(mainSource, /from '@nimiplatform\/kit\/shell\/renderer\/bootstrap'/);
  assert.doesNotMatch(mainSource, /function isRetryableEntryImportError|function createEntryImportError|Failed to fetch dynamically imported module|Importing a module script failed/);
  assert.doesNotMatch(desktopTauriConfigSource, /"pubkey"\s*:\s*"dev-placeholder"/);
  assert.doesNotMatch(authAdapterSource, /as Promise</);
  for (const source of [authAdapterSource, logoutSource, runtimeBootstrapSource, smokeDriverSource]) {
    assert.match(source, /createDesktopShellRuntimeAccountCaller/);
    assert.doesNotMatch(source, /appInstanceId:\s*['"`]nimi\.desktop\.local-first-party/);
    assert.doesNotMatch(source, /deviceId:\s*['"`]desktop-shell/);
    assert.doesNotMatch(source, /mode:\s*2/);
    assert.doesNotMatch(source, /scopes:\s*\[\]/);
  }
  assert.doesNotMatch(authAdapterSource, /发送验证码失败|验证码登录失败|2FA 验证失败|获取钱包签名挑战失败|钱包登录失败|OAuth 登录失败/);
  assert.match(bootstrapAuthSource, /RuntimeAccountService owns local account truth/);
  assert.doesNotMatch(bootstrapAuthSource, /auth_session_load|auth_session_save|auth_session_clear/);
  assert.doesNotMatch(bootstrapAuthSource, /as Record<string, unknown>/);
  assert.match(sessionLoggingSource, /ns_window_ptr\.is_null\(\)/);
  assert.match(systemResourcesSource, /static MACOS_CPU_COUNT: OnceLock<f64> = OnceLock::new\(\);/);
  assert.match(systemResourcesSource, /MACOS_CPU_COUNT\.get_or_init/);
  assert.doesNotMatch(systemResourcesSource, /collect_cpu_percent\(\)[\s\S]*read_command_output\("sysctl", &\["-n", "hw\.ncpu"\]\)/);
  assert.equal(fs.existsSync(path.join(import.meta.dirname, '../src/runtime/net/json.ts')), false);
  for (const sourcePath of [
    'infra/offline/cache-manager.ts',
    'infra/offline/types.ts',
    'infra/local-agent-courier/provision-courier.ts',
    'infra/local-agent-courier/termination-courier.ts',
    'infra/realm/realm-api.ts',
    'features/chat/data/realm-human-chat-data.ts',
    'features/chat/data/realm-group-chat-data.ts',
    'features/social/data/profile-data.ts',
    'features/social/data/realm-social-data.ts',
    'features/agent-detail/data/realm-agent-detail-data.ts',
    'features/world/data/realm-world-data.ts',
  ]) {
    const source = fs.readFileSync(path.join(desktopRendererRoot, sourcePath), 'utf8');
    assert.doesNotMatch(source, /@runtime\/net\/json/);
    assert.match(source, /@nimiplatform\/sdk\/types/);
  }
});
