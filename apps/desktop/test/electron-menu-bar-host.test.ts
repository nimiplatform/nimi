import assert from 'node:assert/strict';
import test from 'node:test';
import type { MenuItemConstructorOptions } from 'electron';

import {
  createDesktopElectronMenuBarHost,
  MENU_BAR_ITEM_IDS,
  MENU_BAR_RENDERER_FRESHNESS_MS,
  type CreateDesktopElectronMenuBarHostInput,
  type MenuBarRuntimeStatus,
} from '../src-electron/menu-bar-host.js';
import {
  MENU_BAR_OPEN_TAB_EVENT,
  MENU_BAR_RUNTIME_HEALTH_SYNC_COMMAND,
} from '../src/shell/shared/menu-bar-types.js';

class FakeTray {
  static current: FakeTray | null = null;
  menu: MenuItemConstructorOptions[] = [];
  destroyed = false;
  popupCount = 0;
  tooltip = '';
  private clickListener: (() => void) | null = null;

  constructor(icon: unknown) {
    void icon;
    FakeTray.current = this;
  }

  setContextMenu(menu: unknown): void {
    this.menu = menu as MenuItemConstructorOptions[];
  }

  setToolTip(value: string): void {
    this.tooltip = value;
  }

  on(event: string, listener: () => void): this {
    if (event === 'click') this.clickListener = listener;
    return this;
  }

  popUpContextMenu(): void {
    this.popupCount += 1;
  }

  destroy(): void {
    this.destroyed = true;
  }

  click(): void {
    this.clickListener?.();
  }
}

function fakeElectron(): CreateDesktopElectronMenuBarHostInput['electron'] {
  return {
    Menu: {
      buildFromTemplate: (template: MenuItemConstructorOptions[]) => template,
    },
    Tray: FakeTray,
  } as unknown as CreateDesktopElectronMenuBarHostInput['electron'];
}

function createInput(overrides: Partial<CreateDesktopElectronMenuBarHostInput> = {}): {
  input: CreateDesktopElectronMenuBarHostInput;
  calls: {
    status: number;
    start: number;
    restart: number;
    focus: number;
    hide: number;
    quit: number;
    errors: string[];
    events: Array<{ eventName: string; payload: unknown }>;
  };
  setStatus: (status: MenuBarRuntimeStatus) => void;
} {
  let status: MenuBarRuntimeStatus = {
    running: true,
    managed: true,
    launchMode: 'RUNTIME',
  };
  const calls = {
    status: 0,
    start: 0,
    restart: 0,
    focus: 0,
    hide: 0,
    quit: 0,
    errors: [] as string[],
    events: [] as Array<{ eventName: string; payload: unknown }>,
  };
  const input: CreateDesktopElectronMenuBarHostInput = {
    electron: fakeElectron(),
    icon: '/Applications/Nimi.app/Contents/Resources/icon.icns',
    lifecycle: {
      status: async () => {
        calls.status += 1;
        return status;
      },
      start: async () => {
        calls.start += 1;
        status = { ...status, running: true };
        return status;
      },
      restart: async () => {
        calls.restart += 1;
        return status;
      },
    },
    focusMainWindow: () => {
      calls.focus += 1;
    },
    hideMainWindow: () => {
      calls.hide += 1;
    },
    emitRendererEvent: (eventName, payload) => {
      calls.events.push({ eventName, payload });
    },
    quit: () => {
      calls.quit += 1;
    },
    reportError: (operation) => {
      calls.errors.push(operation);
    },
    platform: 'darwin',
    ...overrides,
  };
  return {
    input,
    calls,
    setStatus: (next) => {
      status = next;
    },
  };
}

