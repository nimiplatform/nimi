import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const electronMockUrl = `data:text/javascript,${encodeURIComponent(`
  export const browserWindowOps = [];
  export function resetBrowserWindowOps() { browserWindowOps.length = 0; }
  export class BrowserWindow {
    static instances = [];
    static fromWebContents(sender) {
      return BrowserWindow.instances.find((window) => window.webContents === sender) ?? null;
    }
    constructor() {
      this.destroyed = false;
      this.visible = false;
      this.focused = false;
      this.previewRequests = [];
      this.previewCancellations = [];
      this.listeners = new Map();
      this.webListeners = new Map();
      const mainFrame = { url: 'file:///avatar/index.html' };
      this.webContents = {
        mainFrame,
        isDestroyed: () => this.destroyed,
        setWindowOpenHandler() {},
        once: (event, listener) => this.onceWebContents(event, listener),
        on: (event, listener) => {
          const listeners = this.webListeners.get(event) ?? [];
          listeners.push(listener);
          this.webListeners.set(event, listeners);
        },
        send: (event, payload) => {
          browserWindowOps.push(['event', event]);
          if (event === 'nimi:runtime:event:avatar://agent-center-preview-request') this.previewRequests.push(payload);
          if (event === 'nimi:runtime:event:avatar://agent-center-preview-cancel') this.previewCancellations.push(payload);
        },
        capturePage: async () => ({
          isEmpty: () => false,
          toPNG: () => Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        }),
        setAudioMuted: (muted) => browserWindowOps.push(['audio', muted]),
      };
      BrowserWindow.instances.push(this);
    }
    onceWebContents(event, listener) {
      if (event === 'did-finish-load') this.didFinishLoad = listener;
    }
    on(event, listener) {
      const listeners = this.listeners.get(event) ?? [];
      listeners.push({ listener, once: false });
      this.listeners.set(event, listeners);
    }
    once(event, listener) {
      const listeners = this.listeners.get(event) ?? [];
      listeners.push({ listener, once: true });
      this.listeners.set(event, listeners);
    }
    emit(event) {
      const listeners = this.listeners.get(event) ?? [];
      this.listeners.set(event, listeners.filter((entry) => !entry.once));
      for (const entry of listeners) entry.listener();
    }
    emitWebContents(event, ...args) {
      for (const listener of this.webListeners.get(event) ?? []) listener(...args);
    }
    async loadURL() { this.didFinishLoad?.(); }
    isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; }
    isFocused() { return this.focused; }
    show() { this.visible = true; browserWindowOps.push(['show']); }
    hide() { this.visible = false; browserWindowOps.push(['hide']); }
    moveTop() { browserWindowOps.push(['moveTop']); }
    focus() { this.focused = true; browserWindowOps.push(['focus']); }
    setIgnoreMouseEvents(ignore) { browserWindowOps.push(['ignoreMouse', ignore]); }
    close() { this.emit('close'); this.destroy(); }
    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.emit('closed');
    }
  }
  export const powerMonitor = {
    on() {},
    removeListener() {},
  };
  export const screen = {
    on() {},
    removeListener() {},
    getAllDisplays() { return []; },
  };
  export const shell = { showItemInFolder() {} };
