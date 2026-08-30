import type { NimiLocalAppClient } from '@nimiplatform/sdk/app';
import {
  startAvatarVisualCarrier,
  type AvatarRuntimeCarrier,
} from '../carrier/avatar-carrier.js';
import {
  commitRuntimePresentationMaterializationLease,
  releaseRuntimePresentationMaterializationLease,
  resolveRuntimePresentationAvatarAsset,
} from '../carrier/model-resolver.js';
import type { AgentDataDriver } from '../driver/types.js';
import type { AvatarSessionAgentBinding } from './avatar-session-agent-binding.js';
import type { AvatarCommittedPresentationActivation } from './app-bootstrap-types.js';
import type { AvatarPresentationReadinessGate } from './app-bootstrap-types.js';
import { useAvatarStore } from './app-store.js';

type ResolvedAvatarAsset = Awaited<ReturnType<typeof resolveRuntimePresentationAvatarAsset>>;

export type AvatarLivePresentationSwap = {
  readonly activate: (
    input: AvatarCommittedPresentationActivation,
    waitForPresentationReady: AvatarPresentationReadinessGate,
  ) => Promise<void>;
  readonly cancelPending: () => Promise<void>;
};

export class AvatarPresentationRollbackUnavailableError extends Error {
  readonly presentationUnavailable = true as const;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AvatarPresentationRollbackUnavailableError';
  }
}