test('Electron menu bar projects the closed states and drops stale renderer detail after 15s', async () => {
  let nowMs = 1_000;
  const fixture = createInput({ now: () => nowMs });
  const host = createDesktopElectronMenuBarHost(fixture.input);
  await host.initialize();

  assert.equal(host.snapshot().headerState, 'running');
  assert.equal(host.snapshot().restartEnabled, true);
  assert.equal(FakeTray.current?.tooltip, 'Nimi');
  const labels = FakeTray.current?.menu.map((item) => item.label).filter(Boolean) ?? [];
  assert.doesNotMatch(labels.join('\n'), /grpc|pid|endpoint|path|127\.0\.0\.1/iu);

  const result = await host.commandHandlers.menu_bar_sync_runtime_health({
    command: MENU_BAR_RUNTIME_HEALTH_SYNC_COMMAND,
    payload: {
      payload: {
        runtimeHealthStatus: 'DEGRADED',
        runtimeHealthReason: 'provider quorum lost',
        updatedAt: '2026-07-29T00:00:00.000Z',
      },
    },
  });
  assert.deepEqual(result, { synced: true });
  assert.equal(host.snapshot().headerState, 'degraded');

  nowMs += MENU_BAR_RENDERER_FRESHNESS_MS + 1;
  assert.equal(host.snapshot().headerState, 'running');
  assert.equal(host.snapshot().runtimeLine, 'Runtime: RUNNING');
  assert.equal(host.snapshot().lastCheckLine, null);
});

test('Electron menu bar calls only injected fixed lifecycle operations and refreshes after start', async () => {
  const fixture = createInput();
  fixture.setStatus({
    running: false,
    managed: true,
    launchMode: 'RUNTIME',
  });
  const host = createDesktopElectronMenuBarHost(fixture.input);
  await host.initialize();

  assert.equal(host.snapshot().headerState, 'stopped');
  assert.equal(host.snapshot().startEnabled, true);
  await host.activate(MENU_BAR_ITEM_IDS.startRuntime);

  assert.equal(fixture.calls.start, 1);
  assert.equal(fixture.calls.restart, 0);
  assert.equal(fixture.calls.status, 3);
  assert.equal(host.snapshot().headerState, 'running');

  fixture.setStatus({
    running: false,
    managed: false,
    launchMode: 'RUNTIME',
  });
  await host.refreshStatus();
  assert.equal(host.snapshot().headerState, 'unavailable');
  assert.equal(host.snapshot().startEnabled, false);
  await assert.rejects(
    host.activate(MENU_BAR_ITEM_IDS.startRuntime),
    /menu-bar-runtime-start-unavailable/u,
  );
});

test('Electron source menu bar projects live status without exposing Runtime process control', async () => {
  const fixture = createInput({
    runtimeLifecycleProfile: 'source',
    lifecycle: {
      status: async () => ({
        running: true,
        managed: false,
        launchMode: 'SOURCE',
      }),
      start: async () => {
        fixture.calls.start += 1;
        throw new Error('source Runtime start must remain unavailable');
      },
      restart: async () => {
        fixture.calls.restart += 1;
        throw new Error('source Runtime restart must remain unavailable');
      },
    },
  });
  const host = createDesktopElectronMenuBarHost(fixture.input);
  await host.initialize();

  assert.equal(host.snapshot().headerState, 'running');
  assert.equal(host.snapshot().startEnabled, false);
  assert.equal(host.snapshot().restartEnabled, false);
  assert.match(host.snapshot().statusLine, /owned by pnpm dev:runtime/u);
  assert.doesNotMatch(host.snapshot().statusLine, /repair|service/iu);
  await assert.rejects(
    host.activate(MENU_BAR_ITEM_IDS.startRuntime),
    /menu-bar-source-runtime-start-unavailable/u,
  );
  await assert.rejects(
    host.activate(MENU_BAR_ITEM_IDS.restartRuntime),
    /menu-bar-source-runtime-restart-unavailable/u,
  );
  assert.equal(fixture.calls.start, 0);
  assert.equal(fixture.calls.restart, 0);
});

test('Electron menu bar exposes starting only while a fixed lifecycle action is in flight', async () => {
  let running = false;
  let completeStart: (() => void) | undefined;
  const startBarrier = new Promise<void>((resolve) => {
    completeStart = resolve;
  });
  const fixture = createInput({
    lifecycle: {
      status: async () => ({
        running,
        managed: true,
        launchMode: 'RUNTIME',
      }),
      start: async () => {
        await startBarrier;
        running = true;
        return {
          running,
          managed: true,
          launchMode: 'RUNTIME',
        };
      },
      restart: async () => ({
        running,
        managed: true,
        launchMode: 'RUNTIME',
      }),
    },
  });
  const host = createDesktopElectronMenuBarHost(fixture.input);
  await host.initialize();

  const starting = host.activate(MENU_BAR_ITEM_IDS.startRuntime);
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  assert.equal(host.snapshot().headerState, 'starting');
  completeStart?.();
  await starting;
  assert.equal(host.snapshot().headerState, 'running');
});

