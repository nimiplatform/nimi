import type {
  Menu,
  MenuItemConstructorOptions,
  NativeImage,
  Tray,
} from 'electron';

import {
  MENU_BAR_OPEN_TAB_EVENT,
  MENU_BAR_RUNTIME_HEALTH_SYNC_COMMAND,
  parseMenuBarRuntimeHealthSyncCommandPayload,
  type MenuBarOpenTabPayload,
  type MenuBarProviderSummary,
  type MenuBarRuntimeHealthSyncPayload,
} from '../src/shell/shared/menu-bar-types.js';

export const MENU_BAR_RENDERER_FRESHNESS_MS = 15_000;

export const MENU_BAR_ITEM_IDS = Object.freeze({
  openNimi: 'menu-bar-open-nimi',
  openRuntimeDashboard: 'menu-bar-open-runtime-dashboard',
  openLocalModels: 'menu-bar-open-local-models',
  openCloudConnectors: 'menu-bar-open-cloud-connectors',
  openSettings: 'menu-bar-open-settings',
  startRuntime: 'menu-bar-start-runtime',
  restartRuntime: 'menu-bar-restart-runtime',
  refreshStatus: 'menu-bar-refresh-status',
  quitNimi: 'menu-bar-quit-nimi',
} as const);

export type MenuBarHeaderState =
  | 'running'
  | 'degraded'
  | 'starting'
  | 'stopped'
  | 'unavailable';

export type MenuBarFixedRuntimeStatus = {
  readonly running: boolean;
  readonly managed: boolean;
  readonly launchMode: string;
  readonly version?: string;
  readonly lastError?: string;
};

export type DesktopElectronMenuBarHost = {
  readonly enabled: boolean;
  readonly commandHandlers: Readonly<{
    menu_bar_sync_runtime_health: (context: {
      readonly command: string;
      readonly payload: Readonly<Record<string, unknown>>;
    }) => Promise<{ readonly synced: true }>;
  }>;
  initialize(): Promise<void>;
  dispose(): void;
  refreshStatus(): Promise<MenuBarFixedRuntimeStatus>;
  activate(itemId: string): Promise<void>;
  setWindowVisible(visible: boolean): void;
  hideMainWindowOnClose(): boolean;
  snapshot(): DesktopElectronMenuBarSnapshot;
};

export type DesktopElectronMenuBarSnapshot = {
  readonly headerState: MenuBarHeaderState;
  readonly rendererFresh: boolean;
  readonly windowVisible: boolean;
  readonly actionInFlight: 'start' | 'restart' | null;
  readonly runtimeLine: string;
  readonly providerLine: string | null;
  readonly statusLine: string;
  readonly lastCheckLine: string | null;
  readonly startEnabled: boolean;
  readonly restartEnabled: boolean;
  readonly refreshEnabled: boolean;
};

type ElectronMenuBarRuntime = {
  readonly Menu: Pick<typeof Menu, 'buildFromTemplate'>;
  readonly Tray: new (image: NativeImage | string) => Tray;
};

type MenuBarFixedRuntimeLifecycle = {
  /**
   * These operations must be the protected fixed-service lifecycle. They must
   * reject before returning when native carrier or signing verification fails.
   */
  readonly status: () => Promise<unknown>;
  readonly start: () => Promise<unknown>;
  readonly restart: () => Promise<unknown>;
};

export type CreateDesktopElectronMenuBarHostInput = {
  readonly electron: ElectronMenuBarRuntime;
  readonly icon: NativeImage | string;
  readonly lifecycle: MenuBarFixedRuntimeLifecycle;
  readonly focusMainWindow: () => Promise<void> | void;
  readonly hideMainWindow: () => void;
  readonly emitRendererEvent: (
    eventName: typeof MENU_BAR_OPEN_TAB_EVENT,
    payload: MenuBarOpenTabPayload,
  ) => void;
  readonly quit: () => void;
  readonly reportError: (operation: string, error: unknown) => void;
  readonly platform?: NodeJS.Platform;
  readonly now?: () => number;
};

