// T4-W4 acceptance — Apps card UI: 11 canonical card states + actions.
//
// Proves the W4 closed loop:
//   1. each of the 11 canonical card states derives correctly from the SDK
//      `AppLaunchReadiness` floor composed WITH the live `NimiRuntimeAppInstallJob`
//      projection (the four job-dependent states are unreachable from the
//      floor alone);
//   2. every card action routes onto the `DesktopAppLifecycleBridge` (no
//      renderer-local lifecycle);
//   3. the panel projection fails closed on a missing job projection.
//
// Authority: `product-manual-full-authority.md` `#### Canonical Card States`,
// `result-t4-remaining-preflight.md` §3, P-NAPP-008.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type {
  NimiAppClient,
  NimiAppInventoryEntry,
  NimiAppRow,
  NimiAppStatus,
  NimiAppTransport,
} from '@nimiplatform/sdk/app';
import { NimiAppClient as NimiAppClientCtor } from '@nimiplatform/sdk/app';
import { ReasonCode } from '@nimiplatform/sdk/types';

import {
  CANONICAL_APP_CARD_STATES,
  deriveAppCardState,
  postureForCardState,
  selectLatestJobForApp,
  type CanonicalAppCardState,
} from '../src/shell/renderer/features/apps/apps-card-state.js';
import {
  actionPlanForInventoryEntry,
  actionPlanForCardState,
  type AppCardActionId,
} from '../src/shell/renderer/features/apps/apps-card-actions.js';
import {
  routeCardAction,
  appLaunchScopeRef,
} from '../src/shell/renderer/features/apps/apps-panel-controller.js';
import { projectAppsPanel } from '../src/shell/renderer/features/apps/apps-panel-projection.js';
import type {
  DesktopAppLifecycleBridge,
  NimiRuntimeAppInstallJob,
  NimiRuntimeAppOpenProjection,
  NimiRuntimeAppStorageProjection,
} from '../src/shell/renderer/features/apps/apps-lifecycle-bridge.js';

// ---------------------------------------------------------------------------
// Typed fixtures.
// ---------------------------------------------------------------------------

function job(overrides: Partial<NimiRuntimeAppInstallJob>): NimiRuntimeAppInstallJob {
  return {
    jobId: 'job-01',
    appId: 'nimi.notes',
    kind: 'install',
    releaseDescriptorRef: 'descriptor-01',
    installedVersion: '1.0.0',
    state: 'in_progress',
    phase: 'download',
    sourceKind: 'bundled',
    artifactBytes: 4096,
    storage: {
      appRoot: '/data/apps/nimi.notes',
      releaseRoot: '/data/apps/nimi.notes/releases/1.0.0',
      durableDataRoot: '/data/apps/nimi.notes/data',
      cacheRoot: '/data/apps/nimi.notes/cache',
      tempRoot: '/data/apps/nimi.notes/tmp',
    },
    retryable: false,
    ...overrides,
  };
}

function status(overrides: Partial<NimiAppStatus> = {}): NimiAppStatus {
  return { appId: 'nimi.notes', launchReadiness: 'ready', ...overrides };
}

function storageProjection(appId = 'nimi.notes'): NimiRuntimeAppStorageProjection {
  return {
    appId,
    state: 'ready',
    appRoot: `/data/apps/${appId}`,
    activeReleaseRoot: `/data/apps/${appId}/releases/1.0.0`,
    durableDataRoot: `/data/apps/${appId}/data`,
    cacheRoot: `/data/apps/${appId}/cache`,
    tempRoot: `/data/apps/${appId}/tmp`,
    activeVersion: '1.0.0',
    storagePolicyRef: 'nimi-data-app-roots',
  };
}

// ---------------------------------------------------------------------------
// (1) All 11 canonical card states derive correctly.
// ---------------------------------------------------------------------------

