import { createHash, randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import { mkdir, stat } from 'node:fs/promises';
import {
  BrowserWindow,
  screen,
  shell,
  type IpcMainInvokeEvent,
} from 'electron';
import {
  NIMI_ELECTRON_BUNDLED_AVATAR_ASSET_RESOLVE_COMMAND,
  createNimiElectronBundledAvatarAssetHost,
  createNimiElectronDesktopControlHost,
  isAllowedElectronRendererUrl,
  type NimiElectronBundledAvatarHost,
  type NimiElectronBundledAvatarRuntimeAsset,
  type NimiElectronCommandHandler,
  type NimiElectronDesktopControlHost,
  type NimiElectronShellFileProtocolHost,
  type NimiElectronShellUiCommandInput,
} from '@nimiplatform/kit/shell/electron/main';
import { NIMI_BUNDLED_AVATAR_STANDARD_SHELL_CAPABILITY_SET_ID } from '@nimiplatform/kit/shell/capabilities';
import { getRuntimeWireCodec } from '@nimiplatform/sdk/runtime/generated';
import {
  buildAvatarHostHandoffRequest,
  buildAvatarLaunchHandoffPayload,
  parseAvatarHostHandoffResult,
  type AvatarHostHandoffRequest,
  type AvatarHostHandoffResult,
  type AvatarLaunchHandoffPayload,
} from '@nimiplatform/kit/features/avatar/headless';
import { createBundledAvatarWindowOptions } from './bundled-avatar-window-options.js';

const AVATAR_EVENT_CHANNEL_PREFIX = 'nimi:runtime:event:';
const AVATAR_NAS_CHANGED_EVENT = 'avatar://nas-handlers-changed';
const AVATAR_AGENT_CENTER_PREVIEW_REQUEST_EVENT = 'avatar://agent-center-preview-request';
const AVATAR_AGENT_CENTER_PREVIEW_COMPLETE_COMMAND = 'nimi_avatar_agent_center_preview_complete';
const AVATAR_AGENT_CENTER_PREVIEW_TIMEOUT_MS = 5_000;
const GET_AGENT_PRESENTATION_ASSET_METHOD_ID =
  '/nimi.runtime.v1.RuntimeAgentService/GetAgentPresentationAsset';
const RUNTIME_AVATAR_ASSET_TIMEOUT_MS = 30_000;
const MAX_RUNTIME_AVATAR_ASSET_BYTES = 64 * 1024 * 1024;

type AvatarPreviewProjectionRequest = {
  readonly requestId: string;
  readonly agentHandle: string;
  readonly avatarAssetRef: string;
  readonly backendKind: 'live2d' | 'vrm';
  readonly presentationRevision: string;
};

type AvatarPreviewProjectionResult = Readonly<Record<string, unknown>> & {
  readonly state: 'ready' | 'failed' | 'unavailable' | 'loading';
};

type AvatarWindowRecord = {
  readonly window: BrowserWindow;
  readonly launchContext: AvatarLaunchHandoffPayload;
  committedPresentationRef: string | null;
  temporaryCustodyRef: string | null;
};

export type DesktopElectronBundledAvatarHost = {
  readonly desktopCommandHandlers: Readonly<Record<string, NimiElectronCommandHandler>>;
  readonly runtimeBridgeHost: NimiElectronBundledAvatarHost;
  readonly launchInitialAvatar: (payload: AvatarLaunchHandoffPayload) => Promise<BrowserWindow>;
  readonly hostHandoff: (request: AvatarHostHandoffRequest) => Promise<AvatarHostHandoffResult>;
  readonly shutdown: () => Promise<void>;
};

export type CreateDesktopElectronBundledAvatarHostInput = {
  readonly rendererUrl: string;
  readonly preloadPath: string;
  readonly resolveAppPrivateDataRoot: () => Promise<string>;
  readonly localAssetProtocolHost: NimiElectronShellFileProtocolHost;
  readonly devRendererRoot?: string;
  readonly packagedRendererIndexPath?: string;
  readonly publishPreviewImage?: (bytes: Uint8Array) => string;
};

export type DesktopBundledAvatarRuntimeAssetTransport = Pick<
  NimiElectronDesktopControlHost,
  'bundledAvatarUnary'
>;

export function createDesktopBundledAvatarRuntimeAssetResolver(
  control: DesktopBundledAvatarRuntimeAssetTransport = createNimiElectronDesktopControlHost(),
): (input: {
  readonly agentHandle: string;
  readonly assetRef: string;
}) => Promise<NimiElectronBundledAvatarRuntimeAsset> {
  const codec = getRuntimeWireCodec(GET_AGENT_PRESENTATION_ASSET_METHOD_ID);
  return async ({ agentHandle: rawAgentHandle, assetRef: rawAssetRef }) => {
    const agentHandle = requiredAgentHandle(rawAgentHandle, 'agentHandle');
    const assetRef = requiredAvatarAssetRef(rawAssetRef, 'assetRef');
    const responseBytes = await control.bundledAvatarUnary({
      methodId: GET_AGENT_PRESENTATION_ASSET_METHOD_ID,
      requestBytes: codec.encodeRequest({
        agentHandle,
        assetRef,
      }),
      timeoutMs: RUNTIME_AVATAR_ASSET_TIMEOUT_MS,
    });
    return projectRuntimeAvatarAsset(codec.decodeResponse(responseBytes), assetRef);
  };
}

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
  const runtimeControl = createNimiElectronDesktopControlHost();
  const assetHost = createNimiElectronBundledAvatarAssetHost({
    resolveAppPrivateDataRoot,
    resolveRuntimeAsset: createDesktopBundledAvatarRuntimeAssetResolver(runtimeControl),
    localAssetProtocolHost: input.localAssetProtocolHost,
    localAssetRoots,
  });
  const windows = new Map<string, AvatarWindowRecord>();
  const nasWatchers = new Map<string, FSWatcher>();
  const pendingPreviewRequests = new Map<string, {
    readonly record: AvatarWindowRecord;
    readonly request: AvatarPreviewProjectionRequest;
    readonly resolve: (value: Readonly<Record<string, unknown>>) => void;
    readonly timeout: ReturnType<typeof setTimeout>;
  }>();
  const senderInvalidationListeners = new Set<(sender: object) => void>();
  let devRendererProcess: ChildProcess | undefined;
  const ensureRendererReady = () => ensureBundledAvatarDevRenderer(
    rendererUrl,
    input.devRendererRoot,
    input.packagedRendererIndexPath,
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

  const completePendingPreview = (
    requestId: string,
    value: Readonly<Record<string, unknown>>,
  ): void => {
    const pending = pendingPreviewRequests.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    pendingPreviewRequests.delete(requestId);
    pending.resolve({
      result: projectDesktopPreviewEvidence(value.result),
      ...(typeof value.previewPngBase64 === 'string'
        ? { previewPngBase64: value.previewPngBase64 }
        : {}),
    });
  };

  const releasePendingPreviewsForRecord = (record: AvatarWindowRecord, reason: string): void => {
    for (const [requestId, pending] of pendingPreviewRequests) {
      if (pending.record !== record) continue;
      completePendingPreview(requestId, {
        result: unavailablePreviewResult(pending.request, reason),
      });
    }
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
    const window = new BrowserWindow(createBundledAvatarWindowOptions(input.preloadPath));
    const windowRecord: AvatarWindowRecord = {
      window,
      launchContext: canonicalContext,
      committedPresentationRef: null,
      temporaryCustodyRef: null,
    };
    windows.set(avatarInstanceId, windowRecord);
    const sender = window.webContents;
    let senderReleased = false;
    const releaseWindow = (): void => {
      const current = windows.get(avatarInstanceId);
      if (current?.window === window) windows.delete(avatarInstanceId);
      releasePendingPreviewsForRecord(windowRecord, 'Avatar preview renderer window closed before projection completed.');
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
        ['agentHandle', 'conversationAnchorId', 'avatarInstanceId', 'launchSource', 'sourceSurface'],
        'desktop_avatar_launch_handoff',
      );
      const agentHandle = requiredAgentHandle(nested.agentHandle, 'agentHandle');
      const launchContext = buildAvatarLaunchHandoffPayload({
        agentHandle,
        conversationAnchorId: nested.conversationAnchorId,
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
      assertOnlyKeys(nested, ['agentHandle'], 'desktop_avatar_instance_registry_list');
      const agentHandle = requiredAgentHandle(nested.agentHandle, 'agentHandle');
      return [...windows.values()]
        .filter((record) => !record.window.isDestroyed() && record.launchContext.agentHandle === agentHandle)
        .map((record) => ({
          avatarInstanceId: record.launchContext.avatarInstanceId,
          agentHandle: record.launchContext.agentHandle,
          launchSource: record.launchContext.launchSource,
        }));
    },
    desktop_avatar_preview_projection: ({ payload }) => {
      const nested = exactNestedPayload(payload, 'desktop_avatar_preview_projection');
      assertOnlyKeys(
        nested,
        ['agentHandle', 'avatarAssetRef', 'backendKind', 'presentationRevision'],
        'desktop_avatar_preview_projection',
      );
      const agentHandle = requiredAgentHandle(nested.agentHandle, 'agentHandle');
      const backendKind = requiredPreviewBackendKind(nested.backendKind);
      const avatarAssetRef = requiredText(nested.avatarAssetRef, 'avatarAssetRef');
      const presentationRevision = requiredText(nested.presentationRevision, 'presentationRevision');
      const record = [...windows.values()].find((candidate) => (
        !candidate.window.isDestroyed()
        && candidate.launchContext.agentHandle === agentHandle
      ));
      if (!record) {
        return {
          result: projectDesktopPreviewEvidence(unavailablePreviewResult(
            { avatarAssetRef, backendKind },
            'No live Desktop-supervised Avatar renderer is available for this Agent handle.',
          )),
        };
      }
      const request: AvatarPreviewProjectionRequest = {
        requestId: randomUUID(),
        agentHandle: record.launchContext.agentHandle,
        avatarAssetRef,
        backendKind,
        presentationRevision,
      };
      return new Promise<Readonly<Record<string, unknown>>>((resolve) => {
        const timeout = setTimeout(() => {
          completePendingPreview(request.requestId, {
            result: unavailablePreviewResult(request, 'Avatar preview renderer did not answer before the carrier timeout.'),
          });
        }, AVATAR_AGENT_CENTER_PREVIEW_TIMEOUT_MS);
        pendingPreviewRequests.set(request.requestId, { record, request, resolve, timeout });
        record.window.webContents.send(
          `${AVATAR_EVENT_CHANNEL_PREFIX}${AVATAR_AGENT_CENTER_PREVIEW_REQUEST_EVENT}`,
          request,
        );
      });
    },
  };

  const avatarCommandHandlers: Readonly<Record<string, NimiElectronCommandHandler>> = {
    nimi_avatar_get_launch_context: ({ payload, event }) => {
      requireEmptyPayload(payload, 'nimi_avatar_get_launch_context');
      const context = recordForSender(asElectronEvent(event)).launchContext;
      return {
        agentHandle: context.agentHandle,
        conversationAnchorId: context.conversationAnchorId,
        avatarInstanceId: context.avatarInstanceId,
        launchSource: context.launchSource,
      };
    },
    [AVATAR_AGENT_CENTER_PREVIEW_COMPLETE_COMMAND]: async ({ payload, event }) => {
      assertOnlyKeys(payload, ['requestId', 'result'], AVATAR_AGENT_CENTER_PREVIEW_COMPLETE_COMMAND);
      const requestId = requiredText(payload.requestId, 'requestId');
      const pending = pendingPreviewRequests.get(requestId);
      if (!pending) return { accepted: false };
      const record = recordForSender(asElectronEvent(event));
      if (record !== pending.record) {
        throw new Error('desktop-bundled-avatar-preview-sender-mismatch');
      }
      const result = parseAvatarPreviewProjectionResult(payload.result, pending.request);
      if (result.state !== 'ready') {
        completePendingPreview(requestId, { result });
        return { accepted: true };
      }
      try {
        const image = await record.window.webContents.capturePage();
        if (image.isEmpty()) throw new Error('Avatar preview capture produced an empty image.');
        const png = image.toPNG();
        if (png.length < 8 || png.length > 8 * 1024 * 1024) {
          throw new Error('Avatar preview capture produced an invalid PNG payload.');
        }
        const previewImageRef = input.publishPreviewImage?.(png);
        completePendingPreview(requestId, previewImageRef ? {
          result: { ...result, previewImageRef },
        } : {
          result,
          previewPngBase64: png.toString('base64'),
        });
      } catch (error) {
        completePendingPreview(requestId, {
          result: failedPreviewResult(
            pending.request,
            error instanceof Error ? error.message : 'Avatar preview capture failed.',
          ),
        });
      }
      return { accepted: true };
    },
    [NIMI_ELECTRON_BUNDLED_AVATAR_ASSET_RESOLVE_COMMAND]: async ({ payload, event }) => {
      const request = exactNestedPayload(
        payload,
        NIMI_ELECTRON_BUNDLED_AVATAR_ASSET_RESOLVE_COMMAND,
      );
      assertOnlyKeys(
        request,
        ['avatarAssetRef', 'backendKind'],
        NIMI_ELECTRON_BUNDLED_AVATAR_ASSET_RESOLVE_COMMAND,
      );
      const record = recordForSender(asElectronEvent(event));
      return assetHost.resolveBoundPresentation({
        avatarAssetRef: request.avatarAssetRef,
        backendKind: request.backendKind,
      }, record.launchContext.agentHandle);
    },
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
      revealInOs: (targetPath) => shell.showItemInFolder(targetPath),
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

  // Host mechanics only: this port neither derives product coverage nor
  // projects Runtime/SDK availability, result, or error semantics.
  // @nimi-authority: rule.nimi.avatar.embodiment.r023
  const hostHandoff = async (rawRequest: AvatarHostHandoffRequest): Promise<AvatarHostHandoffResult> => {
    const request = buildAvatarHostHandoffRequest(rawRequest);
    const target = request.target;
    const findRecord = (): AvatarWindowRecord | undefined => {
      if (target.avatarInstanceId) {
        const byInstance = windows.get(target.avatarInstanceId);
        if (byInstance && !byInstance.window.isDestroyed()) return byInstance;
      }
      return [...windows.values()].find((candidate) => (
        !candidate.window.isDestroyed()
        && candidate.launchContext.agentHandle === target.agentHandle
        && (!target.conversationAnchorId
          || candidate.launchContext.conversationAnchorId === target.conversationAnchorId)
      ));
    };
    let record = findRecord();
    if (request.command === 'launch' && !record) {
      const window = await createWindow(buildAvatarLaunchHandoffPayload({
        agentHandle: target.agentHandle,
        conversationAnchorId: target.conversationAnchorId,
        avatarInstanceId: target.avatarInstanceId,
        launchSource: target.launchSource ?? 'app-avatar-host-handoff',
        sourceSurface: target.launchSource ?? 'app-avatar-host-handoff',
      }));
      record = [...windows.values()].find((candidate) => candidate.window === window);
      if (!record) throw new Error('desktop-avatar-host-handoff-window-registry-missing');
      record.committedPresentationRef = target.committedPresentationRef;
      record.temporaryCustodyRef = target.temporaryCustodyRef;
    }
    if (!record) {
      return parseAvatarHostHandoffResult({
        command: request.command,
        state: 'absent',
        avatarInstanceRef: null,
        committedPresentationRef: null,
        temporaryCustodyRef: null,
      }, request.command);
    }
    if (request.command === 'launch' || request.command === 'focus') {
      record.window.show();
      record.window.moveTop();
      record.window.focus();
    }
    return parseAvatarHostHandoffResult({
      command: request.command,
      state: record.window.isFocused() ? 'focused' : 'present',
      avatarInstanceRef: record.launchContext.avatarInstanceId,
      committedPresentationRef: record.committedPresentationRef,
      temporaryCustodyRef: record.temporaryCustodyRef,
    }, request.command);
  };

  return {
    desktopCommandHandlers,
    runtimeBridgeHost,
    launchInitialAvatar: createWindow,
    hostHandoff,
    shutdown: async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      for (const watcherId of [...nasWatchers.keys()]) closeWatcher(watcherId);
      for (const [requestId, pending] of pendingPreviewRequests) {
        completePendingPreview(requestId, {
          result: unavailablePreviewResult(pending.request, 'Desktop Avatar host is shutting down.'),
        });
      }
      for (const record of [...windows.values()]) {
        if (!record.window.isDestroyed()) record.window.destroy();
      }
      windows.clear();
      senderInvalidationListeners.clear();
      if (devRendererProcess && devRendererProcess.exitCode === null) devRendererProcess.kill();
      devRendererProcess = undefined;
      await assetHost.close();
    },
  };
}

async function ensureBundledAvatarDevRenderer(
  rendererUrl: string,
  devRendererRoot: string | undefined,
  packagedRendererIndexPath: string | undefined,
  currentProcess: () => ChildProcess | undefined,
  setProcess: (process: ChildProcess) => void,
): Promise<void> {
  if (await rendererResponds(rendererUrl, packagedRendererIndexPath)) return;
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

async function rendererResponds(url: string, packagedRendererIndexPath?: string): Promise<boolean> {
  const packagedIndex = normalizeText(packagedRendererIndexPath);
  if (packagedIndex) {
    return stat(packagedIndex).then((metadata) => metadata.isFile(), () => false);
  }
  if (new URL(url).protocol === 'file:') {
    return false;
  }
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
    if (!initialNavigationComplete) return;
    event.preventDefault();
    invalidate();
    if (!window.isDestroyed()) window.close();
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

function parseAvatarPreviewProjectionResult(
  value: unknown,
  request: AvatarPreviewProjectionRequest,
): AvatarPreviewProjectionResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Avatar preview renderer returned an invalid result.');
  }
  const record = value as Readonly<Record<string, unknown>>;
  const state = record.state;
  if (state !== 'ready' && state !== 'failed' && state !== 'unavailable' && state !== 'loading') {
    throw new Error('Avatar preview renderer returned an invalid state.');
  }
  if (record.tier !== 'avatar_preview_service') {
    throw new Error('Avatar preview renderer returned an invalid service tier.');
  }
  const warnings = record.warnings;
  if (!Array.isArray(warnings) || warnings.some((entry) => typeof entry !== 'string')) {
    throw new Error('Avatar preview renderer returned invalid warnings.');
  }
  if (state === 'ready') {
    assertOnlyKeys(record, [
      'state',
      'tier',
      'avatarAssetRef',
      'backendKind',
      'previewMaterialRef',
      'previewImageRef',
      'visiblePixels',
      'nonPlaceholder',
      'warnings',
    ], 'Avatar preview renderer ready result');
    if (record.avatarAssetRef !== request.avatarAssetRef
      || record.backendKind !== request.backendKind
      || record.nonPlaceholder !== true) {
      throw new Error('Avatar preview renderer result does not match the requested material.');
    }
    const visiblePixels = requiredNumber(record.visiblePixels, 'visiblePixels');
    if (visiblePixels <= 0) throw new Error('Avatar preview renderer returned no visible pixels.');
    const previewImageRef = requiredText(record.previewImageRef, 'previewImageRef');
    if (!previewImageRef.startsWith('/__nimi/avatar-preview/')
      || previewImageRef.startsWith('//')
      || previewImageRef.includes('\\')) {
      throw new Error('Avatar preview renderer returned an uncontrolled surface ref.');
    }
    return { ...record, state };
  }
  assertOnlyKeys(record, [
    'state',
    'tier',
    'avatarAssetRef',
    'backendKind',
    'previewMaterialRef',
    'previewImageRef',
    'visiblePixels',
    'nonPlaceholder',
    'reasonCode',
    'reason',
    'warnings',
  ], 'Avatar preview renderer non-ready result');
  if (record.previewImageRef !== null
    || record.visiblePixels !== null
    || record.nonPlaceholder !== false) {
    throw new Error('Avatar preview renderer non-ready result claimed render output.');
  }
  requiredText(record.reasonCode, 'reasonCode');
  requiredText(record.reason, 'reason');
  return { ...record, state };
}

function unavailablePreviewResult(
  request: Pick<AvatarPreviewProjectionRequest, 'avatarAssetRef' | 'backendKind'>,
  reason: string,
): Readonly<Record<string, unknown>> {
  return {
    state: 'unavailable',
    tier: 'avatar_preview_service',
    avatarAssetRef: request.avatarAssetRef,
    backendKind: request.backendKind,
    previewMaterialRef: null,
    previewImageRef: null,
    visiblePixels: null,
    nonPlaceholder: false,
    reasonCode: 'capability_unavailable',
    reason,
    warnings: [],
  };
}

function failedPreviewResult(
  request: Pick<AvatarPreviewProjectionRequest, 'avatarAssetRef' | 'backendKind'>,
  reason: string,
): Readonly<Record<string, unknown>> {
  return {
    ...unavailablePreviewResult(request, reason),
    state: 'failed',
    reasonCode: 'host_internal_error',
  };
}

function projectDesktopPreviewEvidence(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Avatar preview evidence is invalid.');
  }
  const record = value as Readonly<Record<string, unknown>>;
  const warnings = Array.isArray(record.warnings)
    && record.warnings.every((entry) => typeof entry === 'string')
    ? record.warnings
    : [];
  if (record.state === 'ready') {
    return {
      state: 'ready',
      tier: 'avatar_preview_service',
      previewImageRef: requiredText(record.previewImageRef, 'previewImageRef'),
      visiblePixels: requiredNumber(record.visiblePixels, 'visiblePixels'),
      nonPlaceholder: true,
      warnings,
    };
  }
  return {
    state: record.state === 'failed' ? 'failed' : 'unavailable',
    tier: 'avatar_preview_service',
    previewImageRef: null,
    visiblePixels: null,
    nonPlaceholder: false,
    reason: requiredText(record.reason, 'reason'),
    warnings,
  };
}

function requiredPreviewBackendKind(value: unknown): 'live2d' | 'vrm' {
  if (value !== 'live2d' && value !== 'vrm') {
    throw new Error('backendKind must be live2d or vrm');
  }
  return value;
}

function normalizeAbsoluteUrl(value: unknown, field: string): string {
  const normalized = requiredText(value, field);
  return new URL(normalized).toString();
}

function requiredAgentHandle(value: unknown, field: string): string {
  const handle = requiredText(value, field);
  if (!/^agent_ref_[A-Za-z0-9_-]{43}$/u.test(handle)) {
    throw new Error(`${field} must be a canonical opaque Agent handle`);
  }
  return handle;
}

function requiredAvatarAssetRef(value: unknown, field: string): string {
  const normalized = requiredText(value, field);
  if (!/^(?:live2d|vrm)_[a-f0-9]{12}$/u.test(normalized)) {
    throw new Error(`${field} must be an Avatar asset ref`);
  }
  return normalized;
}

function projectRuntimeAvatarAsset(
  value: unknown,
  expectedAssetRef: string,
): NimiElectronBundledAvatarRuntimeAsset {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('desktop-bundled-avatar-runtime-asset-response-invalid');
  }
  const response = value as Readonly<Record<string, unknown>>;
  assertExactKeys(response, [
    'assetRef',
    'role',
    'backendKind',
    'fileName',
    'mediaType',
    'content',
    'sha256',
  ], 'desktop-bundled-avatar-runtime-asset-response');
  const assetRef = requiredAvatarAssetRef(response.assetRef, 'assetRef');
  if (assetRef !== expectedAssetRef || response.role !== 1) {
    throw new Error('desktop-bundled-avatar-runtime-asset-response-invalid');
  }
  const backendKind = runtimeAvatarBackendKind(response.backendKind);
  if (!assetRef.startsWith(`${backendKind}_`)) {
    throw new Error('desktop-bundled-avatar-runtime-asset-response-invalid');
  }
  const fileName = requiredRuntimeAvatarFileName(response.fileName);
  const mediaType = requiredText(response.mediaType, 'mediaType');
  if ((backendKind === 'vrm' && (path.extname(fileName).toLowerCase() !== '.vrm'
      || mediaType !== 'model/gltf-binary'))
    || (backendKind === 'live2d' && (path.extname(fileName).toLowerCase() !== '.zip'
      || mediaType !== 'application/zip'))) {
    throw new Error('desktop-bundled-avatar-runtime-asset-response-invalid');
  }
  if (!(response.content instanceof Uint8Array)
    || response.content.byteLength <= 0
    || response.content.byteLength > MAX_RUNTIME_AVATAR_ASSET_BYTES) {
    throw new Error('desktop-bundled-avatar-runtime-asset-response-invalid');
  }
  const sha256 = requiredText(response.sha256, 'sha256');
  if (!/^[a-f0-9]{64}$/u.test(sha256)
    || createHash('sha256').update(response.content).digest('hex') !== sha256) {
    throw new Error('desktop-bundled-avatar-runtime-asset-response-invalid');
  }
  return {
    assetRef,
    role: 'avatar',
    backendKind,
    fileName,
    mediaType,
    content: response.content,
    sha256,
  };
}

function runtimeAvatarBackendKind(value: unknown): 'vrm' | 'live2d' {
  if (value === 1) return 'vrm';
  if (value === 2) return 'live2d';
  throw new Error('desktop-bundled-avatar-runtime-asset-response-invalid');
}

function requiredRuntimeAvatarFileName(value: unknown): string {
  const fileName = requiredText(value, 'fileName');
  if (fileName !== path.basename(fileName)
    || fileName !== path.win32.basename(fileName)
    || path.isAbsolute(fileName)
    || path.win32.isAbsolute(fileName)
    || hasAsciiControlCharacter(fileName)
    || fileName.length > 255) {
    throw new Error('desktop-bundled-avatar-runtime-asset-response-invalid');
  }
  return fileName;
}

function hasAsciiControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}

function assertExactKeys(
  payload: Readonly<Record<string, unknown>>,
  expectedKeys: readonly string[],
  command: string,
): void {
  const actual = Object.keys(payload).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${command} keys are invalid`);
  }
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

function optionalText(value: unknown): string | null {
  return normalizeText(value) || null;
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
