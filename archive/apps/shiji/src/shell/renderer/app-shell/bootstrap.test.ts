/**
 * ShiJi bootstrap regression tests (SJ-SHELL-001 / SJ-SHELL-002 /
 * SJ-SHELL-010 / SJ-SHELL-011). Locks the local-first-party-runtime contract
 * AND the blocking runtime.ready (15s) + db_init semantics:
 *
 * - Bootstrap constructs the platform client via `createLocalFirstPartyRuntimePlatformClient`,
 *   which type-rejects app-owned access/refresh tokens and session stores.
 * - Authenticated user comes from the runtime account projection
 *   (`runtime.account.getAccountSessionStatus`), never from a legacy persisted
 *   session bridge.
 * - ANONYMOUS / UNAVAILABLE / RPC errors do NOT fail bootstrap; the shell
 *   opens unauthenticated and the user signs in via the broker.
 * - SQLite init (`db_init`) is BLOCKING — failure must fail-close the bootstrap.
 * - runtime.ready is BLOCKING with a 15s timeout — failure must fail-close.
 * - The bootstrap MUST never invoke the legacy shared desktop auth-session
 *   bridge (`auth_session_load/save/clear`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AccountCallerMode,
  AccountSessionState,
} from '@nimiplatform/sdk/runtime/browser';

const getRuntimeDefaultsMock = vi.fn();
const getDaemonStatusMock = vi.fn();
const startDaemonMock = vi.fn();
const invokeMock = vi.fn();
const createLocalFirstPartyRuntimePlatformClientMock = vi.fn();
const clearPlatformClientMock = vi.fn();
const getAccountSessionStatusMock = vi.fn();
const runtimeReadyMock = vi.fn();

vi.mock('@renderer/bridge', () => ({
  getRuntimeDefaults: getRuntimeDefaultsMock,
  getDaemonStatus: getDaemonStatusMock,
  startDaemon: startDaemonMock,
  invoke: invokeMock,
}));

vi.mock('@nimiplatform/sdk', () => ({
  createLocalFirstPartyRuntimePlatformClient: createLocalFirstPartyRuntimePlatformClientMock,
  clearPlatformClient: clearPlatformClientMock,
}));

vi.mock('@nimiplatform/kit/telemetry', () => ({
  logRendererEvent: vi.fn(),
}));

let useAppStore: typeof import('./app-store.js').useAppStore;
let runShiJiBootstrap: typeof import('./bootstrap.js').runShiJiBootstrap;
let shijiRuntimeAccountCaller: typeof import('./bootstrap.js').shijiRuntimeAccountCaller;

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

describe('shiji-bootstrap (SJ-SHELL-001 / SJ-SHELL-010 / SJ-SHELL-011)', () => {
  beforeEach(async () => {
    vi.resetModules();

    ({ useAppStore } = await import('./app-store.js'));
    ({ runShiJiBootstrap, shijiRuntimeAccountCaller } = await import('./bootstrap.js'));

    getRuntimeDefaultsMock.mockReset();
    getDaemonStatusMock.mockReset();
    startDaemonMock.mockReset();
    invokeMock.mockReset();
    createLocalFirstPartyRuntimePlatformClientMock.mockReset();
    clearPlatformClientMock.mockReset();
    getAccountSessionStatusMock.mockReset();
    runtimeReadyMock.mockReset();

    useAppStore.setState({
      auth: { status: 'bootstrapping', user: null },
      bootstrapReady: false,
      bootstrapError: null,
      runtimeDefaults: null,
      aiModel: '',
    });

    getRuntimeDefaultsMock.mockResolvedValue({
      realm: { realmBaseUrl: 'https://realm.test', accessToken: '' },
      runtime: { localProviderEndpoint: '', localProviderModel: 'shiji-default-model' },
    });
    createLocalFirstPartyRuntimePlatformClientMock.mockImplementation(async () =>
      buildPlatformClientMock(),
    );
    runtimeReadyMock.mockResolvedValue(undefined);
    invokeMock.mockResolvedValue(undefined);
    getDaemonStatusMock.mockResolvedValue({ running: true, managed: false });
    startDaemonMock.mockResolvedValue({ running: true });
  });

  // -------------------------------------------------------------------------
  // SJ-SHELL-010 / SJ-SHELL-011: SDK helper, no app-owned token surface
  // -------------------------------------------------------------------------

  it('uses the local-first-party-runtime SDK helper and never the legacy createPlatformClient signature', async () => {
    getAccountSessionStatusMock.mockResolvedValue({
      state: AccountSessionState.AUTHENTICATED,
      accountProjection: { accountId: 'acct-1', displayName: 'ShiJi User' },
    });
    await runShiJiBootstrap();
    expect(createLocalFirstPartyRuntimePlatformClientMock).toHaveBeenCalledTimes(1);
    const call = (createLocalFirstPartyRuntimePlatformClientMock.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(call.appId).toBe('app.nimi.shiji');
    expect(call.realmBaseUrl).toBe('https://realm.test');
    // SJ-SHELL-011: type-level rejection enforced at runtime — these keys
    // MUST never appear.
    expect(call).not.toHaveProperty('accessToken');
    expect(call).not.toHaveProperty('accessTokenProvider');
    expect(call).not.toHaveProperty('refreshTokenProvider');
    expect(call).not.toHaveProperty('subjectUserIdProvider');
    expect(call).not.toHaveProperty('sessionStore');
  });

  it('uses LOCAL_FIRST_PARTY_APP caller with app.nimi.shiji.local-first-party instance', async () => {
    expect(shijiRuntimeAccountCaller).toEqual({
      appId: 'app.nimi.shiji',
      appInstanceId: 'app.nimi.shiji.local-first-party',
      deviceId: 'local-first-party-device',
      mode: AccountCallerMode.LOCAL_FIRST_PARTY_APP,
      scopes: [],
    });
  });

  // -------------------------------------------------------------------------
  // SJ-SHELL-002 step 3: AUTHENTICATED projection populates auth.user
  // -------------------------------------------------------------------------

  it('projects runtime account when AUTHENTICATED', async () => {
    getAccountSessionStatusMock.mockResolvedValue({
      state: AccountSessionState.AUTHENTICATED,
      accountProjection: { accountId: 'acct-42', displayName: 'Scoped User' },
    });

    await runShiJiBootstrap();

    expect(getAccountSessionStatusMock).toHaveBeenCalledWith({
      caller: shijiRuntimeAccountCaller,
    });
    const auth = useAppStore.getState().auth;
    expect(auth.status).toBe('authenticated');
    expect(auth.user).toEqual({ id: 'acct-42', displayName: 'Scoped User' });
    // SJ-SHELL-011: token / refreshToken fields MUST NOT exist on the slice.
    expect(auth).not.toHaveProperty('token');
    expect(auth).not.toHaveProperty('refreshToken');
    expect(useAppStore.getState().bootstrapReady).toBe(true);
  });

  // -------------------------------------------------------------------------
  // SJ-SHELL-002 step 3: anonymous / unavailable / RPC error do not fail
  // -------------------------------------------------------------------------

  it('opens unauthenticated when runtime account state is ANONYMOUS', async () => {
    getAccountSessionStatusMock.mockResolvedValue({
      state: AccountSessionState.ANONYMOUS,
      accountProjection: null,
    });
    await runShiJiBootstrap();
    expect(useAppStore.getState().bootstrapReady).toBe(true);
    expect(useAppStore.getState().auth.status).toBe('unauthenticated');
  });

  it('opens unauthenticated when runtime account state is UNAVAILABLE', async () => {
    getAccountSessionStatusMock.mockResolvedValue({
      state: AccountSessionState.UNAVAILABLE,
      accountProjection: null,
    });
    await runShiJiBootstrap();
    expect(useAppStore.getState().bootstrapReady).toBe(true);
    expect(useAppStore.getState().auth.status).toBe('unauthenticated');
  });

  it('opens unauthenticated when runtime account status RPC throws (still completes bootstrap)', async () => {
    getAccountSessionStatusMock.mockRejectedValue(new Error('runtime unreachable'));
    await runShiJiBootstrap();
    expect(useAppStore.getState().bootstrapReady).toBe(true);
    expect(useAppStore.getState().auth.status).toBe('unauthenticated');
  });

  // -------------------------------------------------------------------------
  // SJ-SHELL-001 step 4: BLOCKING SQLite init — failure fail-closes bootstrap
  // -------------------------------------------------------------------------

  it('fails bootstrap when db_init throws (SJ-SHELL-001 step 4 is blocking)', async () => {
    getAccountSessionStatusMock.mockResolvedValue({
      state: AccountSessionState.ANONYMOUS,
      accountProjection: null,
    });
    invokeMock.mockRejectedValue(new Error('sqlite open failed'));
    await runShiJiBootstrap();
    expect(useAppStore.getState().bootstrapReady).toBe(false);
    expect(useAppStore.getState().bootstrapError).toMatch(/sqlite open failed/);
  });

  // -------------------------------------------------------------------------
  // SJ-SHELL-001 step 5: BLOCKING runtime.ready 15s timeout fail-close
  // -------------------------------------------------------------------------

  it('fails bootstrap when runtime daemon cannot start (SJ-SHELL-001 step 5)', async () => {
    getAccountSessionStatusMock.mockResolvedValue({
      state: AccountSessionState.ANONYMOUS,
      accountProjection: null,
    });
    getDaemonStatusMock.mockResolvedValue({ running: false });
    startDaemonMock.mockResolvedValue({ running: false, lastError: 'daemon refused to start' });
    await runShiJiBootstrap();
    expect(useAppStore.getState().bootstrapReady).toBe(false);
    expect(useAppStore.getState().bootstrapError).toMatch(/daemon refused to start/);
  });

  it('fails bootstrap when runtime.ready exceeds 15s (SJ-SHELL-001 step 5 timeout)', async () => {
    vi.useFakeTimers();
    try {
      getAccountSessionStatusMock.mockResolvedValue({
        state: AccountSessionState.ANONYMOUS,
        accountProjection: null,
      });
      // runtime.ready never resolves — the 15s timeout MUST trip.
      runtimeReadyMock.mockImplementation(() => new Promise(() => {}));
      const bootstrapDone = runShiJiBootstrap();
      // Advance past the 15s timeout window.
      await vi.advanceTimersByTimeAsync(15_001);
      await bootstrapDone;
      expect(useAppStore.getState().bootstrapReady).toBe(false);
      expect(useAppStore.getState().bootstrapError).toMatch(/runtime ready timeout \(15s\)/);
    } finally {
      vi.useRealTimers();
    }
  });

  // -------------------------------------------------------------------------
  // SJ-SHELL-011 source-text static lock: no legacy shared-session imports
  // -------------------------------------------------------------------------

  it('bootstrap module does not import legacy shared desktop auth-session helpers', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const source = fs.readFileSync(path.join(here, 'bootstrap.ts'), 'utf8');
    // SJ-SHELL-011: kit shared desktop session helpers are forbidden; ShiJi
    // MUST NOT own refresh-token custody at any layer.
    expect(source).not.toMatch(/persistSharedDesktopAuthSession/);
    expect(source).not.toMatch(/resolveDesktopBootstrapAuthSession/);
    expect(source).not.toMatch(/import\b[\s\S]*\b(loadAuthSession|saveAuthSession)\b[\s\S]*from\s+['"]@renderer\/bridge/);
    expect(source).not.toMatch(/import\b[\s\S]*\bclearAuthSession\s+as\s+clearPersistedAuthSession[\s\S]*from\s+['"]@renderer\/bridge/);
    expect(source).not.toMatch(/refreshTokenProvider/);
    expect(source).not.toMatch(/accessTokenProvider/);
    expect(source).not.toMatch(/subjectUserIdProvider/);
    expect(source).not.toMatch(/\bsessionStore\b/);
    // SJ-SHELL-010: must use the SDK helper, not the legacy constructor.
    expect(source).not.toMatch(/\bcreatePlatformClient\s*\(/);
    expect(source).toMatch(/createLocalFirstPartyRuntimePlatformClient/);
    // SJ-SHELL-001 step 4+5: blocking semantics MUST be preserved.
    expect(source).toMatch(/db_init/);
    expect(source).toMatch(/SHIJI_RUNTIME_READY_TIMEOUT_MS/);
  });
});
