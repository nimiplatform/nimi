import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NimiLocalAppAgentHandle, NimiLocalAppClient } from '@nimiplatform/sdk/app';
import type { AvatarRuntimeCarrier } from '../carrier/avatar-carrier.js';
import type { AgentDataDriver } from '../driver/types.js';
import type { AvatarSessionAgentBinding } from './avatar-session-agent-binding.js';
import { useAvatarStore } from './app-store.js';
import {
  AvatarPresentationActivationMismatchError,
  AvatarPresentationRollbackUnavailableError,
  createAvatarLivePresentationSwap,
} from './live-presentation-swap.js';

const AGENT_HANDLE = `agent_ref_${'a'.repeat(43)}` as NimiLocalAppAgentHandle;
const OLD_ASSET_REF = 'live2d_aaaaaaaaaaaa';
const NEW_ASSET_REF = 'live2d_bbbbbbbbbbbb';
const NEW_REVISION = '8';
const request = {
  agentHandle: AGENT_HANDLE,
  avatarAssetRef: NEW_ASSET_REF,
  backendKind: 'live2d' as const,
  presentationRevision: NEW_REVISION,
};

function profile(revision = NEW_REVISION) {
  return {
    backendKind: 'live2d' as const,
    avatarAssetRef: NEW_ASSET_REF,
    expressionProfileRef: '',
    idlePreset: '',
    interactionPolicyRef: '',
    defaultVoiceReference: '',
    avatarAutoplay: false,
    backgroundAssetRef: '',
    revision,
  };
}

function carrier(input: {
  readonly assetRef: string;
  readonly revision: string;
  readonly shutdown?: () => void;
  readonly attachRuntimeDriver?: (driver: AgentDataDriver) => Promise<void>;
  readonly detachRuntimeDriver?: () => void;
}): AvatarRuntimeCarrier {
  return {
    model: {
      modelId: `model-${input.assetRef}`,
      kind: 'live2d',
      runtimeDir: `C:/avatar/${input.assetRef}`,
    },
    committedPresentationSelection: {
      avatarAssetRef: input.assetRef,
      backendKind: 'live2d',
      previewMaterialRef: `agent-center-avatar-asset:id_account:id_agent:live2d:${input.assetRef}`,
      presentationRevision: input.revision,
    },
    backend: { kind: 'live2d' },
    attachRuntimeDriver: input.attachRuntimeDriver ?? vi.fn(async () => undefined),
    detachRuntimeDriver: input.detachRuntimeDriver ?? vi.fn(),
    shutdown: input.shutdown ?? vi.fn(),
  } as unknown as AvatarRuntimeCarrier;
}

function binding(current: NimiLocalAppAgentHandle = AGENT_HANDLE): AvatarSessionAgentBinding {
  return {
    current: () => current,
    generation: () => 1,
    refresh: async () => current,
    run: async (operation) => operation(current),
  };
}

function runtime(snapshot: ReturnType<typeof vi.fn>): Pick<NimiLocalAppClient, 'agentConfigure'> {
  return {
    agentConfigure: {
      presentation: { snapshot },
    },
  } as unknown as Pick<NimiLocalAppClient, 'agentConfigure'>;
}

