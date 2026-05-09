/**
 * Lookdev bootstrap regression tests (LD-SHELL-010 / LD-SHELL-011 /
 * LD-SHELL-012). Locks the local-first-party-runtime contract:
 *
 * - Bootstrap constructs the platform client via `createLocalFirstPartyRuntimePlatformClient`,
 *   which type-rejects app-owned access/refresh tokens and session stores.
 * - Authenticated user comes from the runtime account projection
 *   (`runtime.account.getAccountSessionStatus`), never from a legacy persisted
 *   session bridge.
 * - ANONYMOUS / UNAVAILABLE / RPC errors do NOT fail bootstrap; the shell
 *   opens in unauthenticated state.
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
const getDaemonStatusMock = vi.fn();
const createLocalFirstPartyRuntimePlatformClientMock = vi.fn();
const clearPlatformClientMock = vi.fn();
const getAccountSessionStatusMock = vi.fn();
const runtimeReadyMock = vi.fn();

vi.mock('@renderer/bridge', () => ({
  getRuntimeDefaults: getRuntimeDefaultsMock,
  getDaemonStatus: getDaemonStatusMock,
}));

vi.mock('@nimiplatform/sdk', () => ({
  createLocalFirstPartyRuntimePlatformClient: createLocalFirstPartyRuntimePlatformClientMock,
  clearPlatformClient: clearPlatformClientMock,
}));

vi.mock('@nimiplatform/nimi-kit/telemetry', () => ({
  logRendererEvent: vi.fn(),
}));

let useAppStore: typeof import('@renderer/app-shell/providers/app-store.js').useAppStore;
let runLookdevBootstrap: typeof import('./lookdev-bootstrap.js').runLookdevBootstrap;
let lookdevRuntimeAccountCaller: typeof import('./lookdev-bootstrap.js').lookdevRuntimeAccountCaller;

function buildPlatformClientMock(): {
  runtime: {
    ready: ReturnType<typeof vi.fn>;
    account: {
      getAccountSessionStatus: ReturnType<typeof vi.fn>;
    };
  };
} {
  return {
    runtime: {
      ready: runtimeReadyMock,
      account: {
        getAccountSessionStatus: getAccountSessionStatusMock,
      },
    },
  };
}

describe('lookdev-bootstrap (LD-SHELL-010 / LD-SHELL-011 / LD-SHELL-012)', () => {
  beforeEach(async () => {
    vi.resetModules();

    ({ useAppStore } = await import('@renderer/app-shell/providers/app-store.js'));
    ({ runLookdevBootstrap, lookdevRuntimeAccountCaller } = await import('./lookdev-bootstrap.js'));

    getRuntimeDefaultsMock.mockReset();
    getDaemonStatusMock.mockReset();
    createLocalFirstPartyRuntimePlatformClientMock.mockReset();
    clearPlatformClientMock.mockReset();
    getAccountSessionStatusMock.mockReset();
    runtimeReadyMock.mockReset();

    useAppStore.setState({
      auth: { status: 'bootstrapping', user: null },
      bootstrapReady: false,
      bootstrapError: null,
      runtimeDefaults: null,
    });

    getRuntimeDefaultsMock.mockResolvedValue({
      realm: { realmBaseUrl: 'https://realm.test', accessToken: '' },
      runtime: { localProviderEndpoint: '', localProviderModel: '' },
    });
    createLocalFirstPartyRuntimePlatformClientMock.mockImplementation(async () =>
      buildPlatformClientMock(),
    );
    runtimeReadyMock.mockResolvedValue(undefined);
    getDaemonStatusMock.mockResolvedValue({ running: true, managed: false });
  });

  // -------------------------------------------------------------------------
  // LD-SHELL-010 / LD-SHELL-011: SDK helper, no app-owned token surface
  // -------------------------------------------------------------------------

  it('uses the local-first-party-runtime SDK helper and never the legacy createPlatformClient signature', async () => {
    getAccountSessionStatusMock.mockResolvedValue({
      state: AccountSessionState.AUTHENTICATED,
      accountProjection: { accountId: 'acct-1', displayName: 'Lookdev User' },
    });
    await runLookdevBootstrap();
    expect(createLocalFirstPartyRuntimePlatformClientMock).toHaveBeenCalledTimes(1);
    const call = (createLocalFirstPartyRuntimePlatformClientMock.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(call.appId).toBe('app.nimi.lookdev');
    expect(call.realmBaseUrl).toBe('https://realm.test');
    // LD-SHELL-011: type-level rejection still enforced at runtime — these
    // keys MUST never appear.
    expect(call).not.toHaveProperty('accessToken');
    expect(call).not.toHaveProperty('accessTokenProvider');
    expect(call).not.toHaveProperty('refreshTokenProvider');
    expect(call).not.toHaveProperty('subjectUserIdProvider');
    expect(call).not.toHaveProperty('sessionStore');
  });

  it('uses LOCAL_FIRST_PARTY_APP caller with app.nimi.lookdev.local-first-party instance', async () => {
    expect(lookdevRuntimeAccountCaller).toEqual({
      appId: 'app.nimi.lookdev',
      appInstanceId: 'app.nimi.lookdev.local-first-party',
      deviceId: 'local-first-party-device',
      mode: AccountCallerMode.LOCAL_FIRST_PARTY_APP,
      scopes: [],
    });
  });

  // -------------------------------------------------------------------------
  // LD-SHELL-012 step 3: AUTHENTICATED projection populates auth.user
  // -------------------------------------------------------------------------

  it('projects runtime account when AUTHENTICATED', async () => {
    getAccountSessionStatusMock.mockResolvedValue({
      state: AccountSessionState.AUTHENTICATED,
      accountProjection: { accountId: 'acct-42', displayName: 'Scoped User' },
    });

    await runLookdevBootstrap();

    expect(getAccountSessionStatusMock).toHaveBeenCalledWith({
      caller: lookdevRuntimeAccountCaller,
    });
    const auth = useAppStore.getState().auth;
    expect(auth.status).toBe('authenticated');
    expect(auth.user).toEqual({ id: 'acct-42', displayName: 'Scoped User' });
    // LD-SHELL-011: token / refreshToken fields MUST NOT exist on the slice.
    expect(auth).not.toHaveProperty('token');
    expect(auth).not.toHaveProperty('refreshToken');
    expect(useAppStore.getState().bootstrapReady).toBe(true);
  });

  // -------------------------------------------------------------------------
  // LD-SHELL-012 step 3: anonymous / unavailable / RPC error do not fail
  // -------------------------------------------------------------------------

  it('opens unauthenticated when runtime account state is ANONYMOUS', async () => {
    getAccountSessionStatusMock.mockResolvedValue({
      state: AccountSessionState.ANONYMOUS,
      accountProjection: null,
    });
    await runLookdevBootstrap();
    expect(useAppStore.getState().bootstrapReady).toBe(true);
    expect(useAppStore.getState().auth.status).toBe('unauthenticated');
    expect(useAppStore.getState().auth.user).toBeNull();
  });

  it('opens unauthenticated when runtime account state is UNAVAILABLE', async () => {
    getAccountSessionStatusMock.mockResolvedValue({
      state: AccountSessionState.UNAVAILABLE,
      accountProjection: null,
    });
    await runLookdevBootstrap();
    expect(useAppStore.getState().bootstrapReady).toBe(true);
    expect(useAppStore.getState().auth.status).toBe('unauthenticated');
  });

  it('opens unauthenticated when runtime account status RPC throws', async () => {
    getAccountSessionStatusMock.mockRejectedValue(new Error('runtime unreachable'));
    await runLookdevBootstrap();
    expect(useAppStore.getState().bootstrapReady).toBe(true);
    expect(useAppStore.getState().auth.status).toBe('unauthenticated');
  });

  // -------------------------------------------------------------------------
  // LD-SHELL-011 source-text static lock: no legacy shared-session imports
  // -------------------------------------------------------------------------

  it('bootstrap module does not import legacy shared desktop auth-session helpers', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const source = fs.readFileSync(path.join(here, 'lookdev-bootstrap.ts'), 'utf8');
    // LD-SHELL-011: kit shared desktop session helpers are forbidden; Lookdev
    // MUST NOT own refresh-token custody at any layer.
    expect(source).not.toMatch(/persistSharedDesktopAuthSession/);
    expect(source).not.toMatch(/resolveDesktopBootstrapAuthSession/);
    // Legacy Tauri auth_session_* bridge imports are forbidden.
    expect(source).not.toMatch(/import\b[\s\S]*\b(loadAuthSession|saveAuthSession)\b[\s\S]*from\s+['"]@renderer\/bridge/);
    expect(source).not.toMatch(/import\b[\s\S]*\bclearAuthSession\s+as\s+clearPersistedAuthSession[\s\S]*from\s+['"]@renderer\/bridge/);
    expect(source).not.toMatch(/refreshTokenProvider/);
    expect(source).not.toMatch(/accessTokenProvider/);
    expect(source).not.toMatch(/subjectUserIdProvider/);
    expect(source).not.toMatch(/\bsessionStore\b/);
    // LD-SHELL-010: must use the SDK helper, not the legacy constructor.
    expect(source).not.toMatch(/\bcreatePlatformClient\s*\(/);
    expect(source).toMatch(/createLocalFirstPartyRuntimePlatformClient/);
  });
});