describe('deriveAppCardState — 11 canonical card states', () => {
  it('derives the 7 floor-reachable states from the readiness floor alone', () => {
    const floor: Array<[NimiAppStatus['launchReadiness'], CanonicalAppCardState]> = [
      ['install-required', 'not_installed_installable'],
      ['ready', 'installed_ready'],
      ['update-required', 'update_required'],
      ['permission-required', 'permission_required'],
      ['repair-required', 'repair_required'],
      ['unsupported', 'unsupported_on_this_device'],
      ['blocked-by-master-gate', 'blocked_by_policy'],
    ];
    for (const [readiness, expected] of floor) {
      const derived = deriveAppCardState({
        readiness,
        status: status({ launchReadiness: readiness }),
        job: undefined,
      });
      assert.equal(derived, expected, `floor ${readiness} -> ${expected}`);
    }
  });

  it('refines `ready` to `update_available` when a newer non-breaking version is offered', () => {
    const derived = deriveAppCardState({
      readiness: 'ready',
      status: status({ installedVersion: '1.0.0', availableVersion: '1.1.0' }),
      job: undefined,
    });
    assert.equal(derived, 'update_available');
  });

  it('derives `installing` from a live in-flight install job (not reachable from the floor)', () => {
    const derived = deriveAppCardState({
      readiness: 'install-required',
      status: status({ launchReadiness: 'install-required' }),
      job: job({ kind: 'install', state: 'in_progress', phase: 'download' }),
    });
    assert.equal(derived, 'installing');
  });

  it('derives `uninstalling` from a live in-flight uninstall job', () => {
    const derived = deriveAppCardState({
      readiness: 'ready',
      status: status(),
      job: job({ kind: 'uninstall', state: 'in_progress', phase: 'swap' }),
    });
    assert.equal(derived, 'uninstalling');
  });

  it('derives `install_failed` from a terminal failed job', () => {
    const derived = deriveAppCardState({
      readiness: 'install-required',
      status: status({ launchReadiness: 'install-required' }),
      job: job({ state: 'failed', phase: 'failed', reasonCode: 'RUNTIME_APP_DOWNLOAD_FAILED' }),
    });
    assert.equal(derived, 'install_failed');
  });

  it('lets the floor re-resolve a terminal success/cancel job (no parallel job truth)', () => {
    // A terminal `installed` install job -> floor `ready` -> `installed_ready`.
    assert.equal(
      deriveAppCardState({
        readiness: 'ready',
        status: status(),
        job: job({ state: 'installed', phase: 'installed' }),
      }),
      'installed_ready',
    );
    // A cancelled install -> floor `install-required` -> `not_installed_installable`.
    assert.equal(
      deriveAppCardState({
        readiness: 'install-required',
        status: status({ launchReadiness: 'install-required' }),
        job: job({ state: 'cancelled', phase: 'cancelled' }),
      }),
      'not_installed_installable',
    );
  });

  it('covers every one of the 11 canonical states with a derivation path', () => {
    // Build one derivation per canonical state and assert the full set is hit.
    const derived = new Set<CanonicalAppCardState>([
      deriveAppCardState({ readiness: 'install-required', status: status({ launchReadiness: 'install-required' }), job: undefined }),
      deriveAppCardState({ readiness: 'install-required', status: status({ launchReadiness: 'install-required' }), job: job({ kind: 'install', state: 'queued', phase: 'queued' }) }),
      deriveAppCardState({ readiness: 'ready', status: status(), job: undefined }),
      deriveAppCardState({ readiness: 'ready', status: status({ installedVersion: '1.0.0', availableVersion: '2.0.0' }), job: undefined }),
      deriveAppCardState({ readiness: 'update-required', status: status({ launchReadiness: 'update-required' }), job: undefined }),
      deriveAppCardState({ readiness: 'permission-required', status: status({ launchReadiness: 'permission-required' }), job: undefined }),
      deriveAppCardState({ readiness: 'repair-required', status: status({ launchReadiness: 'repair-required' }), job: undefined }),
      deriveAppCardState({ readiness: 'unsupported', status: status({ launchReadiness: 'unsupported' }), job: undefined }),
      deriveAppCardState({ readiness: 'blocked-by-master-gate', status: status({ launchReadiness: 'blocked-by-master-gate' }), job: undefined }),
      deriveAppCardState({ readiness: 'install-required', status: status({ launchReadiness: 'install-required' }), job: job({ state: 'failed', phase: 'failed', reasonCode: 'X' }) }),
      deriveAppCardState({ readiness: 'ready', status: status(), job: job({ kind: 'uninstall', state: 'in_progress', phase: 'swap' }) }),
    ]);
    for (const state of CANONICAL_APP_CARD_STATES) {
      assert.ok(derived.has(state), `canonical state "${state}" has no derivation path`);
    }
    assert.equal(derived.size, 11, 'exactly 11 canonical states are derivable');
  });

  it('gives each canonical state a posture and an action plan', () => {
    for (const state of CANONICAL_APP_CARD_STATES) {
      assert.ok(postureForCardState(state), `posture missing for ${state}`);
      const plan = actionPlanForCardState(state);
      assert.ok(plan, `action plan missing for ${state}`);
      // A `disabled`-posture state has no primary action; every other state does.
      if (postureForCardState(state) === 'disabled') {
        assert.equal(plan.primary, null, `${state} (disabled) must have no primary action`);
      }
    }
  });
});

