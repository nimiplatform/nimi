import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import {
  BrowserWindow,
  screen,
  type IpcMainInvokeEvent,
} from 'electron';
import {
  NIMI_ELECTRON_BUNDLED_AVATAR_ASSET_RESOLVE_COMMAND,
  createNimiElectronBundledAvatarAssetHost,
  isAllowedElectronRendererUrl,
  type NimiElectronBundledAvatarHost,
  type NimiElectronCommandHandler,
  type NimiElectronShellFileProtocolHost,
  type NimiElectronShellUiCommandInput,
} from '@nimiplatform/kit/shell/electron/main';
import { NIMI_BUNDLED_AVATAR_STANDARD_SHELL_CAPABILITY_SET_ID } from '@nimiplatform/kit/shell/capabilities';
import {
  buildAvatarLaunchHandoffPayload,
  type AvatarLaunchHandoffPayload,
} from '@nimiplatform/kit/features/avatar/headless';

const AVATAR_EVENT_CHANNEL_PREFIX = 'nimi:runtime:event:';
const AVATAR_NAS_CHANGED_EVENT = 'avatar://nas-handlers-changed';

type AvatarWindowRecord = {
  readonly window: BrowserWindow;
  readonly launchContext: AvatarLaunchHandoffPayload;
};

export type DesktopElectronBundledAvatarHost = {
  readonly desktopCommandHandlers: Readonly<Record<string, NimiElectronCommandHandler>>;
  readonly runtimeBridgeHost: NimiElectronBundledAvatarHost;
  readonly launchInitialAvatar: (payload: AvatarLaunchHandoffPayload) => Promise<BrowserWindow>;
  readonly shutdown: () => Promise<void>;
};

export type CreateDesktopElectronBundledAvatarHostInput = {
  readonly rendererUrl: string;
  readonly preloadPath: string;
  readonly resolveAppPrivateDataRoot: () => Promise<string>;
  readonly localAssetProtocolHost: NimiElectronShellFileProtocolHost;
  readonly resolveSelectedDataRoot: () => Promise<string>;
  readonly devRendererRoot?: string;
};

