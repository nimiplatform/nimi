/**
 * Overtone bootstrap regression tests.
 *
 * Locks the local-first-party-runtime contract:
 *
 * - Bootstrap constructs the platform client via `createLocalFirstPartyRuntimePlatformClient`,
 *   which type-rejects app-owned access/refresh tokens and session stores.
 * - Authenticated user comes from the runtime account projection
 *   (`runtime.account.getAccountSessionStatus`), never from a legacy persisted
 *   session bridge or env-token shortcut.
 * - ANONYMOUS / UNAVAILABLE / RPC errors do NOT fail bootstrap; the shell
 *   opens unauthenticated and the user signs in via the broker.
 * - The bootstrap MUST never read VITE_NIMI_REALM_ACCESS_TOKEN or any
 *   bearer-token env shortcut.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AccountCallerMode,
  AccountSessionState,
} from '@nimiplatform/sdk/runtime/browser';

vi.stubEnv('VITE_NIMI_REALM_BASE_URL', 'https://realm.example.test');

const createLocalFirstPartyRuntimePlatformClientMock = vi.fn();
const clearPlatformClientMock = vi.fn();
const getAccountSessionStatusMock = vi.fn();

vi.mock('@nimiplatform/sdk', () => ({
  createLocalFirstPartyRuntimePlatformClient: createLocalFirstPartyRuntimePlatformClientMock,
  clearPlatformClient: clearPlatformClientMock,
}));

let useAppStore: typeof import('@renderer/app-shell/providers/app-store.js').useAppStore;
let runOvertoneBootstrap: typeof import('./overtone-bootstrap.js').runOvertoneBootstrap;
let overtoneRuntimeAccountCaller: typeof import('./overtone-bootstrap.js').overtoneRuntimeAccountCaller;

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

describe('overtone-bootstrap (RuntimeAccountService admission)', () => {
  beforeEach(async () => {
    vi.resetModules();

    ({ useAppStore } = await import('@renderer/app-shell/providers/app-store.js'));
    ({ runOvertoneBootstrap, overtoneRuntimeAccountCaller } = await import('./overtone-bootstrap.js'));

    createLocalFirstPartyRuntimePlatformClientMock.mockReset();
    clearPlatformClientMock.mockReset();
    getAccountSessionStatusMock.mockReset();

    useAppStore.setState({
      authStatus: 'bootstrapping',
      authUser: null,
      realmConfigured: false,
      realmAuthenticated: false,
    });

    createLocalFirstPartyRuntimePlatformClientMock.mockImplementation(async () =>
      buildPlatformClientMock(),
    );
  });

  // -------------------------------------------------------------------------
  // SDK helper, no app-owned token surface
  // -------------------------------------------------------------------------

  it('uses the local-first-party-runtime SDK helper and never the legacy createPlatformClient signature', async () => {
    getAccountSessionStatusMock.mockResolvedValue({
      state: AccountSessionState.AUTHENTICATED,
      accountProjection: { accountId: 'acct-1', displayName: 'Overtone User' },
    });
    await runOvertoneBootstrap();
    expect(createLocalFirstPartyRuntimePlatformClientMock).toHaveBeenCalledTimes(1);
    const call = (createLocalFirstPartyRuntimePlatformClientMock.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(call.appId).toBe('app.nimi.overtone');
    expect(call.realmBaseUrl).toBe('https://realm.example.test');
    // Type-level rejection enforced at runtime — these keys MUST never
    // appear.
    expect(call).not.toHaveProperty('accessToken');
    expect(call).not.toHaveProperty('accessTokenProvider');
    expect(call).not.toHaveProperty('refreshTokenProvider');
    expect(call).not.toHaveProperty('subjectUserIdProvider');
    expect(call).not.toHaveProperty('sessionStore');
  });

  it('uses LOCAL_FIRST_PARTY_APP caller with app.nimi.overtone.local-first-party instance', async () => {
    expect(overtoneRuntimeAccountCaller).toEqual({
      appId: 'app.nimi.overtone',
      appInstanceId: 'app.nimi.overtone.local-first-party',
      deviceId: 'local-first-party-device',
      mode: AccountCallerMode.LOCAL_FIRST_PARTY_APP,
      scopes: [],
    });
  });

  // -------------------------------------------------------------------------
  // AUTHENTICATED projection populates auth + realm-connection state
  // -------------------------------------------------------------------------

  it('projects runtime account when AUTHENTICATED and flips realm-connection state', async () => {
    getAccountSessionStatusMock.mockResolvedValue({
      state: AccountSessionState.AUTHENTICATED,
      accountProjection: { accountId: 'acct-42', displayName: 'Scoped User' },
    });

    await runOvertoneBootstrap();

    expect(getAccountSessionStatusMock).toHaveBeenCalledWith({
      caller: overtoneRuntimeAccountCaller,
    });
    const state = useAppStore.getState();
    expect(state.authStatus).toBe('authenticated');
    expect(state.authUser).toEqual({ id: 'acct-42', displayName: 'Scoped User' });
    expect(state.realmConfigured).toBe(true);
    expect(state.realmAuthenticated).toBe(true);
    // Flat-store discipline: the legacy token fields MUST NOT exist on the
    // store any more.
    expect(state).not.toHaveProperty('authToken');
    expect(state).not.toHaveProperty('authRefreshToken');
  });

  // -------------------------------------------------------------------------
  // Anonymous / unavailable / RPC error do not fail bootstrap
  // -------------------------------------------------------------------------

  it('opens unauthenticated when runtime account state is ANONYMOUS', async () => {
    getAccountSessionStatusMock.mockResolvedValue({
      state: AccountSessionState.ANONYMOUS,
      accountProjection: null,
    });
    await runOvertoneBootstrap();
    const state = useAppStore.getState();
    expect(state.authStatus).toBe('unauthenticated');
    expect(state.authUser).toBeNull();
    expect(state.realmConfigured).toBe(true);
    expect(state.realmAuthenticated).toBe(false);
  });

  it('opens unauthenticated when runtime account state is UNAVAILABLE', async () => {
    getAccountSessionStatusMock.mockResolvedValue({
      state: AccountSessionState.UNAVAILABLE,
      accountProjection: null,
    });
    await runOvertoneBootstrap();
    expect(useAppStore.getState().authStatus).toBe('unauthenticated');
  });

  it('opens unauthenticated when runtime account status RPC throws', async () => {
    getAccountSessionStatusMock.mockRejectedValue(new Error('runtime unreachable'));
    await runOvertoneBootstrap();
    expect(useAppStore.getState().authStatus).toBe('unauthenticated');
  });

  // -------------------------------------------------------------------------
  // Source-text static lock — Wave A-fix env-token shortcut ban
  // -------------------------------------------------------------------------

  it('bootstrap module does not read VITE_NIMI_REALM_ACCESS_TOKEN or import legacy auth helpers', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const source = fs.readFileSync(path.join(here, 'overtone-bootstrap.ts'), 'utf8');
    // Wave A-fix constraint: bearer-token env shortcut MUST NOT survive in
    // any renderer surface. The "dev convenience" path is gone; no new
    // path may bypass the runtime broker login.
    expect(source).not.toMatch(/VITE_NIMI_REALM_ACCESS_TOKEN/);
    expect(source).not.toMatch(/persistSharedDesktopAuthSession/);
    expect(source).not.toMatch(/resolveDesktopBootstrapAuthSession/);
    expect(source).not.toMatch(/import\b[\s\S]*\b(loadAuthSession|saveAuthSession)\b[\s\S]*from\s+['"]@renderer\/bridge/);
    expect(source).not.toMatch(/refreshTokenProvider/);
    expect(source).not.toMatch(/accessTokenProvider/);
    expect(source).not.toMatch(/subjectUserIdProvider/);
    expect(source).not.toMatch(/\bsessionStore\b/);
    // Must use the SDK helper, not the legacy constructor.
    expect(source).not.toMatch(/\bcreatePlatformClient\s*\(/);
    expect(source).toMatch(/createLocalFirstPartyRuntimePlatformClient/);
  });
});
