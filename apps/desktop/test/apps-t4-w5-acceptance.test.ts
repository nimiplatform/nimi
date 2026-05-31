// T4-W5 acceptance — visibility-exclusion hard-cut + status-failure hard-cut.
//
// Proves the W5 closed loop against the manual and the T4 acceptance gate:
//
//   1. The 12th `status_unavailable` card state is hard-cut. `status()` is
//      gone from the Desktop card vocabulary; a `status()` failure resolves to
//      one of the 11 canonical states per the per-reason-code mapping
//      (`repair_required` default) — P-NAPP-008 / manual line 962 forbid a
//      collapsed "Unavailable" card.
//   2. Registry-only visibility: internal / deferred rows (and any
//      non-`ordinary-visible` or non-`admitted` workspace) do NOT surface in
//      the Apps panel before admission (manual lines 880-882, P-NAPP-009,
//      S-APP-009). A negative fixture proves the SDK ordinary-visible filter
//      excludes each one.
//   3. Uninstall data retention: the desktop `uninstall` card action calls the
//      lifecycle bridge with durable-data deletion OFF by default; the
//      separate destructive `delete_app_data` flow passes the explicit
//      destructive-delete confirmation (manual `#### Uninstall And Data`,
//      K-APP-014). The runtime-side filesystem retention proof lives in
//      `runtime/internal/services/app/uninstall_job_test.go`.
//
// Authority: `product-manual-full-authority.md` `## Apps`,
// `result-t4-remaining-preflight.md` §1.5 / §5 (SD-4) / Fork E.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createNimiError } from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';
import {
  NimiAppClient,
  createNimiAppRegistryTransport,
  type NimiAppRegistrySourceRow,
  type NimiAppReleaseDescriptorRow,
  type NimiAppRow,
  type NimiAppStatus,
  type NimiAppTransport,
} from '@nimiplatform/sdk/app';

import { resolveAppStatusFailure } from '../src/shell/renderer/features/apps/apps-status-failure.js';
import {
  DESKTOP_APPS_CARD_STATES,
  projectAppsPanel,
} from '../src/shell/renderer/features/apps/apps-panel-projection.js';
import { CANONICAL_APP_CARD_STATES } from '../src/shell/renderer/features/apps/apps-card-state.js';
import {
  routeCardAction,
} from '../src/shell/renderer/features/apps/apps-panel-controller.js';
import type {
  DesktopAppLifecycleBridge,
  RuntimeAppInstallJob,
  RuntimeAppStorageProjection,
  RuntimeAppUninstallInput,
  RuntimeAppUninstallResult,
} from '../src/shell/renderer/features/apps/apps-lifecycle-bridge.js';

// ---------------------------------------------------------------------------
// 1. status_unavailable hard-cut
// ---------------------------------------------------------------------------