`)}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'electron') {
      return { shortCircuit: true, url: electronMockUrl };
    }
    return nextResolve(specifier, context);
  },
});

const {
  commitDesktopAvatarMaterializationCandidate,
  createDesktopElectronBundledAvatarHost,
  createDesktopAvatarHostHandoffSerialDispatcher,
  desktopAvatarHostSenderAuthorized,
  desktopAvatarMaterializationCommitMatchesCandidate,
  desktopAvatarPreviewRequestMatchesActivePresentation,
  desktopAvatarPreviewWindowBindingMatches,
  desktopAvatarPrimaryFallbackBounds,
  desktopAvatarWindowWasOnRemovedDisplay,
  parseAvatarPreviewProjectionResult,
  parseDesktopAvatarMaterializationCommit,
  parseDesktopAvatarMaterializationResolveRequest,
  runDesktopAvatarCandidatePromotion,
  resolveDesktopAvatarFormalLaunchBinding,
  resolveDesktopAvatarFormalPresentation,
  snapshotDesktopAvatarPreviewWindowBinding,
} = await import('../src-electron/bundled-avatar-host.js');

const AGENT_HANDLE = `agent_ref_${'b'.repeat(43)}`;
const SOURCE_APP_AGENT_HANDLE = `agent_ref_${'s'.repeat(43)}`;
const AVATAR_ASSET_REF = `vrm_${'c'.repeat(12)}`;
const MATERIALIZATION_REF = `avatar-materialization:vrm:${AVATAR_ASSET_REF}`;
const MATERIALIZATION_LEASE_REF = `avatar_materialization_lease_${'d'.repeat(32)}`;

for (const conversationAnchorId of [null, 'anchor-existing']) {
  test(`Avatar launch resolves its own session handle and Conversation (${conversationAnchorId ?? 'open'})`, async () => {
    const calls: unknown[] = [];
    const targetRef = `avatar_target_${'f'.repeat(43)}`;
    const result = await resolveDesktopAvatarFormalLaunchBinding({
      async agentReferenceList() {
        return [{ agentHandle: `agent_ref_${'a'.repeat(43)}` }, { agentHandle: AGENT_HANDLE }];
      },
      async avatarHostTargetResolve(request) {
        calls.push(['resolve', request]);
        return { avatarHostTargetRef: request.agentHandle === AGENT_HANDLE ? targetRef : `avatar_target_${'e'.repeat(43)}` };
      },
      async conversationOpen(request) {
        calls.push(['open', request]);
        return { conversationAnchorId: 'anchor-opened' };
      },
    }, { avatarHostTargetRef: targetRef, conversationAnchorId });
    assert.deepEqual(result, { agentHandle: AGENT_HANDLE, conversationAnchorId: conversationAnchorId ?? 'anchor-opened' });
    assert.deepEqual(calls.at(-1), conversationAnchorId === null
      ? ['open', { agentHandle: AGENT_HANDLE }]
      : ['resolve', { agentHandle: AGENT_HANDLE, conversationAnchorId }]);
  });
}

test('Avatar launch preserves a rejected Conversation fence without opening another Conversation', async () => {
  const targetRef = `avatar_target_${'f'.repeat(43)}`;
  await assert.rejects(resolveDesktopAvatarFormalLaunchBinding({
    async agentReferenceList() { return [{ agentHandle: AGENT_HANDLE }]; },
    async avatarHostTargetResolve(request) {
      if (request.conversationAnchorId !== null) throw new Error('conversation-fence-rejected');
      return { avatarHostTargetRef: targetRef };
    },
    async conversationOpen() { throw new Error('must-not-open-after-rejection'); },
  }, { avatarHostTargetRef: targetRef, conversationAnchorId: 'anchor-foreign' }), /conversation-fence-rejected/u);
});

test('formal presentation resolves only the exact hosted target and consistent owner profile', async () => {
  const input = { avatarHostTargetRef: `avatar_target_${'f'.repeat(43)}`, agentHandle: AGENT_HANDLE, conversationAnchorId: 'anchor-formal' };
  const calls: unknown[] = [];
  const snapshot = { presentationRevision: '2', profile: { revision: '2', avatarAssetRef: AVATAR_ASSET_REF, backendKind: 'vrm' } };
  const result = await resolveDesktopAvatarFormalPresentation({
    async avatarHostTargetResolve(request) { calls.push(['target', request]); return { avatarHostTargetRef: input.avatarHostTargetRef }; },
    async agentPresentationSnapshot(request) { calls.push(['presentation', request]); return snapshot; },
  }, input);
  assert.deepEqual(result, { avatarAssetRef: AVATAR_ASSET_REF, backendKind: 'vrm', presentationRevision: '2' });
  assert.deepEqual(calls, [
    ['target', { agentHandle: AGENT_HANDLE, conversationAnchorId: 'anchor-formal' }],
    ['presentation', { agentHandle: AGENT_HANDLE }],
  ]);
  let presentationReads = 0;
  await assert.rejects(resolveDesktopAvatarFormalPresentation({
    async avatarHostTargetResolve() { return { avatarHostTargetRef: `avatar_target_${'x'.repeat(43)}` }; },
    async agentPresentationSnapshot() { presentationReads++; return snapshot; },
  }, input), /target.*match/iu);
  assert.equal(presentationReads, 0, 'a foreign target must be rejected before reading a profile');
  for (const invalid of [
    { ...snapshot, profile: null },
    { ...snapshot, profile: { ...snapshot.profile, revision: '1' } },
    { ...snapshot, profile: { ...snapshot.profile, backendKind: 'live2d' } },
  ]) {
    await assert.rejects(resolveDesktopAvatarFormalPresentation({
      async avatarHostTargetResolve() { return { avatarHostTargetRef: input.avatarHostTargetRef }; },
      async agentPresentationSnapshot() { return invalid; },
    }, input), /presentation.*(?:unavailable|inconsistent)/iu);
  }
});

function minimalVrmGlb(): Uint8Array {
  const json = Buffer.from(JSON.stringify({
    asset: { version: '2.0' },
    extensionsUsed: ['VRMC_vrm'],
    extensions: { VRMC_vrm: { specVersion: '1.0' } },
  }), 'utf8');
  const paddedJsonLength = Math.ceil(json.byteLength / 4) * 4;
  const bytes = Buffer.alloc(12 + 8 + paddedJsonLength, 0x20);
  bytes.write('glTF', 0, 'ascii');
  bytes.writeUInt32LE(2, 4);
  bytes.writeUInt32LE(bytes.byteLength, 8);
  bytes.writeUInt32LE(paddedJsonLength, 12);
  bytes.writeUInt32LE(0x4e4f534a, 16);
  json.copy(bytes, 20);
  return Uint8Array.from(bytes);
}

type BundledAvatarLifecycleTestOptions = Readonly<{
  resolveFormalPresentation?: Parameters<typeof createDesktopElectronBundledAvatarHost>[0]['resolveFormalPresentation'];
  resolveFormalAvatarHostTarget?: (input: Readonly<{
    agentHandle: string;
    conversationAnchorId: string;
  }>) => Promise<string>;
  revalidateFormalPresentationForMaterialization?: () => Promise<void>;
  revalidateCurrentAvatarHostTarget?: (ref: string) => Promise<string>;
  beforeResolvePresentationAsset?: () => Promise<void>;
  onRegisterReadableFile?: () => void;
  appPrivateDataRoot?: string;
}>;

async function createBundledAvatarHostForLifecycleTest(
  options: BundledAvatarLifecycleTestOptions = {},
) {
  const content = minimalVrmGlb();
  return createDesktopElectronBundledAvatarHost({
    rendererUrl: 'file:///avatar/index.html',
    packagedRendererIndexPath: fileURLToPath(import.meta.url),
    preloadPath: '/tmp/avatar-preload.js',
    async resolveFormalLaunchBinding({ conversationAnchorId }) {
      return { agentHandle: AGENT_HANDLE, conversationAnchorId: conversationAnchorId ?? 'anchor-opened' };
    },
    resolveFormalPresentation: options.resolveFormalPresentation ?? (async () => ({
      avatarAssetRef: AVATAR_ASSET_REF, backendKind: 'vrm' as const, presentationRevision: 'revision-current',
    })),
    resolveAppPrivateDataRoot: async () => options.appPrivateDataRoot ?? '/tmp/nimi-avatar-test-data',
    localAssetProtocolHost: {
      protocolScheme: 'nimi-local',
      registerPrivilegedSchemes() {},
      registerProtocolHandler() {},
      async registerReadableFile(filePath: string) {
        options.onRegisterReadableFile?.();
        return filePath;
      },
      resolveLocalAssetUrl(filePath: string) { return filePath; },
      async hasReadableFile() { return false; },
      async quiesceDataRootReadableGrants() {},
      resumeDataRootReadableGrants() {},
      retireDataRootReadableGrants() {},
      activateDataRootReadableGrants() {},
    },
    async resolveFormalPresentationAsset() {
      await options.beforeResolvePresentationAsset?.();
      return {
        assetRef: AVATAR_ASSET_REF,
        role: 'avatar' as const,
        backendKind: 'vrm' as const,
        fileName: 'avatar.vrm',
        mediaType: 'model/gltf-binary',
        content,
        sha256: createHash('sha256').update(content).digest('hex'),
      };
    },
    revalidateFormalPresentationForMaterialization:
      options.revalidateFormalPresentationForMaterialization ?? (async () => {}),
    resolveFormalAvatarHostTarget:
      options.resolveFormalAvatarHostTarget ?? (async () => `avatar_target_${'f'.repeat(43)}`),
    revalidateCurrentAvatarHostTarget: options.revalidateCurrentAvatarHostTarget ?? (async () => { throw new Error('not-used'); }),
  });
}

async function launchBundledAvatarHostForLifecycleTest(
  host: Awaited<ReturnType<typeof createBundledAvatarHostForLifecycleTest>>,
  instanceId: string,
) {
  const electron = await import('electron') as unknown as typeof import('electron') & {
    readonly BrowserWindow: typeof import('electron').BrowserWindow & {
      readonly instances: Array<import('electron').BrowserWindow>;
    };
  };
  const existingWindowCount = electron.BrowserWindow.instances.length;
  const launch = host.hostHandoff({
    sourceApp: 'nimi.desktop',
    avatarHostTargetRef: `avatar_target_${'f'.repeat(43)}`,
    request: {
      command: 'launch',
      target: {
        agentHandle: SOURCE_APP_AGENT_HANDLE,
        conversationAnchorId: `anchor-${instanceId}`,
        avatarInstanceId: instanceId,
        launchSource: 'desktop-test',
        switchIntentRef: null,
        committedPresentationRef: null,
        temporaryCustodyRef: null,
      },
    },
  });
  while (electron.BrowserWindow.instances.length === existingWindowCount) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  const window = electron.BrowserWindow.instances.at(-1);
  assert.ok(window);
  const getLaunchContext = host.runtimeBridgeHost.commandHandlers?.nimi_avatar_get_launch_context;
  assert.ok(getLaunchContext);
  const context = await getLaunchContext({
    command: 'nimi_avatar_get_launch_context', payload: {},
    appId: 'nimi.avatar', runtimeEndpoint: 'protected-desktop-control',
    event: { sender: window.webContents, senderFrame: window.webContents.mainFrame },
  });
  assert.equal((context as { agentHandle: string }).agentHandle, AGENT_HANDLE);
  assert.equal(window.isVisible(), false);
  assert.equal(host.hasActiveInstances(), false);
  const presence = await host.hostHandoff({
    sourceApp: 'nimi.desktop',
    avatarHostTargetRef: `avatar_target_${'f'.repeat(43)}`,
    request: {
      command: 'presence',
      target: {
        agentHandle: AGENT_HANDLE,
        conversationAnchorId: `anchor-${instanceId}`,
        avatarInstanceId: instanceId,
        launchSource: 'desktop-test',
        switchIntentRef: null,
        committedPresentationRef: null,
        temporaryCustodyRef: null,
      },
    },
  });
  assert.equal(presence.state, 'launching');
  const resolveAsset = host.runtimeBridgeHost.commandHandlers?.nimi_avatar_resolve_agent_center_avatar_asset;
  const commitAsset = host.runtimeBridgeHost.commandHandlers?.nimi_avatar_commit_materialization_lease;
  assert.ok(resolveAsset);
  assert.ok(commitAsset);
  const resolved = await resolveAsset({
    command: 'nimi_avatar_resolve_agent_center_avatar_asset',
    payload: {
      payload: {
        agentHandle: AGENT_HANDLE,
        avatarAssetRef: AVATAR_ASSET_REF,
        backendKind: 'vrm',
        presentationRevision: 'revision-current',
      },
    },
    event: { sender: window.webContents, senderFrame: window.webContents.mainFrame },
    appId: 'nimi.avatar',
    runtimeEndpoint: 'protected-test',
    sendEvent() {},
  });
  await commitAsset({
    command: 'nimi_avatar_commit_materialization_lease',
    payload: {
      materializationLeaseRef: (resolved as { materializationLeaseRef: string }).materializationLeaseRef,
      avatarAssetRef: AVATAR_ASSET_REF,
      backendKind: 'vrm',
      presentationRevision: 'revision-current',
      materializationRef: (resolved as { materializationRef: string }).materializationRef,
    },
    event: { sender: window.webContents, senderFrame: window.webContents.mainFrame },
    appId: 'nimi.avatar',
    runtimeEndpoint: 'protected-test',
    sendEvent() {},
  });
  await launch;
  assert.equal(window.isVisible(), true);
  assert.equal(host.hasActiveInstances(), true);
  return window;
}

test('same-target presence, launch, and focus converge without rebinding caller hints', async () => {
  const electron = await import('electron') as unknown as typeof import('electron') & {
    readonly browserWindowOps: unknown[][];
    readonly resetBrowserWindowOps: () => void;
  };
  const presentationReads: unknown[] = [];
  const host = await createBundledAvatarHostForLifecycleTest({ resolveFormalPresentation: async (input) => {
    presentationReads.push(input);
    return { avatarAssetRef: AVATAR_ASSET_REF, backendKind: 'vrm', presentationRevision: 'revision-current' };
  } });
  const avatarHostTargetRef = `avatar_target_${'f'.repeat(43)}`;
  await launchBundledAvatarHostForLifecycleTest(host, 'instance-current');

  for (const command of ['presence', 'launch', 'focus'] as const) {
    electron.resetBrowserWindowOps();
    const result = await host.hostHandoff({
      sourceApp: 'nimi.zhiyu',
      avatarHostTargetRef,
      request: {
        command,
        target: {
          agentHandle: `agent_ref_${'a'.repeat(43)}`,
          conversationAnchorId: 'anchor-other-valid',
          avatarInstanceId: 'ignored-instance-hint',
          launchSource: 'ignored-launch-source',
          switchIntentRef: null,
          committedPresentationRef: 'ignored-presentation-ref',
          temporaryCustodyRef: 'ignored-custody-ref',
        },
      },
    });
    assert.equal(result.avatarInstanceRef, 'instance-current');
    assert.equal(result.committedPresentationRef, null);
    assert.equal(result.temporaryCustodyRef, null);
    assert.deepEqual(
      electron.browserWindowOps,
      command === 'presence' ? [] : [['show'], ['moveTop'], ['focus']],
    );
  }
  assert.deepEqual(presentationReads, [{ avatarHostTargetRef, agentHandle: AGENT_HANDLE, conversationAnchorId: 'anchor-instance-current' }]);
  await host.shutdown();
});

const currentPresentation = { avatarAssetRef: AVATAR_ASSET_REF, backendKind: 'vrm' as const, presentationRevision: 'revision-current' };
const revisedPresentation = { ...currentPresentation, presentationRevision: 'revision-next' };
const nextHostTurn = () => new Promise<void>(resolve => setImmediate(resolve));
function deferredHostRead<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => { resolve = complete; });
  return { promise, resolve };
}
function recallCurrentAvatar(host: Awaited<ReturnType<typeof createBundledAvatarHostForLifecycleTest>>, command: 'launch' | 'focus' = 'launch') {
  return host.hostHandoff({ sourceApp: 'nimi.zhiyu', avatarHostTargetRef: 'avatar_target_' + 'f'.repeat(43),
    request: { command, target: { agentHandle: SOURCE_APP_AGENT_HANDLE, conversationAnchorId: 'source-anchor-is-not-a-selector',
      avatarInstanceId: 'ignored-hint', launchSource: 'source-hint', switchIntentRef: null,
      committedPresentationRef: null, temporaryCustodyRef: null } } });
}
async function resolvePresentationLease(host: Awaited<ReturnType<typeof createBundledAvatarHostForLifecycleTest>>,
  window: import('electron').BrowserWindow, presentation = revisedPresentation, previewRequestId?: string) {
  return await avatarWindowCall(host, window, 'nimi_avatar_resolve_agent_center_avatar_asset', {
    payload: { agentHandle: AGENT_HANDLE, ...presentation, ...(previewRequestId ? { previewRequestId } : {}) },
  }) as { materializationLeaseRef: string; materializationRef: string };
}
async function commitPresentationLease(host: Awaited<ReturnType<typeof createBundledAvatarHostForLifecycleTest>>,
  window: import('electron').BrowserWindow, lease: Awaited<ReturnType<typeof resolvePresentationLease>>, presentation = revisedPresentation): Promise<unknown> {
  return avatarWindowCall(host, window, 'nimi_avatar_commit_materialization_lease', {
    materializationLeaseRef: lease.materializationLeaseRef,
    materializationRef: lease.materializationRef,
    ...presentation,
  });
}

type PreviewTestRequest = typeof currentPresentation & { requestId: string; conversationAnchorId: string };
type PreviewTestResult = { result: { state: string; reason?: string }; previewPngBase64?: string };

async function beginAvatarPreviewTest(
  host: Awaited<ReturnType<typeof createBundledAvatarHostForLifecycleTest>>,
  window: import('electron').BrowserWindow,
  presentation = revisedPresentation,
) {
  const requests = (window as unknown as { previewRequests: PreviewTestRequest[] }).previewRequests;
  const offset = requests.length;
  const context = await avatarWindowCall(host, window, 'nimi_avatar_get_launch_context', {}) as { conversationAnchorId: string };
  const handler = host.desktopCommandHandlers.desktop_avatar_preview_projection;
  assert.ok(handler);
  const result = Promise.resolve(handler({
    command: 'desktop_avatar_preview_projection',
    payload: { payload: { conversationAnchorId: context.conversationAnchorId, ...presentation } },
    event: { sender: { send() {} }, senderFrame: { url: 'file:///desktop/index.html' } },
    appId: 'nimi.desktop', runtimeEndpoint: 'protected-test', sendEvent() {},
  })).then(value => value as PreviewTestResult);
  while (requests.length === offset) await nextHostTurn();
  return { request: requests[offset]!, result };
}

function completeAvatarPreviewTest(
  host: Awaited<ReturnType<typeof createBundledAvatarHostForLifecycleTest>>,
  window: import('electron').BrowserWindow,
  request: PreviewTestRequest,
  materializationRef: string | null,
) {
  return avatarWindowCall(host, window, 'nimi_avatar_agent_center_preview_complete', {
    requestId: request.requestId,
    result: {
      state: materializationRef ? 'ready' : 'unavailable', tier: 'avatar_preview_service',
      avatarAssetRef: request.avatarAssetRef, backendKind: request.backendKind,
      previewMaterialRef: materializationRef,
      previewImageRef: materializationRef ? `/__nimi/avatar-preview/${request.requestId}.png` : null,
      ...(materializationRef ? {} : { reasonCode: 'capability_unavailable', reason: 'The fixture renderer is unavailable.' }),
      warnings: [],
    },
  });
}

for (const stage of ['owner-read', 'asset-read'] as const) {
  test('preview timeout fences a late materialization resolve during ' + stage, { timeout: 5000 }, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const gate = deferredHostRead<void>();
    const entered = deferredHostRead<void>();
    let holding = false;
    const hold = async () => { if (holding) { entered.resolve(); await gate.promise; } };
    const host = await createBundledAvatarHostForLifecycleTest({
      revalidateFormalPresentationForMaterialization: stage === 'owner-read' ? hold : undefined,
      beforeResolvePresentationAsset: stage === 'asset-read' ? hold : undefined,
    });
    const window = await launchBundledAvatarHostForLifecycleTest(host, 'preview-resolve-' + stage);
    try {
      const preview = await beginAvatarPreviewTest(host, window);
      holding = true;
      const lateResolve = assert.rejects(
        resolvePresentationLease(host, window, revisedPresentation, preview.request.requestId),
        /preview|materialization/iu,
      );
      await entered.promise;
      t.mock.timers.tick(15_000);
      assert.notEqual((await preview.result).result.state, 'ready');
      assert.deepEqual(await completeAvatarPreviewTest(host, window, preview.request, null), { accepted: false });
      holding = false;
      gate.resolve();
      await lateResolve;
      await assert.rejects(resolvePresentationLease(host, window, revisedPresentation, preview.request.requestId), /preview|materialization/iu);
      assert.equal(window.isDestroyed(), false);
      assert.equal((await recallCurrentAvatar(host, 'focus')).avatarInstanceRef, 'preview-resolve-' + stage);
    } finally { holding = false; gate.resolve(); await host.shutdown(); }
  });
}

test('preview timeout fences a lease while its final owner revalidation is still pending', { timeout: 5000 }, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const gate = deferredHostRead<void>();
  const entered = deferredHostRead<void>();
  let holding = false;
  let ownerFinished = false;
  const host = await createBundledAvatarHostForLifecycleTest({
    revalidateFormalPresentationForMaterialization: async () => {
      if (holding) { entered.resolve(); await gate.promise; ownerFinished = true; }
    },
  });
  const window = await launchBundledAvatarHostForLifecycleTest(host, 'preview-late-commit');
  try {
    const preview = await beginAvatarPreviewTest(host, window);
    const lease = await resolvePresentationLease(host, window, revisedPresentation, preview.request.requestId);
    holding = true;
    const lateCommit = assert.rejects(commitPresentationLease(host, window, lease), /preview|materialization/iu);
    await entered.promise;
    t.mock.timers.tick(15_000);
    assert.notEqual((await preview.result).result.state, 'ready');
    await lateCommit;
    assert.equal(ownerFinished, false, 'cancellation must settle without waiting for the owner read');
    holding = false;
    gate.resolve();
    await nextHostTurn();
    assert.equal(ownerFinished, true);
    await assert.rejects(commitPresentationLease(host, window, lease), /stale|preview|materialization/iu);
    assert.equal((await recallCurrentAvatar(host, 'launch')).avatarInstanceRef, 'preview-late-commit');
    assert.equal(window.isDestroyed(), false, 'the failed preview cannot replace the active presentation');
  } finally { holding = false; gate.resolve(); await host.shutdown(); }
});

test('renderer preview cancellation rejects final commit before the pending owner read returns', { timeout: 5000 }, async () => {
  const gate = deferredHostRead<void>();
  const entered = deferredHostRead<void>();
  let holding = false;
  let ownerFinished = false;
  const host = await createBundledAvatarHostForLifecycleTest({
    revalidateFormalPresentationForMaterialization: async () => {
      if (holding) { entered.resolve(); await gate.promise; ownerFinished = true; }
    },
  });
  const window = await launchBundledAvatarHostForLifecycleTest(host, 'preview-owner-cancel');
  try {
    const preview = await beginAvatarPreviewTest(host, window);
    const lease = await resolvePresentationLease(host, window, revisedPresentation, preview.request.requestId);
    holding = true;
    const lateCommit = assert.rejects(commitPresentationLease(host, window, lease), /preview|materialization/iu);
    await entered.promise;
    assert.deepEqual(await completeAvatarPreviewTest(host, window, preview.request, null), { accepted: true });
    assert.equal((await preview.result).result.state, 'unavailable');
    await lateCommit;
    assert.equal(ownerFinished, false, 'renderer cancellation must not wait for the owner read');
    holding = false;
    gate.resolve();
    await nextHostTurn();
    assert.equal(ownerFinished, true);
    await assert.rejects(commitPresentationLease(host, window, lease), /stale|preview|materialization/iu);
    assert.equal((await recallCurrentAvatar(host, 'launch')).avatarInstanceRef, 'preview-owner-cancel');
    assert.equal(window.isDestroyed(), false);
  } finally { holding = false; gate.resolve(); await host.shutdown(); }
});

test('preview request IDs cannot borrow expired leases or another request tuple', { timeout: 5000 }, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const host = await createBundledAvatarHostForLifecycleTest({ resolveFormalPresentation: async () => revisedPresentation });
  const window = await launchBundledAvatarHostForLifecycleTest(host, 'preview-scope');
  try {
    const first = await beginAvatarPreviewTest(host, window);
    const oldLease = await resolvePresentationLease(host, window, revisedPresentation, first.request.requestId);
    t.mock.timers.tick(15_000);
    assert.notEqual((await first.result).result.state, 'ready');
    const cancellations = (window as unknown as { previewCancellations: Array<{ requestId: string }> }).previewCancellations;
    assert.deepEqual(cancellations, [{ requestId: first.request.requestId }]);
    const next = await beginAvatarPreviewTest(host, window);
    assert.notEqual(next.request.requestId, first.request.requestId);
    await assert.rejects(resolvePresentationLease(host, window, revisedPresentation, first.request.requestId), /preview|materialization/iu);
    await assert.rejects(resolvePresentationLease(host, window, currentPresentation, next.request.requestId), /preview|materialization/iu);
    await assert.rejects(commitPresentationLease(host, window, oldLease), /stale|preview|materialization/iu);
    const lease = await resolvePresentationLease(host, window, revisedPresentation, next.request.requestId);
    await commitPresentationLease(host, window, lease);
    assert.deepEqual(await completeAvatarPreviewTest(host, window, first.request, oldLease.materializationRef), { accepted: false });
    assert.deepEqual(await completeAvatarPreviewTest(host, window, next.request, lease.materializationRef), { accepted: true });
    const result = await next.result;
    assert.equal(result.result.state, 'ready');
    assert.deepEqual(cancellations, [{ requestId: first.request.requestId }], 'the next successful request must not inherit cancellation');
    assert.equal(typeof result.previewPngBase64, 'string');
    assert.equal((await recallCurrentAvatar(host, 'launch')).avatarInstanceRef, 'preview-scope');
  } finally { await host.shutdown(); }
});

for (const failure of ['closed', 'binding-renewed'] as const) {
  test('preview ' + failure + ' fences a pending asset read before its late result', { timeout: 5000 }, async () => {
    const gate = deferredHostRead<void>();
    const entered = deferredHostRead<void>();
    let holding = false;
    const host = await createBundledAvatarHostForLifecycleTest({
      beforeResolvePresentationAsset: async () => { if (holding) { entered.resolve(); await gate.promise; } },
    });
    const window = await launchBundledAvatarHostForLifecycleTest(host, 'preview-' + failure);
    try {
      const preview = await beginAvatarPreviewTest(host, window);
      holding = true;
      const lateResolve = assert.rejects(
        resolvePresentationLease(host, window, revisedPresentation, preview.request.requestId),
        /preview|materialization|unbound|invalidated/iu,
      );
      await entered.promise;
      if (failure === 'closed') window.destroy();
      else await avatarWindowCall(host, window, 'nimi_avatar_refresh_host_binding', {
        agentHandle: `agent_ref_${'h'.repeat(43)}`, conversationAnchorId: 'anchor-preview-' + failure,
      });
      assert.notEqual((await preview.result).result.state, 'ready');
      holding = false;
      gate.resolve();
      await lateResolve;
      assert.deepEqual(await completeAvatarPreviewTest(host, window, preview.request, null), { accepted: false });
      assert.equal(window.isDestroyed(), failure === 'closed');
    } finally { holding = false; gate.resolve(); await host.shutdown(); }
  });
}

for (const failure of ['capture-error', 'capture-timeout'] as const) {
  test('committed preview ' + failure + ' does not roll back the active materialization', { timeout: 5000 }, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const capture = deferredHostRead<Awaited<ReturnType<import('electron').WebContents['capturePage']>>>();
    const entered = deferredHostRead<void>();
    const host = await createBundledAvatarHostForLifecycleTest({ resolveFormalPresentation: async () => revisedPresentation });
    const window = await launchBundledAvatarHostForLifecycleTest(host, failure);
    const originalCapture = window.webContents.capturePage;
    t.mock.method(window.webContents, 'capturePage', async () => {
      entered.resolve();
      if (failure === 'capture-error') throw new Error('fixture capture failed');
      return capture.promise;
    });
    try {
      const preview = await beginAvatarPreviewTest(host, window);
      const lease = await resolvePresentationLease(host, window, revisedPresentation, preview.request.requestId);
      await commitPresentationLease(host, window, lease);
      const completion = completeAvatarPreviewTest(host, window, preview.request, lease.materializationRef);
      await entered.promise;
      if (failure === 'capture-timeout') t.mock.timers.tick(15_000);
      const result = await preview.result;
      assert.equal(result.result.state, 'unavailable');
      assert.match(result.result.reason ?? '', /appearance was applied/iu);
      assert.equal((await recallCurrentAvatar(host, 'launch')).avatarInstanceRef, failure);
      assert.equal(window.isDestroyed(), false);
      capture.resolve(await originalCapture.call(window.webContents));
      await completion;
      await assert.rejects(commitPresentationLease(host, window, lease), /stale|preview|materialization/iu);
    } finally { capture.resolve(await originalCapture.call(window.webContents)); await host.shutdown(); }
  });
}

test('same-Agent changed presentation promotes a distinct candidate only after its real fixture lease commits', { timeout: 5000 }, async () => {
  const commitGate = deferredHostRead<void>();
  let waitForCommit = false, commitEntered = false;
  const host = await createBundledAvatarHostForLifecycleTest({
    resolveFormalPresentation: async () => revisedPresentation,
    revalidateFormalPresentationForMaterialization: async () => {
      if (waitForCommit) { commitEntered = true; await commitGate.promise; }
    },
  });
  const old = await launchBundledAvatarHostForLifecycleTest(host, 'same-agent-current');
  old.hide();
  try {
    const pending = await pendingAvatarForAbortTest(host, 'ignored-source-instance');
    let finished = false;
    void pending.launch.then(() => { finished = true; }, () => { finished = true; });
    const context = await pending.call('nimi_avatar_get_launch_context', {}) as { agentHandle: string; conversationAnchorId: string; avatarInstanceId: string };
    assert.equal(context.agentHandle, AGENT_HANDLE);
    assert.equal(context.conversationAnchorId, 'anchor-same-agent-current');
    assert.notEqual(context.avatarInstanceId, 'same-agent-current');
    assert.notEqual(context.avatarInstanceId, 'ignored-source-instance');
    assert.notEqual(pending.window, old);
    assert.equal(pending.window.isVisible(), false);
    assert.equal(old.isDestroyed(), false);
    const lease = await resolvePresentationLease(host, pending.window);
    waitForCommit = true;
    const commit = commitPresentationLease(host, pending.window, lease);
    await nextHostTurn();
    assert.equal(commitEntered, true);
    assert.equal(finished, false);
    assert.equal(pending.window.isVisible(), false);
    assert.equal(old.isDestroyed(), false, 'the old carrier survives until the candidate reaches its owner-validated terminal');
    waitForCommit = false;
    commitGate.resolve(); await commit;
    const result = await pending.launch;
    assert.equal(result.state, 'focused');
    assert.equal(result.avatarInstanceRef, context.avatarInstanceId);
    assert.equal(pending.window.isVisible(), true);
    assert.equal(old.isDestroyed(), true);
    assert.equal(host.hasActiveInstances(), true);
  } finally { commitGate.resolve(); await host.shutdown(); }
});

test('a failed formal presentation read leaves the current carrier usable without rebinding it', async () => {
  const host = await createBundledAvatarHostForLifecycleTest({ resolveFormalPresentation: async () => { throw new Error('formal-owner-unavailable'); } });
  const old = await launchBundledAvatarHostForLifecycleTest(host, 'formal-read-failed');
  try {
    await assert.rejects(recallCurrentAvatar(host), /formal-owner-unavailable/u);
    assert.equal(old.isDestroyed(), false);
    assert.equal((await recallCurrentAvatar(host, 'focus')).avatarInstanceRef, 'formal-read-failed');
    assert.equal(host.hasActiveInstances(), true);
  } finally { await host.shutdown(); }
});

for (const failure of ['aborted', 'closed'] as const) {
  test('same-Agent candidate ' + failure + ' preserves the old carrier and rejects a late lease commit', { timeout: 5000 }, async () => {
    const host = await createBundledAvatarHostForLifecycleTest({ resolveFormalPresentation: async () => revisedPresentation });
    const old = await launchBundledAvatarHostForLifecycleTest(host, 'retained-' + failure);
    try {
      const pending = await pendingAvatarForAbortTest(host, 'ignored-candidate-hint');
      const rejection = assert.rejects(pending.launch, failure === 'aborted' ? /pending-launch-aborted/u : /candidate-closed/u);
      const lease = await resolvePresentationLease(host, pending.window);
      if (failure === 'aborted') {
        assert.deepEqual(await pending.call('nimi_avatar_abort_pending_launch', pending.binding), { accepted: true });
      } else pending.window.destroy();
      await rejection;
      assert.equal(pending.window.isDestroyed(), true);
      await assert.rejects(async () => commitPresentationLease(host, pending.window, lease), /stale|unbound|invalidated/u);
      assert.equal(old.isDestroyed(), false);
      assert.equal((await recallCurrentAvatar(host, 'focus')).avatarInstanceRef, 'retained-' + failure);
      assert.equal(host.hasActiveInstances(), true);
    } finally { await host.shutdown(); }
  });
}

for (const change of ['closed', 'preview-epoch'] as const) {
  test('a ' + change + ' change during the formal read rejects stale same-Agent presentation work', { timeout: 5000 }, async () => {
    const read = deferredHostRead<typeof revisedPresentation>();
    const host = await createBundledAvatarHostForLifecycleTest({ resolveFormalPresentation: () => read.promise });
    const old = await launchBundledAvatarHostForLifecycleTest(host, 'snapshot-' + change);
    const electron = await import('electron') as unknown as { BrowserWindow: { instances: unknown[] } };
    const windowCount = electron.BrowserWindow.instances.length;
    const rejection = assert.rejects(recallCurrentAvatar(host), /presentation-binding-stale/u);
    try {
      await nextHostTurn();
      if (change === 'closed') old.destroy();
      else {
        const lease = await resolvePresentationLease(host, old, currentPresentation);
        await commitPresentationLease(host, old, lease, currentPresentation);
      }
      read.resolve(revisedPresentation);
      await rejection;
      assert.equal(electron.BrowserWindow.instances.length, windowCount, 'a stale snapshot cannot create a replacement');
      if (change === 'preview-epoch') {
        assert.equal((await recallCurrentAvatar(host, 'focus')).avatarInstanceRef, 'snapshot-' + change);
        assert.equal(old.isDestroyed(), false);
      } else assert.equal(host.hasActiveInstances(), false);
    } finally { read.resolve(revisedPresentation); await host.shutdown(); }
  });
}

test('same-Agent promotion revalidates the committed tuple after renderer load completes', { timeout: 5000 }, async t => {
  let ownerChanged = false;
  const loadGate = deferredHostRead<void>();
  const host = await createBundledAvatarHostForLifecycleTest({
    resolveFormalPresentation: async () => revisedPresentation,
    revalidateFormalPresentationForMaterialization: async () => {
      if (ownerChanged) throw new Error('formal-presentation-changed');
    },
  });
  const old = await launchBundledAvatarHostForLifecycleTest(host, 'last-valid-presentation');
  const electron = await import('electron');
  const loadURL = electron.BrowserWindow.prototype.loadURL;
  t.mock.method(electron.BrowserWindow.prototype, 'loadURL', async function(this: import('electron').BrowserWindow, ...args: Parameters<typeof loadURL>) {
    await loadGate.promise;
    return loadURL.apply(this, args);
  });
  try {
    const pending = await pendingAvatarForAbortTest(host, 'ignored-promotion-hint');
    const rejection = assert.rejects(pending.launch, /formal-presentation-changed/u);
    const lease = await resolvePresentationLease(host, pending.window);
    await commitPresentationLease(host, pending.window, lease);
    assert.equal(old.isDestroyed(), false);
    assert.equal(pending.window.isVisible(), false);
    ownerChanged = true;
    loadGate.resolve();
    await rejection;
    assert.equal(pending.window.isDestroyed(), true);
    assert.equal(old.isDestroyed(), false);
    assert.equal((await recallCurrentAvatar(host, 'focus')).avatarInstanceRef, 'last-valid-presentation');
  } finally { loadGate.resolve(); await host.shutdown(); }
});

test('data-root quiesce closes the current Avatar and resume admits a fresh empty host', async () => {
  const appPrivateDataRoot = await mkdtemp(path.join(os.tmpdir(), 'nimi-avatar-data-root-'));
  try {
    const host = await createBundledAvatarHostForLifecycleTest({ appPrivateDataRoot });
    const targetRef = `avatar_target_${'f'.repeat(43)}`;
    const window = await launchBundledAvatarHostForLifecycleTest(host, 'instance-data-root');

    await host.quiesceDataRoot();

    assert.equal(window.isDestroyed(), true);
    assert.equal(host.hasActiveInstances(), false);
    await assert.rejects(host.hostHandoff({
      sourceApp: 'nimi.desktop',
      avatarHostTargetRef: targetRef,
      request: {
        command: 'presence',
        target: {
          agentHandle: AGENT_HANDLE,
          conversationAnchorId: 'anchor-instance-data-root',
          avatarInstanceId: 'instance-data-root',
          launchSource: 'desktop-test',
          switchIntentRef: null,
          committedPresentationRef: null,
          temporaryCustodyRef: null,
        },
      },
    }), /data-root-handoff-closed/u);

    host.resumeDataRoot();
    const presence = await host.hostHandoff({
      sourceApp: 'nimi.desktop',
      avatarHostTargetRef: targetRef,
      request: {
        command: 'presence',
        target: {
          agentHandle: AGENT_HANDLE,
          conversationAnchorId: 'anchor-instance-data-root',
          avatarInstanceId: 'instance-data-root',
          launchSource: 'desktop-test',
          switchIntentRef: null,
          committedPresentationRef: null,
          temporaryCustodyRef: null,
        },
      },
    });
    assert.equal(presence.state, 'absent');
    await host.shutdown();
  } finally {
    await rm(appPrivateDataRoot, { recursive: true, force: true });
  }
});

test('current Avatar session refresh replaces the Host-private generation target without exposing it', async () => {
  const nextTargetRef = `avatar_target_${'g'.repeat(43)}`;
  const host = await createBundledAvatarHostForLifecycleTest({
    resolveFormalAvatarHostTarget: async (input) => {
      assert.deepEqual(input, {
        agentHandle: `agent_ref_${'h'.repeat(43)}`,
        conversationAnchorId: 'anchor-instance-renewed',
      });
      return nextTargetRef;
    },
  });
  const window = await launchBundledAvatarHostForLifecycleTest(host, 'instance-renewed');
  const refresh = host.runtimeBridgeHost.commandHandlers?.nimi_avatar_refresh_host_binding;
  assert.ok(refresh);
  const result = await refresh({
    command: 'nimi_avatar_refresh_host_binding',
    payload: {
      agentHandle: `agent_ref_${'h'.repeat(43)}`,
      conversationAnchorId: 'anchor-instance-renewed',
    },
    event: { sender: window.webContents, senderFrame: window.webContents.mainFrame },
    appId: 'nimi.avatar',
    runtimeEndpoint: 'protected-test',
    sendEvent() {},
  });
  assert.deepEqual(result, { accepted: true });

  const presence = await host.hostHandoff({
    sourceApp: 'nimi.zhiyu',
    avatarHostTargetRef: nextTargetRef,
    request: {
      command: 'presence',
      target: {
        agentHandle: `agent_ref_${'i'.repeat(43)}`,
        conversationAnchorId: 'anchor-instance-renewed',
        avatarInstanceId: null,
        launchSource: 'zhiyu',
        switchIntentRef: null,
        committedPresentationRef: null,
        temporaryCustodyRef: null,
      },
    },
  });
  assert.ok(presence.state === 'present' || presence.state === 'focused');
  assert.equal(presence.avatarInstanceRef, 'instance-renewed');
  await host.shutdown();
});

test('binding refresh releases a same-materialization pending lease exactly once', async () => {
  let revalidationCount = 0;
  let enterFinalRevalidation!: () => void;
  let finishFinalRevalidation!: () => void;
  const finalRevalidationStarted = new Promise<void>((resolve) => {
    enterFinalRevalidation = resolve;
  });
  const holdFinalRevalidation = new Promise<void>((resolve) => {
    finishFinalRevalidation = resolve;
  });
  let readableFileRegistrations = 0;
  const nextTargetRef = `avatar_target_${'g'.repeat(43)}`;
  const host = await createBundledAvatarHostForLifecycleTest({
    resolveFormalAvatarHostTarget: async () => nextTargetRef,
    revalidateFormalPresentationForMaterialization: async () => {
      revalidationCount += 1;
      if (revalidationCount === 4) {
        enterFinalRevalidation();
        await holdFinalRevalidation;
      }
    },
    onRegisterReadableFile: () => { readableFileRegistrations += 1; },
  });
  const window = await launchBundledAvatarHostForLifecycleTest(host, 'instance-refresh-release');
  const resolveAsset = host.runtimeBridgeHost.commandHandlers?.nimi_avatar_resolve_agent_center_avatar_asset;
  const commitAsset = host.runtimeBridgeHost.commandHandlers?.nimi_avatar_commit_materialization_lease;
  const releaseAsset = host.runtimeBridgeHost.commandHandlers?.nimi_avatar_release_materialization_lease;
  const refresh = host.runtimeBridgeHost.commandHandlers?.nimi_avatar_refresh_host_binding;
  assert.ok(resolveAsset);
  assert.ok(commitAsset);
  assert.ok(releaseAsset);
  assert.ok(refresh);
  const call = {
    event: { sender: window.webContents, senderFrame: window.webContents.mainFrame },
    appId: 'nimi.avatar',
    runtimeEndpoint: 'protected-test',
    sendEvent() {},
  };
  const pending = await resolveAsset({
    ...call,
    command: 'nimi_avatar_resolve_agent_center_avatar_asset',
    payload: { payload: {
      agentHandle: AGENT_HANDLE,
      avatarAssetRef: AVATAR_ASSET_REF,
      backendKind: 'vrm',
      presentationRevision: 'revision-current',
    } },
  });
  const pendingCommit = assert.rejects(async () => commitAsset({
    ...call,
    command: 'nimi_avatar_commit_materialization_lease',
    payload: {
      materializationLeaseRef: (pending as { materializationLeaseRef: string }).materializationLeaseRef,
      avatarAssetRef: AVATAR_ASSET_REF,
      backendKind: 'vrm',
      presentationRevision: 'revision-current',
      materializationRef: (pending as { materializationRef: string }).materializationRef,
    },
  }), /materialization-binding-stale/u);
  await finalRevalidationStarted;
  await refresh({
    ...call,
    command: 'nimi_avatar_refresh_host_binding',
    payload: {
      agentHandle: `agent_ref_${'h'.repeat(43)}`,
      conversationAnchorId: 'anchor-instance-refresh-release',
    },
  });
  finishFinalRevalidation();
  await pendingCommit;

  const registrationsBeforeReuse = readableFileRegistrations;
  const reused = await resolveAsset({
    ...call,
    command: 'nimi_avatar_resolve_agent_center_avatar_asset',
    payload: { payload: {
      agentHandle: `agent_ref_${'h'.repeat(43)}`,
      avatarAssetRef: AVATAR_ASSET_REF,
      backendKind: 'vrm',
      presentationRevision: 'revision-current',
    } },
  });
  assert.equal(readableFileRegistrations, registrationsBeforeReuse);
  assert.deepEqual(await releaseAsset({
    ...call,
    command: 'nimi_avatar_release_materialization_lease',
    payload: {
      materializationLeaseRef: (reused as { materializationLeaseRef: string }).materializationLeaseRef,
    },
  }), { accepted: true });
  await host.shutdown();
});

test('initial launch stays hidden and inactive until the exact materialization commit promotes it', async () => {
  const electron = await import('electron') as unknown as typeof import('electron') & {
    readonly browserWindowOps: unknown[][];
    readonly resetBrowserWindowOps: () => void;
  };
  electron.resetBrowserWindowOps();
  const host = await createBundledAvatarHostForLifecycleTest();
  const window = await launchBundledAvatarHostForLifecycleTest(host, 'instance-initial-hidden');
  const mutedIndex = electron.browserWindowOps.findIndex((operation) => operation[0] === 'audio' && operation[1] === true);
  const interactiveIndex = electron.browserWindowOps.findIndex((operation) => operation[0] === 'ignoreMouse' && operation[1] === false);
  const visibleIndex = electron.browserWindowOps.findIndex((operation) => operation[0] === 'show');
  assert.ok(mutedIndex >= 0);
  assert.ok(interactiveIndex > mutedIndex);
  assert.ok(visibleIndex > interactiveIndex);
  assert.equal(window.isVisible(), true);
  await host.shutdown();
});

test('initial launch commit failure destroys the hidden candidate without making it active', async () => {
  const host = await createBundledAvatarHostForLifecycleTest();
  const electron = await import('electron') as unknown as typeof import('electron') & {
    readonly BrowserWindow: typeof import('electron').BrowserWindow & {
      readonly instances: Array<import('electron').BrowserWindow>;
    };
  };
  const existingWindowCount = electron.BrowserWindow.instances.length;
  const launch = host.hostHandoff({
    sourceApp: 'nimi.desktop',
    avatarHostTargetRef: `avatar_target_${'f'.repeat(43)}`,
    request: {
      command: 'launch',
      target: {
        agentHandle: AGENT_HANDLE,
        conversationAnchorId: 'anchor-initial-failure',
        avatarInstanceId: 'instance-initial-failure',
        launchSource: 'desktop-test',
        switchIntentRef: null,
        committedPresentationRef: null,
        temporaryCustodyRef: null,
      },
    },
  });
  const launchRejected = assert.rejects(launch, /materialization-commit-mismatch/u);
  while (electron.BrowserWindow.instances.length === existingWindowCount) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  const window = electron.BrowserWindow.instances.at(-1);
  assert.ok(window);
  const resolveAsset = host.runtimeBridgeHost.commandHandlers?.nimi_avatar_resolve_agent_center_avatar_asset;
  const commitAsset = host.runtimeBridgeHost.commandHandlers?.nimi_avatar_commit_materialization_lease;
  assert.ok(resolveAsset);
  assert.ok(commitAsset);
  const resolved = await resolveAsset({
    command: 'nimi_avatar_resolve_agent_center_avatar_asset',
    payload: {
      payload: {
        agentHandle: AGENT_HANDLE,
        avatarAssetRef: AVATAR_ASSET_REF,
        backendKind: 'vrm',
        presentationRevision: 'revision-current',
      },
    },
    event: { sender: window.webContents, senderFrame: window.webContents.mainFrame },
    appId: 'nimi.avatar',
    runtimeEndpoint: 'protected-test',
    sendEvent() {},
  });
  await assert.rejects(async () => commitAsset({
    command: 'nimi_avatar_commit_materialization_lease',
    payload: {
      materializationLeaseRef: (resolved as { materializationLeaseRef: string }).materializationLeaseRef,
      avatarAssetRef: AVATAR_ASSET_REF,
      backendKind: 'vrm',
      presentationRevision: 'revision-mismatch',
      materializationRef: (resolved as { materializationRef: string }).materializationRef,
    },
    event: { sender: window.webContents, senderFrame: window.webContents.mainFrame },
    appId: 'nimi.avatar',
    runtimeEndpoint: 'protected-test',
    sendEvent() {},
  }), /materialization-commit-mismatch/u);
  await launchRejected;
  assert.equal(window.isVisible(), false);
  assert.equal(window.isDestroyed(), true);
  assert.equal(host.hasActiveInstances(), false);
  await host.shutdown();
});

function avatarWindowCall(
  host: Awaited<ReturnType<typeof createBundledAvatarHostForLifecycleTest>>,
  window: import('electron').BrowserWindow,
  command: string,
  payload: Record<string, unknown>,
) {
  const handler = host.runtimeBridgeHost.commandHandlers?.[command];
  assert.ok(handler, command);
  return handler({ command, payload, event: { sender: window.webContents, senderFrame: window.webContents.mainFrame },
    appId: 'nimi.avatar', runtimeEndpoint: 'protected-test', sendEvent() {} });
}

async function pendingAvatarForAbortTest(
  host: Awaited<ReturnType<typeof createBundledAvatarHostForLifecycleTest>>,
  instanceId: string,
  avatarHostTargetRef = `avatar_target_${'f'.repeat(43)}`,
  switchIntentRef: string | null = null,
) {
  const electron = await import('electron') as unknown as typeof import('electron') & {
    BrowserWindow: typeof import('electron').BrowserWindow & { instances: import('electron').BrowserWindow[] };
  };
  const count = electron.BrowserWindow.instances.length;
  const launch = host.hostHandoff({ sourceApp: 'nimi.desktop', avatarHostTargetRef,
    request: { command: 'launch', target: { agentHandle: SOURCE_APP_AGENT_HANDLE, conversationAnchorId: `anchor-${instanceId}`,
      avatarInstanceId: instanceId, launchSource: 'desktop-test', switchIntentRef, committedPresentationRef: null, temporaryCustodyRef: null } } });
  void launch.catch(() => undefined);
  while (electron.BrowserWindow.instances.length === count) await new Promise<void>(resolve => setImmediate(resolve));
  const window = electron.BrowserWindow.instances.at(-1)!;
  const context = await avatarWindowCall(host, window, 'nimi_avatar_get_launch_context', {}) as {
    agentHandle: string; conversationAnchorId: string;
  };
  const binding = { agentHandle: context.agentHandle, conversationAnchorId: context.conversationAnchorId };
  return { window, launch, binding, call: (command: string, payload: Record<string, unknown>) => avatarWindowCall(host, window, command, payload) };
}

async function resolveAbortTestLease(pending: Awaited<ReturnType<typeof pendingAvatarForAbortTest>>, agentHandle = AGENT_HANDLE) {
  return await pending.call('nimi_avatar_resolve_agent_center_avatar_asset', { payload: {
    agentHandle, avatarAssetRef: AVATAR_ASSET_REF, backendKind: 'vrm', presentationRevision: 'revision-current',
  } }) as { materializationLeaseRef: string; materializationRef: string };
}

function commitAbortTestLease(
  pending: Awaited<ReturnType<typeof pendingAvatarForAbortTest>>,
  lease: Awaited<ReturnType<typeof resolveAbortTestLease>>,
) {
  return pending.call('nimi_avatar_commit_materialization_lease', {
    materializationLeaseRef: lease.materializationLeaseRef, materializationRef: lease.materializationRef,
    avatarAssetRef: AVATAR_ASSET_REF, backendKind: 'vrm', presentationRevision: 'revision-current' });
}

test('scoped abort rejects a pending switch once, preserves the old companion, and cannot affect its later replacement', { timeout: 3000 }, async () => {
  const host = await createBundledAvatarHostForLifecycleTest({ revalidateCurrentAvatarHostTarget: async ref => ref });
  const old = await launchBundledAvatarHostForLifecycleTest(host, 'abort-old-active');
  const nextTarget = `avatar_target_${'g'.repeat(43)}`;
  const confirmation = () => host.hostHandoff({ sourceApp: 'nimi.desktop', avatarHostTargetRef: nextTarget,
    request: { command: 'launch', target: { agentHandle: SOURCE_APP_AGENT_HANDLE, conversationAnchorId: 'anchor-new',
      avatarInstanceId: null, launchSource: 'desktop-test', switchIntentRef: null, committedPresentationRef: null, temporaryCustodyRef: null } } });
  try {
    assert.deepEqual(await avatarWindowCall(host, old, 'nimi_avatar_abort_pending_launch', {
      agentHandle: AGENT_HANDLE, conversationAnchorId: 'anchor-abort-old-active',
    }), { accepted: false });
    const intent = await confirmation();
    const pending = await pendingAvatarForAbortTest(host, 'abort-failed-switch', nextTarget, intent.switchIntentRef);
    assert.deepEqual(await pending.call('nimi_avatar_abort_pending_launch', { ...pending.binding, agentHandle: SOURCE_APP_AGENT_HANDLE }), { accepted: false });
    await assert.rejects(async () => pending.call('nimi_avatar_abort_pending_launch', { ...pending.binding, phase: 'failed' }), /unexpected|unknown|payload|keys/iu);
    assert.deepEqual(await pending.call('nimi_avatar_abort_pending_launch', pending.binding), { accepted: true });
    assert.deepEqual(await pending.call('nimi_avatar_abort_pending_launch', pending.binding), { accepted: false });
    const presence = await host.hostHandoff({ sourceApp: 'nimi.desktop', avatarHostTargetRef: nextTarget,
      request: { command: 'presence', target: { agentHandle: SOURCE_APP_AGENT_HANDLE, conversationAnchorId: null,
        avatarInstanceId: null, launchSource: 'desktop-test', switchIntentRef: null, committedPresentationRef: null, temporaryCustodyRef: null } } });
    assert.equal(presence.state, 'non-matching');
    await assert.rejects(pending.launch, /pending-launch-aborted/u);
    assert.equal(old.isVisible(), true);
    assert.equal(old.isDestroyed(), false);
    assert.equal(pending.window.isDestroyed(), true);

    const freshIntent = await confirmation();
    const replacement = await pendingAvatarForAbortTest(host, 'abort-fresh-switch', nextTarget, freshIntent.switchIntentRef);
    await commitAbortTestLease(replacement, await resolveAbortTestLease(replacement));
    await replacement.launch;
    assert.equal(replacement.window.isVisible(), true);
    assert.deepEqual(await pending.call('nimi_avatar_abort_pending_launch', pending.binding), { accepted: false });
    assert.equal(replacement.window.isDestroyed(), false);
  } finally { await host.shutdown(); }
});

test('scoped abort interrupts loading even after ready was resolved, before promotion can run', { timeout: 2000 }, async t => {
  const { BrowserWindow } = await import('electron');
  let finishLoad!: () => void;
  const gate = new Promise<void>(resolve => { finishLoad = resolve; });
  t.mock.method(BrowserWindow.prototype, 'loadURL', async () => { await gate; });
  const host = await createBundledAvatarHostForLifecycleTest();
  try {
    const pending = await pendingAvatarForAbortTest(host, 'abort-ready-before-load');
    const lease = await resolveAbortTestLease(pending);
    await commitAbortTestLease(pending, lease);
    assert.equal(pending.window.isVisible(), false);
    assert.deepEqual(await pending.call('nimi_avatar_abort_pending_launch', pending.binding), { accepted: true });
    // This must settle without releasing the still-pending loadURL promise.
    await assert.rejects(pending.launch, /pending-launch-aborted/u);
    finishLoad();
    await assert.rejects(async () => commitAbortTestLease(pending, lease), /invalidated|unbound|stale/u);
    assert.equal(pending.window.isDestroyed(), true);
    assert.equal(host.hasActiveInstances(), false);
  } finally { finishLoad(); await host.shutdown(); }
});

test('candidate abort fences an in-flight final revalidation and releases only its own shared materialization hold', { timeout: 3000 }, async () => {
  let revalidations = 0;
  let enter!: () => void;
  let finish!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const gate = new Promise<void>(resolve => { finish = resolve; });
  let registrations = 0;
  const host = await createBundledAvatarHostForLifecycleTest({
    revalidateCurrentAvatarHostTarget: async ref => ref,
    onRegisterReadableFile: () => { registrations++; },
    revalidateFormalPresentationForMaterialization: async () => { if (++revalidations === 4) { enter(); await gate; } },
  });
  const old = await launchBundledAvatarHostForLifecycleTest(host, 'abort-shared-old');
  const target = `avatar_target_${'g'.repeat(43)}`;
  try {
    const intent = await host.hostHandoff({ sourceApp: 'nimi.desktop', avatarHostTargetRef: target,
      request: { command: 'launch', target: { agentHandle: SOURCE_APP_AGENT_HANDLE, conversationAnchorId: null,
        avatarInstanceId: null, launchSource: 'desktop-test', switchIntentRef: null, committedPresentationRef: null, temporaryCustodyRef: null } } });
    const pending = await pendingAvatarForAbortTest(host, 'abort-shared-pending', target, intent.switchIntentRef);
    const lease = await resolveAbortTestLease(pending);
    assert.deepEqual(await avatarWindowCall(host, old, 'nimi_avatar_release_materialization_lease', { materializationLeaseRef: lease.materializationLeaseRef }), { accepted: false });
    const commit = assert.rejects(async () => commitAbortTestLease(pending, lease), /materialization-binding-stale/u);
    await entered;
    assert.deepEqual(await pending.call('nimi_avatar_abort_pending_launch', pending.binding), { accepted: true });
    await assert.rejects(pending.launch, /pending-launch-aborted/u);
    finish(); await commit;
    const beforeReuse = registrations;
    const reused = await avatarWindowCall(host, old, 'nimi_avatar_resolve_agent_center_avatar_asset', { payload: {
      agentHandle: AGENT_HANDLE, avatarAssetRef: AVATAR_ASSET_REF, backendKind: 'vrm', presentationRevision: 'revision-current',
    } }) as { materializationLeaseRef: string };
    assert.equal(registrations, beforeReuse, 'a double release would drop the old active materialization');
    assert.deepEqual(await avatarWindowCall(host, old, 'nimi_avatar_release_materialization_lease', { materializationLeaseRef: reused.materializationLeaseRef }), { accepted: true });
    assert.equal(old.isVisible(), true);
    assert.equal(old.isDestroyed(), false);
  } finally { finish(); await host.shutdown(); }
});

test('pre-ready binding refresh survives the old scope commit and ignores its late abort', { timeout: 3000 }, async () => {
  let count = 0;
  let enter!: () => void;
  let finish!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const nextAgent = `agent_ref_${'h'.repeat(43)}`;
  const host = await createBundledAvatarHostForLifecycleTest({
    resolveFormalAvatarHostTarget: async () => `avatar_target_${'g'.repeat(43)}`,
    revalidateFormalPresentationForMaterialization: async () => { if (++count === 2) { enter(); await gate; } },
  });
  try {
    const pending = await pendingAvatarForAbortTest(host, 'abort-pre-ready-refresh');
    const lease = await resolveAbortTestLease(pending);
    const commit = assert.rejects(async () => commitAbortTestLease(pending, lease), /materialization-binding-stale/u);
    await entered;
    assert.deepEqual(await pending.call('nimi_avatar_refresh_host_binding', { ...pending.binding, agentHandle: nextAgent }), { accepted: true });
    assert.deepEqual(await pending.call('nimi_avatar_abort_pending_launch', pending.binding), { accepted: false });
    finish(); await commit;
    assert.equal(pending.window.isDestroyed(), false);
    await commitAbortTestLease(pending, await resolveAbortTestLease(pending, nextAgent));
    await pending.launch;
    assert.equal(pending.window.isVisible(), true);
  } finally { finish(); await host.shutdown(); }
});

test('binding refresh after ready cannot promote the old binding while URL load is pending', { timeout: 2000 }, async t => {
  const { BrowserWindow } = await import('electron');
  let finishLoad!: () => void;
  const gate = new Promise<void>(resolve => { finishLoad = resolve; });
  t.mock.method(BrowserWindow.prototype, 'loadURL', async () => { await gate; });
  const host = await createBundledAvatarHostForLifecycleTest({ resolveFormalAvatarHostTarget: async () => `avatar_target_${'g'.repeat(43)}` });
  try {
    const pending = await pendingAvatarForAbortTest(host, 'abort-ready-refresh');
    await commitAbortTestLease(pending, await resolveAbortTestLease(pending));
    await assert.rejects(async () => pending.call('nimi_avatar_refresh_host_binding', { ...pending.binding, agentHandle: `agent_ref_${'h'.repeat(43)}` }), /binding-changed-after-ready/u);
    await assert.rejects(pending.launch, /binding-changed-after-ready/u);
    assert.equal(host.hasActiveInstances(), false);
  } finally { finishLoad(); await host.shutdown(); }
});

for (const failure of ['preload', 'closed'] as const) test(`${failure} interrupts a still-loading candidate without awaiting readiness timeout`, { timeout: 2000 }, async t => {
  const { BrowserWindow } = await import('electron');
  let finishLoad!: () => void;
  const gate = new Promise<void>(resolve => { finishLoad = resolve; });
  t.mock.method(BrowserWindow.prototype, 'loadURL', async () => { await gate; });
  const host = await createBundledAvatarHostForLifecycleTest();
  try {
    const pending = await pendingAvatarForAbortTest(host, `abort-${failure}`);
    if (failure === 'closed') pending.window.destroy();
    else (pending.window as unknown as { emitWebContents: (event: string, ...args: unknown[]) => void }).emitWebContents('preload-error', {}, '/test/preload.js', new Error('test loader error'));
    await assert.rejects(pending.launch, failure === 'closed' ? /candidate-closed/u : /candidate-preload-failed/u);
    assert.equal(pending.window.isDestroyed(), true);
    assert.equal(host.hasActiveInstances(), false);
    assert.deepEqual(await pending.call('nimi_avatar_abort_pending_launch', pending.binding), { accepted: false });
  } finally { finishLoad(); await host.shutdown(); }
});

test('readiness timeout permanently fences the candidate and its late ready commit', { timeout: 2000 }, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const host = await createBundledAvatarHostForLifecycleTest();
  try {
    const pending = await pendingAvatarForAbortTest(host, 'abort-timeout');
    const lease = await resolveAbortTestLease(pending);
    t.mock.timers.tick(15_000);
    await assert.rejects(pending.launch, /candidate-presentation-timeout/u);
    await assert.rejects(async () => commitAbortTestLease(pending, lease), /invalidated|unbound|stale/u);
    assert.equal(pending.window.isDestroyed(), true);
    assert.equal(host.hasActiveInstances(), false);
  } finally { await host.shutdown(); }
});

test('Host closing intent precedes exact sender invalidation and is delivered only once', async () => {
  const host = await createBundledAvatarHostForLifecycleTest();
  const window = await launchBundledAvatarHostForLifecycleTest(host, 'instance-closing-intent');
  const notifications: unknown[] = [];
  const order: string[] = [];
  const send = window.webContents.send.bind(window.webContents);
  window.webContents.send = (channel: string, ...args: unknown[]) => {
    if (channel === 'nimi:runtime:event:avatar://host-closing') {
      notifications.push(args[0]);
      order.push('closing');
    }
    send(channel, ...args);
  };
  host.runtimeBridgeHost.subscribeSenderInvalidation((sender) => {
    assert.equal(sender, window.webContents);
    order.push('invalidated');
  });
  try {
    const close = host.runtimeBridgeHost.standardShellHost?.floatingWindow?.close;
    assert.ok(close);
    await close({}, { event: { sender: window.webContents, senderFrame: window.webContents.mainFrame } } as never);
    assert.equal(window.isDestroyed(), true);
    assert.deepEqual(order, ['closing', 'invalidated']);
    assert.deepEqual(notifications, [{}]);
    await host.shutdown();
    assert.deepEqual(order, ['closing', 'invalidated']);
  } finally { await host.shutdown(); }
});

for (const exit of ['quit', 'shutdown', 'native-close'] as const) {
  test(`Host closing intent precedes ${exit} cleanup without waiting for a renderer response`, async () => {
    const host = await createBundledAvatarHostForLifecycleTest();
    const window = await launchBundledAvatarHostForLifecycleTest(host, `closing-${exit}`);
    const messages = observeHostClosing(window);
    let invalidations = 0;
    host.runtimeBridgeHost.subscribeSenderInvalidation((sender) => {
      assert.equal(sender, window.webContents);
      assert.deepEqual(messages, [{}]);
      invalidations += 1;
    });
    try {
      if (exit === 'quit') {
        assert.deepEqual(await avatarWindowCall(host, window, 'nimi_avatar_quit_app', {}), { accepted: true });
        await new Promise<void>((resolve) => setImmediate(resolve));
      } else if (exit === 'shutdown') {
        await host.shutdown();
      } else {
        window.close();
      }
      assert.equal(window.isDestroyed(), true);
      assert.deepEqual(messages, [{}]);
      assert.equal(invalidations, 1);
      await host.shutdown();
      assert.deepEqual(messages, [{}]);
      assert.equal(invalidations, 1);
    } finally { await host.shutdown(); }
  });
}

test('failed Host closing notification does not delay sender revocation or window destruction', async () => {
  const host = await createBundledAvatarHostForLifecycleTest();
  const window = await launchBundledAvatarHostForLifecycleTest(host, 'closing-send-failed');
  const attempted = observeHostClosing(window, () => { throw new Error('sender-delivery-failed'); });
  let invalidations = 0;
  host.runtimeBridgeHost.subscribeSenderInvalidation(() => {
    invalidations += 1;
    assert.equal(host.runtimeBridgeHost.authorizeSender({ sender: window.webContents, senderFrame: window.webContents.mainFrame } as never), false);
  });
  try {
    const close = host.runtimeBridgeHost.standardShellHost?.floatingWindow?.close;
    assert.ok(close);
    await close({}, { event: { sender: window.webContents, senderFrame: window.webContents.mainFrame } } as never);
    assert.deepEqual(attempted, [{}]);
    assert.equal(invalidations, 1);
    assert.equal(window.isDestroyed(), true);
    await host.shutdown();
    assert.deepEqual(attempted, [{}]);
  } finally { await host.shutdown(); }
});

test('an already destroyed Avatar sender is revoked without a closing notification', async () => {
  const host = await createBundledAvatarHostForLifecycleTest();
  const window = await launchBundledAvatarHostForLifecycleTest(host, 'closing-already-destroyed');
  const messages = observeHostClosing(window);
  let invalidations = 0;
  host.runtimeBridgeHost.subscribeSenderInvalidation(() => { invalidations += 1; });
  window.destroy();
  await host.shutdown();
  assert.deepEqual(messages, []);
  assert.equal(invalidations, 1);
});

test('discarding a pending Avatar notifies only that candidate and leaves the active sender running', async () => {
  const host = await createBundledAvatarHostForLifecycleTest({ revalidateCurrentAvatarHostTarget: async (ref) => ref });
  const old = await launchBundledAvatarHostForLifecycleTest(host, 'closing-scope-old');
  const oldMessages = observeHostClosing(old);
  const target = `avatar_target_${'g'.repeat(43)}`;
  try {
    const intent = await host.hostHandoff({ sourceApp: 'nimi.desktop', avatarHostTargetRef: target,
      request: { command: 'launch', target: { agentHandle: SOURCE_APP_AGENT_HANDLE, conversationAnchorId: null,
        avatarInstanceId: null, launchSource: 'desktop-test', switchIntentRef: null, committedPresentationRef: null, temporaryCustodyRef: null } } });
    const pending = await pendingAvatarForAbortTest(host, 'closing-scope-pending', target, intent.switchIntentRef);
    const pendingMessages = observeHostClosing(pending.window);
    assert.deepEqual(await pending.call('nimi_avatar_abort_pending_launch', pending.binding), { accepted: true });
    await assert.rejects(pending.launch, /pending-launch-aborted/u);
    assert.deepEqual(pendingMessages, [{}]);
    assert.deepEqual(oldMessages, []);
    assert.equal(old.isDestroyed(), false);
    assert.equal(old.isVisible(), true);
    assert.equal(host.runtimeBridgeHost.authorizeSender({ sender: old.webContents, senderFrame: old.webContents.mainFrame } as never), true);
  } finally { await host.shutdown(); }
});

function observeHostClosing(window: import('electron').BrowserWindow, onClosing?: () => void): unknown[] {
  const messages: unknown[] = [];
  const send = window.webContents.send.bind(window.webContents);
  window.webContents.send = (channel: string, ...args: unknown[]) => {
    if (channel === 'nimi:runtime:event:avatar://host-closing') {
      messages.push(args[0]);
      onClosing?.();
    }
    send(channel, ...args);
  };
  return messages;
}

test('Stop Companion destroys its window when sender invalidation rejects', async () => {
  const host = await createBundledAvatarHostForLifecycleTest();
  const window = await launchBundledAvatarHostForLifecycleTest(host, 'instance-stop-cleanup-rejects');
  host.runtimeBridgeHost.subscribeSenderInvalidation(() => Promise.reject(
    new Error('formal-scope-cleanup-rejected'),
  ));
  const close = host.runtimeBridgeHost.standardShellHost?.floatingWindow?.close;
  assert.ok(close);
  await close({}, {
    event: {
      sender: window.webContents,
      senderFrame: window.webContents.mainFrame,
    },
  } as never);
  assert.equal(window.isDestroyed(), true);
  await host.shutdown();
});

test('Stop Companion detaches the old window before cleanup so one launch can replace it', async () => {
  const host = await createBundledAvatarHostForLifecycleTest();
  const oldWindow = await launchBundledAvatarHostForLifecycleTest(host, 'instance-stop-race-old');
  let finishCleanup!: () => void;
  const cleanup = new Promise<void>((resolve) => { finishCleanup = resolve; });
  host.runtimeBridgeHost.subscribeSenderInvalidation(() => cleanup);
  const close = host.runtimeBridgeHost.standardShellHost?.floatingWindow?.close;
  assert.ok(close);
  const pendingClose = close({}, {
    event: {
      sender: oldWindow.webContents,
      senderFrame: oldWindow.webContents.mainFrame,
    },
  } as never);
  assert.equal(oldWindow.isVisible(), false);
  assert.equal(host.hasActiveInstances(), false);

  const replacement = await launchBundledAvatarHostForLifecycleTest(
    host,
    'instance-stop-race-replacement',
  );
  assert.equal(replacement.isVisible(), true);
  assert.equal(replacement.isDestroyed(), false);
  finishCleanup();
  await pendingClose;
  assert.equal(oldWindow.isDestroyed(), true);
  assert.equal(replacement.isDestroyed(), false);
  assert.equal(host.hasActiveInstances(), true);
  await host.shutdown();
});

test('Quit Avatar App destroys all windows when sender invalidation never resolves', async () => {
  const host = await createBundledAvatarHostForLifecycleTest();
  const window = await launchBundledAvatarHostForLifecycleTest(host, 'instance-quit-cleanup-pending');
  host.runtimeBridgeHost.subscribeSenderInvalidation(() => new Promise<void>(() => {}));
  const quit = host.runtimeBridgeHost.commandHandlers?.nimi_avatar_quit_app;
  assert.ok(quit);
  const result = await quit({
    command: 'nimi_avatar_quit_app',
    payload: {},
    event: {
      sender: window.webContents,
      senderFrame: window.webContents.mainFrame,
    },
    appId: 'nimi.avatar',
    runtimeEndpoint: 'protected-test',
    sendEvent() {},
  });
  assert.deepEqual(result, { accepted: true });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(window.isDestroyed(), true);
  await host.shutdown();
});

test('bundled Avatar sender authorization covers Host-owned pending candidates exactly', () => {
  const activeMainFrame = { url: 'http://127.0.0.1:1427/' };
  const pendingMainFrame = { url: 'http://127.0.0.1:1427/' };
  const activeSender = { isDestroyed: () => false, mainFrame: activeMainFrame };
  const pendingSender = { isDestroyed: () => false, mainFrame: pendingMainFrame };
  const records = [
    { window: { isDestroyed: () => false, webContents: activeSender } },
    { window: { isDestroyed: () => false, webContents: pendingSender } },
  ] as never;

  assert.equal(desktopAvatarHostSenderAuthorized(records, {
    sender: activeSender,
    senderFrame: activeMainFrame,
  } as never), true);
  assert.equal(desktopAvatarHostSenderAuthorized(records, {
    sender: pendingSender,
    senderFrame: pendingMainFrame,
  } as never), true);
  const invalidatedSenders = new WeakSet<object>([pendingSender]);
  assert.equal(desktopAvatarHostSenderAuthorized(records, {
    sender: pendingSender,
    senderFrame: pendingMainFrame,
  } as never, invalidatedSenders), false);
  assert.equal(desktopAvatarHostSenderAuthorized(records, {
    sender: pendingSender,
    senderFrame: { url: pendingMainFrame.url },
  } as never), false);
  assert.equal(desktopAvatarHostSenderAuthorized(records, {
    sender: { isDestroyed: () => false, mainFrame: pendingMainFrame },
    senderFrame: pendingMainFrame,
  } as never), false);
});

test('removed-display recovery identifies the owning display and uses a bounded primary default', () => {
  const removed = { x: 1920, y: 0, width: 1920, height: 1080 };
  const primary = { x: 0, y: 0, width: 1920, height: 1040 };
  const windowBounds = { x: 3300, y: 500, width: 420, height: 680 };
  assert.equal(
    desktopAvatarWindowWasOnRemovedDisplay(windowBounds, removed, [primary]),
    true,
  );
  assert.deepEqual(
    desktopAvatarPrimaryFallbackBounds(windowBounds, primary),
    { x: 1500, y: 360, width: 420, height: 680 },
  );
  assert.equal(
    desktopAvatarWindowWasOnRemovedDisplay(
      { x: 100, y: 100, width: 420, height: 680 },
      removed,
      [primary],
    ),
    false,
  );
});

test('preview capture binding fails closed after exact window binding becomes stale', () => {
  let destroyed = false;
  const webContents = { isDestroyed: () => destroyed };
  const window = { isDestroyed: () => destroyed, webContents };
  const mutableRecord = {
    window,
    sender: webContents,
    avatarHostTargetRef: `avatar_target_${'a'.repeat(43)}`,
    launchContext: {
      agentHandle: `agent_ref_${'b'.repeat(43)}`,
      conversationAnchorId: 'anchor-current',
      avatarInstanceId: 'avatar-instance-current',
      launchSource: 'desktop',
    },
    activePresentation: {
      avatarAssetRef: AVATAR_ASSET_REF,
      backendKind: 'vrm',
      presentationRevision: 'revision-current',
      materializationRef: MATERIALIZATION_REF,
    },
    previewEpoch: 4,
  };
  const record = mutableRecord as never;
  const windows = new Map([['avatar-instance-current', record]]) as never;
  const binding = snapshotDesktopAvatarPreviewWindowBinding(record);
  assert.equal(desktopAvatarPreviewWindowBindingMatches(record, binding, windows), true);
  assert.equal(desktopAvatarPreviewRequestMatchesActivePresentation(record, binding, {
    avatarAssetRef: AVATAR_ASSET_REF,
    backendKind: 'vrm',
    presentationRevision: 'revision-current',
  }), true);
  mutableRecord.activePresentation = {
    ...mutableRecord.activePresentation,
    presentationRevision: 'revision-replaced',
  };
  assert.equal(desktopAvatarPreviewWindowBindingMatches(record, binding, windows), true);
  assert.equal(desktopAvatarPreviewRequestMatchesActivePresentation(record, binding, {
    avatarAssetRef: AVATAR_ASSET_REF,
    backendKind: 'vrm',
    presentationRevision: 'revision-current',
  }), false);
  mutableRecord.activePresentation = {
    ...mutableRecord.activePresentation,
    presentationRevision: 'revision-current',
  };
  mutableRecord.previewEpoch += 1;
  assert.equal(desktopAvatarPreviewWindowBindingMatches(record, binding, windows), false);
  mutableRecord.previewEpoch -= 1;
  mutableRecord.launchContext = { ...mutableRecord.launchContext, conversationAnchorId: 'anchor-rebound' };
  assert.equal(desktopAvatarPreviewWindowBindingMatches(record, binding, windows), false);
  mutableRecord.launchContext = { ...mutableRecord.launchContext, conversationAnchorId: 'anchor-current' };
  destroyed = true;
  assert.equal(desktopAvatarPreviewWindowBindingMatches(record, binding, windows), false);
});

test('preview ready result is bound to the active Host materialization', () => {
  const request = {
    requestId: 'preview-request',
    conversationAnchorId: 'anchor-current',
    avatarAssetRef: AVATAR_ASSET_REF,
    backendKind: 'vrm',
    presentationRevision: 'revision-current',
  } as const;
  const ready = {
    state: 'ready',
    tier: 'avatar_preview_service',
    avatarAssetRef: AVATAR_ASSET_REF,
    backendKind: 'vrm',
    previewMaterialRef: MATERIALIZATION_REF,
    previewImageRef: '/__nimi/avatar-preview/preview-request.png',
    warnings: [],
  } as const;
  assert.equal(
    parseAvatarPreviewProjectionResult(ready, request, MATERIALIZATION_REF).state,
    'ready',
  );
  assert.throws(
    () => parseAvatarPreviewProjectionResult(
      ready,
      request,
      `avatar-materialization:vrm:vrm_${'e'.repeat(12)}`,
    ),
    /does not match the active materialization/u,
  );
});

test('materialization commit accepts only one exact internally consistent presentation tuple', () => {
  const exact = {
    materializationLeaseRef: MATERIALIZATION_LEASE_REF,
    avatarAssetRef: AVATAR_ASSET_REF,
    backendKind: 'vrm',
    presentationRevision: 'revision-current',
    materializationRef: MATERIALIZATION_REF,
  } as const;
  assert.deepEqual(parseDesktopAvatarMaterializationCommit(exact), exact);
  assert.throws(
    () => parseDesktopAvatarMaterializationCommit({ ...exact, extra: true }),
    /keys are invalid/u,
  );
  assert.throws(
    () => parseDesktopAvatarMaterializationCommit({
      ...exact,
      backendKind: 'live2d',
    }),
    /tuple is inconsistent/u,
  );
  assert.throws(
    () => parseDesktopAvatarMaterializationCommit({
      ...exact,
      presentationRevision: ' revision-current',
    }),
    /presentationRevision is invalid/u,
  );
  assert.throws(
    () => parseDesktopAvatarMaterializationCommit({
      ...exact,
      materializationRef: `avatar-materialization:vrm:vrm_${'e'.repeat(12)}`,
    }),
    /tuple is inconsistent/u,
  );
  const resolve = parseDesktopAvatarMaterializationResolveRequest({
    agentHandle: AGENT_HANDLE,
    avatarAssetRef: AVATAR_ASSET_REF,
    backendKind: 'vrm',
    presentationRevision: 'revision-current',
  });
  assert.equal(resolve.presentationRevision, 'revision-current');
  assert.equal(desktopAvatarMaterializationCommitMatchesCandidate({
    ...resolve,
    materializationRef: MATERIALIZATION_REF,
  }, exact), true);
  assert.equal(desktopAvatarMaterializationCommitMatchesCandidate({
    ...resolve,
    presentationRevision: 'revision-old',
    materializationRef: MATERIALIZATION_REF,
  }, exact), false);
  assert.throws(
    () => parseDesktopAvatarMaterializationResolveRequest({
      agentHandle: AGENT_HANDLE,
      avatarAssetRef: AVATAR_ASSET_REF,
      backendKind: 'vrm',
    }),
    /keys are invalid/u,
  );
  assert.throws(
    () => parseDesktopAvatarMaterializationResolveRequest({
      agentHandle: AGENT_HANDLE,
      avatarAssetRef: AVATAR_ASSET_REF,
      backendKind: 'vrm',
      presentationRevision: ' revision-current',
    }),
    /presentationRevision is invalid/u,
  );
});

test('Host handoff serial tail orders concurrent confirmations and survives a rejected current fence', async () => {
  let currentTarget = 'A';
  let activeOperations = 0;
  let maxActiveOperations = 0;
  const starts: string[] = [];
  let releaseB: (() => void) | undefined;
  const bGate = new Promise<void>((resolve) => { releaseB = resolve; });
  const expectedCurrent: Readonly<Record<string, string>> = { B: 'A', C: 'A', D: 'B' };
  const perform = async (dispatch: { sourceApp: string }) => {
    const requested = dispatch.sourceApp;
    starts.push(requested);
    activeOperations += 1;
    maxActiveOperations = Math.max(maxActiveOperations, activeOperations);
    try {
      if (currentTarget !== expectedCurrent[requested]) {
        throw new Error('desktop-avatar-switch-intent-invalid');
      }
      if (requested === 'B') await bGate;
      currentTarget = requested;
      return {
        command: 'launch',
        state: 'focused',
        avatarInstanceRef: `instance-${requested}`,
        switchIntentRef: null,
        committedPresentationRef: null,
        temporaryCustodyRef: null,
      } as const;
    } finally {
      activeOperations -= 1;
    }
  };
  const dispatch = createDesktopAvatarHostHandoffSerialDispatcher(perform as never);
  const b = dispatch({ sourceApp: 'B' } as never);
  await Promise.resolve();
  const c = dispatch({ sourceApp: 'C' } as never);
  const d = dispatch({ sourceApp: 'D' } as never);
  assert.deepEqual(starts, ['B']);
  releaseB?.();
  await b;
  await assert.rejects(c, /desktop-avatar-switch-intent-invalid/u);
  await d;
  assert.deepEqual(starts, ['B', 'C', 'D']);
  assert.equal(maxActiveOperations, 1);
  assert.equal(currentTarget, 'D');
});

test('Host handoff shutdown closes enqueue and rejects a late active continuation', async () => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const dispatch = createDesktopAvatarHostHandoffSerialDispatcher(async () => {
    await gate;
    if (dispatch.isClosing()) throw new Error('desktop-bundled-avatar-host-shutting-down');
    return {
      command: 'launch',
      state: 'focused',
      avatarInstanceRef: 'late-instance',
      switchIntentRef: null,
      committedPresentationRef: null,
      temporaryCustodyRef: null,
    };
  });
  const active = dispatch({ sourceApp: 'A' } as never);
  await Promise.resolve();
  await dispatch.closeAndWait(0);
  await assert.rejects(
    dispatch({ sourceApp: 'B' } as never),
    /desktop-bundled-avatar-host-shutting-down/u,
  );
  release?.();
  await assert.rejects(active, /desktop-bundled-avatar-host-shutting-down/u);
});

test('confirmed switch discards a failed hidden candidate without closing the active companion', async () => {
  const events: string[] = [];
  const candidate = { id: 'candidate' };
  await assert.rejects(runDesktopAvatarCandidatePromotion({
    createCandidate: async () => {
      events.push('candidate-created-hidden');
      return candidate;
    },
    waitUntilReady: async () => {
      events.push('candidate-wait');
      throw new Error('candidate-presentation-failed');
    },
    validateCandidate: () => { events.push('candidate-validated'); },
    stageCurrent: () => { events.push('current-staged'); },
    activateCandidate: () => { events.push('candidate-activated'); },
    restoreCurrent: () => { events.push('current-restored'); },
    commitPromotion: () => { events.push('candidate-promoted'); },
    rollbackPromotion: () => { events.push('candidate-rollback'); },
    retireCurrent: async () => { events.push('current-retired'); },
    continueRetiringCurrent: () => { events.push('current-retire-continued'); },
    discardCandidate: async () => { events.push('candidate-discarded'); },
    assertOpen: () => { events.push('host-open'); },
  }), /candidate-presentation-failed/u);
  assert.deepEqual(events, [
    'candidate-created-hidden',
    'candidate-wait',
    'candidate-discarded',
  ]);
});

test('confirmed switch stages old window, atomically promotes candidate, then retires old window', async () => {
  const events: string[] = [];
  const candidate = { id: 'candidate' };
  const promoted = await runDesktopAvatarCandidatePromotion({
    createCandidate: async () => {
      events.push('candidate-created-hidden');
      return candidate;
    },
    waitUntilReady: async () => { events.push('candidate-ready'); },
    validateCandidate: () => { events.push('candidate-validated'); },
    stageCurrent: () => { events.push('current-staged'); },
    activateCandidate: () => { events.push('candidate-activated'); },
    restoreCurrent: () => { events.push('current-restored'); },
    commitPromotion: () => { events.push('candidate-promoted'); },
    rollbackPromotion: () => { events.push('candidate-rollback'); },
    retireCurrent: async () => { events.push('current-retired'); },
    continueRetiringCurrent: () => { events.push('current-retire-continued'); },
    discardCandidate: async () => { events.push('candidate-discarded'); },
    assertOpen: () => { events.push('host-open'); },
  });
  assert.equal(promoted, candidate);
  assert.deepEqual(events, [
    'candidate-created-hidden',
    'candidate-ready',
    'host-open',
    'candidate-validated',
    'current-staged',
    'host-open',
    'candidate-promoted',
    'host-open',
    'candidate-activated',
    'host-open',
    'current-retired',
  ]);
});

test('candidate failure in the no-await promotion section restores old window before discard', async () => {
  const events: string[] = [];
  const candidate = { id: 'candidate' };
  await assert.rejects(runDesktopAvatarCandidatePromotion({
    createCandidate: async () => candidate,
    waitUntilReady: async () => { events.push('candidate-ready'); },
    validateCandidate: () => { events.push('candidate-validated'); },
    stageCurrent: () => { events.push('current-staged'); },
    activateCandidate: () => {
      events.push('candidate-activation-failed');
      throw new Error('candidate-window-gone');
    },
    restoreCurrent: () => { events.push('current-restored'); },
    commitPromotion: () => { events.push('candidate-promoted'); },
    rollbackPromotion: () => { events.push('candidate-rollback'); },
    retireCurrent: async () => { events.push('current-retired'); },
    continueRetiringCurrent: () => { events.push('current-retire-continued'); },
    discardCandidate: async () => { events.push('candidate-discarded'); },
    assertOpen: () => { events.push('host-open'); },
  }), /candidate-window-gone/u);
  assert.deepEqual(events, [
    'candidate-ready',
    'host-open',
    'candidate-validated',
    'current-staged',
    'host-open',
    'candidate-promoted',
    'host-open',
    'candidate-activation-failed',
    'candidate-rollback',
    'current-restored',
    'candidate-discarded',
  ]);
});

test('old-window retirement failure cannot roll back a committed candidate', async () => {
  const events: string[] = [];
  const candidate = { id: 'candidate' };
  const promoted = await runDesktopAvatarCandidatePromotion({
    createCandidate: async () => candidate,
    waitUntilReady: async () => {},
    validateCandidate: () => {},
    stageCurrent: () => { events.push('current-staged'); },
    activateCandidate: () => { events.push('candidate-activated'); },
    restoreCurrent: () => { events.push('current-restored'); },
    commitPromotion: () => { events.push('candidate-promoted'); },
    rollbackPromotion: () => { events.push('candidate-rollback'); },
    retireCurrent: async () => {
      events.push('current-retire-failed');
      throw new Error('sender-cleanup-failed');
    },
    continueRetiringCurrent: () => { events.push('current-retire-continued'); },
    discardCandidate: async () => { events.push('candidate-discarded'); },
    assertOpen: () => {},
  });
  assert.equal(promoted, candidate);
  assert.deepEqual(events, [
    'current-staged',
    'candidate-promoted',
    'candidate-activated',
    'current-retire-failed',
    'current-retire-continued',
  ]);
});

test('materialization commit releases without activation when owner changes during final revalidation', async () => {
  let current = true;
  let finishRevalidation: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { finishRevalidation = resolve; });
  const events: string[] = [];
  const pending = commitDesktopAvatarMaterializationCandidate({
    isCurrent: () => current,
    revalidate: async () => {
      events.push('revalidate-start');
      await gate;
      events.push('revalidate-finish');
    },
    commit: () => { events.push('commit'); },
    release: async () => { events.push('release'); },
    staleReason: 'materialization-stale',
  });
  await Promise.resolve();
  current = false;
  finishRevalidation?.();
  await assert.rejects(pending, /materialization-stale/u);
  assert.deepEqual(events, ['revalidate-start', 'revalidate-finish', 'release']);
});

test('bundled Avatar asset command carries the reminted formal App handle into Host materialization', async () => {
  const source = await readFile(
    new URL('../src-electron/bundled-avatar-host.ts', import.meta.url),
    'utf8',
  );
  const mainSource = await readFile(
    new URL('../src-electron/main.ts', import.meta.url),
    'utf8',
  );

  assert.match(
    source,
    /parseDesktopAvatarMaterializationResolveRequest[\s\S]*requiredAgentHandle\(payload\.agentHandle, 'agentHandle'\)/u,
  );
  assert.match(source, /assetHost\.resolveBoundPresentation/u);
  assert.match(source, /revalidateFormalPresentationForMaterialization/u);
  const formalFence = mainSource.slice(
    mainSource.indexOf('revalidateFormalPresentationForMaterialization:'),
    mainSource.indexOf('resolveFormalAvatarHostTarget:'),
  );
  assert.match(formalFence, /resolveDesktopAvatarFormalPresentation\(localAppHost,[\s\S]*avatarHostTargetRef,[\s\S]*agentHandle,[\s\S]*conversationAnchorId/u);
  assert.match(formalFence, /presentation\.presentationRevision !== presentationRevision[\s\S]*presentation\.avatarAssetRef !== avatarAssetRef[\s\S]*presentation\.backendKind !== backendKind/u);
  assert.match(mainSource, /resolveFormalPresentation:[\s\S]*resolveDesktopAvatarFormalPresentation\(host, request\)/u);
  const formalResolver = source.slice(
    source.indexOf('export async function resolveDesktopAvatarFormalPresentation('),
    source.indexOf('export function desktopAvatarHostSenderAuthorized('),
  );
  assert.match(formalResolver, /resolvedTarget\.avatarHostTargetRef[\s\S]*input\.avatarHostTargetRef/u);
  assert.match(formalResolver, /snapshot\.presentationRevision[\s\S]*profile\.revision[\s\S]*profile\.avatarAssetRef[\s\S]*profile\.backendKind/u);
  assert.ok(
    formalResolver.indexOf('avatarHostTargetResolve') < formalResolver.indexOf('agentPresentationSnapshot'),
  );
  const avatarOnlyLaunch = mainSource.slice(
    mainSource.indexOf('if (AVATAR_ONLY_DEVELOPMENT_MODE)'),
    mainSource.indexOf("app.on('activate'"),
  );
  assert.match(
    avatarOnlyLaunch,
    /avatarHostTargetResolve\(\{\s*agentHandle: selectedAgentHandle,\s*conversationAnchorId,\s*\}\)/u,
  );
  assert.doesNotMatch(source, /GetAgentPresentationAsset|bundledAvatarUnary/u);
  assert.doesNotMatch(source, /privateBinding|localAgentRef|ownerUserId|runtimeSourceRef/u);
  assert.doesNotMatch(source, /resolveSelectedDataRoot/u);
  assert.doesNotMatch(source, /launchInitialAvatar|desktop_avatar_launch_handoff/u);
  assert.match(source, /await assetHost\.close\(\);/u);
  assert.match(source, /releaseRecordMaterialization\(windowRecord\);/u);
  assert.match(source, /pendingMaterializationLeases\.set\(materializationLeaseRef/u);
  assert.match(source, /presentationRevision,\s*materializationRef: resolved\.materializationRef/u);
  assert.match(source, /AVATAR_MATERIALIZATION_COMMIT_COMMAND[\s\S]*parseDesktopAvatarMaterializationCommit[\s\S]*commitDesktopAvatarMaterializationCandidate[\s\S]*record\.activePresentation = activePresentation/u);
  assert.match(source, /agentHandle: request\.agentHandle,[\s\S]*conversationAnchorId: record\.launchContext\.conversationAnchorId/u);
  assert.match(source, /revalidateFormalPresentationForMaterialization\(\{[\s\S]*lease\.binding\.avatarHostTargetRef[\s\S]*lease\.agentHandle[\s\S]*lease\.conversationAnchorId[\s\S]*lease\.presentationRevision/u);
  assert.match(source, /show: false[\s\S]*setAudioMuted\(true\)[\s\S]*setIgnoreMouseEvents\(true/u);
  assert.match(source, /waitForPendingCandidateReady[\s\S]*stageCurrentWindowForPromotion[\s\S]*commitPendingCandidatePromotion[\s\S]*activatePromotedCandidate[\s\S]*closeWindowRecord\(currentRecord\)/u);
  assert.match(source, /createDesktopAvatarHostHandoffSerialDispatcher\(performHostHandoff\)/u);
  const sameTargetBranchStart = source.indexOf(
    '} else if (record.avatarHostTargetRef === avatarHostTargetRef) {',
  );
  assert.ok(sameTargetBranchStart >= 0);
  const sameTargetBranch = source.slice(
    sameTargetBranchStart,
    source.indexOf('    } else {', sameTargetBranchStart),
  );
  assert.match(sameTargetBranch, /record\.avatarHostTargetRef === avatarHostTargetRef/u);
  assert.doesNotMatch(
    sameTargetBranch,
    /rebindWindowRecord|launchContext\s*=|webContents\.send|committedPresentationRef\s*=|temporaryCustodyRef\s*=/u,
  );
  assert.equal(source.match(/avatar:\/\/launch-context-updated/gu)?.length ?? 0, 0);
  const resolveHandler = source.slice(
    source.indexOf(`[NIMI_ELECTRON_BUNDLED_AVATAR_ASSET_RESOLVE_COMMAND]`),
    source.indexOf(`[AVATAR_MATERIALIZATION_COMMIT_COMMAND]`),
  );
  assert.doesNotMatch(resolveHandler, /activePresentation\s*=/u);
  assert.match(
    source,
    /releasePendingMaterializationLease[\s\S]*pendingMaterializationLeases\.delete\(materializationLeaseRef\);[\s\S]*assetHost\.releaseMaterialization\(lease\.materializationRef\)/u,
  );
  assert.match(source, /catch \(error\) \{[\s\S]*releasePendingMaterializationLease\(materializationLeaseRef, lease\)/u);
  assert.match(source, /invalidatePreviewProjection[\s\S]*releasePendingPreviewsForRecord/u);
  assert.match(source, /preservesPendingPreview/u);
  assert.match(source, /desktopAvatarPreviewRequestMatchesActivePresentation/u);
  assert.match(source, /hostHandoff\.closeAndWait\(AVATAR_HOST_HANDOFF_SHUTDOWN_WAIT_MS\)/u);
  assert.match(
    mainSource,
    /operation: 'formal-app-resources', critical: true, abortRemainingOnFailure: false, timeoutMs: DESKTOP_FORMAL_RESOURCE_SHUTDOWN_TIMEOUT_MS, run: \(\) => runtimeBridge\?\.disposeFormalAppResources/u,
  );
  assert.match(mainSource, /if \(!report\.criticalCleanupComplete\)\s*\{\s*throw new DesktopShutdownBlockedError\(report\)/u);
  assert.doesNotMatch(mainSource, /await runtimeBridge\?\.disposeFormalAppResources/u);
  assert.match(source, /AVATAR_MATERIALIZATION_RELEASE_COMMAND[\s\S]*assetHost\.releaseMaterialization\(lease\.materializationRef\)/u);
  assert.match(source, /powerMonitor\.on\('suspend', handleHostSuspend\)/u);
  assert.match(source, /powerMonitor\.on\('lock-screen', handleHostSuspend\)/u);
  assert.match(source, /handleHostResume[\s\S]*constrainAllWindows\(\);[\s\S]*handleHostSuspend\(\);/u);
  assert.match(source, /powerMonitor\.removeListener\('lock-screen', handleHostSuspend\)/u);
  assert.match(
    source,
    /if \(!initialNavigationComplete\) return;\s+event\.preventDefault\(\);\s+invalidate\(\);\s+if \(!window\.isDestroyed\(\)\) window\.close\(\);/u,
  );
});