describe('Avatar live presentation swap', () => {
  beforeEach(() => {
    useAvatarStore.setState(useAvatarStore.getInitialState(), true);
    useAvatarStore.getState().setModelPath('C:/avatar/old');
    useAvatarStore.getState().setModelLoaded('old-model');
  });

  it('waits for candidate first-frame readiness before transferring the driver and lease', async () => {
    const order: string[] = [];
    const oldCarrier = carrier({
      assetRef: OLD_ASSET_REF,
      revision: '7',
      detachRuntimeDriver: () => { order.push('old_detached'); },
      shutdown: () => order.push('old_shutdown'),
    });
    const replacement = carrier({
      assetRef: NEW_ASSET_REF,
      revision: NEW_REVISION,
      attachRuntimeDriver: async () => { order.push('replacement_attached'); },
    });
    let activeCarrier: AvatarRuntimeCarrier | null = oldCarrier;
    const snapshot = vi.fn(async () => ({
      profile: profile(),
      previousProfile: null,
      defaultVoiceReference: '',
      avatarAutoplay: false,
      presentationRevision: NEW_REVISION,
    }));
    const startCarrier = vi.fn(async () => {
      order.push('replacement_visual_created');
      return replacement;
    });
    const commitReplacement = vi.fn((next: AvatarRuntimeCarrier | null) => {
      order.push('replacement_exposed');
      activeCarrier = next;
    });
    const commitMaterializationLease = vi.fn(async () => {
      order.push('materialization_committed');
    });
    const swap = createAvatarLivePresentationSwap({
      runtime: runtime(snapshot),
      agentBinding: binding(),
      driver: {} as AgentDataDriver,
      getCarrier: () => activeCarrier,
      commitReplacement,
      isClosed: () => false,
      resolveAsset: vi.fn(async () => ({
        manifest: {
          modelId: 'new-model',
          kind: 'live2d',
          runtimeDir: 'C:/avatar/new',
        },
        reference: {
          localAvatarAssetRef: NEW_ASSET_REF,
          backendKind: 'live2d',
          materializationRef: `agent-center-avatar-asset:id_account:id_agent:live2d:${NEW_ASSET_REF}`,
          materializationLeaseRef: `avatar_materialization_lease_${'b'.repeat(32)}`,
        },
      })) as never,
      startCarrier: startCarrier as never,
      commitMaterializationLease,
      releaseMaterializationLease: vi.fn(),
    });

    await swap.activate(request, async (candidate) => {
      expect(candidate).toBe(replacement);
      order.push('candidate_first_frame_ready');
    });

    expect(snapshot).toHaveBeenCalledTimes(3);
    expect(startCarrier).toHaveBeenCalledWith(expect.objectContaining({ publishModelState: false }));
    expect(order).toEqual([
      'replacement_visual_created',
      'candidate_first_frame_ready',
      'old_detached',
      'replacement_attached',
      'replacement_exposed',
      'materialization_committed',
      'old_shutdown',
    ]);
    expect(activeCarrier).toBe(replacement);
    expect(commitMaterializationLease).toHaveBeenCalledWith({
      materializationLeaseRef: `avatar_materialization_lease_${'b'.repeat(32)}`,
      materializationRef: `agent-center-avatar-asset:id_account:id_agent:live2d:${NEW_ASSET_REF}`,
      avatarAssetRef: NEW_ASSET_REF,
      backendKind: 'live2d',
      presentationRevision: NEW_REVISION,
    });
    expect(useAvatarStore.getState().model).toEqual({
      modelPath: 'C:/avatar/new',
      modelId: 'new-model',
      loadState: 'loaded',
      error: null,
    });
  });

  it('rolls back the replacement and releases only the candidate when Host lease commit fails', async () => {
    const oldShutdown = vi.fn();
    const replacementShutdown = vi.fn();
    const oldCarrier = carrier({ assetRef: OLD_ASSET_REF, revision: '7', shutdown: oldShutdown });
    const replacement = carrier({
      assetRef: NEW_ASSET_REF,
      revision: NEW_REVISION,
      shutdown: replacementShutdown,
    });
    let activeCarrier: AvatarRuntimeCarrier | null = oldCarrier;
    const releaseMaterializationLease = vi.fn(async () => undefined);
    const swap = createAvatarLivePresentationSwap({
      runtime: runtime(vi.fn(async () => ({
        profile: profile(), previousProfile: null, defaultVoiceReference: '',
        avatarAutoplay: false, presentationRevision: NEW_REVISION,
      }))),
      agentBinding: binding(),
      driver: {} as AgentDataDriver,
      getCarrier: () => activeCarrier,
      commitReplacement: (next) => { activeCarrier = next; },
      isClosed: () => false,
      resolveAsset: vi.fn(async () => ({
        manifest: { modelId: 'new-model', kind: 'live2d', runtimeDir: 'C:/avatar/new' },
        reference: {
          localAvatarAssetRef: NEW_ASSET_REF,
          backendKind: 'live2d',
          materializationRef: `agent-center-avatar-asset:id_account:id_agent:live2d:${NEW_ASSET_REF}`,
          materializationLeaseRef: `avatar_materialization_lease_${'c'.repeat(32)}`,
        },
      })) as never,
      startCarrier: vi.fn(async () => replacement) as never,
      commitMaterializationLease: vi.fn(async () => { throw new Error('lease commit failed'); }),
      releaseMaterializationLease,
    });

    await expect(swap.activate(request, async () => undefined)).rejects.toThrow('lease commit failed');
    expect(activeCarrier).toBe(oldCarrier);
    expect(oldShutdown).not.toHaveBeenCalled();
    expect(replacementShutdown).toHaveBeenCalledOnce();
    expect(releaseMaterializationLease).toHaveBeenCalledWith(
      `avatar_materialization_lease_${'c'.repeat(32)}`,
    );
  });

  it('fails closed before formal reads when the request Agent handle is stale', async () => {
    const snapshot = vi.fn();
    const oldCarrier = carrier({ assetRef: OLD_ASSET_REF, revision: '7' });
    const resolveAsset = vi.fn();
    const startCarrier = vi.fn();
    const commitReplacement = vi.fn();
    const swap = createAvatarLivePresentationSwap({
      runtime: runtime(snapshot),
      agentBinding: binding(`agent_ref_${'c'.repeat(43)}` as NimiLocalAppAgentHandle),
      driver: {} as AgentDataDriver,
      getCarrier: () => oldCarrier,
      commitReplacement,
      isClosed: () => false,
      resolveAsset: resolveAsset as never,
      startCarrier: startCarrier as never,
    });

    await expect(swap.activate(request, async () => undefined)).rejects.toBeInstanceOf(
      AvatarPresentationActivationMismatchError,
    );
    expect(snapshot).not.toHaveBeenCalled();
    expect(resolveAsset).not.toHaveBeenCalled();
    expect(startCarrier).not.toHaveBeenCalled();
    expect(commitReplacement).not.toHaveBeenCalled();
  });

  it('fails closed without mutation when the requested revision is not current', async () => {
    const snapshot = vi.fn(async () => ({
      profile: profile('7'),
      previousProfile: null,
      defaultVoiceReference: '',
      avatarAutoplay: false,
      presentationRevision: '7',
    }));
    const oldCarrier = carrier({ assetRef: OLD_ASSET_REF, revision: '7' });
    const resolveAsset = vi.fn();
    const startCarrier = vi.fn();
    const commitReplacement = vi.fn();
    const swap = createAvatarLivePresentationSwap({
      runtime: runtime(snapshot),
      agentBinding: binding(),
      driver: {} as AgentDataDriver,
      getCarrier: () => oldCarrier,
      commitReplacement,
      isClosed: () => false,
      resolveAsset: resolveAsset as never,
      startCarrier: startCarrier as never,
    });

    await expect(swap.activate(request, async () => undefined)).rejects.toBeInstanceOf(
      AvatarPresentationActivationMismatchError,
    );
    expect(resolveAsset).not.toHaveBeenCalled();
    expect(startCarrier).not.toHaveBeenCalled();
    expect(commitReplacement).not.toHaveBeenCalled();
    expect(useAvatarStore.getState().model).toMatchObject({
      modelPath: 'C:/avatar/old',
      modelId: 'old-model',
      loadState: 'loaded',
    });
  });

  it('cancels a staged readiness wait, releases the uncommitted candidate lease, and leaves owner cleanup to retire the active carrier', async () => {
    const oldShutdown = vi.fn();
    const replacementShutdown = vi.fn();
    const oldCarrier = carrier({ assetRef: OLD_ASSET_REF, revision: '7', shutdown: oldShutdown });
    const replacement = carrier({
      assetRef: NEW_ASSET_REF,
      revision: NEW_REVISION,
      shutdown: replacementShutdown,
    });
    let activeCarrier: AvatarRuntimeCarrier | null = oldCarrier;
    let closed = false;
    const candidateStarted = deferred<void>();
    const releaseMaterializationLease = vi.fn(async () => undefined);
    const swap = createAvatarLivePresentationSwap({
      runtime: runtime(vi.fn(async () => ({
        profile: profile(), previousProfile: null, defaultVoiceReference: '',
        avatarAutoplay: false, presentationRevision: NEW_REVISION,
      }))),
      agentBinding: binding(),
      driver: {} as AgentDataDriver,
      getCarrier: () => activeCarrier,
      commitReplacement: (next) => { activeCarrier = next; },
      isClosed: () => closed,
      resolveAsset: vi.fn(async () => ({
        manifest: { modelId: 'new-model', kind: 'live2d', runtimeDir: 'C:/avatar/new' },
        reference: {
          localAvatarAssetRef: NEW_ASSET_REF,
          backendKind: 'live2d',
          materializationRef: `agent-center-avatar-asset:id_account:id_agent:live2d:${NEW_ASSET_REF}`,
          materializationLeaseRef: `avatar_materialization_lease_${'d'.repeat(32)}`,
        },
      })) as never,
      startCarrier: vi.fn(async () => {
        candidateStarted.resolve();
        return replacement;
      }) as never,
      releaseMaterializationLease,
    });

    const activationResult = swap.activate(request, () => new Promise<void>(() => {}))
      .then(() => null, (error: unknown) => error);
    await candidateStarted.promise;
    closed = true;
    await swap.cancelPending();

    expect(await activationResult).toBeInstanceOf(Error);
    expect(activeCarrier).toBe(oldCarrier);
    expect(replacementShutdown).toHaveBeenCalledOnce();
    expect(oldShutdown).not.toHaveBeenCalled();
    expect(releaseMaterializationLease).toHaveBeenCalledWith(
      `avatar_materialization_lease_${'d'.repeat(32)}`,
    );
  });

  it('keeps the Host-render split committed when window cancellation crosses a successful Host commit', async () => {
    const oldShutdown = vi.fn();
    const replacementShutdown = vi.fn();
    const oldCarrier = carrier({ assetRef: OLD_ASSET_REF, revision: '7', shutdown: oldShutdown });
    const replacement = carrier({
      assetRef: NEW_ASSET_REF,
      revision: NEW_REVISION,
      shutdown: replacementShutdown,
    });
    let activeCarrier: AvatarRuntimeCarrier | null = oldCarrier;
    let closed = false;
    const commitStarted = deferred<void>();
    const commitGate = deferred<void>();
    const trackedLeases = new Set<string>();
    const commitReplacement = vi.fn((next: AvatarRuntimeCarrier | null) => {
      activeCarrier = next;
    });
    const swap = createAvatarLivePresentationSwap({
      runtime: runtime(vi.fn(async () => ({
        profile: profile(), previousProfile: null, defaultVoiceReference: '',
        avatarAutoplay: false, presentationRevision: NEW_REVISION,
      }))),
      agentBinding: binding(),
      driver: {} as AgentDataDriver,
      getCarrier: () => activeCarrier,
      commitReplacement,
      isClosed: () => closed,
      resolveAsset: vi.fn(async () => ({
        manifest: { modelId: 'new-model', kind: 'live2d', runtimeDir: 'C:/avatar/new' },
        reference: {
          localAvatarAssetRef: NEW_ASSET_REF,
          backendKind: 'live2d',
          materializationRef: `agent-center-avatar-asset:id_account:id_agent:live2d:${NEW_ASSET_REF}`,
          materializationLeaseRef: `avatar_materialization_lease_${'e'.repeat(32)}`,
        },
      })) as never,
      startCarrier: vi.fn(async () => replacement) as never,
      commitMaterializationLease: vi.fn(async () => {
        commitStarted.resolve();
        await commitGate.promise;
      }),
      releaseMaterializationLease: vi.fn(async () => undefined),
      trackMaterializationLease: (leaseRef) => trackedLeases.add(leaseRef),
      untrackMaterializationLease: (leaseRef) => trackedLeases.delete(leaseRef),
    });

    const activationResult = swap.activate(request, async () => undefined)
      .then(() => null, (error: unknown) => error);
    await commitStarted.promise;
    closed = true;
    const cancellation = swap.cancelPending();
    commitGate.resolve();
    await cancellation;

    expect(await activationResult).toBeNull();
    expect(commitReplacement).toHaveBeenCalledTimes(1);
    expect(activeCarrier).toBe(replacement);
    expect(oldShutdown).toHaveBeenCalledOnce();
    expect(replacementShutdown).not.toHaveBeenCalled();
    expect(trackedLeases).toEqual(new Set([
      `avatar_materialization_lease_${'e'.repeat(32)}`,
    ]));
  });

  it('restores the old carrier when window cancellation crosses a rejected Host commit', async () => {
    const oldAttach = vi.fn(async () => undefined);
    const oldCarrier = carrier({
      assetRef: OLD_ASSET_REF,
      revision: '7',
      attachRuntimeDriver: oldAttach,
    });
    const replacementShutdown = vi.fn();
    const replacement = carrier({
      assetRef: NEW_ASSET_REF,
      revision: NEW_REVISION,
      shutdown: replacementShutdown,
    });
    let activeCarrier: AvatarRuntimeCarrier | null = oldCarrier;
    let closed = false;
    const commitStarted = deferred<void>();
    const commitGate = deferred<void>();
    const commitReplacement = vi.fn((next: AvatarRuntimeCarrier | null) => {
      activeCarrier = next;
    });
    const releaseMaterializationLease = vi.fn(async () => undefined);
    const swap = createAvatarLivePresentationSwap({
      runtime: runtime(vi.fn(async () => ({
        profile: profile(), previousProfile: null, defaultVoiceReference: '',
        avatarAutoplay: false, presentationRevision: NEW_REVISION,
      }))),
      agentBinding: binding(),
      driver: {} as AgentDataDriver,
      getCarrier: () => activeCarrier,
      commitReplacement,
      isClosed: () => closed,
      resolveAsset: vi.fn(async () => ({
        manifest: { modelId: 'new-model', kind: 'live2d', runtimeDir: 'C:/avatar/new' },
        reference: {
          localAvatarAssetRef: NEW_ASSET_REF,
          backendKind: 'live2d',
          materializationRef: `agent-center-avatar-asset:id_account:id_agent:live2d:${NEW_ASSET_REF}`,
          materializationLeaseRef: `avatar_materialization_lease_${'2'.repeat(32)}`,
        },
      })) as never,
      startCarrier: vi.fn(async () => replacement) as never,
      commitMaterializationLease: vi.fn(async () => {
        commitStarted.resolve();
        await commitGate.promise;
        throw new Error('Host commit rejected');
      }),
      releaseMaterializationLease,
    });

    const activationResult = swap.activate(request, async () => undefined)
      .then(() => null, (error: unknown) => error);
    await commitStarted.promise;
    closed = true;
    const cancellation = swap.cancelPending();
    commitGate.resolve();
    await cancellation;

    expect(await activationResult).toEqual(expect.objectContaining({ message: 'Host commit rejected' }));
    expect(commitReplacement).toHaveBeenCalledTimes(2);
    expect(activeCarrier).toBe(oldCarrier);
    expect(oldAttach).toHaveBeenCalledOnce();
    expect(replacementShutdown).toHaveBeenCalledOnce();
    expect(releaseMaterializationLease).toHaveBeenCalledWith(
      `avatar_materialization_lease_${'2'.repeat(32)}`,
    );
  });

  it('does not roll back an accepted Host commit when the Agent binding renews during the commit call', async () => {
    const renewedHandle = `agent_ref_${'f'.repeat(43)}` as NimiLocalAppAgentHandle;
    let currentHandle = AGENT_HANDLE;
    let bindingGeneration = 1;
    const dynamicBinding: AvatarSessionAgentBinding = {
      current: () => currentHandle,
      generation: () => bindingGeneration,
      refresh: async () => currentHandle,
      run: async (operation) => operation(currentHandle),
    };
    const oldAttach = vi.fn(async () => undefined);
    const oldCarrier = carrier({
      assetRef: OLD_ASSET_REF,
      revision: '7',
      attachRuntimeDriver: oldAttach,
    });
    const replacementDetach = vi.fn();
    const replacementShutdown = vi.fn();
    const replacement = carrier({
      assetRef: NEW_ASSET_REF,
      revision: NEW_REVISION,
      detachRuntimeDriver: replacementDetach,
      shutdown: replacementShutdown,
    });
    let activeCarrier: AvatarRuntimeCarrier | null = oldCarrier;
    const commitStarted = deferred<void>();
    const commitGate = deferred<void>();
    const releaseMaterializationLease = vi.fn(async () => undefined);
    const swap = createAvatarLivePresentationSwap({
      runtime: runtime(vi.fn(async () => ({
        profile: profile(), previousProfile: null, defaultVoiceReference: '',
        avatarAutoplay: false, presentationRevision: NEW_REVISION,
      }))),
      agentBinding: dynamicBinding,
      driver: {} as AgentDataDriver,
      getCarrier: () => activeCarrier,
      commitReplacement: (next) => { activeCarrier = next; },
      isClosed: () => false,
      resolveAsset: vi.fn(async () => ({
        manifest: { modelId: 'new-model', kind: 'live2d', runtimeDir: 'C:/avatar/new' },
        reference: {
          localAvatarAssetRef: NEW_ASSET_REF,
          backendKind: 'live2d',
          materializationRef: `agent-center-avatar-asset:id_account:id_agent:live2d:${NEW_ASSET_REF}`,
          materializationLeaseRef: `avatar_materialization_lease_${'f'.repeat(32)}`,
        },
      })) as never,
      startCarrier: vi.fn(async () => replacement) as never,
      commitMaterializationLease: vi.fn(async () => {
        commitStarted.resolve();
        await commitGate.promise;
      }),
      releaseMaterializationLease,
    });

    const activationResult = swap.activate(request, async () => undefined)
      .then(() => null, (error: unknown) => error);
    await commitStarted.promise;
    currentHandle = renewedHandle;
    bindingGeneration += 1;
    commitGate.resolve();

    expect(await activationResult).toBeNull();
    expect(activeCarrier).toBe(replacement);
    expect(oldAttach).not.toHaveBeenCalled();
    expect(replacementDetach).not.toHaveBeenCalled();
    expect(replacementShutdown).not.toHaveBeenCalled();
    expect(releaseMaterializationLease).not.toHaveBeenCalled();
  });

  it('clears the active carrier and surfaces unavailable when old driver restoration fails', async () => {
    const oldShutdown = vi.fn();
    const replacementShutdown = vi.fn();
    const oldCarrier = carrier({
      assetRef: OLD_ASSET_REF,
      revision: '7',
      shutdown: oldShutdown,
      attachRuntimeDriver: vi.fn(async () => { throw new Error('old attach failed'); }),
    });
    const replacement = carrier({
      assetRef: NEW_ASSET_REF,
      revision: NEW_REVISION,
      shutdown: replacementShutdown,
    });
    let activeCarrier: AvatarRuntimeCarrier | null = oldCarrier;
    const releaseMaterializationLease = vi.fn(async () => undefined);
    const swap = createAvatarLivePresentationSwap({
      runtime: runtime(vi.fn(async () => ({
        profile: profile(), previousProfile: null, defaultVoiceReference: '',
        avatarAutoplay: false, presentationRevision: NEW_REVISION,
      }))),
      agentBinding: binding(),
      driver: {} as AgentDataDriver,
      getCarrier: () => activeCarrier,
      commitReplacement: (next) => { activeCarrier = next; },
      isClosed: () => false,
      resolveAsset: vi.fn(async () => ({
        manifest: { modelId: 'new-model', kind: 'live2d', runtimeDir: 'C:/avatar/new' },
        reference: {
          localAvatarAssetRef: NEW_ASSET_REF,
          backendKind: 'live2d',
          materializationRef: `agent-center-avatar-asset:id_account:id_agent:live2d:${NEW_ASSET_REF}`,
          materializationLeaseRef: `avatar_materialization_lease_${'1'.repeat(32)}`,
        },
      })) as never,
      startCarrier: vi.fn(async () => replacement) as never,
      commitMaterializationLease: vi.fn(async () => { throw new Error('lease commit failed'); }),
      releaseMaterializationLease,
    });

    await expect(swap.activate(request, async () => undefined)).rejects.toBeInstanceOf(
      AvatarPresentationRollbackUnavailableError,
    );
    expect(activeCarrier).toBeNull();
    expect(oldShutdown).toHaveBeenCalledOnce();
    expect(replacementShutdown).toHaveBeenCalledOnce();
    expect(useAvatarStore.getState().model).toMatchObject({
      loadState: 'error',
      error: expect.stringContaining('old attach failed'),
    });
    expect(releaseMaterializationLease).toHaveBeenCalledWith(
      `avatar_materialization_lease_${'1'.repeat(32)}`,
    );
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
