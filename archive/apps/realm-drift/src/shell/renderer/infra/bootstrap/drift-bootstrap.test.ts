/**
 * Realm Drift bootstrap regression tests (RD-SHELL-003 / RD-SHELL-004 /
 * RD-SHELL-009 / RD-SHELL-010). Locks the local-first-party-runtime contract:
 *
 * - Bootstrap constructs the platform client via `createLocalFirstPartyRuntimePlatformClient`,
 *   which type-rejects app-owned access/refresh tokens and session stores.
 * - Authenticated user comes from the runtime account projection
 *   (`runtime.account.getAccountSessionStatus`), never from a legacy persisted
 *   session bridge.
 * - ANONYMOUS / UNAVAILABLE / RPC errors do NOT fail bootstrap; the shell
 *   opens unauthenticated and the user signs in via the broker.
 * - The bootstrap MUST never invoke the legacy shared desktop auth-session
 *   bridge (`auth_session_load/save/clear`) and MUST never persist a refresh
 *   token at any layer.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AccountCallerMode,
  AccountSessionState,
} from '@nimiplatform/sdk/runtime/browser';

const getRuntimeDefaultsMock = vi.fn();
const createLocalFirstPartyRuntimePlatformClientMock = vi.fn();
const clearPlatformClientMock = vi.fn();
const getAccountSessionStatusMock = vi.fn();
const initI18nMock = vi.fn(async () => undefined);

vi.mock('@renderer/bridge', () => ({
  getRuntimeDefaults: getRuntimeDefaultsMock,
}));

vi.mock('@nimiplatform/sdk', () => ({
  createLocalFirstPartyRuntimePlatformClient: createLocalFirstPartyRuntimePlatformClientMock,
  clearPlatformClient: clearPlatformClientMock,
}));

vi.mock('@renderer/i18n/index.js', () => ({
  initI18n: initI18nMock,
}));

let useAppStore: typeof import('@renderer/app-shell/app-store.js').useAppStore;
let runDriftBootstrap: typeof import('./drift-bootstrap.js').runDriftBootstrap;
let driftRuntimeAccountCaller: typeof import('./drift-bootstrap.js').driftRuntimeAccountCaller;

function buildPlatformClientMock(): {
  runtime: {
    account: {
      getAccountSessionStatus: ReturnType<typeof vi.fn>;
    };
  };
} {
  return {
    runtime: {
      account: {
        getAccountSessionStatus: getAccountSessionStatusMock,
      },
    },
  };
}

describe('drift-bootstrap (RD-SHELL-003 / RD-SHELL-009 / RD-SHELL-010)', () => {
  beforeEach(async () => {
    vi.resetModules();

    ({ useAppStore } = await import('@renderer/app-shell/app-store.js'));
    ({ runDriftBootstrap, driftRuntimeAccountCaller } = await import('./drift-bootstrap.js'));

    getRuntimeDefaultsMock.mockReset();
    createLocalFirstPartyRuntimePlatformClientMock.mockReset();
    clearPlatformClientMock.mockReset();
    getAccountSessionStatusMock.mockReset();
    initI18nMock.mockReset();
    initI18nMock.mockResolvedValue(undefined);

    useAppStore.setState({
      auth: { status: 'bootstrapping', user: null },
      bootstrapReady: false,
      bootstrapError: null,
      runtimeDefaults: null,
    });

    getRuntimeDefaultsMock.mockResolvedValue({
      realm: { realmBaseUrl: 'https://realm.test', realtimeUrl: 'wss://realtime.test', accessToken: '' },
      runtime: { localProviderEndpoint: '', localProviderModel: '' },
    });
    createLocalFirstPartyRuntimePlatformClientMock.mockImplementation(async () =>
      buildPlatformClientMock(),
    );
  });

  // -------------------------------------------------------------------------
  // RD-SHELL-009 / RD-SHELL-010: SDK helper, no app-owned token surface
  // -------------------------------------------------------------------------

  it('uses the local-first-party-runtime SDK helper and never the legacy createPlatformClient signature', async () => {
    getAccountSessionStatusMock.mockResolvedValue({
      state: AccountSessionState.AUTHENTICATED,
      accountProjection: { accountId: 'acct-1', displayName: 'Drift User' },
    });
    await runDriftBootstrap();
    expect(createLocalFirstPartyRuntimePlatformClientMock).toHaveBeenCalledTimes(1);
    const call = (createLocalFirstPartyRuntimePlatformClientMock.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(call.appId).toBe('app.nimi.realm-drift');
    expect(call.realmBaseUrl).toBe('https://realm.test');
    // RD-SHELL-010: type-level rejection enforced at runtime — these keys
    // MUST never appear.
    expect(call).not.toHaveProperty('accessToken');
    expect(call).not.toHaveProperty('accessTokenProvider');
    expect(call).not.toHaveProperty('refreshTokenProvider');
    expect(call).not.toHaveProperty('subjectUserIdProvider');
    expect(call).not.toHaveProperty('sessionStore');
  });

  it('uses LOCAL_FIRST_PARTY_APP caller with app.nimi.realm-drift.local-first-party instance', async () => {
    expect(driftRuntimeAccountCaller).toEqual({
      appId: 'app.nimi.realm-drift',
      appInstanceId: 'app.nimi.realm-drift.local-first-party',
      deviceId: 'local-first-party-device',
      mode: AccountCallerMode.LOCAL_FIRST_PARTY_APP,
      scopes: [],
    });
  });

  // -------------------------------------------------------------------------
  // RD-SHELL-004 step 2: AUTHENTICATED projection populates auth.user
  // -------------------------------------------------------------------------

  it('projects runtime account when AUTHENTICATED', async () => {
    getAccountSessionStatusMock.mockResolvedValue({
      state: AccountSessionState.AUTHENTICATED,
      accountProjection: { accountId: 'acct-42', displayName: 'Scoped User' },
    });

    await runDriftBootstrap();

    expect(getAccountSessionStatusMock).toHaveBeenCalledWith({
      caller: driftRuntimeAccountCaller,
    });
    const auth = useAppStore.getState().auth;
    expect(auth.status).toBe('authenticated');
    expect(auth.user).toEqual({ id: 'acct-42', displayName: 'Scoped User' });
    // RD-SHELL-008 / RD-SHELL-010: token / refreshToken fields MUST NOT exist
    // on the slice.
    expect(auth).not.toHaveProperty('token');
    expect(auth).not.toHaveProperty('refreshToken');
    expect(useAppStore.getState().bootstrapReady).toBe(true);
  });

  // -------------------------------------------------------------------------
  // RD-SHELL-004 step 2: anonymous / unavailable / RPC error do not fail
  // -------------------------------------------------------------------------

  it('opens unauthenticated when runtime account state is ANONYMOUS', async () => {
    getAccountSessionStatusMock.mockResolvedValue({
      state: AccountSessionState.ANONYMOUS,
      accountProjection: null,
    });
    await runDriftBootstrap();
    expect(useAppStore.getState().bootstrapReady).toBe(true);
    expect(useAppStore.getState().auth.status).toBe('unauthenticated');
  });

  it('opens unauthenticated when runtime account state is UNAVAILABLE', async () => {
    getAccountSessionStatusMock.mockResolvedValue({
      state: AccountSessionState.UNAVAILABLE,
      accountProjection: null,
    });
    await runDriftBootstrap();
    expect(useAppStore.getState().bootstrapReady).toBe(true);
    expect(useAppStore.getState().auth.status).toBe('unauthenticated');
  });

  it('opens unauthenticated when runtime account status RPC throws', async () => {
    getAccountSessionStatusMock.mockRejectedValue(new Error('runtime unreachable'));
    await runDriftBootstrap();
    expect(useAppStore.getState().bootstrapReady).toBe(true);
    expect(useAppStore.getState().auth.status).toBe('unauthenticated');
  });

  // -------------------------------------------------------------------------
  // RD-SHELL-010 source-text static lock: no legacy shared-session imports
  // -------------------------------------------------------------------------

  it('bootstrap module does not import legacy shared desktop auth-session helpers', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const source = fs.readFileSync(path.join(here, 'drift-bootstrap.ts'), 'utf8');
    expect(source).not.toMatch(/persistSharedDesktopAuthSession/);
    expect(source).not.toMatch(/resolveDesktopBootstrapAuthSession/);
    expect(source).not.toMatch(/import\b[\s\S]*\b(loadAuthSession|saveAuthSession)\b[\s\S]*from\s+['"]@renderer\/bridge/);
    expect(source).not.toMatch(/import\b[\s\S]*\bclearAuthSession\s+as\s+clearPersistedAuthSession[\s\S]*from\s+['"]@renderer\/bridge/);
    expect(source).not.toMatch(/refreshTokenProvider/);
    expect(source).not.toMatch(/accessTokenProvider/);
    expect(source).not.toMatch(/subjectUserIdProvider/);
    expect(source).not.toMatch(/\bsessionStore\b/);
    expect(source).not.toMatch(/\bcreatePlatformClient\s*\(/);
    expect(source).toMatch(/createLocalFirstPartyRuntimePlatformClient/);
  });
});
