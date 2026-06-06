import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, test } from 'node:test';
import {
  NimiAppClient,
  createNimiAppRegistryTransport,
  loadNimiAppRegistryRows,
  loadNimiAppReleaseDescriptorRows,
  type AppLaunchReadiness,
  type NimiAppRow,
  type NimiAppStatus,
  type NimiAppTransport,
} from '@nimiplatform/sdk/app';
import {
  DESKTOP_APPS_CARD_STATES,
  mapLaunchReadinessToAppsCardState,
  projectAppsPanel,
  type DesktopAppsCardState,
} from '../src/shell/renderer/features/apps/apps-panel-projection.js';

function createPlatformRegistryClient(): NimiAppClient {
  return new NimiAppClient(createNimiAppRegistryTransport({
    loadRows: loadNimiAppRegistryRows,
    loadReleaseDescriptors: loadNimiAppReleaseDescriptorRows,
  }));
}

function makeClient(behavior: {
  list?: readonly NimiAppRow[] | Error;
  status?: (appId: string) => NimiAppStatus | Error;
} = {}): NimiAppClient {
  const transport: NimiAppTransport = {
    async list() {
      if (behavior.list instanceof Error) throw behavior.list;
      if (behavior.list !== undefined) return behavior.list;
      return [buildRow('nimi.example-app', 'Example App')];
    },
    async get(appId: string) {
      const rows = await this.list();
      const row = rows.find((candidate) => candidate.appId === appId);
      if (!row) throw new Error('missing');
      return row;
    },
    async status(appId: string) {
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

function buildRow(appId: string, displayName: string): NimiAppRow {
  return {
    appId,
    appKind: 'nimi-app',
    displayName,
    trustTier: 'nimi-first-party',
    publisher: 'Nimi',
    aiProfileSelectionRef: 'local-standard',
    capabilitySet: ['text.generate'],
    releaseDescriptorRef: `${appId}.bundled`,
    installStoragePolicyRef: 'nimi-data-app-roots',
    sourceRule: 'P-NAPP-004',
  };
}

describe('AppsPanel ordinary-visible projection', () => {
  it('projects no ordinary-visible Apps from the current Platform catalog', async () => {
    const projection = await projectAppsPanel(createPlatformRegistryClient());
    assert.equal(projection.status, 'loaded');
    if (projection.status !== 'loaded') return;

    const ids = projection.entries.map((entry) => entry.app.appId);
    assert.deepEqual(ids, []);
    assert.equal(projection.entries.some((entry) => entry.app.appId === 'nimi.avatar'), false);
  });

  it('maps SDK launch readiness into explicit Desktop Apps card states', () => {
    const expected: Record<AppLaunchReadiness, DesktopAppsCardState> = {
      ready: 'installed_ready',
      'install-required': 'not_installed_installable',
      'update-required': 'update_required',
      'repair-required': 'repair_required',
      'permission-required': 'permission_required',
      'blocked-by-master-gate': 'blocked_by_policy',
      unsupported: 'unsupported_on_this_device',
    };

    for (const [readiness, state] of Object.entries(expected) as Array<[AppLaunchReadiness, DesktopAppsCardState]>) {
      assert.equal(mapLaunchReadinessToAppsCardState(readiness), state);
    }
  });

  it('resolves an opaque per-app status failure to repair_required (W5 hard-cut default)', async () => {
    // T4-W5: the historical 12th `status_unavailable` bucket is hard-cut. An
    // opaque (untyped) `status()` failure resolves to the canonical
    // `repair_required` card state — the row stays visible, carries a Repair
    // action, and the detail carries the exact failure (P-NAPP-008 / manual
    // line 962: no collapsed "Unavailable" card).
    const projection = await projectAppsPanel(makeClient({
      status: () => new Error('status boom'),
    }));
    assert.equal(projection.status, 'loaded');
    if (projection.status !== 'loaded') return;

    assert.equal(projection.entries.length, 1);
    assert.equal(projection.entries[0]!.cardState, 'repair_required');
    assert.match(projection.entries[0]!.detail ?? '', /status boom/);
    // The 12th state must not survive anywhere in the resolved projection.
    assert.equal(
      projection.entries.some((entry) => (entry.cardState as string) === 'status_unavailable'),
      false,
    );
  });

  it('fails closed when the ordinary Apps registry projection cannot load', async () => {
    const projection = await projectAppsPanel(makeClient({ list: new Error('registry boom') }));
    assert.equal(projection.status, 'error');
    if (projection.status === 'error') {
      assert.match(projection.detail, /registry boom/);
    }
  });
});

const appsPanelSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/apps/apps-panel.tsx'),
  'utf8',
);
const appsProjectionSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/apps/apps-panel-projection.ts'),
  'utf8',
);
const appsViewSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/apps/apps-panel-view.tsx'),
  'utf8',
);
const appsControllerSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/apps/apps-panel-controller.ts'),
  'utf8',
);

test('AppsPanel consumes Apps-owned projection and no longer mounts historical LibraryView', () => {
  // T4-W4 moved the projection load into `apps-panel-controller.ts`; the panel
  // delegates via `useAppsPanelController` and mounts the Apps-owned view.
  assert.match(appsPanelSource, /useAppsPanelController/);
  assert.match(appsPanelSource, /AppsPanelView/);
  assert.match(appsControllerSource, /projectAppsPanel/);
  assert.doesNotMatch(appsPanelSource, /LibraryView/);
  assert.doesNotMatch(appsPanelSource, /projectLibrary/);
});

test('AppsPanel source does not scan source workspaces or app-local specs for visibility', () => {
  const combined = `${appsPanelSource}\n${appsProjectionSource}\n${appsViewSource}`;
  assert.doesNotMatch(combined, /read(dir|File|FileSync)|readdir|glob|fast-glob|import\.meta\.glob/);
  assert.doesNotMatch(combined, /apps\/\*\*|workspace source|source workspace|app-local spec|Mods|Extensions/);
  assert.match(appsProjectionSource, /NimiAppClient/);
});

test('AppsPanel view exposes Apps-specific test hooks and all admitted card states', () => {
  assert.match(appsViewSource, /data-testid="apps-view"/);
  assert.match(appsViewSource, /data-testid="apps-entry-list"/);
  assert.match(appsViewSource, /data-app-card-state/);
  for (const state of DESKTOP_APPS_CARD_STATES) {
    assert.ok(appsViewSource.includes(state), `AppsPanelView missing state "${state}"`);
  }
});
