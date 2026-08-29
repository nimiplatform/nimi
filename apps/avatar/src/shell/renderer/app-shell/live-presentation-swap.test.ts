import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NimiLocalAppAgentHandle, NimiLocalAppClient } from '@nimiplatform/sdk/app';
import type { AvatarDebugFacade } from '../avatar-debug/contract.js';
import type { AvatarRuntimeCarrier } from '../carrier/avatar-carrier.js';
import type { AgentDataDriver } from '../driver/types.js';
import type { AvatarSessionAgentBinding } from './avatar-session-agent-binding.js';
import { useAvatarStore } from './app-store.js';
import {
  AvatarPresentationActivationMismatchError,
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
    shutdown: input.shutdown ?? vi.fn(),
  } as unknown as AvatarRuntimeCarrier;
}

function binding(current: NimiLocalAppAgentHandle = AGENT_HANDLE): AvatarSessionAgentBinding {
  return {
    current: () => current,
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

  it('attaches and exposes the replacement before shutting down the old carrier', async () => {
    const order: string[] = [];
    const oldCarrier = carrier({
      assetRef: OLD_ASSET_REF,
      revision: '7',
      shutdown: () => order.push('old_shutdown'),
    });
    const replacement = carrier({ assetRef: NEW_ASSET_REF, revision: NEW_REVISION });
    let activeCarrier: AvatarRuntimeCarrier | null = oldCarrier;
    const snapshot = vi.fn(async () => ({
      profile: profile(),
      previousProfile: null,
      defaultVoiceReference: '',
      avatarAutoplay: false,
      presentationRevision: NEW_REVISION,
    }));
    const startCarrier = vi.fn(async () => {
      order.push('replacement_attached');
      return replacement;
    });
    const commitReplacement = vi.fn((next: AvatarRuntimeCarrier) => {
      order.push('replacement_exposed');
      activeCarrier = next;
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
        },
      })) as never,
      startCarrier: startCarrier as never,
      createDebugFacade: (() => ({}) as AvatarDebugFacade) as never,
    });

    await swap.activate(request);

    expect(snapshot).toHaveBeenCalledTimes(2);
    expect(startCarrier).toHaveBeenCalledWith(expect.objectContaining({ publishModelState: false }));
    expect(order).toEqual(['replacement_attached', 'replacement_exposed', 'old_shutdown']);
    expect(activeCarrier).toBe(replacement);
    expect(useAvatarStore.getState().model).toEqual({
      modelPath: 'C:/avatar/new',
      modelId: 'new-model',
      loadState: 'loaded',
      error: null,
    });
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

    await expect(swap.activate(request)).rejects.toBeInstanceOf(
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

    await expect(swap.activate(request)).rejects.toBeInstanceOf(
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
});
