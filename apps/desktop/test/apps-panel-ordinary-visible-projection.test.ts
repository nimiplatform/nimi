import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, test } from 'node:test';
import {
  NimiAppClient,
  createNimiAppRegistryTransport,
  type AppLaunchReadiness,
  type NimiAppRow,
  type NimiAppStatus,
  type NimiAppTransport,
} from '@nimiplatform/sdk/app';
// T4 Fork C: the live Apps bridge no longer reads `platform-catalog/index.ts`
// for the Nimi App registry — it reads the runtime `~/.nimi/apps` projections.
// These transport-filter tests still exercise the SDK ordinary-visible filter
// against the generated catalog projection used purely as a row fixture.
import {
  loadPlatformNimiAppReleaseDescriptorRows,
  loadPlatformNimiAppRegistryRows,
} from '../src/runtime/platform-catalog/generated.js';
import {
  DESKTOP_APPS_CARD_STATES,
  mapLaunchReadinessToAppsCardState,
  projectAppsPanel,
  type DesktopAppsCardState,
} from '../src/shell/renderer/features/apps/apps-panel-projection.js';

function createPlatformRegistryClient(): NimiAppClient {
  return new NimiAppClient(createNimiAppRegistryTransport({
    loadRows: loadPlatformNimiAppRegistryRows,
    loadReleaseDescriptors: loadPlatformNimiAppReleaseDescriptorRows,
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
      return [buildRow('nimi.parentos', 'ParentOS')];
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
    releaseDescriptorRef: `${appId}.bundled`,
    installStoragePolicyRef: 'nimi-data-app-roots',
    sourceRule: 'P-NAPP-004',
  };
}

describe('AppsPanel ordinary-visible projection', () => {
  it('projects only current ordinary-visible admitted Apps from Platform catalog', async () => {
    const projection = await projectAppsPanel(createPlatformRegistryClient());
    assert.equal(projection.status, 'loaded');
    if (projection.status !== 'loaded') return;

    const ids = projection.entries.map((entry) => entry.app.appId);
    assert.deepEqual(ids, ['nimi.parentos']);
    assert.equal(projection.entries[0]!.cardState, 'not_installed_installable');
    assert.equal(projection.entries.some((entry) => entry.app.appId === 'nimi.avatar'), false);
    assert.equal(projection.entries.some((entry) => entry.app.appId === 'nimi.tester'), false);
    assert.equal(projection.entries.some((entry) => entry.app.appId.toLowerCase().includes('forge')), false);
    assert.equal(projection.entries.some((entry) => entry.app.appId.toLowerCase().includes('shiji')), false);
  });

  it('keeps Tester admitted as developer-only without ordinary Apps projection', async () => {
    const client = createPlatformRegistryClient();
    const listed = await client.list();
    assert.equal(listed.some((entry) => entry.appId === 'nimi.tester'), false);

    const registrySource = readFileSync(
      resolve(import.meta.dirname, '../../../.nimi/spec/platform/kernel/tables/nimi-app-registry.yaml'),
      'utf8',
    );
    assert.match(registrySource, /app_id:\s*nimi\.tester[\s\S]*ordinary_visibility:\s*developer-only/);
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

  it('keeps per-app status failures explicit instead of dropping rows silently', async () => {
    const projection = await projectAppsPanel(makeClient({
      status: () => new Error('status boom'),
    }));
    assert.equal(projection.status, 'loaded');
    if (projection.status !== 'loaded') return;

    assert.equal(projection.entries.length, 1);
    assert.equal(projection.entries[0]!.cardState, 'status_unavailable');
    assert.match(projection.entries[0]!.detail ?? '', /status boom/);
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

test('AppsPanel consumes Apps-owned projection and no longer mounts historical LibraryView', () => {
  assert.match(appsPanelSource, /projectAppsPanel/);
  assert.match(appsPanelSource, /AppsPanelView/);
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
