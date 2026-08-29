import type { NimiLocalAppClient } from '@nimiplatform/sdk/app';
import { createAvatarDebugFacade } from '../avatar-debug/avatar-debug-facade.js';
import {
  startAvatarRuntimeCarrier,
  type AvatarRuntimeCarrier,
} from '../carrier/avatar-carrier.js';
import { resolveRuntimePresentationAvatarAsset } from '../carrier/model-resolver.js';
import type { AgentDataDriver } from '../driver/types.js';
import type { AvatarDebugFacade } from '../avatar-debug/contract.js';
import type { AvatarSessionAgentBinding } from './avatar-session-agent-binding.js';
import type { AvatarCommittedPresentationActivation } from './app-bootstrap-types.js';
import { useAvatarStore } from './app-store.js';

type ResolvedAvatarAsset = Awaited<ReturnType<typeof resolveRuntimePresentationAvatarAsset>>;

export type AvatarLivePresentationSwap = {
  readonly activate: (input: AvatarCommittedPresentationActivation) => Promise<void>;
};

export class AvatarPresentationActivationMismatchError extends Error {
  readonly reasonCode = 'invalid_manifest' as const;

  constructor(message: string) {
    super(message);
    this.name = 'AvatarPresentationActivationMismatchError';
  }
}

export function isAvatarPresentationActivationMismatchError(
  value: unknown,
): value is AvatarPresentationActivationMismatchError {
  return value instanceof AvatarPresentationActivationMismatchError
    || (Boolean(value)
      && typeof value === 'object'
      && (value as { readonly reasonCode?: unknown }).reasonCode === 'invalid_manifest');
}

export function createAvatarLivePresentationSwap(input: {
  readonly runtime: Pick<NimiLocalAppClient, 'agentConfigure'>;
  readonly agentBinding: AvatarSessionAgentBinding;
  readonly driver: AgentDataDriver;
  readonly getCarrier: () => AvatarRuntimeCarrier | null;
  readonly commitReplacement: (
    carrier: AvatarRuntimeCarrier,
    avatarDebug: AvatarDebugFacade,
  ) => void;
  readonly isClosed: () => boolean;
  readonly resolveAsset?: typeof resolveRuntimePresentationAvatarAsset;
  readonly startCarrier?: typeof startAvatarRuntimeCarrier;
  readonly createDebugFacade?: typeof createAvatarDebugFacade;
}): AvatarLivePresentationSwap {
  const resolveAsset = input.resolveAsset ?? resolveRuntimePresentationAvatarAsset;
  const startCarrier = input.startCarrier ?? startAvatarRuntimeCarrier;
  const createDebugFacade = input.createDebugFacade ?? createAvatarDebugFacade;
  let activationTail: Promise<void> = Promise.resolve();

  const activate = (request: AvatarCommittedPresentationActivation): Promise<void> => {
    const pending = activationTail.then(() => activateOne(request));
    activationTail = pending.catch(() => undefined);
    return pending;
  };

  const activateOne = async (request: AvatarCommittedPresentationActivation): Promise<void> => {
    assertActivationRequest(request);
    if (input.isClosed()) {
      throw new Error('Avatar presentation carrier is already closed.');
    }
    const currentCarrier = input.getCarrier();
    if (!currentCarrier) {
      throw new Error('Avatar presentation carrier is unavailable.');
    }
    if (selectionMatches(currentCarrier, request)) return;

    const profile = await readMatchingPresentation(input.runtime, input.agentBinding, request);
    const resolved = await resolveAsset({
      agentHandle: request.agentHandle,
      presentationProfile: profile,
    });
    assertResolvedAssetMatches(resolved, request);

    const previousModel = { ...useAvatarStore.getState().model };
    let replacement: AvatarRuntimeCarrier | null = null;
    try {
      replacement = await startCarrier({
        driver: input.driver,
        modelManifest: resolved.manifest,
        publishModelState: false,
        committedPresentationSelection: {
          avatarAssetRef: resolved.reference.localAvatarAssetRef,
          backendKind: resolved.reference.backendKind,
          previewMaterialRef: resolved.reference.materializationRef,
          presentationRevision: request.presentationRevision,
        },
      });
      await readMatchingPresentation(input.runtime, input.agentBinding, request);
      if (input.isClosed()) {
        throw new Error('Avatar presentation carrier closed before replacement activation.');
      }
      const store = useAvatarStore.getState();
      store.setModelPath(resolved.manifest.runtimeDir);
      store.setModelLoaded(resolved.manifest.modelId);
      input.commitReplacement(replacement, createDebugFacade(replacement));
      replacement = null;
      currentCarrier.shutdown();
    } catch (error) {
      replacement?.shutdown();
      useAvatarStore.setState({ model: previousModel });
      throw error;
    }
  };

  return Object.freeze({ activate });
}

async function readMatchingPresentation(
  runtime: Pick<NimiLocalAppClient, 'agentConfigure'>,
  agentBinding: AvatarSessionAgentBinding,
  request: AvatarCommittedPresentationActivation,
) {
  if (agentBinding.current() !== request.agentHandle) {
    throw new AvatarPresentationActivationMismatchError(
      'Avatar presentation request does not match the current-session Agent handle.',
    );
  }
  return agentBinding.run(async (agentHandle) => {
    if (agentHandle !== request.agentHandle) {
      throw new AvatarPresentationActivationMismatchError(
        'Avatar presentation request became stale after Agent handle renewal.',
      );
    }
    const snapshot = await runtime.agentConfigure.presentation.snapshot({ agentHandle });
    if (snapshot.presentationRevision !== request.presentationRevision
      || snapshot.profile?.revision !== request.presentationRevision
      || snapshot.profile.avatarAssetRef !== request.avatarAssetRef
      || snapshot.profile.backendKind !== request.backendKind) {
      throw new AvatarPresentationActivationMismatchError(
        'Avatar presentation request does not match the current formal presentation snapshot.',
      );
    }
    return snapshot.profile;
  });
}

function assertActivationRequest(request: AvatarCommittedPresentationActivation): void {
  const agentHandle = normalizeText(request.agentHandle);
  const avatarAssetRef = normalizeText(request.avatarAssetRef);
  const presentationRevision = normalizeText(request.presentationRevision);
  if (!agentHandle || !avatarAssetRef || !presentationRevision
    || (request.backendKind !== 'live2d' && request.backendKind !== 'vrm')) {
    throw new AvatarPresentationActivationMismatchError(
      'Avatar presentation activation request is invalid.',
    );
  }
}

function selectionMatches(
  carrier: AvatarRuntimeCarrier,
  request: AvatarCommittedPresentationActivation,
): boolean {
  const selection = carrier.committedPresentationSelection;
  return selection?.avatarAssetRef === request.avatarAssetRef
    && selection.backendKind === request.backendKind
    && selection.presentationRevision === request.presentationRevision
    && carrier.backend.kind === request.backendKind;
}

function assertResolvedAssetMatches(
  resolved: ResolvedAvatarAsset,
  request: AvatarCommittedPresentationActivation,
): void {
  if (resolved.reference.localAvatarAssetRef !== request.avatarAssetRef
    || resolved.reference.backendKind !== request.backendKind
    || resolved.manifest.kind !== request.backendKind) {
    throw new AvatarPresentationActivationMismatchError(
      'Resolved Avatar presentation material does not match the formal presentation snapshot.',
    );
  }
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