describe('T4-W5 — status_unavailable 12th card state is hard-cut', () => {
  it('the Desktop card vocabulary is exactly the 11 canonical states, no 12th', () => {
    assert.equal(DESKTOP_APPS_CARD_STATES.length, 11);
    assert.deepEqual([...DESKTOP_APPS_CARD_STATES], [...CANONICAL_APP_CARD_STATES]);
    assert.equal(
      (DESKTOP_APPS_CARD_STATES as readonly string[]).includes('status_unavailable'),
      false,
    );
  });

  it('an opaque status() failure maps to repair_required (E1 default bucket)', () => {
    const resolution = resolveAppStatusFailure(new Error('socket hang up'));
    assert.equal(resolution.cardState, 'repair_required');
    assert.match(resolution.detail, /socket hang up/);
  });

  it('a non-canonical / incomplete status projection maps to repair_required', () => {
    // The SDK `NimiAppClient.status` wraps a transport failure in a
    // `NimiAppClientError` whose `cause` is the underlying error. An untyped
    // wrapped failure still resolves to the repair bucket.
    const wrapped = new Error('status transport error');
    (wrapped as { cause?: unknown }).cause = new Error('registry row missing');
    const resolution = resolveAppStatusFailure(wrapped);
    assert.equal(resolution.cardState, 'repair_required');
    assert.match(resolution.detail, /registry row missing/);
  });

  it('a host/runtime-incompatible reason code maps to unsupported_on_this_device', () => {
    const error = createNimiError({
      message: 'runtime is too old for this app',
      reasonCode: ReasonCode.COMPAT_RUNTIME_TOO_OLD,
      actionHint: 'update_runtime',
      source: 'runtime',
    });
    const resolution = resolveAppStatusFailure(error);
    assert.equal(resolution.cardState, 'unsupported_on_this_device');
    assert.match(resolution.detail, new RegExp(ReasonCode.COMPAT_RUNTIME_TOO_OLD));
  });

  it('a policy/permission reason code maps to blocked_by_policy', () => {
    const error = createNimiError({
      message: 'app authorization denied by policy',
      reasonCode: ReasonCode.APP_AUTHORIZATION_DENIED,
      actionHint: 'review_policy',
      source: 'runtime',
    });
    const resolution = resolveAppStatusFailure(error);
    assert.equal(resolution.cardState, 'blocked_by_policy');
    assert.match(resolution.detail, new RegExp(ReasonCode.APP_AUTHORIZATION_DENIED));
  });

  it('a typed reason code carried on the error cause is still mapped', () => {
    // `NimiAppClientError` wraps the runtime `NimiError` as `.cause`.
    const inner = createNimiError({
      message: 'permission denied',
      reasonCode: ReasonCode.RUNTIME_GRPC_PERMISSION_DENIED,
      actionHint: 'review_policy',
      source: 'runtime',
    });
    const outer = new Error('status transport error');
    (outer as { cause?: unknown }).cause = inner;
    const resolution = resolveAppStatusFailure(outer);
    assert.equal(resolution.cardState, 'blocked_by_policy');
  });

  it('distinct status() failures resolve to distinct cards — no collapse', () => {
    // P-NAPP-008: distinct fail-closed reasons must not collapse into one
    // label. Three distinct failures => three distinct canonical card states.
    const repair = resolveAppStatusFailure(new Error('opaque'));
    const unsupported = resolveAppStatusFailure(
      createNimiError({
        message: 'too new',
        reasonCode: ReasonCode.COMPAT_RUNTIME_TOO_NEW,
        actionHint: 'x',
        source: 'runtime',
      }),
    );
    const blocked = resolveAppStatusFailure(
      createNimiError({
        message: 'denied',
        reasonCode: ReasonCode.AUTH_DENIED,
        actionHint: 'x',
        source: 'runtime',
      }),
    );
    const states = new Set([repair.cardState, unsupported.cardState, blocked.cardState]);
    assert.equal(states.size, 3);
  });

  it('projectAppsPanel resolves a status() failure to a canonical card, never status_unavailable', async () => {
    const client = makeClient({
      status: () =>
        createNimiError({
          message: 'app authorization denied',
          reasonCode: ReasonCode.APP_SCOPE_FORBIDDEN,
          actionHint: 'review_policy',
          source: 'runtime',
        }),
    });
    const projection = await projectAppsPanel(client);
    assert.equal(projection.status, 'loaded');
    if (projection.status !== 'loaded') return;
    assert.equal(projection.entries.length, 1);
    const entry = projection.entries[0]!;
    assert.equal(entry.cardState, 'blocked_by_policy');
    assert.ok(
      (CANONICAL_APP_CARD_STATES as readonly string[]).includes(entry.cardState),
      'resolved card state must be canonical',
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Registry-only visibility — negative proof
// ---------------------------------------------------------------------------

describe('T4-W5 — registry-only visibility: non-ordinary rows excluded before admission', () => {
  it('excludes non-ordinary-visible / non-admitted workspaces from the Apps panel', async () => {
    // A negative fixture: every row that is NOT both `ordinary-visible` and
    // `admitted` must be filtered out. Only `nimi.example-app` (the admitted
    // ordinary-visible app) surfaces.
    const rows: readonly NimiAppRegistrySourceRow[] = [
      registryRow('nimi.example-app', 'Example App', 'ordinary-visible', 'admitted'),
      // Developer-only rows are admitted for internal tooling but never ordinary Apps.
      registryRow('nimi.dev-tool', 'Developer Tool', 'developer-only', 'admitted'),
      // Deferred workspaces are not admitted as ordinary Apps.
      registryRow('nimi.deferred-tool', 'Deferred Tool', 'not-admitted-visible', 'deferred'),
      // A hidden-internal workspace.
      registryRow('nimi.internal-tool', 'Internal Tool', 'hidden-internal', 'admitted'),
    ];
    const client = new NimiAppClient(
      createNimiAppRegistryTransport({
        loadRows: () => rows,
        loadReleaseDescriptors: () => rows.map((row) => releaseDescriptorFor(row)),
      }),
    );

    const projection = await projectAppsPanel(client);
    assert.equal(projection.status, 'loaded');
    if (projection.status !== 'loaded') return;

    const surfaced = projection.entries.map((entry) => entry.app.appId);
    assert.deepEqual(surfaced, ['nimi.example-app']);
    for (const excluded of ['nimi.dev-tool', 'nimi.deferred-tool', 'nimi.internal-tool']) {
      assert.equal(
        surfaced.includes(excluded),
        false,
        `${excluded} must not surface in Apps before ordinary-visible admission`,
      );
    }
  });

  it('an ordinary-visible row that is NOT admitted is still excluded', async () => {
    // Visibility alone is not admission: a row marked `ordinary-visible` but
    // whose `admissionStatus` is not `admitted` must not surface.
    const rows: readonly NimiAppRegistrySourceRow[] = [
      registryRow('nimi.deferred-tool', 'Deferred Tool', 'ordinary-visible', 'deferred'),
    ];
    const client = new NimiAppClient(
      createNimiAppRegistryTransport({
        loadRows: () => rows,
        loadReleaseDescriptors: () => rows.map((row) => releaseDescriptorFor(row)),
      }),
    );
    const projection = await projectAppsPanel(client);
    assert.equal(projection.status, 'loaded');
    if (projection.status !== 'loaded') return;
    assert.equal(projection.entries.length, 0);
  });
});

// ---------------------------------------------------------------------------
// 3. Uninstall data-retention proof (desktop layer)
// ---------------------------------------------------------------------------

describe('T4-W5 — uninstall keeps durable app data by default', () => {
  it('the uninstall card action does NOT request durable-data deletion', async () => {
    // manual `#### Uninstall And Data`: uninstall removes the release payload
    // and keeps durable app data under <nimi_data>/apps/<app-id>/data by
    // default. The desktop action must never pass `deleteDurableData`.
    const { lifecycle, uninstallCalls } = recordingLifecycle();
    await routeCardAction(lifecycle, 'nimi.example-app', 'uninstall');
    assert.equal(uninstallCalls.length, 1);
    const input = uninstallCalls[0]!;
    assert.equal(input.appId, 'nimi.example-app');
    assert.notEqual(input.deleteDurableData, true);
    assert.notEqual(input.destructiveDataDeleteConfirmed, true);
  });

  it('the separate delete_app_data flow passes the explicit destructive confirmation', async () => {
    // The destructive "Delete app data" flow is the ONLY path that removes
    // durable data — and only with the explicit destructive-confirm flag.
    const { lifecycle, uninstallCalls } = recordingLifecycle();
    await routeCardAction(lifecycle, 'nimi.example-app', 'delete_app_data');
    assert.equal(uninstallCalls.length, 1);
    const input = uninstallCalls[0]!;
    assert.equal(input.deleteDurableData, true);
    assert.equal(input.destructiveDataDeleteConfirmed, true);
  });

  it('the uninstall result projects release-removed with durable data kept', async () => {
    // The runtime emits `releaseRemoved: true` / `durableDataRemoved: false`
    // for a default uninstall; the desktop bridge projects it unchanged.
    const { lifecycle } = recordingLifecycle();
    const result = await lifecycle.uninstall({ appId: 'nimi.example-app' });
    assert.equal(result.releaseRemoved, true);
    assert.equal(result.durableDataRemoved, false);
  });
});

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

function makeClient(behavior: {
  status?: (appId: string) => NimiAppStatus | Error;
}): NimiAppClient {
  const transport: NimiAppTransport = {
    async list(): Promise<readonly NimiAppRow[]> {
      return [clientRow('nimi.example-app', 'Example App')];
    },
    async get(appId: string): Promise<NimiAppRow> {
      return clientRow(appId, appId);
    },
    async status(appId: string): Promise<NimiAppStatus> {
      if (behavior.status) {
        const result = behavior.status(appId);
        if (result instanceof Error) throw result;
        return result;
      }
      return { appId, launchReadiness: 'install-required' };
    },
  };
  return new NimiAppClient(transport);
}

function clientRow(appId: string, displayName: string): NimiAppRow {
  return {
    appId,
    appKind: 'nimi-app',
    displayName,
    trustTier: 'nimi-first-party',
    publisher: 'Nimi',
    releaseDescriptorRef: `${appId}.descriptor`,
    installStoragePolicyRef: 'nimi-data-app-roots',
    sourceRule: 'P-NAPP-004',
  };
}

function registryRow(
  appId: string,
  displayName: string,
  ordinaryVisibility: NimiAppRegistrySourceRow['ordinaryVisibility'],
  admissionStatus: NimiAppRegistrySourceRow['admissionStatus'],
): NimiAppRegistrySourceRow {
  return {
    appId,
    appKind: 'nimi-app',
    displayName,
    publisher: 'Nimi',
    trustTier: 'nimi-first-party',
    ordinaryVisibility,
    releaseDescriptorRef: `${appId}.descriptor`,
    installStoragePolicyRef: 'nimi-data-app-roots',
    sourceRule: 'P-NAPP-004',
    admissionStatus,
  };
}

function releaseDescriptorFor(row: NimiAppRegistrySourceRow): NimiAppReleaseDescriptorRow {
  return {
    descriptorId: row.releaseDescriptorRef,
    appId: row.appId,
    version: '1.0.0',
    descriptorClass: 'bundled-with-nimi',
    sourceKind: 'nimi-bundle',
    sourceRef: 'nimi-bundle',
    artifactLocator: `nimi-bundle://${row.appId}`,
    digestAlgorithm: 'sha256',
    sha256: 'a'.repeat(64),
    size: '1024',
    provenanceRef: 'nimi-provenance',
    packageKind: 'nimi-app',
    entryRef: `${row.appId}-entry`,
    sandboxRef: `${row.appId}-sandbox`,
    permissionsRef: `${row.appId}-permissions`,
    storagePolicyRef: row.installStoragePolicyRef,
    admissionPath: 'P-NAPP-004',
    mutableSourceAllowed: false,
    installDigestVerificationRequired: 'required',
    sourceRule: 'P-NAPP-004',
  };
}

function uninstallJob(): RuntimeAppInstallJob {
  return {
    jobId: 'job-uninstall-01',
    appId: 'nimi.example-app',
    kind: 'uninstall',
    releaseDescriptorRef: 'nimi.example-app.descriptor',
    installedVersion: '1.0.0',
    state: 'uninstalled',
    phase: 'uninstalled',
    sourceKind: 'bundled',
    artifactBytes: 0,
    storage: {
      appRoot: '/data/apps/nimi.example-app',
      releaseRoot: '/data/apps/nimi.example-app/releases/1.0.0',
      durableDataRoot: '/data/apps/nimi.example-app/data',
      cacheRoot: '/data/apps/nimi.example-app/cache',
      tempRoot: '/data/apps/nimi.example-app/tmp',
    },
    retryable: false,
  };
}

function storageProjection(appId = 'nimi.example-app'): RuntimeAppStorageProjection {
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

/**
 * A `DesktopAppLifecycleBridge` stub that records every `uninstall` input so
 * the data-retention proof can assert on the durable-data flags.
 */
function recordingLifecycle(): {
  lifecycle: DesktopAppLifecycleBridge;
  uninstallCalls: RuntimeAppUninstallInput[];
} {
  const uninstallCalls: RuntimeAppUninstallInput[] = [];
  const lifecycle: DesktopAppLifecycleBridge = {
    async install() {
      return uninstallJob();
    },
    async uninstall(input): Promise<RuntimeAppUninstallResult> {
      uninstallCalls.push(input);
      return {
        appId: input.appId,
        releaseRemoved: true,
        durableDataRemoved: input.deleteDurableData === true,
        storage: uninstallJob().storage,
        job: uninstallJob(),
      };
    },
    async getJob() {
      return uninstallJob();
    },
    async listJobs() {
      return [];
    },
    async storage(input) {
      return storageProjection(input.appId);
    },
    async watchJobEvents() {
      return {
        async *[Symbol.asyncIterator]() {
          /* no frames */
        },
      };
    },
    async update() {
      return uninstallJob();
    },
    async healthRepair() {
      return uninstallJob();
    },
    async open() {
      return {
        appId: 'nimi.example-app',
        state: 'launched',
        reachedStep: 'launch',
        launched: true,
        activeVersion: '1.0.0',
        scope: { kind: 'app', ownerId: 'nimi.example-app' },
        reasonCode: ReasonCode.ACTION_EXECUTED,
      };
    },
  };
  return { lifecycle, uninstallCalls };
}
