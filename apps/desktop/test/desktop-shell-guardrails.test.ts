import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { isExpectedAnonymousSessionError, toAuthUserRecord } from '../src/shell/renderer/features/auth/auth-session-utils';
import { openExternalUrl } from '../src/shell/renderer/bridge/runtime-bridge/ui';
import { subscribeRuntimeModReloadResult } from '../src/shell/renderer/bridge/runtime-bridge/mod-local';

type WindowLike = {
  __TAURI__?: {
    core?: {
      invoke?: (command: string, payload?: unknown) => Promise<unknown> | unknown;
    };
    event?: {
      listen?: (eventName: string, handler: (event: { payload: unknown }) => void) => (() => void) | Promise<() => void>;
    };
  };
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

  assert.equal(isExpectedAnonymousSessionError({ reasonCode: 'AUTH_TOKEN_INVALID' }), true);
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
      /仅支持 http\/https 链接/,
    );
    assert.equal(opened, false);
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

test('subscribeRuntimeModReloadResult forwards parsed reload events through the listener', async () => {
  let handler: ((event: { payload: unknown }) => void) | null = null;
  let unsubscribed = false;
  const restoreWindow = installWindowMock({
    __TAURI__: {
      event: {
        listen: (_eventName, nextHandler) => {
          handler = nextHandler;
          return () => {
            unsubscribed = true;
          };
        },
      },
    },
  });

  try {
    const received: Array<Record<string, unknown>> = [];
    const unsubscribe = await subscribeRuntimeModReloadResult((event) => {
      received.push(event as unknown as Record<string, unknown>);
    });

    const emitReload = handler as ((event: { payload: unknown }) => void) | null;
    if (emitReload) {
      emitReload({
        payload: {
          modId: 'mod.alpha',
          sourceId: 'source.dev',
          status: 'resolved',
          occurredAt: '2026-03-21T01:40:00Z',
        },
      });
    }

    assert.deepEqual(received, [
      {
        modId: 'mod.alpha',
        sourceId: 'source.dev',
        status: 'resolved',
        occurredAt: '2026-03-21T01:40:00Z',
        error: undefined,
      },
    ]);

    unsubscribe();
    assert.equal(unsubscribed, true);
  } finally {
    restoreWindow();
  }
});

test('desktop shell source guardrails keep particle cleanup and auth helpers centralized', () => {
  const authMenuSource = fs.readFileSync(
    path.join(import.meta.dirname, '../src/shell/renderer/features/auth/web-auth-menu.tsx'),
    'utf8',
  );
  const authAdapterSource = fs.readFileSync(
    path.join(import.meta.dirname, '../src/shell/renderer/features/auth/desktop-auth-adapter.ts'),
    'utf8',
  );
  const particleSource = fs.readFileSync(
    path.join(import.meta.dirname, '../src/shell/renderer/features/auth/particle-background-light.tsx'),
    'utf8',
  );
  const turnInputSource = fs.readFileSync(
    path.join(import.meta.dirname, '../src/shell/renderer/features/turns/turn-input.tsx'),
    'utf8',
  );

  assert.doesNotMatch(authMenuSource, /function toAuthUserRecord/);
  assert.doesNotMatch(authAdapterSource, /as Promise</);
  assert.doesNotMatch(authAdapterSource, /发送验证码失败|验证码登录失败|2FA 验证失败|获取钱包签名挑战失败|钱包登录失败|OAuth 登录失败/);
  assert.match(particleSource, /spatialBuckets/);
  assert.match(particleSource, /renderer\.forceContextLoss\(\)/);
  assert.match(turnInputSource, /from '\.\/emoji-data'/);
  assert.doesNotMatch(turnInputSource, /const EMOJI_CATEGORIES = \[/);
});
