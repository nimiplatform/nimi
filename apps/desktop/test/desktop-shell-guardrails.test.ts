import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isNimiRealmExpectedAnonymousSessionError,
  toNimiRealmAuthUserRecord,
} from '@nimiplatform/sdk/realm';
import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import { confirmDialog, openExternalUrl } from '@nimiplatform/kit/shell/renderer/bridge';
import { ReasonCode } from '@nimiplatform/sdk/types';

type WindowLike = {
  __NIMI_ELECTRON_TEST__?: {
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

test('SDK auth projection only coerces object user payloads and keeps anonymous session errors explicit', () => {
  assert.deepEqual(toNimiRealmAuthUserRecord({ id: 'user-1' }), { id: 'user-1' });
  assert.equal(toNimiRealmAuthUserRecord(null), null);
  assert.equal(toNimiRealmAuthUserRecord(['user-1']), null);

  assert.equal(isNimiRealmExpectedAnonymousSessionError({ reasonCode: ReasonCode.AUTH_TOKEN_INVALID }), true);
  assert.equal(isNimiRealmExpectedAnonymousSessionError(new Error('HTTP_401 unauthorized')), false);
  assert.equal(isNimiRealmExpectedAnonymousSessionError(new Error('contract mismatch')), false);
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

test('confirmDialog fails closed outside a standard shell host', async () => {
  const restoreWindow = installWindowMock({
    confirm: () => true,
  });

  try {
    await assert.rejects(
      () => confirmDialog({
        title: 'Discard pending changes',
        description: 'Discard the pending settings changes?',
        level: 'warning',
      }),
      /Standard shell host invoke is not available/,
    );
  } finally {
    restoreWindow();
  }
});

test('confirmDialog invokes the standard shell UI command and payload shape', async () => {
  let observedCommand = '';
  let observedPayload: unknown = null;
  const restoreWindow = installWindowMock({
    __NIMI_ELECTRON_TEST__: {
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
    assert.equal(observedCommand, NIMI_STANDARD_SHELL_COMMANDS['shell-ui.confirmDialog']);
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

test('proxyHttp fails closed without the Electron standard shell host', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = (async () => {
    fetchCalled = true;
    throw new Error('renderer fetch must not be reached');
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
        /Desktop HTTP requests require the Electron standard shell host/,
      );
      assert.equal(fetchCalled, false);
    } finally {
      restoreWindow();
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
