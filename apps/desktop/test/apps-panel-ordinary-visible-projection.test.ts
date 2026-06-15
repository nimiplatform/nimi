import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  NimiAppClient,
  createNimiAppRegistryTransport,
  loadNimiAppRegistryRows,
  loadNimiAppReleaseDescriptorRows,
  type AppLaunchReadiness,
  type NimiAppInventoryEntry,
  type NimiAppRow,
  type NimiAppStatus,
  type NimiAppTransport,
} from '@nimiplatform/sdk/app';
import {
  DESKTOP_APPS_CARD_STATES,
  mapLaunchReadinessToAppsCardState,
  projectAppsPanel,
  type DesktopAppsEntry,
  type DesktopAppsCardState,
} from '../src/shell/renderer/features/apps/apps-panel-projection.js';
import { AppsPanelView } from '../src/shell/renderer/features/apps/apps-panel-view.js';

function createPlatformRegistryClient(): NimiAppClient {
  return new NimiAppClient(createNimiAppRegistryTransport({
    loadRows: loadNimiAppRegistryRows,
    loadReleaseDescriptors: loadNimiAppReleaseDescriptorRows,
  }));
}

function makeClient(behavior: {
  list?: readonly NimiAppInventoryEntry[] | Error;
  status?: (appId: string) => NimiAppStatus | Error;
} = {}): NimiAppClient {
  const transport: NimiAppTransport = {
    async list() {
      if (behavior.list instanceof Error) throw behavior.list;
      if (behavior.list !== undefined) return behavior.list;
      return [inventoryEntry(buildRow('nimi.example-app', 'Example App'))];
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

function inventoryEntry(
  row: NimiAppRow,
  overrides: Partial<Omit<NimiAppInventoryEntry, 'sources'>> & {
    readonly sources?: Partial<NimiAppInventoryEntry['sources']>;
  } = {},
): NimiAppInventoryEntry {
  const sources: NimiAppInventoryEntry['sources'] = {
    catalog: { status: 'present', value: row },
    account: { status: 'absent' },
    local: { status: 'absent' },
    packageReadiness: { status: 'absent' },
    ...overrides.sources,
  };
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
    installState: 'not-installed',
    openReadiness: 'install-required',
    activeJobs: [],
    nextActions: ['install'],
    ...overrides,
    sources,
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
    // `status()` is package/detail refinement only. A refinement failure keeps
    // the inventory-derived card floor and carries the detail for diagnostics;
    // it never creates a 12th `status_unavailable` state.
    const projection = await projectAppsPanel(makeClient({
      status: () => new Error('status boom'),
    }));
    assert.equal(projection.status, 'loaded');
    if (projection.status !== 'loaded') return;

    assert.equal(projection.entries.length, 1);
    assert.equal(projection.entries[0]!.cardState, 'not_installed_installable');
    assert.match(projection.entries[0]!.detail ?? '', /status boom/);
    // The 12th state must not survive anywhere in the resolved projection.
    assert.equal(
      projection.entries.some((entry) => (entry.cardState as string) === 'status_unavailable'),
      false,
    );
  });

  it('derives card state from unified inventory open readiness, not status package readiness', async () => {
    const row = buildRow('account.secure', 'Account Secure');
    const app = inventoryEntry(row, {
      installState: 'unknown',
      openReadiness: 'sign-in-required',
      nextActions: ['sign-in'],
      sources: {
        account: { status: 'absent' },
        packageReadiness: {
          status: 'present',
          value: {
            appId: 'account.secure',
            releaseDescriptorRef: 'account.secure.bundled',
            storagePolicyRef: 'nimi-data-app-roots',
            expectedVersion: '1.0.0',
            activeVersion: '1.0.0',
            installedVersion: '1.0.0',
            verificationState: 'digest-verified',
            state: 'ready',
          },
        },
      },
    });
    const projection = await projectAppsPanel(makeClient({
      list: [app],
      status: (appId) => ({
        appId,
        launchReadiness: 'ready',
        installedVersion: '1.0.0',
        availableVersion: '1.0.1',
      }),
    }));
    assert.equal(projection.status, 'loaded');
    if (projection.status !== 'loaded') return;

    const [entry] = projection.entries;
    assert.equal(entry?.app.openReadiness, 'sign-in-required');
    assert.equal(entry?.status?.launchReadiness, 'blocked-by-master-gate');
    assert.equal(entry?.cardState, 'blocked_by_policy');
    assert.notEqual(entry?.cardState, 'installed_ready');

    const markup = renderAppsView(projection.entries);
    assert.match(markup, /data-open-readiness="sign-in-required"/);
    assert.match(markup, /data-app-card-state="blocked_by_policy"/);
    assert.doesNotMatch(markup, /data-app-card-state="installed_ready"/);
    assert.match(markup, /data-testid="apps-action-account\.secure-sign_in"/);
  });

  it('fails closed when the ordinary Apps registry projection cannot load', async () => {
    const projection = await projectAppsPanel(makeClient({ list: new Error('registry boom') }));
    assert.equal(projection.status, 'error');
    if (projection.status === 'error') {
      assert.match(projection.detail, /registry boom/);
    }
  });
});