describe('selectLatestJobForApp', () => {
  it('selects the most recent job for an app by updatedAt', () => {
    const jobs: NimiRuntimeAppInstallJob[] = [
      job({ jobId: 'a', updatedAt: '2026-05-21T10:00:00.000Z' }),
      job({ jobId: 'b', updatedAt: '2026-05-21T12:00:00.000Z' }),
      job({ jobId: 'c', appId: 'nimi.other', updatedAt: '2026-05-21T13:00:00.000Z' }),
    ];
    const latest = selectLatestJobForApp('nimi.notes', jobs);
    assert.equal(latest?.jobId, 'b');
  });

  it('returns undefined when no job matches the app', () => {
    assert.equal(selectLatestJobForApp('nimi.missing', [job({})]), undefined);
  });
});

// ---------------------------------------------------------------------------
// (2) Card actions route onto the lifecycle bridge.
// ---------------------------------------------------------------------------

interface BridgeCall {
  readonly method: string;
  readonly input: unknown;
}

function recordingLifecycle(): {
  bridge: DesktopAppLifecycleBridge;
  calls: BridgeCall[];
} {
  const calls: BridgeCall[] = [];
  const record = (method: string) => async (input: unknown) => {
    calls.push({ method, input });
    return undefined as never;
  };
  const openProjection: NimiRuntimeAppOpenProjection = {
    appId: 'nimi.notes',
    state: 'blocked',
    reachedStep: 'launch',
    launched: false,
    scope: appLaunchScopeRef('nimi.notes'),
    reasonCode: ReasonCode.ACTION_EXECUTED,
  };
  const bridge: DesktopAppLifecycleBridge = {
    install: record('install'),
    adoptLocal: record('adoptLocal'),
    removeLocalAdoption: record('removeLocalAdoption'),
    uninstall: record('uninstall'),
    getJob: record('getJob'),
    listJobs: record('listJobs'),
    storage: record('storage'),
    watchJobEvents: record('watchJobEvents'),
    update: record('update'),
    healthRepair: record('healthRepair'),
    async open(input) {
      calls.push({ method: 'open', input });
      return openProjection;
    },
  };
  return { bridge, calls };
}