export async function createDesktopElectronBundledAvatarHost(
  input: CreateDesktopElectronBundledAvatarHostInput,
): Promise<DesktopElectronBundledAvatarHost> {
  const rendererUrl = normalizeAbsoluteUrl(input.rendererUrl, 'bundled Avatar renderer URL');
  const resolveAppPrivateDataRoot = async (): Promise<string> => {
    const appPrivateDataRoot = path.resolve(await input.resolveAppPrivateDataRoot());
    await mkdir(appPrivateDataRoot, { recursive: true });
    return appPrivateDataRoot;
  };
  const localAssetRoots: string[] = [];
  const assetHost = createNimiElectronBundledAvatarAssetHost({
    resolveSelectedDataRoot: input.resolveSelectedDataRoot,
    localAssetProtocolHost: input.localAssetProtocolHost,
    localAssetRoots,
  });
  const windows = new Map<string, AvatarWindowRecord>();
  const nasWatchers = new Map<string, FSWatcher>();
  const senderInvalidationListeners = new Set<(sender: object) => void>();
  let devRendererProcess: ChildProcess | undefined;
  const ensureRendererReady = () => ensureBundledAvatarDevRenderer(
    rendererUrl,
    input.devRendererRoot,
    () => devRendererProcess,
    (process) => { devRendererProcess = process; },
  );
  const invalidateSender = (sender: object): void => {
    for (const listener of senderInvalidationListeners) listener(sender);
  };
  let shuttingDown = false;

  const recordForSender = (event: IpcMainInvokeEvent): AvatarWindowRecord => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    const record = [...windows.values()].find((candidate) => candidate.window === senderWindow);
    if (!record) throw new Error('desktop-bundled-avatar-sender-window-unbound');
    return record;
  };

  const closeWatcher = (watcherId: string): void => {
    nasWatchers.get(watcherId)?.close();
    nasWatchers.delete(watcherId);
  };

  const createWindow = async (launchContext: AvatarLaunchHandoffPayload): Promise<BrowserWindow> => {
    await ensureRendererReady();
    const existing = launchContext.avatarInstanceId ? windows.get(launchContext.avatarInstanceId) : undefined;
    if (existing && !existing.window.isDestroyed()) {
      existing.window.show();
      existing.window.moveTop();
      existing.window.focus();
      return existing.window;
    }
    const avatarInstanceId = launchContext.avatarInstanceId || `desktop-avatar-${randomUUID()}`;
    const canonicalContext = { ...launchContext, avatarInstanceId };
    const window = new BrowserWindow({
      width: 420,
      height: 680,
      minWidth: 390,
      minHeight: 520,
      transparent: true,
      frame: false,
      resizable: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      title: 'Nimi Avatar',
      backgroundColor: '#00000000',
      webPreferences: {
        preload: input.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    windows.set(avatarInstanceId, { window, launchContext: canonicalContext });
    const sender = window.webContents;
    let senderReleased = false;
    const releaseWindow = (): void => {
      const current = windows.get(avatarInstanceId);
      if (current?.window === window) windows.delete(avatarInstanceId);
      if (!senderReleased) {
        senderReleased = true;
        invalidateSender(sender);
      }
    };
    secureAvatarWindow(window, rendererUrl, releaseWindow);
    window.on('close', releaseWindow);
    window.on('closed', () => {
      releaseWindow();
      for (const watcherId of [...nasWatchers.keys()]) closeWatcher(watcherId);
    });
    await window.loadURL(rendererUrl);
    return window;
  };

  const desktopCommandHandlers: Readonly<Record<string, NimiElectronCommandHandler>> = {
    desktop_avatar_launch_handoff: async ({ payload }) => {
      const nested = exactNestedPayload(payload, 'desktop_avatar_launch_handoff');
      assertOnlyKeys(
        nested,
        ['agentId', 'avatarInstanceId', 'launchSource', 'sourceSurface'],
        'desktop_avatar_launch_handoff',
      );
      const launchContext = buildAvatarLaunchHandoffPayload({
        agentId: nested.agentId,
        avatarInstanceId: nested.avatarInstanceId,
        launchSource: nested.launchSource,
        sourceSurface: nested.sourceSurface,
      });
      const window = await createWindow(launchContext);
      const record = [...windows.values()].find((candidate) => candidate.window === window);
      if (!record) throw new Error('desktop-bundled-avatar-window-registry-missing');
      return {
        opened: true,
        handoffUri: `desktop-supervised-avatar://${encodeURIComponent(record.launchContext.avatarInstanceId || '')}`,
      };
    },
    desktop_avatar_close_handoff: async ({ payload }) => {
      const nested = exactNestedPayload(payload, 'desktop_avatar_close_handoff');
      const avatarInstanceId = requiredText(nested.avatarInstanceId, 'avatarInstanceId');
      assertOnlyKeys(nested, ['avatarInstanceId', 'closedBy', 'sourceSurface'], 'desktop_avatar_close_handoff');
      const record = windows.get(avatarInstanceId);
      if (record && !record.window.isDestroyed()) record.window.close();
      return {
        opened: true,
        handoffUri: `desktop-supervised-avatar://close/${encodeURIComponent(avatarInstanceId)}`,
      };
    },
    desktop_avatar_instance_registry_list: ({ payload }) => {
      const nested = exactNestedPayload(payload, 'desktop_avatar_instance_registry_list');
      assertOnlyKeys(nested, ['agentId'], 'desktop_avatar_instance_registry_list');
      const agentId = requiredLocalAgentRef(nested.agentId, 'agentId');
      return [...windows.values()]
        .filter((record) => !record.window.isDestroyed() && record.launchContext.agentId === agentId)
        .map((record) => ({
          avatarInstanceId: record.launchContext.avatarInstanceId,
          agentId: record.launchContext.agentId,
          launchSource: record.launchContext.launchSource,
        }));
    },
  };

  const avatarCommandHandlers: Readonly<Record<string, NimiElectronCommandHandler>> = {
    nimi_avatar_get_launch_context: ({ payload, event }) => {
      requireEmptyPayload(payload, 'nimi_avatar_get_launch_context');
      return recordForSender(asElectronEvent(event)).launchContext;
    },
    [NIMI_ELECTRON_BUNDLED_AVATAR_ASSET_RESOLVE_COMMAND]: async ({ payload }) => (
      assetHost.resolve(exactNestedPayload(payload, NIMI_ELECTRON_BUNDLED_AVATAR_ASSET_RESOLVE_COMMAND))
    ),
    nimi_avatar_scan_nas_handlers: ({ payload }) => {
      assertOnlyKeys(payload, ['nimiDir'], 'nimi_avatar_scan_nas_handlers');
      return assetHost.scanNasHandlers(payload.nimiDir);
    },
    nimi_avatar_read_text_file: ({ payload }) => {
      assertOnlyKeys(payload, ['path'], 'nimi_avatar_read_text_file');
      return assetHost.readTextFile(payload.path);
    },
    nimi_avatar_watch_nas_handlers: async ({ payload, event }) => {
      assertOnlyKeys(payload, ['nimiDir', 'watcherId'], 'nimi_avatar_watch_nas_handlers');
      const watcherId = requiredText(payload.watcherId, 'watcherId');
      const nimiDir = await assetHost.assertAdmittedDirectory(payload.nimiDir);
      closeWatcher(watcherId);
      const sender = asElectronEvent(event).sender;
      const watcher = watch(nimiDir, { recursive: true }, (eventType, filename) => {
        if (sender.isDestroyed()) {
          closeWatcher(watcherId);
          return;
        }
        sender.send(`${AVATAR_EVENT_CHANNEL_PREFIX}${AVATAR_NAS_CHANGED_EVENT}`, {
          watcher_id: watcherId,
          nimi_dir: nimiDir,
          changed_files: filename ? [String(filename)] : [],
          reload_mode: eventType === 'rename' ? 'update' : 'update',
        });
      });
      nasWatchers.set(watcherId, watcher);
      return undefined;
    },
    nimi_avatar_unwatch_nas_handlers: ({ payload }) => {
      assertOnlyKeys(payload, ['watcherId'], 'nimi_avatar_unwatch_nas_handlers');
      closeWatcher(requiredText(payload.watcherId, 'watcherId'));
      return undefined;
    },
    nimi_avatar_get_cursor_client_position: ({ payload, event }) => {
      requireEmptyPayload(payload, 'nimi_avatar_get_cursor_client_position');
      const window = senderWindow(asElectronEvent(event));
      const cursor = screen.getCursorScreenPoint();
      const bounds = window.getBounds();
      const display = screen.getDisplayMatching(bounds);
      return {
        screenX: cursor.x,
        screenY: cursor.y,
        clientX: cursor.x - bounds.x,
        clientY: cursor.y - bounds.y,
        scaleFactor: display.scaleFactor || 1,
      };
    },
  };

  const runtimeBridgeHost: NimiElectronBundledAvatarHost = {
    rendererUrl,
    authorizeSender: (event) => {
      const electronEvent = asElectronEvent(event);
      const record = [...windows.values()].find((candidate) => (
        !candidate.window.isDestroyed()
        && candidate.window.webContents === electronEvent.sender
      ));
      if (!record) return false;
      return electronEvent.senderFrame === record.window.webContents.mainFrame;
    },
    subscribeSenderInvalidation: (listener) => {
      senderInvalidationListeners.add(listener);
      return () => senderInvalidationListeners.delete(listener);
    },
    standardShellHost: {
      capabilitySetRef: NIMI_BUNDLED_AVATAR_STANDARD_SHELL_CAPABILITY_SET_ID,
      standardDataRootBinding: {
        source: 'product-control-projection',
        resolveDataRoot: resolveAppPrivateDataRoot,
      },
      localAssetRoots,
      localAssetProtocolHost: input.localAssetProtocolHost,
      floatingWindow: {
        setBounds: (payload, call) => setFloatingWindowBounds(payload, call),
        setIgnoreCursorEvents: (payload, call) => {
          senderWindow(asElectronEvent(call.event)).setIgnoreMouseEvents(Boolean(payload.ignore), {
            forward: payload.forward === undefined ? true : Boolean(payload.forward),
          });
        },
        setAlwaysOnTop: (payload, call) => {
          senderWindow(asElectronEvent(call.event)).setAlwaysOnTop(Boolean(payload.alwaysOnTop));
        },
        hide: (_payload, call) => senderWindow(asElectronEvent(call.event)).hide(),
        close: (_payload, call) => senderWindow(asElectronEvent(call.event)).close(),
        beginManualDrag: (_payload, call) => {
          const [x, y] = senderWindow(asElectronEvent(call.event)).getPosition();
          return { mode: 'manual', originX: x, originY: y };
        },
        moveManualDrag: (payload, call) => {
          const x = Math.round(requiredNumber(payload.originX, 'originX') + requiredNumber(payload.totalDeltaX, 'totalDeltaX'));
          const y = Math.round(requiredNumber(payload.originY, 'originY') + requiredNumber(payload.totalDeltaY, 'totalDeltaY'));
          senderWindow(asElectronEvent(call.event)).setPosition(x, y);
        },
        constrainToVisibleArea: (payload, call) => constrainFloatingWindow(payload, call),
      },
    },
    commandHandlers: avatarCommandHandlers,
  };

  return {
    desktopCommandHandlers,
    runtimeBridgeHost,
    launchInitialAvatar: createWindow,
    shutdown: async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      for (const watcherId of [...nasWatchers.keys()]) closeWatcher(watcherId);
      for (const record of [...windows.values()]) {
        if (!record.window.isDestroyed()) record.window.destroy();
      }
      windows.clear();
      senderInvalidationListeners.clear();
      if (devRendererProcess && devRendererProcess.exitCode === null) devRendererProcess.kill();
      devRendererProcess = undefined;
      assetHost.close();
    },
  };
}

async function ensureBundledAvatarDevRenderer(
  rendererUrl: string,
  devRendererRoot: string | undefined,
  currentProcess: () => ChildProcess | undefined,
  setProcess: (process: ChildProcess) => void,
): Promise<void> {
  if (await rendererResponds(rendererUrl)) return;
  const root = normalizeText(devRendererRoot);
  if (!root) throw new Error('desktop-bundled-avatar-renderer-unavailable');
  const existing = currentProcess();
  if (!existing || existing.exitCode !== null) {
    setProcess(spawn(process.execPath, [
      path.join(path.resolve(root), 'node_modules', 'vite', 'bin', 'vite.js'),
      '--host', '127.0.0.1', '--port', '1427', '--strictPort',
    ], { cwd: path.resolve(root), stdio: 'inherit', env: process.env }));
  }
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (await rendererResponds(rendererUrl)) return;
    if (currentProcess()?.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('desktop-bundled-avatar-renderer-start-failed');
}

async function rendererResponds(url: string): Promise<boolean> {
  try {
    const response = await fetch(url);
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

function secureAvatarWindow(
  window: BrowserWindow,
  rendererUrl: string,
  invalidate: () => void,
): void {
  let initialNavigationComplete = false;
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.once('did-finish-load', () => {
    initialNavigationComplete = true;
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedElectronRendererUrl(url, [rendererUrl])) event.preventDefault();
    if (initialNavigationComplete) invalidate();
  });
}

function setFloatingWindowBounds(
  payload: Readonly<Record<string, unknown>>,
  input: NimiElectronShellUiCommandInput,
): void {
  const window = senderWindow(asElectronEvent(input.event));
  const width = optionalNumber(payload.width);
  const height = optionalNumber(payload.height);
  const x = optionalNumber(payload.x);
  const y = optionalNumber(payload.y);
  if (width !== undefined && height !== undefined) window.setSize(Math.round(width), Math.round(height));
  if (x !== undefined && y !== undefined) window.setPosition(Math.round(x), Math.round(y));
}

function constrainFloatingWindow(
  payload: Readonly<Record<string, unknown>>,
  input: NimiElectronShellUiCommandInput,
): { readonly constrained: boolean } {
  const window = senderWindow(asElectronEvent(input.event));
  const bounds = window.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  const ratio = Math.min(1, Math.max(0.05, optionalNumber(payload.minVisibleRatio) ?? 0.2));
  const minWidth = Math.ceil(bounds.width * ratio);
  const minHeight = Math.ceil(bounds.height * ratio);
  const x = Math.min(Math.max(bounds.x, area.x - bounds.width + minWidth), area.x + area.width - minWidth);
  const y = Math.min(Math.max(bounds.y, area.y - bounds.height + minHeight), area.y + area.height - minHeight);
  const constrained = x !== bounds.x || y !== bounds.y;
  if (constrained) window.setBounds({ ...bounds, x, y });
  return { constrained };
}

function exactNestedPayload(
  payload: Readonly<Record<string, unknown>>,
  command: string,
): Readonly<Record<string, unknown>> {
  assertOnlyKeys(payload, ['payload'], command);
  if (!payload.payload || typeof payload.payload !== 'object' || Array.isArray(payload.payload)) {
    throw new Error(`${command} requires an object payload`);
  }
  return payload.payload as Readonly<Record<string, unknown>>;
}

function requireEmptyPayload(payload: Readonly<Record<string, unknown>>, command: string): void {
  assertOnlyKeys(payload, [], command);
}

function assertOnlyKeys(
  payload: Readonly<Record<string, unknown>>,
  allowedKeys: readonly string[],
  command: string,
): void {
  const allowed = new Set(allowedKeys);
  const keys = Object.keys(payload);
  if (keys.some((key) => !allowed.has(key))) {
    throw new Error(`${command} payload keys are invalid`);
  }
}

function normalizeAbsoluteUrl(value: unknown, field: string): string {
  const normalized = requiredText(value, field);
  return new URL(normalized).toString();
}

function requiredLocalAgentRef(value: unknown, field: string): string {
  const normalized = requiredText(value, field);
  if (!normalized.startsWith('local-agent:')) throw new Error(`${field} must be a local-agent ref`);
  return normalized;
}

function requiredText(value: unknown, field: string): string {
  const normalized = normalizeText(value);
  if (!normalized || normalized.length > 32_768) throw new Error(`${field} is required`);
  return normalized;
}

function requiredNumber(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${field} must be numeric`);
  return parsed;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asElectronEvent(event: NimiElectronShellUiCommandInput['event']): IpcMainInvokeEvent {
  return event as unknown as IpcMainInvokeEvent;
}

function senderWindow(event: IpcMainInvokeEvent): BrowserWindow {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) throw new Error('desktop-bundled-avatar-sender-window-missing');
  return window;
}