type MenuBarInternalState = {
  windowVisible: boolean;
  lifecycleChecked: boolean;
  lifecycleStatus: MenuBarFixedRuntimeStatus | null;
  runtimeHealthStatus: string | null;
  runtimeHealthReason: string | null;
  providerSummary: MenuBarProviderSummary | null;
  rendererUpdatedAt: string | null;
  rendererSyncedAtMs: number | null;
  actionInFlight: 'start' | 'restart' | null;
  lastError: string | null;
  quitRequested: boolean;
};

export function createDesktopElectronMenuBarHost(
  input: CreateDesktopElectronMenuBarHostInput,
): DesktopElectronMenuBarHost {
  const enabled = (input.platform ?? process.platform) === 'darwin';
  const now = input.now ?? Date.now;
  const state: MenuBarInternalState = {
    windowVisible: true,
    lifecycleChecked: false,
    lifecycleStatus: null,
    runtimeHealthStatus: null,
    runtimeHealthReason: null,
    providerSummary: null,
    rendererUpdatedAt: null,
    rendererSyncedAtMs: null,
    actionInFlight: null,
    lastError: null,
    quitRequested: false,
  };
  let tray: Tray | null = null;
  let initialized = false;

  const applyMenu = (): void => {
    if (!tray) return;
    const projection = projectMenuBarSnapshot(state, now());
    tray.setContextMenu(input.electron.Menu.buildFromTemplate(buildMenuTemplate(
      projection,
      (itemId) => {
        void activate(itemId).catch((error) => {
          input.reportError(`menu-bar-activate:${itemId}`, error);
        });
      },
    )));
  };

  const acceptStatus = (value: unknown): MenuBarFixedRuntimeStatus => {
    const status = parseFixedRuntimeStatus(value);
    state.lifecycleChecked = true;
    state.lifecycleStatus = status;
    state.lastError = status.lastError ?? null;
    return status;
  };

  const refreshStatus = async (): Promise<MenuBarFixedRuntimeStatus> => {
    requireEnabled(enabled);
    try {
      const status = acceptStatus(await input.lifecycle.status());
      applyMenu();
      return status;
    } catch (error) {
      state.lifecycleChecked = true;
      state.lifecycleStatus = null;
      state.lastError = boundedErrorCode(error);
      applyMenu();
      throw error;
    }
  };

  const dispatchOpenTab = async (payload: MenuBarOpenTabPayload): Promise<void> => {
    await input.focusMainWindow();
    state.windowVisible = true;
    input.emitRendererEvent(MENU_BAR_OPEN_TAB_EVENT, payload);
    applyMenu();
  };

  const runRuntimeAction = async (action: 'start' | 'restart'): Promise<void> => {
    if (state.actionInFlight !== null) {
      throw new Error('menu-bar-runtime-action-in-flight');
    }
    state.actionInFlight = action;
    applyMenu();
    let actionError: unknown;
    try {
      const current = await refreshStatus();
      const currentVerified = fixedServiceVerified(current);
      if (
        !currentVerified
        || (action === 'start' && current.running)
        || (action === 'restart' && !current.running)
      ) {
        throw new Error(`menu-bar-runtime-${action}-unavailable`);
      }
      const result = action === 'start'
        ? await input.lifecycle.start()
        : await input.lifecycle.restart();
      acceptStatus(result);
    } catch (error) {
      actionError = error;
      state.lastError = boundedErrorCode(error);
    }
    try {
      await refreshStatus();
    } catch (error) {
      actionError ??= error;
    } finally {
      state.actionInFlight = null;
      applyMenu();
    }
    if (actionError) {
      throw actionError;
    }
  };

  async function activate(itemId: string): Promise<void> {
    requireEnabled(enabled);
    switch (itemId) {
      case MENU_BAR_ITEM_IDS.openNimi:
        await input.focusMainWindow();
        state.windowVisible = true;
        applyMenu();
        return;
      case MENU_BAR_ITEM_IDS.openRuntimeDashboard:
        await dispatchOpenTab({ tab: 'runtime', page: 'overview' });
        return;
      case MENU_BAR_ITEM_IDS.openLocalModels:
        await dispatchOpenTab({ tab: 'runtime', page: 'models' });
        return;
      case MENU_BAR_ITEM_IDS.openCloudConnectors:
        await dispatchOpenTab({ tab: 'runtime', page: 'cloud' });
        return;
      case MENU_BAR_ITEM_IDS.openSettings:
        await dispatchOpenTab({ tab: 'settings' });
        return;
      case MENU_BAR_ITEM_IDS.startRuntime:
        await runRuntimeAction('start');
        return;
      case MENU_BAR_ITEM_IDS.restartRuntime:
        await runRuntimeAction('restart');
        return;
      case MENU_BAR_ITEM_IDS.refreshStatus:
        await refreshStatus();
        return;
      case MENU_BAR_ITEM_IDS.quitNimi:
        state.quitRequested = true;
        applyMenu();
        try {
          input.quit();
        } catch (error) {
          state.quitRequested = false;
          applyMenu();
          throw error;
        }
        return;
      default:
        throw new Error('menu-bar-item-invalid');
    }
  }

  const commandHandlers = Object.freeze({
    async menu_bar_sync_runtime_health(context: {
      readonly command: string;
      readonly payload: Readonly<Record<string, unknown>>;
    }): Promise<{ readonly synced: true }> {
      requireEnabled(enabled);
      if (!initialized) {
        throw new Error('menu-bar-shell-not-initialized');
      }
      if (context.command !== MENU_BAR_RUNTIME_HEALTH_SYNC_COMMAND) {
        throw new Error('menu-bar-command-invalid');
      }
      const payload = parseMenuBarRuntimeHealthSyncCommandPayload(context.payload);
      await refreshStatus();
      syncRendererHealth(state, payload, now());
      applyMenu();
      return { synced: true };
    },
  });

  return Object.freeze({
    enabled,
    commandHandlers,
    async initialize(): Promise<void> {
      requireEnabled(enabled);
      if (initialized) {
        throw new Error('menu-bar-shell-already-initialized');
      }
      const icon = prepareTemplateIcon(input.icon);
      tray = new input.electron.Tray(icon);
      tray.setToolTip('Nimi Desktop');
      tray.on('click', () => {
        tray?.popUpContextMenu();
      });
      initialized = true;
      applyMenu();
      try {
        await refreshStatus();
      } catch (error) {
        input.reportError('menu-bar-refresh-status', error);
      }
    },
    dispose(): void {
      tray?.destroy();
      tray = null;
      initialized = false;
    },
    refreshStatus,
    activate,
    setWindowVisible(visible: boolean): void {
      state.windowVisible = visible;
      applyMenu();
    },
    hideMainWindowOnClose(): boolean {
      if (!enabled || state.quitRequested) {
        return false;
      }
      input.hideMainWindow();
      state.windowVisible = false;
      applyMenu();
      return true;
    },
    snapshot(): DesktopElectronMenuBarSnapshot {
      return projectMenuBarSnapshot(state, now());
    },
  });
}

