import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { mkdir, stat } from 'node:fs/promises';
import {
  BrowserWindow,
  powerMonitor,
  screen,
  shell,
  type Display,
  type IpcMainInvokeEvent,
  type Rectangle,
} from 'electron';
import {
  NIMI_ELECTRON_BUNDLED_AVATAR_ASSET_RESOLVE_COMMAND,
  createNimiElectronBundledAvatarAssetHost,
  isAllowedElectronRendererUrl,
  type NimiElectronBundledAvatarHost,
  type NimiElectronBundledAvatarRuntimeAsset,
  type NimiElectronCommandHandler,
  type NimiElectronShellFileProtocolHost,
  type NimiElectronShellUiCommandInput,
} from '@nimiplatform/kit/shell/electron/main';
import { NIMI_BUNDLED_AVATAR_STANDARD_SHELL_CAPABILITY_SET_ID } from '@nimiplatform/kit/shell/capabilities';
import {
  buildAvatarHostHandoffRequest,
  buildAvatarLaunchHandoffPayload,
  parseAvatarHostHandoffResult,
  type AvatarHostHandoffRequest,
  type AvatarHostHandoffResult,
  type AvatarHostHandoffCommand,
  type AvatarLaunchHandoffPayload,
} from '@nimiplatform/kit/features/avatar/headless';
import { createBundledAvatarWindowOptions } from './bundled-avatar-window-options.js';

const AVATAR_EVENT_CHANNEL_PREFIX = 'nimi:runtime:event:';
const AVATAR_HOST_SUSPEND_EVENT = 'avatar://host-suspend';
const AVATAR_AGENT_CENTER_PREVIEW_REQUEST_EVENT = 'avatar://agent-center-preview-request';
const AVATAR_AGENT_CENTER_PREVIEW_COMPLETE_COMMAND = 'nimi_avatar_agent_center_preview_complete';
const AVATAR_MATERIALIZATION_COMMIT_COMMAND = 'nimi_avatar_commit_materialization_lease';
const AVATAR_MATERIALIZATION_RELEASE_COMMAND = 'nimi_avatar_release_materialization_lease';
const AVATAR_AGENT_CENTER_PREVIEW_TIMEOUT_MS = 15_000;
const AVATAR_SWITCH_INTENT_TTL_MS = 30_000;
const AVATAR_HOST_HANDOFF_SHUTDOWN_WAIT_MS = 2_500;
const AVATAR_PENDING_CANDIDATE_READY_TIMEOUT_MS = AVATAR_AGENT_CENTER_PREVIEW_TIMEOUT_MS;
const AVATAR_SENDER_INVALIDATION_WAIT_MS = 2_000;
const AVATAR_WINDOW_CLOSE_WAIT_MS = 2_000;

type AvatarPreviewProjectionRequest = {
  readonly requestId: string;
  readonly conversationAnchorId: string;
  readonly avatarAssetRef: string;
  readonly backendKind: 'live2d' | 'vrm';
  readonly presentationRevision: string;
};

type AvatarPreviewProjectionResult = Readonly<Record<string, unknown>> & {
  readonly state: 'ready' | 'failed' | 'unavailable' | 'loading';
};

type AvatarActivePresentation = Readonly<{
  avatarAssetRef: string;
  backendKind: 'live2d' | 'vrm';
  presentationRevision: string;
  materializationRef: string;
}>;

type AvatarWindowRecord = {
  readonly window: BrowserWindow;
  readonly sender: object;
  avatarHostTargetRef: string;
  launchContext: AvatarLaunchHandoffPayload;
  committedPresentationRef: string | null;
  temporaryCustodyRef: string | null;
  activePresentation: AvatarActivePresentation | null;
  previewEpoch: number;
  senderInvalidation: Promise<void> | null;
  senderInvalidationWait: Promise<void> | null;
  previewTail: Promise<void>;
};

type AvatarPreviewWindowBinding = Readonly<{
  window: BrowserWindow;
  sender: object;
  avatarInstanceId: string;
  avatarHostTargetRef: string;
  agentHandle: string;
  conversationAnchorId: string;
  previewEpoch: number;
}>;

export type DesktopAvatarHostHandoffDispatch = Readonly<{
  request: AvatarHostHandoffRequest;
  avatarHostTargetRef: string;
  sourceApp: string;
}>;