describe('routeCardAction — every action routes onto the lifecycle bridge', () => {
  const cases: Array<[AppCardActionId, string, unknown]> = [
    ['install', 'install', { appId: 'nimi.notes', confirmed: true }],
    ['retry', 'install', { appId: 'nimi.notes', confirmed: true }],
    ['update', 'update', { appId: 'nimi.notes', confirmed: true }],
    ['repair', 'healthRepair', { appId: 'nimi.notes', action: 'repair' }],
    ['cancel', 'healthRepair', { appId: 'nimi.notes', action: 'cancel' }],
    ['uninstall', 'uninstall', { appId: 'nimi.notes' }],
    [
      'remove_local_adoption',
      'removeLocalAdoption',
      { appId: 'nimi.notes', deleteDurableDataConfirmed: false },
    ],
    [
      'delete_app_data',
      'uninstall',
      { appId: 'nimi.notes', deleteDurableData: true, destructiveDataDeleteConfirmed: true },
    ],
  ];

  for (const [action, method, expectedInput] of cases) {
    it(`routes "${action}" -> lifecycle.${method}`, async () => {
      const { bridge, calls } = recordingLifecycle();
      await routeCardAction(bridge, 'nimi.notes', action);
      assert.equal(calls.length, 1);
      assert.equal(calls[0]!.method, method);
      assert.deepEqual(calls[0]!.input, expectedInput);
    });
  }

  it('derives card actions from inventory nextActions before card-state fallback', () => {
    const connectPlan = actionPlanForInventoryEntry({
      nextActions: ['connect-local'],
      cardState: 'not_installed_installable',
    });
    assert.equal(connectPlan.primary?.id, 'connect_local');
    assert.equal(connectPlan.secondary.some((action) => action.id === 'details'), true);

    const localReadyPlan = actionPlanForInventoryEntry({
      nextActions: ['open', 'remove-local-adoption'],
      cardState: 'installed_ready',
    });
    assert.equal(localReadyPlan.primary?.id, 'open');
    assert.deepEqual(
      localReadyPlan.secondary.map((action) => action.id),
      ['details', 'remove_local_adoption'],
    );
  });

  it('cancels connect_local without adopting when the folder picker is cancelled', async () => {
    const { bridge, calls } = recordingLifecycle();
    await routeCardAction(bridge, 'nimi.notes', 'connect_local', {
      appClient: makeClient(),
      pickLocalAppRootDirectory: async () => null,
    });
    assert.equal(calls.length, 0);
  });

  it('routes connect_local through the folder picker and Runtime local adoption', async () => {
    const { bridge, calls } = recordingLifecycle();
    await routeCardAction(bridge, 'nimi.notes', 'connect_local', {
      appClient: makeClient(),
      pickLocalAppRootDirectory: async () => '/local/notes',
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.method, 'adoptLocal');
    assert.deepEqual(calls[0]!.input, {
      rootPath: '/local/notes',
      expectedAppId: 'nimi.notes',
    });
  });

  it('routes sign_in to the desktop account gate and not the lifecycle bridge', async () => {
    const { bridge, calls } = recordingLifecycle();
    let signInRequests = 0;
    await routeCardAction(bridge, 'nimi.notes', 'sign_in', {
      appClient: makeClient(),
      requestSignIn: () => {
        signInRequests += 1;
      },
    });
    assert.equal(signInRequests, 1);
    assert.equal(calls.length, 0);
  });

  it('routes "open" only after app-scope AIConfig initialization succeeds', async () => {
    const { bridge, calls } = recordingLifecycle();
    const ensureCalls: unknown[] = [];
    await routeCardAction(bridge, 'nimi.notes', 'open', {
      appClient: makeClient(),
      ensureAIConfig: async (input) => {
        ensureCalls.push(input);
        assert.equal(calls.length, 0, 'Runtime open must not happen before AIConfig ensure');
        return {
          outcome: 'already-initialized' as const,
          scopeRef: { kind: 'app' as const, ownerId: input.appId },
          config: {} as never,
        };
      },
    });
    assert.equal(ensureCalls.length, 1);
    assert.deepEqual(ensureCalls[0], {
      appId: 'nimi.notes',
      recommendedProfileRef: 'local-standard',
      requirementDeclarations: [{
        requirementId: 'nimi.notes.app-launch.ai.requirements',
        scopeRef: { kind: 'app', ownerId: 'nimi.notes' },
        requiredSlices: [{
          requirementSliceId: 'nimi.notes.text.generate',
          capability: 'text.generate',
          profileSliceRef: 'capabilities.text.generate',
          readinessPolicy: 'required',
        }],
        setupProjectionPolicy: 'setup-required',
      }],
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.method, 'open');
    assert.deepEqual(calls[0]!.input, { appId: 'nimi.notes', scope: appLaunchScopeRef('nimi.notes') });
  });

  it('blocks Runtime open when app AIConfig setup is required', async () => {
    const { bridge, calls } = recordingLifecycle();
    await assert.rejects(
      () => routeCardAction(bridge, 'nimi.notes', 'open', {
        appClient: makeClient(),
        ensureAIConfig: async (input) => ({
          outcome: 'setup-required-no-live-config' as const,
          scopeRef: { kind: 'app' as const, ownerId: input.appId },
          config: null,
          profileSource: 'recommended-profile' as const,
          profileId: 'local-standard',
          setupRepairPlan: {
            unmetRequirements: [{ requirementId: 'text.generate', detail: 'product_state_proposed' }],
            setupProjection: {
              outcome: 'setup_required_no_live_config',
              blockingCapabilities: ['text.generate'],
              reasonCodes: ['product_state_proposed'],
              actionRefs: ['open_app_ai_profile_repair_surface'],
            },
          },
        }),
      }),
      (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_APP_AI_CONFIG_SETUP_REQUIRED',
    );
    assert.equal(calls.length, 0, 'Runtime open must not run when AIConfig setup is required');
  });

  it('rejects renderer-only flows as bridge actions (no silent collapse)', async () => {
    const { bridge, calls } = recordingLifecycle();
    await assert.rejects(() => routeCardAction(bridge, 'nimi.notes', 'details'));
    await assert.rejects(() => routeCardAction(bridge, 'nimi.notes', 'review_permissions'));
    assert.equal(calls.length, 0, 'renderer-only flows never reach the bridge');
  });

  it('appLaunchScopeRef builds the canonical app-launch AIScopeRef', () => {
    assert.deepEqual(appLaunchScopeRef('nimi.notes'), { kind: 'app', ownerId: 'nimi.notes' });
  });
});

// ---------------------------------------------------------------------------
// (3) Fail-closed on a missing/failed job projection.
// ---------------------------------------------------------------------------

function makeClient(behavior: {
  list?: readonly NimiAppInventoryEntry[];
  status?: NimiAppStatus;
} = {}): NimiAppClient {
  const transport: NimiAppTransport = {
    async list() {
      return behavior.list ?? [inventoryEntry(buildRow())];
    },
    async get(appId: string) {
      const rows = await this.list();
      const row = rows.find((candidate) => candidate.appId === appId);
      if (!row) throw new Error('missing');
      return row;
    },
    async status(appId: string) {
      return behavior.status ?? { appId, launchReadiness: 'ready' };
    },
  };
  return new NimiAppClientCtor(transport);
}

function buildRow(): NimiAppRow {
  return {
    appId: 'nimi.notes',
    appKind: 'nimi-app',
    displayName: 'Notes',
    trustTier: 'nimi-first-party',
    publisher: 'Nimi',
    aiProfileSelectionRef: 'local-standard',
    capabilitySet: ['text.generate'],
    releaseDescriptorRef: 'nimi.notes.bundled',
    installStoragePolicyRef: 'nimi-data-app-roots',
    sourceRule: 'P-NAPP-004',
  };
}

function inventoryEntry(row: NimiAppRow): NimiAppInventoryEntry {
  return {
    appId: row.appId,
    displayName: row.displayName,
    appKind: row.appKind,
    publisher: row.publisher,
    aiProfileSelectionRef: row.aiProfileSelectionRef,
    releaseDescriptorRef: row.releaseDescriptorRef,
    installStoragePolicyRef: row.installStoragePolicyRef,
    trustTier: row.trustTier,
    capabilitySet: [...row.capabilitySet],
    sources: {
      catalog: { status: 'present', value: row },
      account: { status: 'absent' },
      local: { status: 'absent' },
      packageReadiness: { status: 'absent' },
    },
    installState: 'not-installed',
    openReadiness: 'install-required',
    activeJobs: [],
    nextActions: ['install'],
  };
}

function failingJobBridge(): DesktopAppLifecycleBridge {
  const { bridge } = recordingLifecycle();
  return {
    ...bridge,
    async listJobs(appId: string) {
      assert.equal(appId, 'nimi.notes');
      throw new Error('job projection boom');
    },
  };
}

describe('projectAppsPanel — fail-closed on a missing job projection', () => {
  it('fails the whole panel closed when the live job projection cannot load', async () => {
    const projection = await projectAppsPanel(makeClient(), failingJobBridge());
    assert.equal(projection.status, 'error');
    if (projection.status === 'error') {
      assert.match(projection.detail, /job projection boom/);
    }
  });

  it('composes the live job projection into the card state when it loads', async () => {
    const { bridge } = recordingLifecycle();
    const withJob: DesktopAppLifecycleBridge = {
      ...bridge,
      async listJobs(appId: string) {
        assert.equal(appId, 'nimi.notes');
        return [job({ appId: 'nimi.notes', kind: 'install', state: 'in_progress', phase: 'download' })];
      },
      async storage(input) {
        return storageProjection(input.appId);
      },
    };
    const projection = await projectAppsPanel(makeClient(), withJob);
    assert.equal(projection.status, 'loaded');
    if (projection.status !== 'loaded') return;
    assert.equal(projection.entries[0]!.cardState, 'installing');
  });

  it('uses Runtime GetAppStorage for detail roots instead of registry install evidence', async () => {
    const { bridge } = recordingLifecycle();
    const lifecycle: DesktopAppLifecycleBridge = {
      ...bridge,
      async listJobs(appId: string) {
        assert.equal(appId, 'nimi.notes');
        return [];
      },
      async storage(input) {
        return storageProjection(input.appId);
      },
    };
    const client = makeClient({
      status: {
        appId: 'nimi.notes',
        launchReadiness: 'ready',
        storageRoots: {
          releaseRoot: '/desktop-scanned/releases/1.0.0',
          dataRoot: '/desktop-scanned/data',
          cacheRoot: '/desktop-scanned/cache',
          tempRoot: '/desktop-scanned/tmp',
        },
      },
    });

    const projection = await projectAppsPanel(client, lifecycle);
    assert.equal(projection.status, 'loaded');
    if (projection.status !== 'loaded') return;
    assert.deepEqual(projection.entries[0]!.status?.storageRoots, {
      releaseRoot: '/data/apps/nimi.notes/releases/1.0.0',
      dataRoot: '/data/apps/nimi.notes/data',
      cacheRoot: '/data/apps/nimi.notes/cache',
      tempRoot: '/data/apps/nimi.notes/tmp',
    });
  });

  it('fails the whole panel closed when Runtime storage projection cannot load', async () => {
    const { bridge } = recordingLifecycle();
    const lifecycle: DesktopAppLifecycleBridge = {
      ...bridge,
      async listJobs(appId: string) {
        assert.equal(appId, 'nimi.notes');
        return [];
      },
      async storage() {
        throw new Error('storage projection boom');
      },
    };
    const projection = await projectAppsPanel(makeClient(), lifecycle);
    assert.equal(projection.status, 'error');
    if (projection.status === 'error') {
      assert.match(projection.detail, /storage projection boom/);
    }
  });
});
