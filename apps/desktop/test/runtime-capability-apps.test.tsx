import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TooltipProvider } from '@nimiplatform/kit/ui';
import type { NimiMachineLoadout } from '@nimiplatform/sdk/runtime';
import { AppStoreProvider } from '../src/shell/renderer/app-shell/providers/app-store';
import { createAppStore } from '../src/shell/renderer/app-shell/providers/app-store-factory';
import { DesktopI18nResourceProvider } from '../src/shell/renderer/i18n/i18n-context';
import { DesktopRendererBindingProvider } from '../src/shell/renderer/renderer/binding-context';
import type { DesktopCanonicalRendererBindings } from '../src/shell/renderer/renderer/contract';
import type { DesktopAppsEntry, DesktopAppsPanelProjection } from '../src/shell/renderer/features/apps/apps-panel-projection';
import {
  capabilityApps,
  capabilityAppsColumn,
  RuntimeCapabilityAppsCard,
} from '../src/shell/renderer/features/runtime-config/runtime-capability-apps';
import { RuntimeCapabilityDetail } from '../src/shell/renderer/features/runtime-config/runtime-capability-detail';

(globalThis as { React?: typeof React }).React = React;

const I18N_RESOURCE = { instance: { t: (key: string) => key } } as never;

type LoadedProjection = Extract<DesktopAppsPanelProjection, { status: 'loaded' }>;

function entry(input: {
  readonly appId: string;
  readonly name: string;
  readonly source: 'installed' | 'development' | 'catalog';
  readonly refs?: readonly string[] | null;
}): DesktopAppsEntry {
  const sourceClass = input.source === 'development' ? 'local_development' : 'verified';
  const refs = input.refs === undefined ? [] : input.refs;
  return {
    identity: {
      entryKey: `${sourceClass}:${input.appId}${input.source === 'development' ? ':selector' : ''}`,
      appId: input.appId,
      sourceClass,
      displayName: input.name,
      updatedAtUnixMs: 0,
    },
    appInfo: input.source === 'development' ? undefined : refs ? { capabilityContractRefs: refs } as never : null,
    catalogTarget: input.source === 'catalog' ? { capabilityContractRefs: refs ?? [] } as never : null,
    localDevelopment: input.source === 'development' ? { capabilityContractRefs: refs ?? [] } as never : null,
    committedRelease: input.source === 'installed' ? { appId: input.appId } as never : null,
    packageJob: null,
    run: null,
    aiConfigSummary: null,
    iconUrl: null,
    summary: null,
  };
}

function loaded(entries: readonly DesktopAppsEntry[], runtimeError: string | null = null): LoadedProjection {
  return { status: 'loaded', entries, catalogStatus: 'loaded', runtimeError };
}

function render(element: React.ReactElement): string {
  const bindings = { app: { commands: {} }, sdk: {} } as DesktopCanonicalRendererBindings;
  return renderToStaticMarkup(
    <DesktopI18nResourceProvider resource={I18N_RESOURCE}>
      <DesktopRendererBindingProvider bindings={bindings}>{element}</DesktopRendererBindingProvider>
    </DesktopI18nResourceProvider>,
  );
}

test('the capability lists the Apps on this device that declare it, one row per App', () => {
  const view = capabilityApps(loaded([
    entry({ appId: 'app.parentos', name: 'ParentOS', source: 'installed', refs: ['text.generate', 'audio.transcribe'] }),
    entry({ appId: 'app.bureau', name: 'Odd Bureau', source: 'installed', refs: ['image.generate'] }),
    entry({ appId: 'app.inscape', name: 'Inscape', source: 'development', refs: ['text.generate'] }),
    // Available in the catalog but not on this device.
    entry({ appId: 'app.storybook', name: 'Storybook', source: 'catalog', refs: ['text.generate'] }),
    // Installed and registered for development: the installed release names the row.
    entry({ appId: 'app.shijing', name: 'ShiJing (dev)', source: 'development', refs: ['text.generate'] }),
    entry({ appId: 'app.shijing', name: 'ShiJing', source: 'installed', refs: ['text.generate'] }),
  ]), 'text.generate');
  assert.deepEqual(view.apps.map((item) => item.identity.displayName), ['Inscape', 'ParentOS', 'ShiJing']);
  assert.equal(view.incomplete, false);
  assert.deepEqual(capabilityApps(loaded([]), 'text.generate'), { apps: [], incomplete: false });
});

test('an App whose declaration cannot be read makes the list incomplete instead of absent', () => {
  const unreadable = capabilityApps(loaded([
    entry({ appId: 'app.parentos', name: 'ParentOS', source: 'installed', refs: ['text.generate'] }),
    entry({ appId: 'app.unknown', name: 'Unknown', source: 'installed', refs: null }),
  ]), 'text.generate');
  assert.deepEqual(unreadable.apps.map((item) => item.identity.appId), ['app.parentos']);
  assert.equal(unreadable.incomplete, true);
  assert.equal(capabilityApps(loaded([], 'Runtime Apps lifecycle list failed: offline'), 'text.generate').incomplete, true);
});