function buildMenuTemplate(
  projection: DesktopElectronMenuBarSnapshot,
  activate: (itemId: string) => void,
): MenuItemConstructorOptions[] {
  const action = (itemId: string): (() => void) => () => activate(itemId);
  return [
    {
      id: 'menu-bar-state-header',
      label: `Nimi Runtime: ${projection.headerState}`,
      enabled: false,
    },
    { type: 'separator' },
    { id: MENU_BAR_ITEM_IDS.openNimi, label: 'Open Nimi', click: action(MENU_BAR_ITEM_IDS.openNimi) },
    {
      id: MENU_BAR_ITEM_IDS.openRuntimeDashboard,
      label: 'Runtime Dashboard',
      click: action(MENU_BAR_ITEM_IDS.openRuntimeDashboard),
    },
    {
      id: MENU_BAR_ITEM_IDS.openLocalModels,
      label: 'Local Models',
      click: action(MENU_BAR_ITEM_IDS.openLocalModels),
    },
    {
      id: MENU_BAR_ITEM_IDS.openCloudConnectors,
      label: 'Cloud Connectors',
      click: action(MENU_BAR_ITEM_IDS.openCloudConnectors),
    },
    {
      id: MENU_BAR_ITEM_IDS.openSettings,
      label: 'Settings',
      click: action(MENU_BAR_ITEM_IDS.openSettings),
    },
    { type: 'separator' },
    { id: 'menu-bar-runtime-line', label: projection.runtimeLine, enabled: false },
    {
      id: 'menu-bar-provider-line',
      label: projection.providerLine ?? 'Providers: unavailable',
      enabled: false,
      visible: projection.providerLine !== null,
    },
    { id: 'menu-bar-status-line', label: projection.statusLine, enabled: false },
    {
      id: 'menu-bar-last-check-line',
      label: projection.lastCheckLine ?? 'Last check: unavailable',
      enabled: false,
      visible: projection.lastCheckLine !== null,
    },
    { type: 'separator' },
    {
      id: MENU_BAR_ITEM_IDS.startRuntime,
      label: 'Start Runtime',
      enabled: projection.startEnabled,
      click: action(MENU_BAR_ITEM_IDS.startRuntime),
    },
    {
      id: MENU_BAR_ITEM_IDS.restartRuntime,
      label: 'Restart Runtime',
      enabled: projection.restartEnabled,
      click: action(MENU_BAR_ITEM_IDS.restartRuntime),
    },
    {
      id: MENU_BAR_ITEM_IDS.refreshStatus,
      label: 'Refresh Status',
      enabled: projection.refreshEnabled,
      click: action(MENU_BAR_ITEM_IDS.refreshStatus),
    },
    { type: 'separator' },
    { id: MENU_BAR_ITEM_IDS.quitNimi, label: 'Quit Nimi', click: action(MENU_BAR_ITEM_IDS.quitNimi) },
  ];
}