describe('AppsPanelView unified inventory UI', () => {
  it('renders an actionable local connect empty state', () => {
    const markup = renderAppsView([]);
    assert.match(markup, /data-testid="apps-source-summary"/);
    assert.match(markup, /data-testid="apps-connect-local-empty"/);
    assert.doesNotMatch(markup, /Admitted ordinary/);
  });

  it('renders account verified but not installed inventory with Account source and Install action', () => {
    const app = inventoryEntry(buildRow('account.notes', 'Account Notes'), {
      sources: {
        account: {
          status: 'present',
          value: {
            appId: 'account.notes',
            accountState: 'verified',
            installState: 'not-installed',
            dataPolicy: 'account-bound',
          },
        },
      },
      nextActions: ['install'],
    });
    const markup = renderAppsView([desktopEntry(app, 'not_installed_installable')]);
    assert.match(markup, /data-testid="apps-entry-account\.notes-source-account"/);
    assert.match(markup, /data-source-status="present"/);
    assert.match(markup, /data-testid="apps-action-account\.notes-install"/);
  });

  it('renders local adopted inventory with Local source, local trust, and remove local link action', () => {
    const app = inventoryEntry(buildRow('local.notes', 'Local Notes'), {
      trustTier: 'local-explicit',
      installState: 'adopted-local',
      openReadiness: 'ready',
      sources: {
        catalog: { status: 'absent' },
        local: {
          status: 'present',
          value: {
            appId: 'local.notes',
            rootPath: '/local/notes',
            manifestPath: '/local/notes/nimi.app.yaml',
            displayName: 'Local Notes',
            version: '1.0.0',
            entryRef: 'app://local.notes/main',
            permissionScopeRef: 'permission-scope:local.notes',
            storagePolicyRef: 'storage-policy:local.notes',
            state: 'adopted',
            trust: 'explicit-local',
          },
        },
      },
      nextActions: ['open', 'remove-local-adoption'],
    });
    const markup = renderAppsView([desktopEntry(app, 'installed_ready')]);
    assert.match(markup, /data-testid="apps-entry-local\.notes-source-local"/);
    assert.match(markup, /data-trust-tier="local-explicit"/);
    assert.match(markup, /data-testid="apps-action-local\.notes-remove_local_adoption"/);
  });

  it('renders connect-required as Connect action rather than Install Required', () => {
    const app = inventoryEntry(buildRow('local.missing', 'Local Missing'), {
      openReadiness: 'connect-required',
      installState: 'unknown',
      nextActions: ['connect-local'],
    });
    const markup = renderAppsView([desktopEntry(app, 'not_installed_installable')]);
    assert.match(markup, /data-open-readiness="connect-required"/);
    assert.match(markup, /data-testid="apps-action-local\.missing-connect_local"/);
  });

  it('renders sign-in-required as Sign in action rather than generic blocked', () => {
    const app = inventoryEntry(buildRow('account.secure', 'Account Secure'), {
      openReadiness: 'sign-in-required',
      nextActions: ['sign-in'],
    });
    const markup = renderAppsView([desktopEntry(app, 'blocked_by_policy')]);
    assert.match(markup, /data-open-readiness="sign-in-required"/);
    assert.match(markup, /data-testid="apps-action-account\.secure-sign_in"/);
  });

  it('renders degraded source chips with typed reason detail', () => {
    const app = inventoryEntry(buildRow('degraded.notes', 'Degraded Notes'), {
      sources: {
        account: {
          status: 'degraded',
          reasonCode: 'ACCOUNT_INVENTORY_UNAVAILABLE',
          detail: 'runtime account projection unavailable',
        },
      },
    });
    const markup = renderAppsView([desktopEntry(app, 'not_installed_installable')]);
    assert.match(markup, /data-testid="apps-entry-degraded\.notes-source-account"/);
    assert.match(markup, /data-source-status="degraded"/);
    assert.match(markup, /ACCOUNT_INVENTORY_UNAVAILABLE/);
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
  assert.match(appsPanelSource, /onConnectLocalApp/);
  assert.match(appsControllerSource, /projectAppsPanel/);
  assert.doesNotMatch(appsPanelSource, /LibraryView/);
  assert.doesNotMatch(appsPanelSource, /projectLibrary/);
});

test('AppsPanel source does not scan source workspaces or app-local specs for visibility', () => {
  const combined = `${appsPanelSource}\n${appsProjectionSource}\n${appsViewSource}`;
  const workspaceScanPattern = /\bread(dir|File|FileSync)\b|\breaddir\b|\bglob\b|\bfast-glob\b|import\.meta\.glob/;
  assert.doesNotMatch(combined, workspaceScanPattern);
  assert.doesNotMatch(combined, /apps\/\*\*|workspace source|source workspace|app-local spec|Mods|Extensions/);
  assert.match(appsProjectionSource, /NimiAppClient/);
  assert.match(appsControllerSource, /pickLocalAppRootDirectory/);
  assert.doesNotMatch(appsControllerSource, workspaceScanPattern);
});

test('AppsPanel view exposes Apps-specific test hooks and all admitted card states', () => {
  assert.match(appsViewSource, /data-testid="apps-view"/);
  assert.match(appsViewSource, /data-testid="apps-entry-list"/);
  assert.match(appsViewSource, /data-app-card-state/);
  assert.match(appsViewSource, /actionPlanForInventoryEntry/);
  assert.doesNotMatch(appsViewSource, /actionPlanForCardState/);
  for (const state of DESKTOP_APPS_CARD_STATES) {
    assert.ok(appsViewSource.includes(state), `AppsPanelView missing state "${state}"`);
  }
});

function renderAppsView(entries: readonly DesktopAppsEntry[]): string {
  return renderToStaticMarkup(
    createElement(AppsPanelView, {
      projection: { status: 'loaded', entries },
      onCardAction: () => undefined,
      onConnectLocalApp: () => undefined,
      busyAppId: null,
      actionError: null,
    }),
  );
}

function desktopEntry(
  app: NimiAppInventoryEntry,
  cardState: DesktopAppsCardState,
): DesktopAppsEntry {
  return {
    app,
    cardState,
    status: {
      appId: app.appId,
      launchReadiness: app.openReadiness === 'ready' ? 'ready' : 'install-required',
    },
  };
}
