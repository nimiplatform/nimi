/**
 * ParentOS bootstrap regression tests (PO-SHELL-001 / PO-SHELL-008 / spec
 * K-ACCSVC-008). Locks the local-first-party-runtime contract:
 *
 * - Bootstrap constructs the platform client via `createLocalFirstPartyRuntimePlatformClient`,
 *   which type-rejects app-owned access/refresh tokens and session stores.
 * - Authenticated subject for the local SQLite scope comes from the runtime
 *   account projection (`runtime.account.getAccountSessionStatus`), never
 *   from a legacy persisted session bridge.
 * - Anonymous / unavailable runtime account states do NOT fail bootstrap;
 *   ParentOS opens against the anonymous local scope.
 * - The bootstrap must never invoke the legacy shared desktop auth-session
 *   bridge (`auth_session_load`/`save`/`clear`) and must never persist a
 *   refresh token at any layer.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AccountCallerMode,
  AccountSessionState,
} from '@nimiplatform/sdk/runtime/browser';

const getRuntimeDefaultsMock = vi.fn();
const createLocalFirstPartyRuntimePlatformClientMock = vi.fn();
const clearPlatformClientMock = vi.fn();
const dbInitMock = vi.fn();
const getAppSettingMock = vi.fn();
const getChildMock = vi.fn();
const getFamilyMock = vi.fn();
const getChildrenMock = vi.fn();
const loadPersistedParentosAIConfigMock = vi.fn();
const mapChildRowMock = vi.fn();
const getAccountSessionStatusMock = vi.fn();
const runtimeReadyMock = vi.fn();

vi.mock('../bridge/parentos-runtime-defaults.js', () => ({
  getParentOSRuntimeDefaults: getRuntimeDefaultsMock,
}));

vi.mock('@nimiplatform/sdk', () => ({
  createLocalFirstPartyRuntimePlatformClient: createLocalFirstPartyRuntimePlatformClientMock,
  clearPlatformClient: clearPlatformClientMock,
}));

vi.mock('../bridge/sqlite-bridge.js', () => ({
  dbInit: dbInitMock,
  getAppSetting: getAppSettingMock,
  getChild: getChildMock,
  getFamily: getFamilyMock,
  getChildren: getChildrenMock,
}));

vi.mock('../bridge/mappers.js', () => ({
  mapChildRow: mapChildRowMock,
}));

vi.mock('../features/settings/parentos-ai-config.js', () => ({
  loadPersistedParentosAIConfig: loadPersistedParentosAIConfigMock,
}));

let useAppStore: typeof import('../app-shell/app-store.js').useAppStore;
let runParentOSBootstrap: typeof import('./parentos-bootstrap.js').runParentOSBootstrap;
let syncParentOSLocalDataScope: typeof import('./parentos-bootstrap.js').syncParentOSLocalDataScope;
let parentosRuntimeAccountCaller: typeof import('./parentos-bootstrap.js').parentosRuntimeAccountCaller;

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

describe('parentos-bootstrap (PO-SHELL-001 / PO-SHELL-008)', () => {
  beforeEach(async () => {
    vi.resetModules();

    ({ useAppStore } = await import('../app-shell/app-store.js'));
    ({
      runParentOSBootstrap,
      syncParentOSLocalDataScope,
      parentosRuntimeAccountCaller,
    } = await import('./parentos-bootstrap.js'));

    getRuntimeDefaultsMock.mockReset();
    createLocalFirstPartyRuntimePlatformClientMock.mockReset();
    clearPlatformClientMock.mockReset();
    dbInitMock.mockReset();
    getAppSettingMock.mockReset();
    getChildMock.mockReset();
    getFamilyMock.mockReset();
    getChildrenMock.mockReset();
    loadPersistedParentosAIConfigMock.mockReset();
    mapChildRowMock.mockReset();
    getAccountSessionStatusMock.mockReset();
    runtimeReadyMock.mockReset();

    useAppStore.setState({
      auth: { status: 'bootstrapping', user: null },
      bootstrapReady: false,
      bootstrapError: null,
      runtimeDefaults: null,
      familyId: null,
      children: [],
      activeChildId: null,
      aiConfig: null,
    });

    getRuntimeDefaultsMock.mockResolvedValue({
      webBaseUrl: '',
      realm: { realmBaseUrl: 'https://realm.test', accessToken: '' },
      runtime: { sandboxRoot: '', materialRoot: '', defaultUploadPath: '' },
    });
    createLocalFirstPartyRuntimePlatformClientMock.mockImplementation(async () =>
      buildPlatformClientMock(),
    );
    runtimeReadyMock.mockResolvedValue(undefined);
    loadPersistedParentosAIConfigMock.mockResolvedValue(null);
    getAppSettingMock.mockResolvedValue('');
    getChildMock.mockResolvedValue(null);
    getFamilyMock.mockResolvedValue({ familyId: 'family-anon' });
    getChildrenMock.mockResolvedValue([]);
    mapChildRowMock.mockImplementation((row: unknown) => row);
  });

  // -------------------------------------------------------------------------
  // Authentication path: runtime account projection drives the scope
  // -------------------------------------------------------------------------

  it('uses the local-first-party-runtime SDK helper and never the legacy createPlatformClient signature', async () => {
    getAccountSessionStatusMock.mockResolvedValue({
      state: AccountSessionState.AUTHENTICATED,
      accountProjection: { accountId: 'acct-1', displayName: 'User One' },
    });
    await runParentOSBootstrap();
    expect(createLocalFirstPartyRuntimePlatformClientMock).toHaveBeenCalledTimes(1);
    const call = createLocalFirstPartyRuntimePlatformClientMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.appId).toBe('app.nimi.parentos');
    expect(call.realmBaseUrl).toBe('https://realm.test');
    // PO-SHELL-008: type-level rejection still enforced at runtime — these
    // keys must never appear.
    expect(call).not.toHaveProperty('accessToken');
    expect(call).not.toHaveProperty('accessTokenProvider');
    expect(call).not.toHaveProperty('refreshTokenProvider');
    expect(call).not.toHaveProperty('subjectUserIdProvider');
    expect(call).not.toHaveProperty('sessionStore');
  });

  it('uses LOCAL_FIRST_PARTY_APP caller with app.nimi.parentos.local-first-party instance', async () => {
    expect(parentosRuntimeAccountCaller).toEqual({
      appId: 'app.nimi.parentos',
      appInstanceId: 'app.nimi.parentos.local-first-party',
      deviceId: 'local-first-party-device',
      mode: AccountCallerMode.LOCAL_FIRST_PARTY_APP,
      scopes: [],
    });
  });

  it('switches local SQLite scope to the runtime-projected accountId when authenticated', async () => {
    getAccountSessionStatusMock.mockResolvedValue({
      state: AccountSessionState.AUTHENTICATED,
      accountProjection: { accountId: 'acct-42', displayName: 'Scoped' },
    });
    getFamilyMock.mockResolvedValue({ familyId: 'family-42' });

    await runParentOSBootstrap();

    // Account projection user id is what enters the scope, not any legacy
    // persisted-session subject.
    expect(getAccountSessionStatusMock).toHaveBeenCalledWith({
      caller: parentosRuntimeAccountCaller,
    });
    expect(dbInitMock).toHaveBeenCalledWith('acct-42');
    const auth = useAppStore.getState().auth;
    expect(auth.status).toBe('authenticated');
    expect(auth.user).toEqual({ id: 'acct-42', displayName: 'Scoped' });
  });

  // -------------------------------------------------------------------------
  // Anonymous path: runtime ANONYMOUS / UNAVAILABLE / errors must not fail
  // -------------------------------------------------------------------------

  it('proceeds to the anonymous local scope when runtime account state is ANONYMOUS', async () => {
    getAccountSessionStatusMock.mockResolvedValue({
      state: AccountSessionState.ANONYMOUS,
      accountProjection: null,
    });
    await runParentOSBootstrap();
    expect(useAppStore.getState().bootstrapReady).toBe(true);
    expect(useAppStore.getState().auth.status).toBe('unauthenticated');
    expect(dbInitMock).toHaveBeenCalledWith(null);
  });

  it('proceeds to the anonymous local scope when runtime account state is UNAVAILABLE', async () => {
    getAccountSessionStatusMock.mockResolvedValue({
      state: AccountSessionState.UNAVAILABLE,
      accountProjection: null,
    });
    await runParentOSBootstrap();
    expect(useAppStore.getState().bootstrapReady).toBe(true);
    expect(useAppStore.getState().auth.status).toBe('unauthenticated');
    expect(dbInitMock).toHaveBeenCalledWith(null);
  });

  it('proceeds to the anonymous local scope when runtime account status RPC throws', async () => {
    getAccountSessionStatusMock.mockRejectedValue(new Error('runtime unreachable'));
    await runParentOSBootstrap();
    expect(useAppStore.getState().bootstrapReady).toBe(true);
    expect(useAppStore.getState().auth.status).toBe('unauthenticated');
    expect(dbInitMock).toHaveBeenCalledWith(null);
  });

  // -------------------------------------------------------------------------
  // Spec hard-cut lock: no legacy refresh-token / shared-session imports
  // -------------------------------------------------------------------------

  it('bootstrap module does not import legacy shared desktop auth-session helpers', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const source = fs.readFileSync(path.join(here, 'parentos-bootstrap.ts'), 'utf8');
    // PO-SHELL-008: the kit's shared desktop session helpers are forbidden;
    // ParentOS must not own refresh-token custody at any layer.
    expect(source).not.toMatch(/persistSharedDesktopAuthSession/);
    expect(source).not.toMatch(/resolveDesktopBootstrapAuthSession/);
    // Legacy Tauri auth_session_* bridge imports are forbidden (the host
    // commands were already disabled at the Rust layer; the bridge import
    // surface must not re-introduce them).
    expect(source).not.toMatch(/import\b[\s\S]*\b(loadAuthSession|saveAuthSession)\b[\s\S]*from\s+['"]\.\.\/bridge/);
    expect(source).not.toMatch(/import\b[\s\S]*\bclearAuthSession\s+as\s+clearPersistedAuthSession[\s\S]*from\s+['"]\.\.\/bridge/);
    expect(source).not.toMatch(/refreshTokenProvider/);
    expect(source).not.toMatch(/accessTokenProvider/);
  });

  // -------------------------------------------------------------------------
  // Scope switching on user change
  // -------------------------------------------------------------------------

  it('clears stale local state before switching to a new account scope', async () => {
    const childTemplate = {
      gender: 'female' as const,
      birthDate: '2020-01-01',
      birthWeightKg: null,
      birthHeightCm: null,
      birthHeadCircCm: null,
      avatarPath: null,
      nurtureMode: 'balanced' as const,
      nurtureModeOverrides: null,
      allergies: null,
      medicalNotes: null,
      recorderProfiles: null,
      createdAt: '',
      updatedAt: '',
    };
    useAppStore.setState({
      familyId: 'old-family',
      children: [
        {
          childId: 'old-child',
          familyId: 'old-family',
          displayName: 'Old',
          ...childTemplate,
        },
      ],
      activeChildId: 'old-child',
    });

    getFamilyMock.mockResolvedValue({ familyId: 'family-new' });
    getChildrenMock.mockResolvedValue([
      {
        childId: 'child-new',
        familyId: 'family-new',
        displayName: 'New',
        ...childTemplate,
        gender: 'male' as const,
        birthDate: '2024-06-01',
      },
    ]);

    await syncParentOSLocalDataScope('acct-new');

    expect(dbInitMock).toHaveBeenCalledWith('acct-new');
    expect(useAppStore.getState().familyId).toBe('family-new');
    expect(useAppStore.getState().activeChildId).toBe('child-new');
  });
});