export function isAvatarPresentationRollbackUnavailableError(
  value: unknown,
): value is AvatarPresentationRollbackUnavailableError {
  return value instanceof AvatarPresentationRollbackUnavailableError
    || (Boolean(value)
      && typeof value === 'object'
      && (value as { readonly presentationUnavailable?: unknown }).presentationUnavailable === true);
}

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
  readonly commitReplacement: (carrier: AvatarRuntimeCarrier | null) => void;
  readonly isClosed: () => boolean;
  readonly resolveAsset?: typeof resolveRuntimePresentationAvatarAsset;
  readonly startCarrier?: typeof startAvatarVisualCarrier;
  readonly commitMaterializationLease?: typeof commitRuntimePresentationMaterializationLease;
  readonly releaseMaterializationLease?: typeof releaseRuntimePresentationMaterializationLease;
  readonly trackMaterializationLease?: (materializationLeaseRef: string) => void;
  readonly untrackMaterializationLease?: (materializationLeaseRef: string) => void;
}): AvatarLivePresentationSwap {
  const resolveAsset = input.resolveAsset ?? resolveRuntimePresentationAvatarAsset;
  const startCarrier = input.startCarrier ?? startAvatarVisualCarrier;
  const commitMaterializationLease = input.commitMaterializationLease
    ?? commitRuntimePresentationMaterializationLease;
  const releaseMaterializationLease = input.releaseMaterializationLease
    ?? releaseRuntimePresentationMaterializationLease;
  const trackMaterializationLease = input.trackMaterializationLease ?? (() => {});
  const untrackMaterializationLease = input.untrackMaterializationLease ?? (() => {});
  let activationTail: Promise<void> = Promise.resolve();
  let activeTransaction: ActivationTransaction | null = null;

  const activate = (
    request: AvatarCommittedPresentationActivation,
    waitForPresentationReady: AvatarPresentationReadinessGate,
  ): Promise<void> => {
    const pending = activationTail.then(() => activateOne(request, waitForPresentationReady));
    activationTail = pending.catch(() => undefined);
    return pending;
  };

  const activateOne = async (
    request: AvatarCommittedPresentationActivation,
    waitForPresentationReady: AvatarPresentationReadinessGate,
  ): Promise<void> => {
    const transaction = createActivationTransaction();
    activeTransaction = transaction;
    try {
      assertActivationRequest(request);
      assertTransactionOpen(transaction, input.isClosed);
    } catch (error) {
      if (activeTransaction === transaction) activeTransaction = null;
      throw error;
    }
    const currentCarrier = input.getCarrier();
    if (!currentCarrier) {
      if (activeTransaction === transaction) activeTransaction = null;
      throw new Error('Avatar presentation carrier is unavailable.');
    }
    if (selectionMatches(currentCarrier, request)) {
      if (activeTransaction === transaction) activeTransaction = null;
      return;
    }

    const previousModel = { ...useAvatarStore.getState().model };
    let replacement: AvatarRuntimeCarrier | null = null;
    let resolved: ResolvedAvatarAsset | null = null;
    let replacementCommitted = false;
    let currentDetached = false;
    let replacementAttached = false;
    try {
      const initialOwner = await readMatchingPresentation(
        input.runtime,
        input.agentBinding,
        request,
      );
      assertTransactionOpen(transaction, input.isClosed);
      assertBindingFence(input.agentBinding, request, initialOwner.bindingGeneration);
      resolved = await resolveAsset({
        agentHandle: request.agentHandle,
        presentationRevision: request.presentationRevision,
        presentationProfile: initialOwner.profile,
      });
      trackMaterializationLease(resolved.reference.materializationLeaseRef);
      assertTransactionOpen(transaction, input.isClosed);
      assertBindingFence(input.agentBinding, request, initialOwner.bindingGeneration);
      assertResolvedAssetMatches(resolved, request);
      replacement = await startCarrier({
        modelManifest: resolved.manifest,
        publishModelState: false,
        committedPresentationSelection: {
          avatarAssetRef: resolved.reference.localAvatarAssetRef,
          backendKind: resolved.reference.backendKind,
          previewMaterialRef: resolved.reference.materializationRef,
          presentationRevision: request.presentationRevision,
        },
      });
      assertTransactionOpen(transaction, input.isClosed);
      await waitForReadinessOrCancellation(replacement, waitForPresentationReady, transaction);
      assertTransactionOpen(transaction, input.isClosed);
      let ownerFence = await readMatchingPresentation(input.runtime, input.agentBinding, request);
      assertTransactionOpen(transaction, input.isClosed);
      assertBindingFence(input.agentBinding, request, ownerFence.bindingGeneration);
      currentCarrier.detachRuntimeDriver();
      currentDetached = true;
      assertTransactionOpen(transaction, input.isClosed);
      await replacement.attachRuntimeDriver(input.driver);
      replacementAttached = true;
      assertTransactionOpen(transaction, input.isClosed);
      ownerFence = await readMatchingPresentation(input.runtime, input.agentBinding, request);
      assertTransactionOpen(transaction, input.isClosed);
      assertBindingFence(input.agentBinding, request, ownerFence.bindingGeneration);
      replacementCommitted = true;
      input.commitReplacement(replacement);
      assertTransactionOpen(transaction, input.isClosed);
      assertBindingFence(input.agentBinding, request, ownerFence.bindingGeneration);
      const store = useAvatarStore.getState();
      store.setModelPath(resolved.manifest.runtimeDir);
      store.setModelLoaded(resolved.manifest.modelId);
      assertTransactionOpen(transaction, input.isClosed);
      assertBindingFence(input.agentBinding, request, ownerFence.bindingGeneration);
      await commitMaterializationLease({
        materializationLeaseRef: resolved.reference.materializationLeaseRef,
        materializationRef: resolved.reference.materializationRef,
        avatarAssetRef: request.avatarAssetRef,
        backendKind: request.backendKind,
        presentationRevision: request.presentationRevision,
      });
      // Host commit is the final irreversible boundary. From here onward no
      // owner read, cancellation fence, renderer rollback, or fallible cleanup
      // may turn an accepted materialization back into the prior carrier.
      shutdownCarrierSafely(currentCarrier);
      replacement = null;
      return;
    } catch (error) {
      if (replacementAttached) replacement?.detachRuntimeDriver();
      let restoreError: unknown = null;
      if (currentDetached) {
        try {
          await currentCarrier.attachRuntimeDriver(input.driver);
        } catch (candidateRestoreError) {
          restoreError = candidateRestoreError;
        }
      }

      await releaseTrackedLease(resolved, releaseMaterializationLease, untrackMaterializationLease);

      if (restoreError) {
        input.commitReplacement(null);
        shutdownCarrierSafely(replacement);
        shutdownCarrierSafely(currentCarrier);
        const message = `Avatar presentation rollback could not restore the prior Runtime driver: ${describeError(restoreError)}`;
        useAvatarStore.getState().setModelError(message);
        throw new AvatarPresentationRollbackUnavailableError(message, { cause: error });
      }

      if (replacementCommitted) input.commitReplacement(currentCarrier);
      shutdownCarrierSafely(replacement);
      useAvatarStore.setState({ model: previousModel });
      throw error;
    } finally {
      if (activeTransaction === transaction) activeTransaction = null;
    }
  };

  const cancelPending = async (): Promise<void> => {
    activeTransaction?.cancel();
    await activationTail;
  };

  return Object.freeze({ activate, cancelPending });
}