test('the Apps column is left out while loading and when no App on this device uses the capability', () => {
  const projection = loaded([
    entry({ appId: 'app.parentos', name: 'ParentOS', source: 'installed', refs: ['text.generate'] }),
    // Only in the catalog, so not on this device.
    entry({ appId: 'app.storybook', name: 'Storybook', source: 'catalog', refs: ['text.embed'] }),
  ]);
  assert.equal(capabilityAppsColumn({ isPending: true, isError: false }, 'text.embed'), null);
  assert.equal(capabilityAppsColumn({ isPending: false, isError: false, data: projection }, 'text.embed'), null);
  assert.deepEqual(
    capabilityAppsColumn({ isPending: false, isError: false, data: projection }, 'text.generate'),
    { apps: [projection.entries[0]], incomplete: false },
  );
  // Unknown keeps the column: it is never shown as "no App uses this".
  assert.deepEqual(
    capabilityAppsColumn(
      { isPending: false, isError: false, data: loaded([], 'Runtime Apps lifecycle list failed: offline') },
      'text.embed',
    ),
    { apps: [], incomplete: true },
  );
  assert.equal(capabilityAppsColumn({ isPending: false, isError: true }, 'text.embed'), 'unavailable');
  assert.equal(
    capabilityAppsColumn({ isPending: false, isError: false, data: { status: 'error', detail: 'offline' } }, 'text.embed'),
    'unavailable',
  );
});

test('the Apps column shows each App by icon and name, with explicit incomplete and unavailable states', () => {
  const apps = [entry({ appId: 'app.parentos', name: 'ParentOS', source: 'installed', refs: ['text.generate'] })];
  const listed = render(<RuntimeCapabilityAppsCard state={{ apps, incomplete: false }} onOpen={() => {}} />);
  assert.match(listed, /runtimeConfig\.capabilities\.apps\.title/);
  assert.match(listed, /data-testid="capability-app:app\.parentos"[^>]*>[\s\S]*ParentOS/);
  assert.doesNotMatch(listed, /apps\.(incomplete|unavailable)/);

  const unknown = render(<RuntimeCapabilityAppsCard state={{ apps: [], incomplete: true }} onOpen={() => {}} />);
  assert.match(unknown, /apps\.incomplete/);
  assert.doesNotMatch(unknown, /capability-app:/);
  assert.match(render(<RuntimeCapabilityAppsCard state={{ apps, incomplete: true }} onOpen={() => {}} />), /ParentOS[\s\S]*apps\.incomplete/);
  assert.match(render(<RuntimeCapabilityAppsCard state="unavailable" onOpen={() => {}} />), /apps\.unavailable/);
});

test('the capability page places the Apps column beside the tab content', () => {
  const appStore = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference: () => undefined });
  const detail = (apps?: React.ReactNode, section = 'overview') => render(
    <AppStoreProvider store={appStore}>
      <TooltipProvider>
        <RuntimeCapabilityDetail
          capability="text.generate"
          selected={{
            loadoutId: 'loadout-1', recipeId: 'recipe-1', capabilityContract: 'text.generate',
            displayName: 'Gemma 4', modelAxes: [], validationState: 'configured',
          } as unknown as NimiMachineLoadout}
          loadouts={[]}
          recipes={[]}
          catalog={[]}
          assets={[]}
          libraryLoading={false}
          libraryError={false}
          status={{ state: 'ready', replacement: false }}
          taskModel=""
          section={section}
          onSection={() => {}}
          busy={false}
          disabled={false}
          navigationContext={null}
          onHome={() => {}}
          onStart={async () => {}}
          onEnable={async () => {}}
          onApplyCustomization={async () => {}}
          onTask={() => {}}
          onDiagnostics={() => {}}
          onModelMarket={() => {}}
          apps={apps}
        />
      </TooltipProvider>
    </AppStoreProvider>,
  );
  const column = <p data-testid="apps-column-slot">apps</p>;
  for (const section of ['overview', 'models', 'advanced']) {
    const html = detail(column, section);
    // The tabs stay full width; the column sits after the tab content inside the same grid.
    assert.match(html, /role="tablist"[\s\S]*xl:grid-cols-\[minmax\(0,1fr\)_15rem\][\s\S]*<aside[^>]*><p data-testid="apps-column-slot">/, section);
  }
  const without = detail(undefined);
  assert.doesNotMatch(without, /<aside|xl:grid-cols-\[minmax\(0,1fr\)_15rem\]/);
  assert.match(without, /data-testid="capability-current-model"/);
});
