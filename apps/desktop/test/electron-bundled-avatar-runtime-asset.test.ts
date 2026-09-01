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
      this.listeners = new Map();
      const mainFrame = { url: 'file:///avatar/index.html' };
      this.webContents = {
        mainFrame,
        isDestroyed: () => this.destroyed,
        setWindowOpenHandler() {},
        once: (event, listener) => this.onceWebContents(event, listener),
        on: () => {},
        send: (event) => browserWindowOps.push(['event', event]),
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
  snapshotDesktopAvatarPreviewWindowBinding,
} = await import('../src-electron/bundled-avatar-host.js');

const AGENT_HANDLE = `agent_ref_${'b'.repeat(43)}`;
const AVATAR_ASSET_REF = `vrm_${'c'.repeat(12)}`;
const MATERIALIZATION_REF = `avatar-materialization:vrm:${AVATAR_ASSET_REF}`;
const MATERIALIZATION_LEASE_REF = `avatar_materialization_lease_${'d'.repeat(32)}`;

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
  resolveFormalAvatarHostTarget?: (input: Readonly<{
    agentHandle: string;
    conversationAnchorId: string;
  }>) => Promise<string>;
  revalidateFormalPresentationForMaterialization?: () => Promise<void>;
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
    async revalidateCurrentAvatarHostTarget() { throw new Error('not-used'); },
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
  while (electron.BrowserWindow.instances.length === existingWindowCount) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  const window = electron.BrowserWindow.instances.at(-1);
  assert.ok(window);
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
  const host = await createBundledAvatarHostForLifecycleTest();
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
  await host.shutdown();
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
    mainSource.indexOf('resolveFormalPresentationAsset:'),
  );
  assert.match(formalFence, /avatarHostTargetResolve/u);
  assert.match(formalFence, /resolvedTarget\.avatarHostTargetRef[\s\S]*avatarHostTargetRef/u);
  assert.match(formalFence, /agentPresentationSnapshot/u);
  assert.match(formalFence, /snapshot\.presentationRevision[\s\S]*profile\.revision[\s\S]*profile\.avatarAssetRef[\s\S]*profile\.backendKind/u);
  assert.ok(
    formalFence.indexOf('avatarHostTargetResolve') < formalFence.indexOf('agentPresentationSnapshot'),
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
    /Promise\.allSettled\(\[\s*boundDesktopShutdownCleanup\([\s\S]*disposeFormalAppResources[\s\S]*DESKTOP_FORMAL_RESOURCE_SHUTDOWN_TIMEOUT_MS/u,
  );
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