export type DesktopElectronBundledAvatarHost = {
  readonly desktopCommandHandlers: Readonly<Record<string, NimiElectronCommandHandler>>;
  readonly runtimeBridgeHost: NimiElectronBundledAvatarHost;
  readonly hostHandoff: (dispatch: DesktopAvatarHostHandoffDispatch) => Promise<AvatarHostHandoffResult>;
  readonly hasActiveInstances: () => boolean;
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
  readonly resolveFormalPresentationAsset: (input: {
    readonly agentHandle: string;
    readonly assetRef: string;
  }) => Promise<NimiElectronBundledAvatarRuntimeAsset>;
  readonly revalidateFormalPresentationForMaterialization: (input: {
    readonly avatarHostTargetRef: string;
    readonly agentHandle: string;
    readonly conversationAnchorId: string;
    readonly avatarAssetRef: string;
    readonly backendKind: 'live2d' | 'vrm';
    readonly presentationRevision: string;
  }) => Promise<void>;
  readonly resolveFormalAvatarHostTarget: (input: {
    readonly agentHandle: string;
    readonly conversationAnchorId: string;
  }) => Promise<string>;
  readonly revalidateCurrentAvatarHostTarget: (avatarHostTargetRef: string) => Promise<string>;
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
    resolveAppPrivateDataRoot,
    resolveRuntimeAsset: input.resolveFormalPresentationAsset,
    localAssetProtocolHost: input.localAssetProtocolHost,
    localAssetRoots,
  });
  const windows = new Map<string, AvatarWindowRecord>();
  const pendingPreviewRequests = new Map<string, {
    readonly record: AvatarWindowRecord;
    readonly binding: AvatarPreviewWindowBinding;
    readonly request: AvatarPreviewProjectionRequest;
    readonly resolve: (value: Readonly<Record<string, unknown>>) => void;
    readonly timeout: ReturnType<typeof setTimeout>;
  }>();
  const pendingMaterializationLeases = new Map<string, Readonly<{
    record: AvatarWindowRecord;
    binding: AvatarPreviewWindowBinding;
    agentHandle: string;
    conversationAnchorId: string;
    avatarAssetRef: string;
    backendKind: 'live2d' | 'vrm';
    presentationRevision: string;
    materializationRef: string;
  }>>();
  const releasePendingMaterializationLease = async (
    materializationLeaseRef: string,
    expectedLease?: Readonly<{
      materializationRef: string;
    }>,
  ): Promise<boolean> => {
    const lease = pendingMaterializationLeases.get(materializationLeaseRef);
    if (!lease || (expectedLease && lease !== expectedLease)) return false;
    pendingMaterializationLeases.delete(materializationLeaseRef);
    await assetHost.releaseMaterialization(lease.materializationRef);
    return true;
  };
  const pendingCandidates = new Set<AvatarWindowRecord>();
  const retiringWindows = new Set<AvatarWindowRecord>();
  const pendingCandidateReadiness = new Map<AvatarWindowRecord, Readonly<{
    promise: Promise<AvatarActivePresentation>;
    resolve: (presentation: AvatarActivePresentation) => void;
    reject: (error: Error) => void;
    settled: () => boolean;
  }>>();
  const switchIntents = new Map<string, Readonly<{
    sourceApp: string;
    currentTargetRef: string;
    requestedTargetRef: string;
    expiresAt: number;
  }>>();
  const senderInvalidationListeners = new Set<(sender: object) => void | Promise<void>>();
  const invalidatedSenders = new WeakSet<object>();
  let devRendererProcess: ChildProcess | undefined;
  const ensureRendererReady = () => ensureBundledAvatarDevRenderer(
    rendererUrl,
    input.devRendererRoot,
    input.packagedRendererIndexPath,
    () => devRendererProcess,
    (process) => { devRendererProcess = process; },
  );
  const invalidateSender = (sender: object): Promise<void> => {
    // This tombstone is synchronous and irreversible for the WebContents
    // lifetime. Async resource disposal must never leave a window authorized
    // or allow its sender-scoped Host resources to be recreated.
    invalidatedSenders.add(sender);
    const invalidations = [...senderInvalidationListeners].map((listener) => {
      try {
        return Promise.resolve(listener(sender));
      } catch (error) {
        return Promise.reject(error);
      }
    });
    return Promise.all(invalidations).then(() => undefined);
  };
  let shuttingDown = false;
  const assertAvatarHostOpen = (): void => {
    if (shuttingDown) throw new Error('desktop-bundled-avatar-host-shutting-down');
  };
  const allWindowRecords = (): AvatarWindowRecord[] => [...new Set([
    ...windows.values(),
    ...pendingCandidates,
    ...retiringWindows,
  ])];

  const sendHostEvent = (eventName: string, payload: Readonly<Record<string, unknown>>): void => {
    for (const record of allWindowRecords()) {
      if (record.window.isDestroyed() || record.window.webContents.isDestroyed()) continue;
      record.window.webContents.send(`${AVATAR_EVENT_CHANNEL_PREFIX}${eventName}`, payload);
    }
  };
  const constrainAllWindows = (): void => {
    for (const record of windows.values()) {
      if (!record.window.isDestroyed()) constrainBrowserWindow(record.window);
    }
  };
  const handleDisplayTopologyChange = (): void => constrainAllWindows();
  const handleDisplayRemoved = (_event: unknown, removedDisplay: Display): void => {
    const remainingBounds = screen.getAllDisplays().map((display) => display.bounds);
    const primaryWorkArea = screen.getPrimaryDisplay().workArea;
    for (const record of windows.values()) {
      if (record.window.isDestroyed()) continue;
      const bounds = record.window.getBounds();
      if (desktopAvatarWindowWasOnRemovedDisplay(
        bounds,
        removedDisplay.bounds,
        remainingBounds,
      )) {
        record.window.setBounds(desktopAvatarPrimaryFallbackBounds(bounds, primaryWorkArea));
      } else {
        constrainBrowserWindow(record.window);
      }
    }
  };
  const handleHostSuspend = (): void => sendHostEvent(AVATAR_HOST_SUSPEND_EVENT, {});
  const handleHostResume = (): void => {
    constrainAllWindows();
    // Reassert the same local-safe cleanup after wake in case the renderer
    // could not process the pre-suspend IPC before the operating system slept.
    handleHostSuspend();
  };
  screen.on('display-added', handleDisplayTopologyChange);
  screen.on('display-removed', handleDisplayRemoved);
  screen.on('display-metrics-changed', handleDisplayTopologyChange);
  powerMonitor.on('suspend', handleHostSuspend);
  powerMonitor.on('lock-screen', handleHostSuspend);
  powerMonitor.on('resume', handleHostResume);

  const recordForSender = (event: IpcMainInvokeEvent): AvatarWindowRecord => {
    if (invalidatedSenders.has(event.sender)) {
      throw new Error('desktop-bundled-avatar-sender-invalidated');
    }
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    const record = allWindowRecords().find((candidate) => candidate.window === senderWindow);
    if (!record) throw new Error('desktop-bundled-avatar-sender-window-unbound');
    return record;
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

  const invalidatePreviewProjection = (record: AvatarWindowRecord, reason: string): void => {
    record.previewEpoch += 1;
    releasePendingPreviewsForRecord(record, reason);
  };

  const releasePendingMaterializationsForRecord = (record: AvatarWindowRecord): void => {
    for (const [leaseRef, lease] of pendingMaterializationLeases) {
      if (lease.record !== record) continue;
      void releasePendingMaterializationLease(leaseRef, lease).catch(() => undefined);
    }
  };

  const releaseRecordMaterialization = (record: AvatarWindowRecord): void => {
    releasePendingMaterializationsForRecord(record);
    const activePresentation = record.activePresentation;
    record.activePresentation = null;
    if (!activePresentation) return;
    void assetHost.releaseMaterialization(activePresentation.materializationRef).catch((error: unknown) => {
      console.warn(`[desktop:avatar] materialization release failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  };

  const createWindow = async (
    launchContext: AvatarLaunchHandoffPayload,
    avatarHostTargetRef: string,
    pendingCandidate = false,
  ): Promise<AvatarWindowRecord> => {
    assertAvatarHostOpen();
    await ensureRendererReady();
    assertAvatarHostOpen();
    const avatarInstanceId = launchContext.avatarInstanceId || `desktop-avatar-${randomUUID()}`;
    if (windows.has(avatarInstanceId)
      || [...pendingCandidates].some((candidate) => candidate.launchContext.avatarInstanceId === avatarInstanceId)) {
      throw new Error('desktop-avatar-instance-hint-conflict');
    }
    const canonicalContext = { ...launchContext, avatarInstanceId };
    const window = new BrowserWindow({
      ...createBundledAvatarWindowOptions(input.preloadPath),
      ...(pendingCandidate ? { show: false } : {}),
    });
    if (pendingCandidate) {
      window.webContents.setAudioMuted(true);
      window.setIgnoreMouseEvents(true, { forward: false });
    }
    if (shuttingDown) {
      window.destroy();
      throw new Error('desktop-bundled-avatar-host-shutting-down');
    }
    const windowRecord: AvatarWindowRecord = {
      window,
      sender: window.webContents,
      avatarHostTargetRef,
      launchContext: canonicalContext,
      committedPresentationRef: null,
      temporaryCustodyRef: null,
      activePresentation: null,
      previewEpoch: 0,
      senderInvalidation: null,
      senderInvalidationWait: null,
      previewTail: Promise.resolve(),
    };
    if (pendingCandidate) {
      pendingCandidates.add(windowRecord);
      const readiness = createDesktopAvatarCandidateReadiness();
      pendingCandidateReadiness.set(windowRecord, readiness);
      void readiness.promise.catch(() => undefined);
    } else {
      windows.set(avatarInstanceId, windowRecord);
    }
    const sender = window.webContents;
    let senderReleased = false;
    const beginSenderInvalidation = (): Promise<void> => {
      windowRecord.senderInvalidation ??= invalidateSender(sender);
      return windowRecord.senderInvalidation;
    };
    const releaseWindow = (): void => {
      for (const [instanceId, current] of windows) {
        if (current.window === window) windows.delete(instanceId);
      }
      pendingCandidates.delete(windowRecord);
      retiringWindows.delete(windowRecord);
      const candidateReadiness = pendingCandidateReadiness.get(windowRecord);
      pendingCandidateReadiness.delete(windowRecord);
      if (candidateReadiness && !candidateReadiness.settled()) {
        candidateReadiness.reject(new Error('desktop-avatar-pending-candidate-closed'));
      }
      invalidatePreviewProjection(
        windowRecord,
        'Avatar preview renderer window closed before projection completed.',
      );
      releaseRecordMaterialization(windowRecord);
      if (!senderReleased) {
        senderReleased = true;
        void beginSenderInvalidation().catch((error: unknown) => {
          console.warn(`[desktop:avatar] sender cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
    };
    secureAvatarWindow(window, rendererUrl, releaseWindow);
    window.webContents.on('render-process-gone', () => {
      if (!window.isDestroyed()) window.destroy();
    });
    window.on('close', releaseWindow);
    window.on('closed', () => {
      releaseWindow();
    });
    try {
      await window.loadURL(rendererUrl);
      assertAvatarHostOpen();
    } catch (error) {
      if (!window.isDestroyed()) window.destroy();
      throw error;
    }
    return windowRecord;
  };

  const waitForPendingCandidateReady = async (
    record: AvatarWindowRecord,
  ): Promise<AvatarActivePresentation> => {
    const readiness = pendingCandidateReadiness.get(record);
    if (!readiness || !pendingCandidates.has(record)) {
      throw new Error('desktop-avatar-pending-candidate-missing');
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const presentation = await Promise.race([
        readiness.promise,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            reject(new Error('desktop-avatar-pending-candidate-presentation-timeout'));
          }, AVATAR_PENDING_CANDIDATE_READY_TIMEOUT_MS);
          timer.unref?.();
        }),
      ]);
      if (!pendingCandidates.has(record)
        || record.window.isDestroyed()
        || record.activePresentation !== presentation) {
        throw new Error('desktop-avatar-pending-candidate-became-stale');
      }
      return presentation;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };

  const discardPendingCandidate = async (record: AvatarWindowRecord): Promise<void> => {
    if (!pendingCandidates.has(record) && record.window.isDestroyed()) return;
    record.senderInvalidation ??= invalidateSender(record.sender);
    await waitForAvatarSenderInvalidation(record, 'pending candidate');
    if (!record.window.isDestroyed()) record.window.destroy();
  };

  const validatePendingCandidate = (record: AvatarWindowRecord): void => {
    assertAvatarHostOpen();
    const avatarInstanceId = requiredText(record.launchContext.avatarInstanceId, 'avatarInstanceId');
    if (!pendingCandidates.has(record)
      || record.window.isDestroyed()
      || windows.has(avatarInstanceId)
      || !record.activePresentation) {
      throw new Error('desktop-avatar-pending-candidate-promotion-invalid');
    }
  };

  const stageCurrentWindowForPromotion = (record: AvatarWindowRecord): void => {
    if (record.window.isDestroyed() || record.window.webContents.isDestroyed()) {
      throw new Error('desktop-avatar-current-window-unavailable');
    }
    record.window.webContents.setAudioMuted(true);
    record.window.setIgnoreMouseEvents(true, { forward: false });
    record.window.hide();
  };

  const restoreCurrentWindowAfterFailedPromotion = (record: AvatarWindowRecord): void => {
    if (record.window.isDestroyed() || record.window.webContents.isDestroyed()) return;
    record.window.webContents.setAudioMuted(false);
    record.window.setIgnoreMouseEvents(false);
    record.window.show();
    record.window.moveTop();
    record.window.focus();
  };

  const activatePromotedCandidate = (record: AvatarWindowRecord): void => {
    const avatarInstanceId = requiredText(record.launchContext.avatarInstanceId, 'avatarInstanceId');
    if (record.window.isDestroyed() || windows.get(avatarInstanceId) !== record) {
      throw new Error('desktop-avatar-promoted-candidate-activation-invalid');
    }
    record.window.webContents.setAudioMuted(false);
    record.window.setIgnoreMouseEvents(false);
    record.window.show();
    if (record.window.isDestroyed() || !record.window.isVisible()) {
      throw new Error('desktop-avatar-pending-candidate-activation-failed');
    }
  };

  const commitPendingCandidatePromotion = (
    current: AvatarWindowRecord | null,
    record: AvatarWindowRecord,
  ): void => {
    validatePendingCandidate(record);
    const avatarInstanceId = requiredText(record.launchContext.avatarInstanceId, 'avatarInstanceId');
    if (current) {
      retiringWindows.add(current);
      for (const [instanceId, candidate] of windows) {
        if (candidate === current) windows.delete(instanceId);
      }
    }
    pendingCandidates.delete(record);
    pendingCandidateReadiness.delete(record);
    windows.set(avatarInstanceId, record);
  };

  const rollbackPendingCandidatePromotion = (
    current: AvatarWindowRecord | null,
    record: AvatarWindowRecord,
  ): void => {
    for (const [instanceId, candidate] of windows) {
      if (candidate === record) windows.delete(instanceId);
    }
    pendingCandidates.add(record);
    if (!current) return;
    retiringWindows.delete(current);
    const currentInstanceId = requiredText(current.launchContext.avatarInstanceId, 'avatarInstanceId');
    windows.set(currentInstanceId, current);
  };

  const continueRetiringWindowRecord = (record: AvatarWindowRecord, error: unknown): void => {
    console.warn(`[desktop:avatar] retired window cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    if (record.window.isDestroyed()) {
      retiringWindows.delete(record);
      return;
    }
    if (!record.window.webContents.isDestroyed()) record.window.webContents.setAudioMuted(true);
    record.window.setIgnoreMouseEvents(true, { forward: false });
    record.window.hide();
    record.window.destroy();
  };

  const closeWindowRecord = async (record: AvatarWindowRecord): Promise<void> => {
    if (record.window.isDestroyed()) {
      retiringWindows.delete(record);
      return;
    }
    stageCurrentWindowForPromotion(record);
    retiringWindows.add(record);
    for (const [instanceId, current] of windows) {
      if (current === record) windows.delete(instanceId);
    }
    record.senderInvalidation ??= invalidateSender(record.sender);
    invalidatePreviewProjection(
      record,
      'Avatar preview renderer window began closing before projection completed.',
    );
    await waitForAvatarSenderInvalidation(record, 'window close');
    try {
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(() => {
          if (!record.window.isDestroyed()) record.window.destroy();
          finish();
        }, AVATAR_WINDOW_CLOSE_WAIT_MS);
        timer.unref?.();
        record.window.once('closed', finish);
        record.window.close();
        if (record.window.isDestroyed()) finish();
      });
    } catch (error) {
      console.warn(`[desktop:avatar] window close failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (!record.window.isDestroyed()) record.window.destroy();
    }
  };

  const closeAllAvatarWindows = async (): Promise<void> => {
    await Promise.all(allWindowRecords().map((record) => closeWindowRecord(record)));
  };

  const prepareAllAvatarWindowsForClose = async (): Promise<void> => {
    await Promise.allSettled(allWindowRecords().map(async (record) => {
      record.senderInvalidation ??= invalidateSender(record.sender);
      await waitForAvatarSenderInvalidation(record, 'quit');
    }));
  };

  const waitForAvatarSenderInvalidation = async (
    record: AvatarWindowRecord,
    operation: string,
  ): Promise<void> => {
    const invalidation = record.senderInvalidation;
    if (!invalidation) return;
    record.senderInvalidationWait ??= (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const outcome = await Promise.race([
        invalidation.then(
          () => ({ status: 'fulfilled' as const }),
          (reason: unknown) => ({ status: 'rejected' as const, reason }),
        ),
        new Promise<{ readonly status: 'timed-out' }>((resolve) => {
          timer = setTimeout(() => resolve({ status: 'timed-out' }), AVATAR_SENDER_INVALIDATION_WAIT_MS);
          timer.unref?.();
        }),
      ]);
      if (timer !== undefined) clearTimeout(timer);
      if (outcome.status === 'rejected') {
        console.warn(`[desktop:avatar] ${operation} sender cleanup failed: ${outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)}`);
      } else if (outcome.status === 'timed-out') {
        console.warn(`[desktop:avatar] ${operation} sender cleanup timed out`);
      }
    })();
    await record.senderInvalidationWait;
  };

  const desktopCommandHandlers: Readonly<Record<string, NimiElectronCommandHandler>> = {
    desktop_avatar_preview_projection: ({ payload }) => {
      const nested = exactNestedPayload(payload, 'desktop_avatar_preview_projection');
      assertOnlyKeys(
        nested,
        ['conversationAnchorId', 'avatarAssetRef', 'backendKind', 'presentationRevision'],
        'desktop_avatar_preview_projection',
      );
      const conversationAnchorId = requiredText(nested.conversationAnchorId, 'conversationAnchorId');
      const backendKind = requiredPreviewBackendKind(nested.backendKind);
      const avatarAssetRef = requiredText(nested.avatarAssetRef, 'avatarAssetRef');
      const presentationRevision = requiredText(nested.presentationRevision, 'presentationRevision');
      const record = [...windows.values()].find((candidate) => (
        !candidate.window.isDestroyed()
        && candidate.launchContext.conversationAnchorId === conversationAnchorId
      ));
      if (!record) {
        return {
          result: projectDesktopPreviewEvidence(unavailablePreviewResult(
            { avatarAssetRef, backendKind },
            'No live Desktop-supervised Avatar renderer is available for this Conversation anchor.',
          )),
        };
      }
      const request: AvatarPreviewProjectionRequest = {
        requestId: randomUUID(),
        conversationAnchorId: record.launchContext.conversationAnchorId,
        avatarAssetRef,
        backendKind,
        presentationRevision,
      };
      const binding = snapshotDesktopAvatarPreviewWindowBinding(record);
      const run = record.previewTail.then(() => new Promise<Readonly<Record<string, unknown>>>((resolve) => {
        if (!desktopAvatarPreviewWindowBindingMatches(record, binding, windows)) {
          resolve({
            result: projectDesktopPreviewEvidence(unavailablePreviewResult(
              request,
              'Avatar preview window binding became stale before projection started.',
            )),
          });
          return;
        }
        const timeout = setTimeout(() => {
          completePendingPreview(request.requestId, {
            result: unavailablePreviewResult(request, 'Avatar preview renderer did not answer before the carrier timeout.'),
          });
        }, AVATAR_AGENT_CENTER_PREVIEW_TIMEOUT_MS);
        pendingPreviewRequests.set(request.requestId, { record, binding, request, resolve, timeout });
        record.window.webContents.send(
          `${AVATAR_EVENT_CHANNEL_PREFIX}${AVATAR_AGENT_CENTER_PREVIEW_REQUEST_EVENT}`,
          request,
        );
      }));
      record.previewTail = run.then(() => undefined, () => undefined);
      return run;
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
    nimi_avatar_refresh_host_binding: async ({ payload, event }) => {
      assertOnlyKeys(payload, ['agentHandle', 'conversationAnchorId'], 'nimi_avatar_refresh_host_binding');
      const agentHandle = requiredAgentHandle(payload.agentHandle, 'agentHandle');
      const conversationAnchorId = requiredText(payload.conversationAnchorId, 'conversationAnchorId');
      const record = recordForSender(asElectronEvent(event));
      if (record.launchContext.conversationAnchorId !== conversationAnchorId) {
        throw new Error('desktop-bundled-avatar-refresh-anchor-mismatch');
      }
      const avatarHostTargetRef = requiredAvatarHostTargetRef(
        await input.resolveFormalAvatarHostTarget({ agentHandle, conversationAnchorId }),
      );
      if (recordForSender(asElectronEvent(event)) !== record
        || record.window.isDestroyed()
        || record.launchContext.conversationAnchorId !== conversationAnchorId) {
        throw new Error('desktop-bundled-avatar-refresh-binding-stale');
      }
      if (record.avatarHostTargetRef !== avatarHostTargetRef
        || record.launchContext.agentHandle !== agentHandle) {
        invalidatePreviewProjection(
          record,
          'Avatar Host binding changed before preview projection completed.',
        );
        releasePendingMaterializationsForRecord(record);
        record.avatarHostTargetRef = avatarHostTargetRef;
        record.launchContext = buildAvatarLaunchHandoffPayload({
          ...record.launchContext,
          agentHandle,
          conversationAnchorId,
        });
      }
      return { accepted: true };
    },
    nimi_avatar_quit_app: async ({ payload, event }) => {
      requireEmptyPayload(payload, 'nimi_avatar_quit_app');
      recordForSender(asElectronEvent(event));
      try {
        await prepareAllAvatarWindowsForClose();
      } finally {
        setImmediate(() => { void closeAllAvatarWindows(); });
      }
      return { accepted: true };
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
      if (!desktopAvatarPreviewWindowBindingMatches(record, pending.binding, windows)) {
        completePendingPreview(requestId, {
          result: unavailablePreviewResult(
            pending.request,
            'Avatar preview window binding became stale before capture.',
          ),
        });
        return { accepted: false };
      }
      const reportedState = payload.result
        && typeof payload.result === 'object'
        && !Array.isArray(payload.result)
        ? (payload.result as Readonly<Record<string, unknown>>).state
        : null;
      const activePresentation = record.activePresentation;
      if (reportedState === 'ready'
        && (!activePresentation
          || !desktopAvatarPreviewRequestMatchesActivePresentation(
            record,
            pending.binding,
            pending.request,
          ))) {
          completePendingPreview(requestId, {
            result: unavailablePreviewResult(
              pending.request,
              'Avatar preview active presentation changed before result validation.',
            ),
          });
          return { accepted: false };
      }
      const result = parseAvatarPreviewProjectionResult(
        payload.result,
        pending.request,
        activePresentation?.materializationRef ?? '',
      );
      if (result.state !== 'ready') {
        completePendingPreview(requestId, { result });
        return { accepted: true };
      }
      try {
        const image = await record.window.webContents.capturePage();
        if (pendingPreviewRequests.get(requestId) !== pending
          || !desktopAvatarPreviewWindowBindingMatches(record, pending.binding, windows)
          || !desktopAvatarPreviewRequestMatchesActivePresentation(
            record,
            pending.binding,
            pending.request,
          )) {
          completePendingPreview(requestId, {
            result: unavailablePreviewResult(
              pending.request,
              'Avatar preview window binding became stale during capture.',
            ),
          });
          return { accepted: false };
        }
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
      const request = parseDesktopAvatarMaterializationResolveRequest(exactNestedPayload(
        payload,
        NIMI_ELECTRON_BUNDLED_AVATAR_ASSET_RESOLVE_COMMAND,
      ));
      const record = recordForSender(asElectronEvent(event));
      const binding = snapshotDesktopAvatarPreviewWindowBinding(record);
      const { avatarAssetRef, backendKind, presentationRevision } = request;
      await input.revalidateFormalPresentationForMaterialization({
        avatarHostTargetRef: record.avatarHostTargetRef,
        agentHandle: request.agentHandle,
        conversationAnchorId: record.launchContext.conversationAnchorId,
        avatarAssetRef,
        backendKind,
        presentationRevision,
      });
      if (!desktopAvatarMaterializationWindowBindingMatches(
        record,
        binding,
        windows,
        pendingCandidates,
      )) {
        throw new Error('desktop-bundled-avatar-materialization-binding-stale');
      }
      const resolved = await assetHost.resolveBoundPresentation({
        avatarAssetRef,
        backendKind,
      }, request.agentHandle);
      if (!desktopAvatarMaterializationWindowBindingMatches(
        record,
        binding,
        windows,
        pendingCandidates,
      )) {
        await assetHost.releaseMaterialization(resolved.materializationRef);
        throw new Error('desktop-bundled-avatar-materialization-binding-stale');
      }
      const materializationLeaseRef = `avatar_materialization_lease_${randomUUID().replace(/-/gu, '')}`;
      pendingMaterializationLeases.set(materializationLeaseRef, Object.freeze({
        record,
        binding,
        agentHandle: request.agentHandle,
        conversationAnchorId: record.launchContext.conversationAnchorId,
        avatarAssetRef,
        backendKind,
        presentationRevision,
        materializationRef: resolved.materializationRef,
      }));
      return { ...resolved, materializationLeaseRef };
    },
    [AVATAR_MATERIALIZATION_COMMIT_COMMAND]: async ({ payload, event }) => {
      const record = recordForSender(asElectronEvent(event));
      const materializationLeaseRef = requiredMaterializationLeaseRef(payload.materializationLeaseRef);
      const lease = pendingMaterializationLeases.get(materializationLeaseRef);
      if (!lease || lease.record !== record) {
        throw new Error('desktop-bundled-avatar-materialization-lease-stale');
      }
      const rejectCandidate = async (reason: string): Promise<never> => {
        const candidateReadiness = pendingCandidateReadiness.get(record);
        if (candidateReadiness && !candidateReadiness.settled()) {
          candidateReadiness.reject(new Error(reason));
        }
        await releasePendingMaterializationLease(materializationLeaseRef, lease).catch(() => undefined);
        throw new Error(reason);
      };
      let commit: ReturnType<typeof parseDesktopAvatarMaterializationCommit>;
      try {
        commit = parseDesktopAvatarMaterializationCommit(payload);
      } catch (error) {
        const candidateReadiness = pendingCandidateReadiness.get(record);
        if (candidateReadiness && !candidateReadiness.settled()) {
          candidateReadiness.reject(error instanceof Error ? error : new Error(String(error)));
        }
        await releasePendingMaterializationLease(materializationLeaseRef, lease).catch(() => undefined);
        throw error;
      }
      if (!desktopAvatarMaterializationWindowBindingMatches(
        record,
        lease.binding,
        windows,
        pendingCandidates,
      )) {
        return rejectCandidate('desktop-bundled-avatar-materialization-binding-stale');
      }
      if (!desktopAvatarMaterializationCommitMatchesCandidate(lease, commit)) {
        return rejectCandidate('desktop-bundled-avatar-materialization-commit-mismatch');
      }
      let retiredMaterializationRef: string | undefined;
      await commitDesktopAvatarMaterializationCandidate({
        isCurrent: () => (
          pendingMaterializationLeases.get(materializationLeaseRef) === lease
          && desktopAvatarMaterializationWindowBindingMatches(
            record,
            lease.binding,
            windows,
            pendingCandidates,
          )
        ),
        revalidate: () => input.revalidateFormalPresentationForMaterialization({
          avatarHostTargetRef: lease.binding.avatarHostTargetRef,
          agentHandle: lease.agentHandle,
          conversationAnchorId: lease.conversationAnchorId,
          avatarAssetRef: lease.avatarAssetRef,
          backendKind: lease.backendKind,
          presentationRevision: lease.presentationRevision,
        }),
        commit: () => {
          pendingMaterializationLeases.delete(materializationLeaseRef);
          const previousPresentation = record.activePresentation;
          const preservesPendingPreview = [...pendingPreviewRequests.values()].some((pending) => (
            pending.record === record
            && pending.request.avatarAssetRef === commit.avatarAssetRef
            && pending.request.backendKind === commit.backendKind
            && pending.request.presentationRevision === commit.presentationRevision
          ));
          if (!preservesPendingPreview) {
            invalidatePreviewProjection(
              record,
              'Avatar preview active materialization was replaced before projection completed.',
            );
          }
          const activePresentation = Object.freeze({
            avatarAssetRef: commit.avatarAssetRef,
            backendKind: commit.backendKind,
            presentationRevision: commit.presentationRevision,
            materializationRef: commit.materializationRef,
          });
          record.activePresentation = activePresentation;
          retiredMaterializationRef = previousPresentation?.materializationRef === commit.materializationRef
            ? commit.materializationRef
            : previousPresentation?.materializationRef;
          const candidateReadiness = pendingCandidateReadiness.get(record);
          if (candidateReadiness && !candidateReadiness.settled()) {
            candidateReadiness.resolve(activePresentation);
          }
        },
        release: async () => {
          const candidateReadiness = pendingCandidateReadiness.get(record);
          if (candidateReadiness && !candidateReadiness.settled()) {
            candidateReadiness.reject(new Error(
              'desktop-avatar-pending-candidate-presentation-revalidation-failed',
            ));
          }
          await releasePendingMaterializationLease(materializationLeaseRef, lease).catch(() => undefined);
        },
        staleReason: 'desktop-bundled-avatar-materialization-binding-stale',
      });
      if (retiredMaterializationRef) {
        void assetHost.releaseMaterialization(retiredMaterializationRef).catch((error: unknown) => {
          console.warn(`[desktop:avatar] retired materialization release failed: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
      return { accepted: true, materializationRef: commit.materializationRef };
    },
    [AVATAR_MATERIALIZATION_RELEASE_COMMAND]: async ({ payload, event }) => {
      assertOnlyKeys(payload, ['materializationLeaseRef'], AVATAR_MATERIALIZATION_RELEASE_COMMAND);
      const materializationLeaseRef = requiredMaterializationLeaseRef(payload.materializationLeaseRef);
      const lease = pendingMaterializationLeases.get(materializationLeaseRef);
      const record = recordForSender(asElectronEvent(event));
      if (!lease || lease.record !== record) return { accepted: false };
      return { accepted: await releasePendingMaterializationLease(materializationLeaseRef, lease) };
    },
    nimi_avatar_read_text_file: ({ payload }) => {
      assertOnlyKeys(payload, ['path'], 'nimi_avatar_read_text_file');
      return assetHost.readTextFile(payload.path);
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
      return desktopAvatarHostSenderAuthorized(
        allWindowRecords(),
        electronEvent,
        invalidatedSenders,
      );
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
          const record = recordForSender(asElectronEvent(call.event));
          record.window.setIgnoreMouseEvents(
            pendingCandidates.has(record) ? true : Boolean(payload.ignore),
            {
            forward: payload.forward === undefined ? true : Boolean(payload.forward),
            },
          );
        },
        setAlwaysOnTop: (payload, call) => {
          senderWindow(asElectronEvent(call.event)).setAlwaysOnTop(Boolean(payload.alwaysOnTop));
        },
        hide: (_payload, call) => senderWindow(asElectronEvent(call.event)).hide(),
        close: (_payload, call) => closeWindowRecord(recordForSender(asElectronEvent(call.event))),
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
  const performHostHandoff = async (
    rawDispatch: DesktopAvatarHostHandoffDispatch,
  ): Promise<AvatarHostHandoffResult> => {
    assertAvatarHostOpen();
    const request = buildAvatarHostHandoffRequest(rawDispatch.request);
    const avatarHostTargetRef = requiredAvatarHostTargetRef(rawDispatch.avatarHostTargetRef);
    const sourceApp = requiredSourceApp(rawDispatch.sourceApp);
    const target = request.target;
    const active = [...windows.values()].filter((record) => !record.window.isDestroyed());
    if (active.length > 1) throw new Error('desktop-avatar-single-active-invariant-violated');
    let record = active[0];

    for (const [ref, intent] of switchIntents) {
      if (intent.expiresAt <= Date.now()) switchIntents.delete(ref);
    }

    if (!record) {
      if (target.switchIntentRef) throw new Error('desktop-avatar-switch-intent-without-current-instance');
      if (request.command !== 'launch') return avatarHandoffNonPresentResult(request.command, 'absent');
      record = await runDesktopAvatarCandidatePromotion({
        createCandidate: async () => {
          const candidate = await createWindow(buildAvatarLaunchHandoffPayload({
            agentHandle: target.agentHandle,
            conversationAnchorId: target.conversationAnchorId,
            avatarInstanceId: target.avatarInstanceId,
            launchSource: target.launchSource ?? 'app-avatar-host-handoff',
            sourceSurface: target.launchSource ?? 'app-avatar-host-handoff',
          }), avatarHostTargetRef, true);
          candidate.committedPresentationRef = target.committedPresentationRef;
          candidate.temporaryCustodyRef = target.temporaryCustodyRef;
          return candidate;
        },
        waitUntilReady: waitForPendingCandidateReady,
        validateCandidate: validatePendingCandidate,
        stageCurrent: () => {},
        activateCandidate: activatePromotedCandidate,
        restoreCurrent: () => {},
        commitPromotion: (candidate) => commitPendingCandidatePromotion(null, candidate),
        rollbackPromotion: (candidate) => rollbackPendingCandidatePromotion(null, candidate),
        retireCurrent: async () => {},
        continueRetiringCurrent: () => {},
        discardCandidate: discardPendingCandidate,
        assertOpen: assertAvatarHostOpen,
      });
    } else if (record.avatarHostTargetRef === avatarHostTargetRef) {
      if (target.switchIntentRef) throw new Error('desktop-avatar-switch-intent-replayed-for-current-target');
    } else {
      if (request.command !== 'launch') {
        return avatarHandoffNonPresentResult(request.command, 'non-matching');
      }
      if (!target.switchIntentRef) {
        const switchIntentRef = `avatar_switch_${randomUUID().replace(/-/gu, '')}`;
        switchIntents.set(switchIntentRef, Object.freeze({
          sourceApp,
          currentTargetRef: record.avatarHostTargetRef,
          requestedTargetRef: avatarHostTargetRef,
          expiresAt: Date.now() + AVATAR_SWITCH_INTENT_TTL_MS,
        }));
        return avatarHandoffNonPresentResult(request.command, 'confirmation-required', switchIntentRef);
      }
      const intent = switchIntents.get(target.switchIntentRef);
      if (!intent || intent.expiresAt <= Date.now()
        || intent.sourceApp !== sourceApp
        || intent.currentTargetRef !== record.avatarHostTargetRef
        || intent.requestedTargetRef !== avatarHostTargetRef) {
        throw new Error('desktop-avatar-switch-intent-invalid');
      }
      const revalidatedCurrentTargetRef = requiredAvatarHostTargetRef(
        await input.revalidateCurrentAvatarHostTarget(record.avatarHostTargetRef),
      );
      assertAvatarHostOpen();
      if (revalidatedCurrentTargetRef !== intent.currentTargetRef
        || revalidatedCurrentTargetRef !== record.avatarHostTargetRef) {
        throw new Error('desktop-avatar-current-target-revalidation-failed');
      }
      switchIntents.delete(target.switchIntentRef);
      const currentRecord = record;
      record = await runDesktopAvatarCandidatePromotion({
        createCandidate: async () => {
          const candidate = await createWindow(buildAvatarLaunchHandoffPayload({
            agentHandle: target.agentHandle,
            conversationAnchorId: target.conversationAnchorId,
            avatarInstanceId: target.avatarInstanceId,
            launchSource: target.launchSource ?? 'app-avatar-host-handoff',
            sourceSurface: target.launchSource ?? 'app-avatar-host-handoff',
          }), avatarHostTargetRef, true);
          candidate.committedPresentationRef = target.committedPresentationRef;
          candidate.temporaryCustodyRef = target.temporaryCustodyRef;
          return candidate;
        },
        waitUntilReady: waitForPendingCandidateReady,
        validateCandidate: validatePendingCandidate,
        stageCurrent: () => stageCurrentWindowForPromotion(currentRecord),
        activateCandidate: activatePromotedCandidate,
        restoreCurrent: () => restoreCurrentWindowAfterFailedPromotion(currentRecord),
        commitPromotion: (candidate) => commitPendingCandidatePromotion(currentRecord, candidate),
        rollbackPromotion: (candidate) => rollbackPendingCandidatePromotion(currentRecord, candidate),
        retireCurrent: () => closeWindowRecord(currentRecord),
        continueRetiringCurrent: (error) => continueRetiringWindowRecord(currentRecord, error),
        discardCandidate: discardPendingCandidate,
        assertOpen: assertAvatarHostOpen,
      });
    }

    if (request.command === 'launch' || request.command === 'focus') {
      assertAvatarHostOpen();
      record.window.show();
      record.window.moveTop();
      record.window.focus();
    }
    return parseAvatarHostHandoffResult({
      command: request.command,
      state: record.window.isFocused() ? 'focused' : 'present',
      avatarInstanceRef: record.launchContext.avatarInstanceId,
      switchIntentRef: null,
      committedPresentationRef: record.committedPresentationRef,
      temporaryCustodyRef: record.temporaryCustodyRef,
    }, request.command);
  };
  const serializedHostHandoff = createDesktopAvatarHostHandoffSerialDispatcher(performHostHandoff);
  const hostHandoff: DesktopAvatarHostHandoffSerialDispatcher = Object.assign(
    async (rawDispatch: DesktopAvatarHostHandoffDispatch): Promise<AvatarHostHandoffResult> => {
      if (!serializedHostHandoff.isClosing() && rawDispatch.request.command === 'presence') {
        const request = buildAvatarHostHandoffRequest(rawDispatch.request);
        const avatarHostTargetRef = requiredAvatarHostTargetRef(rawDispatch.avatarHostTargetRef);
        requiredSourceApp(rawDispatch.sourceApp);
        const pending = [...pendingCandidates].find((candidate) => (
          !candidate.window.isDestroyed() && candidate.avatarHostTargetRef === avatarHostTargetRef
        ));
        if (pending) {
          return parseAvatarHostHandoffResult({
            command: request.command,
            state: 'launching',
            avatarInstanceRef: pending.launchContext.avatarInstanceId,
            switchIntentRef: null,
            committedPresentationRef: pending.committedPresentationRef,
            temporaryCustodyRef: pending.temporaryCustodyRef,
          }, request.command);
        }
        const active = [...windows.values()].find((candidate) => (
          !candidate.window.isDestroyed() && candidate.avatarHostTargetRef === avatarHostTargetRef
        ));
        if (active) {
          return parseAvatarHostHandoffResult({
            command: request.command,
            state: active.window.isFocused() ? 'focused' : 'present',
            avatarInstanceRef: active.launchContext.avatarInstanceId,
            switchIntentRef: null,
            committedPresentationRef: active.committedPresentationRef,
            temporaryCustodyRef: active.temporaryCustodyRef,
          }, request.command);
        }
        if (pendingCandidates.size > 0 || windows.size > 0) {
          return avatarHandoffNonPresentResult(request.command, 'non-matching');
        }
        return avatarHandoffNonPresentResult(request.command, 'absent');
      }
      return serializedHostHandoff(rawDispatch);
    },
    {
      closeAndWait: (timeoutMs?: number) => serializedHostHandoff.closeAndWait(timeoutMs),
      isClosing: () => serializedHostHandoff.isClosing(),
    },
  );
  let shutdownPromise: Promise<void> | null = null;
  const shutdown = (): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;
    shuttingDown = true;
    shutdownPromise = (async () => {
      await hostHandoff.closeAndWait(AVATAR_HOST_HANDOFF_SHUTDOWN_WAIT_MS);
      for (const [requestId, pending] of pendingPreviewRequests) {
        completePendingPreview(requestId, {
          result: unavailablePreviewResult(pending.request, 'Desktop Avatar host is shutting down.'),
        });
      }
      const activeRecords = allWindowRecords();
      await Promise.allSettled(activeRecords.map(async (record) => {
        record.senderInvalidation ??= invalidateSender(record.sender);
        await waitForAvatarSenderInvalidation(record, 'shutdown');
      }));
      for (const record of activeRecords) {
        if (!record.window.isDestroyed()) record.window.destroy();
      }
      windows.clear();
      pendingCandidates.clear();
      retiringWindows.clear();
      pendingCandidateReadiness.clear();
      switchIntents.clear();
      pendingMaterializationLeases.clear();
      screen.removeListener('display-added', handleDisplayTopologyChange);
      screen.removeListener('display-removed', handleDisplayRemoved);
      screen.removeListener('display-metrics-changed', handleDisplayTopologyChange);
      powerMonitor.removeListener('suspend', handleHostSuspend);
      powerMonitor.removeListener('lock-screen', handleHostSuspend);
      powerMonitor.removeListener('resume', handleHostResume);
      senderInvalidationListeners.clear();
      if (devRendererProcess && devRendererProcess.exitCode === null) devRendererProcess.kill();
      devRendererProcess = undefined;
      await assetHost.close();
    })();
    return shutdownPromise;
  };

  return {
    desktopCommandHandlers,
    runtimeBridgeHost,
    hostHandoff,
    hasActiveInstances: () => [...windows.values()].some((record) => !record.window.isDestroyed()),
    shutdown,
  };
}

export function desktopAvatarHostSenderAuthorized(
  records: Iterable<Pick<AvatarWindowRecord, 'window'>>,
  event: IpcMainInvokeEvent,
  invalidatedSenders?: Pick<WeakSet<object>, 'has'>,
): boolean {
  if (invalidatedSenders?.has(event.sender)) return false;
  const record = [...records].find((candidate) => (
    !candidate.window.isDestroyed()
    && !candidate.window.webContents.isDestroyed()
    && candidate.window.webContents === event.sender
  ));
  return Boolean(record && event.senderFrame === record.window.webContents.mainFrame);
}

export type DesktopAvatarHostHandoffSerialDispatcher = ((
  dispatch: DesktopAvatarHostHandoffDispatch,
) => Promise<AvatarHostHandoffResult>) & Readonly<{
  closeAndWait(timeoutMs?: number): Promise<void>;
  isClosing(): boolean;
}>;

export async function runDesktopAvatarCandidatePromotion<T>(input: Readonly<{
  createCandidate: () => Promise<T>;
  waitUntilReady: (candidate: T) => Promise<unknown>;
  validateCandidate: (candidate: T) => void;
  stageCurrent: () => void;
  activateCandidate: (candidate: T) => void;
  restoreCurrent: () => void;
  commitPromotion: (candidate: T) => void;
  rollbackPromotion: (candidate: T) => void;
  retireCurrent: () => Promise<void>;
  continueRetiringCurrent: (error: unknown) => void;
  discardCandidate: (candidate: T) => Promise<void>;
  assertOpen: () => void;
}>): Promise<T> {
  const candidate = await input.createCandidate();
  let promoted = false;
  let promotionAttempted = false;
  let currentStaged = false;
  try {
    await input.waitUntilReady(candidate);
    input.assertOpen();
    input.validateCandidate(candidate);
    currentStaged = true;
    input.stageCurrent();
    input.assertOpen();
    promotionAttempted = true;
    input.commitPromotion(candidate);
    promoted = true;
    input.assertOpen();
    input.activateCandidate(candidate);
    input.assertOpen();
    try {
      await input.retireCurrent();
    } catch (error) {
      try {
        input.continueRetiringCurrent(error);
      } catch {
        // Registry ownership already committed; retirement failure cannot roll it back.
      }
    }
    return candidate;
  } catch (error) {
    if (promoted || promotionAttempted) {
      promoted = false;
      try {
        input.rollbackPromotion(candidate);
      } catch {
        // Preserve the original promotion failure; Host shutdown still owns the
        // exact candidate and current records through their lifecycle sets.
      }
    }
    if (!promoted) {
      if (currentStaged) {
        try {
          input.restoreCurrent();
        } catch {
          // Preserve the original promotion failure while candidate cleanup continues.
        }
      }
      await input.discardCandidate(candidate).catch(() => undefined);
    }
    throw error;
  }
}

export async function commitDesktopAvatarMaterializationCandidate(input: Readonly<{
  isCurrent: () => boolean;
  revalidate: () => Promise<void>;
  commit: () => void;
  release: () => Promise<void>;
  staleReason: string;
}>): Promise<void> {
  let committed = false;
  try {
    if (!input.isCurrent()) throw new Error(input.staleReason);
    await input.revalidate();
    if (!input.isCurrent()) throw new Error(input.staleReason);
    input.commit();
    committed = true;
  } catch (error) {
    if (!committed) await input.release().catch(() => undefined);
    throw error;
  }
}

function createDesktopAvatarCandidateReadiness(): Readonly<{
  promise: Promise<AvatarActivePresentation>;
  resolve: (presentation: AvatarActivePresentation) => void;
  reject: (error: Error) => void;
  settled: () => boolean;
}> {
  let settled = false;
  let resolvePromise!: (presentation: AvatarActivePresentation) => void;
  let rejectPromise!: (error: Error) => void;
  const promise = new Promise<AvatarActivePresentation>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return Object.freeze({
    promise,
    resolve(presentation) {
      if (settled) return;
      settled = true;
      resolvePromise(presentation);
    },
    reject(error) {
      if (settled) return;
      settled = true;
      rejectPromise(error);
    },
    settled: () => settled,
  });
}

export function createDesktopAvatarHostHandoffSerialDispatcher(
  perform: (
    dispatch: DesktopAvatarHostHandoffDispatch,
  ) => Promise<AvatarHostHandoffResult>,
): DesktopAvatarHostHandoffSerialDispatcher {
  let hostHandoffTail: Promise<void> = Promise.resolve();
  let accepting = true;
  const dispatchHandoff = (dispatch: DesktopAvatarHostHandoffDispatch) => {
    if (!accepting) return Promise.reject(new Error('desktop-bundled-avatar-host-shutting-down'));
    const result = hostHandoffTail.then(async () => {
      if (!accepting) throw new Error('desktop-bundled-avatar-host-shutting-down');
      const value = await perform(dispatch);
      if (!accepting) throw new Error('desktop-bundled-avatar-host-shutting-down');
      return value;
    });
    hostHandoffTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  return Object.assign(dispatchHandoff, {
    async closeAndWait(timeoutMs = AVATAR_HOST_HANDOFF_SHUTDOWN_WAIT_MS): Promise<void> {
      accepting = false;
      const boundedMs = Math.max(0, Math.min(10_000, Math.floor(timeoutMs)));
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          hostHandoffTail,
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, boundedMs);
            timer.unref?.();
          }),
        ]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
    isClosing: () => !accepting,
  });
}

function avatarHandoffNonPresentResult(
  command: AvatarHostHandoffCommand,
  state: 'absent' | 'non-matching' | 'confirmation-required',
  switchIntentRef: string | null = null,
): AvatarHostHandoffResult {
  return parseAvatarHostHandoffResult({
    command,
    state,
    avatarInstanceRef: null,
    switchIntentRef,
    committedPresentationRef: null,
    temporaryCustodyRef: null,
  }, command);
}

function requiredAvatarHostTargetRef(value: unknown): string {
  const ref = requiredText(value, 'avatarHostTargetRef');
  if (!/^avatar_target_[A-Za-z0-9_-]{43}$/u.test(ref)) {
    throw new Error('avatarHostTargetRef must be a Runtime-minted Host-private ref');
  }
  return ref;
}

function requiredSourceApp(value: unknown): string {
  const sourceApp = requiredText(value, 'sourceApp');
  if (sourceApp.length > 160 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(sourceApp)) {
    throw new Error('sourceApp is invalid');
  }
  return sourceApp;
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
  return constrainBrowserWindow(window, optionalNumber(payload.minVisibleRatio) ?? 0.2);
}

function constrainBrowserWindow(
  window: BrowserWindow,
  minVisibleRatio = 0.2,
): { readonly constrained: boolean } {
  const bounds = window.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  const ratio = Math.min(1, Math.max(0.05, minVisibleRatio));
  const minWidth = Math.ceil(bounds.width * ratio);
  const minHeight = Math.ceil(bounds.height * ratio);
  const x = Math.min(Math.max(bounds.x, area.x - bounds.width + minWidth), area.x + area.width - minWidth);
  const y = Math.min(Math.max(bounds.y, area.y - bounds.height + minHeight), area.y + area.height - minHeight);
  const constrained = x !== bounds.x || y !== bounds.y;
  if (constrained) window.setBounds({ ...bounds, x, y });
  return { constrained };
}

export function desktopAvatarWindowWasOnRemovedDisplay(
  windowBounds: Rectangle,
  removedDisplayBounds: Rectangle,
  remainingDisplayBounds: readonly Rectangle[],
): boolean {
  const removedOverlap = rectangleOverlapArea(windowBounds, removedDisplayBounds);
  if (removedOverlap <= 0) return false;
  const remainingOverlap = remainingDisplayBounds.reduce(
    (largest, bounds) => Math.max(largest, rectangleOverlapArea(windowBounds, bounds)),
    0,
  );
  return removedOverlap >= remainingOverlap;
}

export function desktopAvatarPrimaryFallbackBounds(
  windowBounds: Rectangle,
  primaryWorkArea: Rectangle,
): Rectangle {
  return {
    ...windowBounds,
    x: primaryWorkArea.x + Math.max(0, primaryWorkArea.width - windowBounds.width),
    y: primaryWorkArea.y + Math.max(0, primaryWorkArea.height - windowBounds.height),
  };
}

function rectangleOverlapArea(left: Rectangle, right: Rectangle): number {
  const width = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x),
  );
  const height = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y),
  );
  return width * height;
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

export function parseAvatarPreviewProjectionResult(
  value: unknown,
  request: AvatarPreviewProjectionRequest,
  activeMaterializationRef: string,
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
  if (record.avatarAssetRef !== request.avatarAssetRef
    || record.backendKind !== request.backendKind) {
    throw new Error('Avatar preview renderer result does not match the requested material.');
  }
  if (state === 'ready') {
    assertOnlyKeys(record, [
      'state',
      'tier',
      'avatarAssetRef',
      'backendKind',
      'previewMaterialRef',
      'previewImageRef',
      'warnings',
    ], 'Avatar preview renderer ready result');
    const previewMaterialRef = requiredText(record.previewMaterialRef, 'previewMaterialRef');
    if (previewMaterialRef !== activeMaterializationRef) {
      throw new Error('Avatar preview renderer result does not match the active materialization.');
    }
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
    'reasonCode',
    'reason',
    'warnings',
  ], 'Avatar preview renderer non-ready result');
  if (record.previewImageRef !== null) {
    throw new Error('Avatar preview renderer non-ready result claimed render output.');
  }
  if (record.previewMaterialRef !== null) requiredText(record.previewMaterialRef, 'previewMaterialRef');
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
      backendKind: requiredPreviewBackendKind(record.backendKind),
      avatarAssetRef: requiredText(record.avatarAssetRef, 'avatarAssetRef'),
      previewMaterialRef: requiredText(record.previewMaterialRef, 'previewMaterialRef'),
      previewImageRef: requiredText(record.previewImageRef, 'previewImageRef'),
      warnings,
    };
  }
  return {
    state: record.state === 'failed' ? 'failed' : 'unavailable',
    tier: 'avatar_preview_service',
    backendKind: requiredPreviewBackendKind(record.backendKind),
    avatarAssetRef: requiredText(record.avatarAssetRef, 'avatarAssetRef'),
    previewMaterialRef: record.previewMaterialRef === null
      ? null
      : requiredText(record.previewMaterialRef, 'previewMaterialRef'),
    previewImageRef: null,
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
  const normalized = requiredExactText(value, field, 256);
  if (!/^(?:live2d|vrm)_[a-f0-9]{12}$/u.test(normalized)) {
    throw new Error(`${field} must be an Avatar asset ref`);
  }
  return normalized;
}

function requiredMaterializationLeaseRef(value: unknown): string {
  const ref = requiredExactText(value, 'materializationLeaseRef', 128);
  if (!/^avatar_materialization_lease_[a-f0-9]{32}$/u.test(ref)) {
    throw new Error('materializationLeaseRef is invalid');
  }
  return ref;
}

function requiredPresentationMaterializationRef(value: unknown): string {
  const ref = requiredExactText(value, 'materializationRef', 256);
  if (!/^avatar-materialization:(?:live2d|vrm):(?:live2d|vrm)_[a-f0-9]{12}$/u.test(ref)) {
    throw new Error('materializationRef is invalid');
  }
  return ref;
}

export function parseDesktopAvatarMaterializationResolveRequest(
  payload: Readonly<Record<string, unknown>>,
): Readonly<{
  agentHandle: string;
  avatarAssetRef: string;
  backendKind: 'live2d' | 'vrm';
  presentationRevision: string;
}> {
  assertExactKeys(payload, [
    'agentHandle',
    'avatarAssetRef',
    'backendKind',
    'presentationRevision',
  ], NIMI_ELECTRON_BUNDLED_AVATAR_ASSET_RESOLVE_COMMAND);
  const agentHandle = requiredAgentHandle(payload.agentHandle, 'agentHandle');
  const avatarAssetRef = requiredAvatarAssetRef(payload.avatarAssetRef, 'avatarAssetRef');
  const backendKind = requiredPreviewBackendKind(payload.backendKind);
  const presentationRevision = requiredExactText(
    payload.presentationRevision,
    'presentationRevision',
    512,
  );
  if (!avatarAssetRef.startsWith(`${backendKind}_`)) {
    throw new Error('desktop-bundled-avatar-materialization-tuple-mismatch');
  }
  return Object.freeze({ agentHandle, avatarAssetRef, backendKind, presentationRevision });
}

export function parseDesktopAvatarMaterializationCommit(
  payload: Readonly<Record<string, unknown>>,
): Readonly<AvatarActivePresentation & { materializationLeaseRef: string }> {
  assertExactKeys(payload, [
    'materializationLeaseRef',
    'avatarAssetRef',
    'backendKind',
    'presentationRevision',
    'materializationRef',
  ], AVATAR_MATERIALIZATION_COMMIT_COMMAND);
  const materializationLeaseRef = requiredMaterializationLeaseRef(payload.materializationLeaseRef);
  const avatarAssetRef = requiredAvatarAssetRef(payload.avatarAssetRef, 'avatarAssetRef');
  const backendKind = requiredPreviewBackendKind(payload.backendKind);
  const presentationRevision = requiredExactText(
    payload.presentationRevision,
    'presentationRevision',
    512,
  );
  const materializationRef = requiredPresentationMaterializationRef(payload.materializationRef);
  if (!avatarAssetRef.startsWith(`${backendKind}_`)
    || materializationRef !== `avatar-materialization:${backendKind}:${avatarAssetRef}`) {
    throw new Error('Avatar materialization commit tuple is inconsistent');
  }
  return Object.freeze({
    materializationLeaseRef,
    avatarAssetRef,
    backendKind,
    presentationRevision,
    materializationRef,
  });
}

export function desktopAvatarMaterializationCommitMatchesCandidate(
  candidate: AvatarActivePresentation,
  commit: AvatarActivePresentation,
): boolean {
  return candidate.avatarAssetRef === commit.avatarAssetRef
    && candidate.backendKind === commit.backendKind
    && candidate.presentationRevision === commit.presentationRevision
    && candidate.materializationRef === commit.materializationRef;
}

export function snapshotDesktopAvatarPreviewWindowBinding(
  record: AvatarWindowRecord,
): AvatarPreviewWindowBinding {
  return Object.freeze({
    window: record.window,
    sender: record.sender,
    avatarInstanceId: requiredText(record.launchContext.avatarInstanceId, 'avatarInstanceId'),
    avatarHostTargetRef: record.avatarHostTargetRef,
    agentHandle: record.launchContext.agentHandle,
    conversationAnchorId: record.launchContext.conversationAnchorId,
    previewEpoch: record.previewEpoch,
  });
}

export function desktopAvatarPreviewWindowBindingMatches(
  record: AvatarWindowRecord,
  binding: AvatarPreviewWindowBinding,
  windows: ReadonlyMap<string, AvatarWindowRecord>,
): boolean {
  return !record.window.isDestroyed()
    && !record.window.webContents.isDestroyed()
    && record.window === binding.window
    && record.sender === binding.sender
    && windows.get(binding.avatarInstanceId) === record
    && record.avatarHostTargetRef === binding.avatarHostTargetRef
    && record.launchContext.avatarInstanceId === binding.avatarInstanceId
    && record.launchContext.agentHandle === binding.agentHandle
    && record.launchContext.conversationAnchorId === binding.conversationAnchorId
    && record.previewEpoch === binding.previewEpoch;
}

export function desktopAvatarMaterializationWindowBindingMatches(
  record: AvatarWindowRecord,
  binding: AvatarPreviewWindowBinding,
  windows: ReadonlyMap<string, AvatarWindowRecord>,
  pendingCandidates: ReadonlySet<AvatarWindowRecord>,
): boolean {
  const registered = windows.get(binding.avatarInstanceId) === record
    || pendingCandidates.has(record);
  return registered
    && !record.window.isDestroyed()
    && !record.window.webContents.isDestroyed()
    && record.window === binding.window
    && record.sender === binding.sender
    && record.avatarHostTargetRef === binding.avatarHostTargetRef
    && record.launchContext.avatarInstanceId === binding.avatarInstanceId
    && record.launchContext.agentHandle === binding.agentHandle
    && record.launchContext.conversationAnchorId === binding.conversationAnchorId
    && record.previewEpoch === binding.previewEpoch;
}

export function desktopAvatarPreviewRequestMatchesActivePresentation(
  record: AvatarWindowRecord,
  binding: AvatarPreviewWindowBinding,
  request: Pick<
    AvatarPreviewProjectionRequest,
    'avatarAssetRef' | 'backendKind' | 'presentationRevision'
  >,
): boolean {
  const active = record.activePresentation;
  return active !== null
    && desktopAvatarPreviewWindowPresentationMatches(record, binding)
    && active.avatarAssetRef === request.avatarAssetRef
    && active.backendKind === request.backendKind
    && active.presentationRevision === request.presentationRevision;
}

function desktopAvatarPreviewWindowPresentationMatches(
  record: AvatarWindowRecord,
  binding: AvatarPreviewWindowBinding,
): boolean {
  return record.previewEpoch === binding.previewEpoch;
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

function requiredExactText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength
    || value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`${field} is invalid`);
  }
  return value;
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