function projectMenuBarSnapshot(
  state: MenuBarInternalState,
  nowMs: number,
): DesktopElectronMenuBarSnapshot {
  const rendererFresh = state.rendererSyncedAtMs !== null
    && nowMs - state.rendererSyncedAtMs <= MENU_BAR_RENDERER_FRESHNESS_MS;
  const status = state.lifecycleStatus;
  const verified = fixedServiceVerified(status);
  const running = verified && status?.running === true;
  const headerState: MenuBarHeaderState = state.actionInFlight
    ? 'starting'
    : !state.lifecycleChecked || !verified
      ? 'unavailable'
      : running && rendererFresh && state.runtimeHealthStatus === 'DEGRADED'
        ? 'degraded'
        : running
          ? 'running'
          : 'stopped';
  const runtimeLine = state.actionInFlight
    ? 'Runtime: STARTING'
    : !verified
      ? 'Runtime: UNAVAILABLE'
      : running
        ? `Runtime: ${rendererFresh && state.runtimeHealthStatus
          ? state.runtimeHealthStatus
          : 'RUNNING'}`
        : 'Runtime: STOPPED';
  const providerLine = rendererFresh
    ? providerSummaryLine(state.providerSummary)
    : null;
  const statusLine = verified
    ? releaseStatusLine(status)
    : 'Status: signed service repair required';
  const lastCheckLine = rendererFresh
    ? `Last check: ${state.rendererUpdatedAt ?? '-'}`
    : null;
  const busy = state.actionInFlight !== null || state.quitRequested;
  return Object.freeze({
    headerState,
    rendererFresh,
    windowVisible: state.windowVisible,
    actionInFlight: state.actionInFlight,
    runtimeLine,
    providerLine,
    statusLine,
    lastCheckLine,
    startEnabled: !busy && verified && !running,
    restartEnabled: !busy && verified && running,
    refreshEnabled: !busy,
  });
}

