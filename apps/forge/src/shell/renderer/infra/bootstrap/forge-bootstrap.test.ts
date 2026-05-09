/**
 * Forge bootstrap regression tests (FG-SHELL-003 / FG-SHELL-004 /
 * FG-SHELL-011 / FG-SHELL-012). Locks the local-first-party-runtime contract:
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
const registerForgeModSdkHostMock = vi.fn();
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

vi.mock('./forge-runtime-host.js', () => ({
  registerForgeModSdkHost: registerForgeModSdkHostMock,
}));

vi.mock('@nimiplatform/nimi-kit/telemetry', () => ({
  logRendererEvent: vi.fn(),
}));

let useAppStore: typeof import('@renderer/app-shell/providers/app-store.js').useAppStore;
let runForgeBootstrap: typeof import('./forge-bootstrap.js').runForgeBootstrap;
let forgeRuntimeAccountCaller: typeof import('./forge-bootstrap.js').forgeRuntimeAccountCaller;

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

describe('forge-bootstrap (FG-SHELL-003 / FG-SHELL-011 / FG-SHELL-012)', () => {
  beforeEach(async () => {
    vi.resetModules();

    ({ useAppStore } = await import('@renderer/app-shell/providers/app-store.js'));
    ({ runForgeBootstrap, forgeRuntimeAccountCaller } = await import('./forge-bootstrap.js'));

    getRuntimeDefaultsMock.mockReset();
    getDaemonStatusMock.mockReset();
    createLocalFirstPartyRuntimePlatformClientMock.mockReset();
    clearPlatformClientMock.mockReset();
    registerForgeModSdkHostMock.mockReset();
    getAccountSessionStatusMock.mockReset();
    runtimeReadyMock.mockReset();

    useAppStore.setState({
      auth: { status: 'bootstrapping', user: null },
      bootstrapReady: false,
      bootstrapError: null,
      runtimeDefaults: null,
      creatorAccess: { checked: false, hasAccess: false, canCreateWorld: false, canMaintainWorld: false, records: [] },
      sidebarCollapsed: false,
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
  // FG-SHELL-011 / FG-SHELL-012: SDK helper, no app-owned token surface
  // -------------------------------------------------------------------------

  it('uses the local-first-party-runtime SDK helper and never the legacy createPlatformClient signature', async () => {
    getAccountSessionStatusMock.mockResolvedValue({
      state: AccountSessionState.AUTHENTICATED,
      accountProjection: { accountId: 'acct-1', displayName: 'Forge User' },
    });
    await runForgeBootstrap();
    expect(createLocalFirstPartyRuntimePlatformClientMock).toHaveBeenCalledTimes(1);
    const call = (createLocalFirstPartyRuntimePlatformClientMock.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(call.appId).toBe('app.nimi.forge');
    expect(call.realmBaseUrl).toBe('https://realm.test');
    // FG-SHELL-012: type-level rejection still enforced at runtime — these
    // keys MUST never appear.
    expect(call).not.toHaveProperty('accessToken');
    expect(call).not.toHaveProperty('accessTokenProvider');
    expect(call).not.toHaveProperty('refreshTokenProvider');
    expect(call).not.toHaveProperty('subjectUserIdProvider');
    expect(call).not.toHaveProperty('sessionStore');
  });

  it('uses LOCAL_FIRST_PARTY_APP caller with app.nimi.forge.local-first-party instance', async () => {
    expect(forgeRuntimeAccountCaller).toEqual({
      appId: 'app.nimi.forge',
      appInstanceId: 'app.nimi.forge.local-first-party',
      deviceId: 'local-first-party-device',
      mode: AccountCallerMode.LOCAL_FIRST_PARTY_APP,
      scopes: [],
    });
  });

  // -------------------------------------------------------------------------
  // FG-SHELL-004 step 2: AUTHENTICATED projection populates auth.user
  // -------------------------------------------------------------------------

  it('projects runtime account when AUTHENTICATED and clears creator access', async () => {
    getAccountSessionStatusMock.mockResolvedValue({
      state: AccountSessionState.AUTHENTICATED,
      accountProjection: { accountId: 'acct-42', displayName: 'Scoped User' },
    });

    await runForgeBootstrap();

    expect(getAccountSessionStatusMock).toHaveBeenCalledWith({
      caller: forgeRuntimeAccountCaller,
    });
    const auth = useAppStore.getState().auth;
    expect(auth.status).toBe('authenticated');
    expect(auth.user).toEqual({ id: 'acct-42', displayName: 'Scoped User' });
    // FG-SHELL-009: token / refreshToken fields MUST NOT exist on the slice.
    expect(auth).not.toHaveProperty('token');
    expect(auth).not.toHaveProperty('refreshToken');
    expect(useAppStore.getState().bootstrapReady).toBe(true);
  });

  // -------------------------------------------------------------------------
  // FG-SHELL-004 step 2: anonymous / unavailable / RPC error do not fail
  // -------------------------------------------------------------------------

  it('opens unauthenticated when runtime account state is ANONYMOUS', async () => {
    getAccountSessionStatusMock.mockResolvedValue({
      state: AccountSessionState.ANONYMOUS,
      accountProjection: null,
    });
    await runForgeBootstrap();
    expect(useAppStore.getState().bootstrapReady).toBe(true);
    expect(useAppStore.getState().auth.status).toBe('unauthenticated');
    expect(useAppStore.getState().auth.user).toBeNull();
  });

  it('opens unauthenticated when runtime account state is UNAVAILABLE', async () => {
    getAccountSessionStatusMock.mockResolvedValue({
      state: AccountSessionState.UNAVAILABLE,
      accountProjection: null,
    });
    await runForgeBootstrap();
    expect(useAppStore.getState().bootstrapReady).toBe(true);
    expect(useAppStore.getState().auth.status).toBe('unauthenticated');
  });

  it('opens unauthenticated when runtime account status RPC throws', async () => {
    getAccountSessionStatusMock.mockRejectedValue(new Error('runtime unreachable'));
    await runForgeBootstrap();
    expect(useAppStore.getState().bootstrapReady).toBe(true);
    expect(useAppStore.getState().auth.status).toBe('unauthenticated');
  });

  // -------------------------------------------------------------------------
  // FG-SHELL-012 source-text static lock: no legacy shared-session imports
  // -------------------------------------------------------------------------

  it('bootstrap module does not import legacy shared desktop auth-session helpers', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const source = fs.readFileSync(path.join(here, 'forge-bootstrap.ts'), 'utf8');
    // FG-SHELL-012: kit shared desktop session helpers are forbidden; Forge
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
    // FG-SHELL-011: must use the SDK helper, not the legacy constructor.
    expect(source).not.toMatch(/\bcreatePlatformClient\s*\(/);
    expect(source).toMatch(/createLocalFirstPartyRuntimePlatformClient/);
  });
});
