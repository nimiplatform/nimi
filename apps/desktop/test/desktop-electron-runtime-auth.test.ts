import assert from 'node:assert/strict';
import test from 'node:test';

import { AccountCallerMode, AccountSessionState } from '@nimiplatform/sdk/runtime/generated';
import {
  type DesktopElectronRuntimeAuthRuntime,
  createDesktopElectronTrustedRuntimeMetadataProvider,
  isDesktopRuntimeLocalProductControlMethodId,
} from '../src-electron/runtime-auth.js';

test('Desktop Electron trusted Runtime metadata keeps product-control host identity anonymous', async () => {
  const calls: string[] = [];
  const provider = createDesktopElectronTrustedRuntimeMetadataProvider({
    appId: 'nimi.desktop',
    runtimeEndpoint: '127.0.0.1:46371',
    runtime: createFakeDesktopElectronRuntime(calls),
  });

  const metadata = await provider({
    command: 'nimi.shell.runtime.unary',
    methodId: '/nimi.runtime.v1.RuntimeLocalService/GetProductControlRecord',
    appId: 'nimi.desktop',
    runtimeEndpoint: '127.0.0.1:46371',
    event: {},
  });

  assert.equal(isDesktopRuntimeLocalProductControlMethodId('/nimi.runtime.v1.RuntimeLocalService/GetProductControlRecord'), true);
  assert.deepEqual(calls, []);
  assert.deepEqual(metadata, {
    metadata: {
      participantId: 'nimi.desktop',
      callerKind: 'desktop-core',
      callerId: 'desktop.product-control',
      surfaceId: 'desktop.product-control',
    },
  });
});

test('Desktop Electron trusted Runtime metadata is host-owned and not developer-registered', async () => {
  const calls: Array<{ readonly kind: string; readonly request: Record<string, unknown>; readonly options?: unknown }> = [];
  const provider = createDesktopElectronTrustedRuntimeMetadataProvider({
    appId: 'nimi.desktop',
    runtimeEndpoint: '127.0.0.1:46371',
    runtime: createFakeDesktopElectronRuntime(calls),
  });

  const metadata = await provider({
    command: 'nimi.shell.runtime.unary',
    methodId: '/nimi.runtime.v1.RuntimeAgentService/ListAgents',
    appId: 'nimi.desktop',
    runtimeEndpoint: '127.0.0.1:46371',
    event: {},
  });

  const statusCall = calls.find((call) => call.kind === 'getAccountSessionStatus');
  const registerCall = calls.find((call) => call.kind === 'registerApp');
  const tokenCall = calls.find((call) => call.kind === 'authorizeExternalPrincipal');
  assert.equal((statusCall?.request.caller as { readonly mode?: unknown } | undefined)?.mode, AccountCallerMode.DESKTOP_SHELL);
  assert.equal(registerCall?.request.developerRegistration, false);
  assert.equal(tokenCall?.request.subjectUserId, 'account-1');
  assert.deepEqual(metadata, {
    appSession: {
      sessionId: 'session-id',
      sessionToken: 'session-token',
    },
    protectedAccessToken: {
      tokenId: 'protected-token-id',
      secret: 'protected-token-secret',
    },
  });
});

test('Desktop Electron trusted Runtime metadata returns unavailable while Runtime account is unauthenticated', async () => {
  const calls: Array<{ readonly kind: string; readonly request: Record<string, unknown>; readonly options?: unknown }> = [];
  const provider = createDesktopElectronTrustedRuntimeMetadataProvider({
    appId: 'nimi.desktop',
    runtimeEndpoint: '127.0.0.1:46371',
    runtime: createFakeDesktopElectronRuntime(calls, { authenticated: false }),
  });

  const metadata = await provider({
    command: 'nimi.shell.runtime.unary',
    methodId: '/nimi.runtime.v1.RuntimeAgentService/ListAgents',
    appId: 'nimi.desktop',
    runtimeEndpoint: '127.0.0.1:46371',
    event: {},
  });

  assert.equal(metadata, undefined);
  assert.deepEqual(calls.map((call) => call.kind), ['getAccountSessionStatus']);
});

function createFakeDesktopElectronRuntime(
  calls: Array<{ readonly kind: string; readonly request: Record<string, unknown>; readonly options?: unknown }> | string[],
  input: { readonly authenticated?: boolean } = {},
): DesktopElectronRuntimeAuthRuntime {
  const authenticated = input.authenticated !== false;
  const push = (kind: string, request: Record<string, unknown>, options?: unknown) => {
    calls.push({ kind, request, options } as never);
  };
  return {
    account: {
      getAccountSessionStatus: async (request: Record<string, unknown>, options?: unknown) => {
        push('getAccountSessionStatus', request, options);
        return authenticated
          ? {
            state: AccountSessionState.AUTHENTICATED,
            accountProjection: { accountId: 'account-1' },
          }
          : { state: AccountSessionState.ANONYMOUS };
      },
    },
    auth: {
      registerApp: async (request: Record<string, unknown>, options?: unknown) => {
        push('registerApp', request, options);
        return { accepted: true };
      },
      openSession: async (request: Record<string, unknown>, options?: unknown) => {
        push('openSession', request, options);
        return {
          sessionId: 'session-id',
          sessionToken: 'session-token',
          expiresAt: { seconds: Math.floor((Date.now() + 3_600_000) / 1000), nanos: 0 },
        };
      },
    },
    grants: {
      authorizeExternalPrincipal: async (request: Record<string, unknown>, options?: unknown) => {
        push('authorizeExternalPrincipal', request, options);
        return {
          tokenId: 'protected-token-id',
          secret: 'protected-token-secret',
          expiresAt: { seconds: Math.floor((Date.now() + 3_600_000) / 1000), nanos: 0 },
        };
      },
    },
  } as unknown as DesktopElectronRuntimeAuthRuntime;
}