function syncRendererHealth(
  state: MenuBarInternalState,
  payload: MenuBarRuntimeHealthSyncPayload,
  nowMs: number,
): void {
  state.runtimeHealthStatus = payload.runtimeHealthStatus ?? null;
  state.runtimeHealthReason = payload.runtimeHealthReason ?? null;
  state.providerSummary = payload.providerSummary ?? null;
  state.rendererUpdatedAt = payload.updatedAt ?? null;
  state.rendererSyncedAtMs = nowMs;
}

function providerSummaryLine(summary: MenuBarProviderSummary | null): string {
  if (!summary) return 'Providers: pending';
  return `Providers: ${summary.healthy} healthy / ${summary.unhealthy} unhealthy / ${summary.unknown} unknown`;
}

function releaseStatusLine(status: MenuBarFixedRuntimeStatus): string {
  const version = boundedVersion(status.version);
  if (status.launchMode.trim().toUpperCase() === 'RELEASE') {
    return version ? `Status: verified release ${version}` : 'Status: verified release';
  }
  return 'Status: verified development service';
}

function fixedServiceVerified(
  status: MenuBarFixedRuntimeStatus | null,
): status is MenuBarFixedRuntimeStatus {
  if (!status || status.managed !== true) return false;
  const mode = status.launchMode.trim().toUpperCase();
  return mode === 'RELEASE' || mode === 'RUNTIME';
}

function parseFixedRuntimeStatus(value: unknown): MenuBarFixedRuntimeStatus {
  if (!value || typeof value !== 'object') {
    throw new Error('menu-bar-runtime-status-invalid');
  }
  const record = value as Readonly<Record<string, unknown>>;
  if (typeof record.running !== 'boolean' || typeof record.managed !== 'boolean') {
    throw new Error('menu-bar-runtime-status-invalid');
  }
  const launchMode = String(record.launchMode ?? '').trim().toUpperCase();
  if (launchMode !== 'RELEASE' && launchMode !== 'RUNTIME') {
    throw new Error('menu-bar-runtime-status-invalid');
  }
  const version = boundedVersion(record.version);
  if (launchMode === 'RELEASE' && !version) {
    throw new Error('menu-bar-runtime-status-invalid');
  }
  const lastError = optionalBoundedText(record.lastError, 128);
  return {
    running: record.running,
    managed: record.managed,
    launchMode,
    ...(version ? { version } : {}),
    ...(lastError ? { lastError } : {}),
  };
}

function boundedVersion(value: unknown): string {
  const text = optionalBoundedText(value, 64);
  return text && /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/u.test(text) ? text : '';
}

function optionalBoundedText(value: unknown, maxLength: number): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return text && text.length <= maxLength ? text : '';
}

function boundedErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return 'runtime-service-unavailable';
  for (const key of ['reasonCode', 'code', 'message'] as const) {
    const value = (error as Readonly<Record<string, unknown>>)[key];
    if (typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,127}$/u.test(value)) {
      return value;
    }
  }
  return 'runtime-service-unavailable';
}

function prepareTemplateIcon(icon: NativeImage | string): NativeImage | string {
  if (typeof icon === 'string') {
    if (!icon.trim()) {
      throw new Error('menu-bar-icon-invalid');
    }
    return icon;
  }
  if (icon.isEmpty()) {
    throw new Error('menu-bar-icon-invalid');
  }
  icon.setTemplateImage(true);
  return icon;
}

function requireEnabled(enabled: boolean): void {
  if (!enabled) {
    throw new Error('menu-bar-shell-disabled');
  }
}