test('Electron menu bar admits only one Runtime lifecycle action while status is pending', async () => {
  let statusCalls = 0;
  let startCalls = 0;
  let releaseStatus: (() => void) | undefined;
  const statusBarrier = new Promise<void>((resolve) => {
    releaseStatus = resolve;
  });
  const fixture = createInput({
    lifecycle: {
      status: async () => {
        statusCalls += 1;
        if (statusCalls === 2) await statusBarrier;
        return {
          running: false,
          managed: true,
          launchMode: 'RUNTIME',
        };
      },
      start: async () => {
        startCalls += 1;
        return {
          running: true,
          managed: true,
          launchMode: 'RUNTIME',
        };
      },
      restart: async () => ({
        running: false,
        managed: true,
        launchMode: 'RUNTIME',
      }),
    },
  });
  const host = createDesktopElectronMenuBarHost(fixture.input);
  await host.initialize();

  const first = host.activate(MENU_BAR_ITEM_IDS.startRuntime);
  await new Promise<void>((resolve) => setImmediate(resolve));
  await assert.rejects(
    host.activate(MENU_BAR_ITEM_IDS.startRuntime),
    /menu-bar-runtime-action-in-flight/u,
  );
  assert.equal(statusCalls, 2);
  assert.equal(startCalls, 0);
  releaseStatus?.();
  await first;
  assert.equal(startCalls, 1);
});

test('Electron menu bar bounds navigation and keeps close-hide distinct from explicit quit', async () => {
  const fixture = createInput();
  const host = createDesktopElectronMenuBarHost(fixture.input);
  await host.initialize();

  await host.activate(MENU_BAR_ITEM_IDS.openRuntimeDashboard);
  await host.activate(MENU_BAR_ITEM_IDS.openSettings);
  assert.equal(fixture.calls.focus, 2);
  assert.deepEqual(fixture.calls.events, [
    {
      eventName: MENU_BAR_OPEN_TAB_EVENT,
      payload: { tab: 'runtime', page: 'overview' },
    },
    {
      eventName: MENU_BAR_OPEN_TAB_EVENT,
      payload: { tab: 'settings' },
    },
  ]);
  assert.equal(host.hideMainWindowOnClose(), true);
  assert.equal(fixture.calls.hide, 1);
  assert.equal(fixture.calls.quit, 0);

  await host.activate(MENU_BAR_ITEM_IDS.quitNimi);
  assert.equal(fixture.calls.quit, 1);
  assert.equal(host.hideMainWindowOnClose(), false);
  assert.equal(fixture.calls.start, 0);
  assert.equal(fixture.calls.restart, 0);
  await assert.rejects(host.activate('menu-bar-open-unknown'), /menu-bar-item-invalid/u);
});

test('Electron menu bar rejects non-exact renderer health and stays disabled off macOS', async () => {
  const fixture = createInput();
  const host = createDesktopElectronMenuBarHost(fixture.input);
  await host.initialize();
  await assert.rejects(
    host.commandHandlers.menu_bar_sync_runtime_health({
      command: MENU_BAR_RUNTIME_HEALTH_SYNC_COMMAND,
      payload: {
        payload: {
          retiredProviderHealth: true,
        },
      },
    }),
    /menu-bar-runtime-health-sync-payload-invalid/u,
  );

  const disabledFixture = createInput({ platform: 'win32' });
  const previousTray = FakeTray.current;
  const disabledHost = createDesktopElectronMenuBarHost(disabledFixture.input);
  assert.equal(disabledHost.enabled, false);
  await assert.rejects(disabledHost.initialize(), /menu-bar-shell-disabled/u);
  assert.equal(FakeTray.current, previousTray);
});