type ActivationTransaction = Readonly<{
  cancel(): void;
  cancelled(): boolean;
  cancellation: Promise<void>;
}>;

function createActivationTransaction(): ActivationTransaction {
  let isCancelled = false;
  let resolveCancellation = () => {};
  const cancellation = new Promise<void>((resolve) => {
    resolveCancellation = resolve;
  });
  return Object.freeze({
    cancel() {
      if (isCancelled) return;
      isCancelled = true;
      resolveCancellation();
    },
    cancelled: () => isCancelled,
    cancellation,
  });
}

async function waitForReadinessOrCancellation(
  carrier: AvatarRuntimeCarrier,
  waitForPresentationReady: AvatarPresentationReadinessGate,
  transaction: ActivationTransaction,
): Promise<void> {
  const result = await Promise.race([
    waitForPresentationReady(carrier).then(() => 'ready' as const),
    transaction.cancellation.then(() => 'cancelled' as const),
  ]);
  if (result === 'cancelled') {
    throw new Error('Avatar presentation activation was cancelled.');
  }
}

function assertTransactionOpen(
  transaction: ActivationTransaction,
  isClosed: () => boolean,
): void {
  if (transaction.cancelled() || isClosed()) {
    throw new Error('Avatar presentation carrier is already closed.');
  }
}

async function releaseTrackedLease(
  resolved: ResolvedAvatarAsset | null,
  releaseMaterializationLease: typeof releaseRuntimePresentationMaterializationLease,
  untrackMaterializationLease: (materializationLeaseRef: string) => void,
): Promise<boolean> {
  if (!resolved) return true;
  const leaseRef = resolved.reference.materializationLeaseRef;
  try {
    await releaseMaterializationLease(leaseRef);
    untrackMaterializationLease(leaseRef);
    return true;
  } catch {
    // Keep the ref tracked so the window owner cleanup can retry release.
    return false;
  }
}

function shutdownCarrierSafely(carrier: AvatarRuntimeCarrier | null): void {
  if (!carrier) return;
  try {
    carrier.shutdown();
  } catch (error) {
    console.warn(`[avatar:presentation-swap] carrier shutdown failed: ${describeError(error)}`);
  }
}

async function readMatchingPresentation(
  runtime: Pick<NimiLocalAppClient, 'agentConfigure'>,
  agentBinding: AvatarSessionAgentBinding,
  request: AvatarCommittedPresentationActivation,
) {
  const bindingGeneration = agentBinding.generation();
  if (agentBinding.current() !== request.agentHandle) {
    throw new AvatarPresentationActivationMismatchError(
      'Avatar presentation request does not match the current-session Agent handle.',
    );
  }
  const profile = await agentBinding.run(async (agentHandle) => {
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
  assertBindingFence(agentBinding, request, bindingGeneration);
  return { profile, bindingGeneration };
}

function assertBindingFence(
  agentBinding: AvatarSessionAgentBinding,
  request: AvatarCommittedPresentationActivation,
  bindingGeneration: number,
): void {
  if (agentBinding.current() !== request.agentHandle
    || agentBinding.generation() !== bindingGeneration) {
    throw new AvatarPresentationActivationMismatchError(
      'Avatar presentation request became stale after Agent handle renewal.',
    );
  }
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

function describeError(value: unknown): string {
  return value instanceof Error && value.message.trim() ? value.message.trim() : String(value);
}
