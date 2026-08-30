import type { NimiLocalAppClient } from '@nimiplatform/sdk/app';
import { startAvatarRuntimeCarrier } from '../carrier/avatar-carrier.js';
import type { AvatarRuntimeCarrier } from '../carrier/avatar-carrier.js';
import { refreshAvatarHostBinding } from '../bridge/launch-context.js';
import { createDriver, resolveDriverKind } from '../driver/factory.js';
import {
  commitRuntimePresentationMaterializationLease,
  releaseRuntimePresentationMaterializationLease,
  resolveRuntimePresentationAvatarAsset,
} from '../carrier/model-resolver.js';
import type { AgentDataDriver } from '../driver/types.js';
import { ulid } from '../infra/ids.js';
import { startAvatarVoiceCaptureSession, type AvatarVoiceCaptureSession } from '../voice-capture.js';
import type { BootstrapHandle } from './app-bootstrap-types.js';
import { useAvatarStore } from './app-store.js';
import {
  errorMessage,
  installAvatarRuntimeBridge,
  loadSelectedMockScenarioFixture,
  readNormalizedString,
  waitForAvatarLaunchContext,
} from './app-bootstrap-helpers.js';
import {
  firstPartyUnavailableDetail,
  recordDriverStartFailure,
  runFirstPartyStage,
  runFirstPartyStageWithTimeout,
  setRuntimeBindingUnavailable,
} from './app-bootstrap-first-party-diagnostics.js';
import { createAvatarSessionAgentBinding } from './avatar-session-agent-binding.js';
import { getAvatarLocalAppClient } from './avatar-local-app-client.js';
import {
  createAvatarLivePresentationSwap,
  type AvatarLivePresentationSwap,
} from './live-presentation-swap.js';
import { detectDeviceTier } from './device-tier-detector.js';

const AVATAR_FIRST_PARTY_DRIVER_START_TIMEOUT_MS = 12_000;

export type { BootstrapHandle } from './app-bootstrap-types.js';

/**
 * A0 deliberately admits only fixture execution here. A real Avatar session
 * must be opened by the protected Desktop carrier in A1; renderer code must
 * not reconstruct a first-party Runtime identity or request credentials.
 */
export async function bootstrapAvatar(): Promise<BootstrapHandle> {
  detectDeviceTier();
  let driver: AgentDataDriver | null = null;
  let carrier: AvatarRuntimeCarrier | null = null;
  let unsubscribeStatus = () => {};
  let unsubscribeBundle = () => {};
  let activeVoiceCapture: AvatarVoiceCaptureSession | null = null;
  let pendingMaterializationLeaseRef: string | null = null;
  const ownedMaterializationLeaseRefs = new Set<string>();
  let initialMaterializationCommit: Promise<void> | null = null;
  let presentationSwap: AvatarLivePresentationSwap | null = null;
  let cleanedUp = false;
  let getVoiceInputAvailability: BootstrapHandle['getVoiceInputAvailability'] = async () => ({
    available: false,
    reason: 'Foreground voice requires a protected Desktop launch session.',
  });
  let startVoiceCapture: BootstrapHandle['startVoiceCapture'] = async () => {
    throw new Error('Foreground voice requires a protected Desktop launch session');
  };
  let submitVoiceCaptureTurn: BootstrapHandle['submitVoiceCaptureTurn'] = async () => {
    throw new Error('Foreground voice requires a protected Desktop launch session');
  };
  let interruptConversationTurn: BootstrapHandle['interruptConversationTurn'] = async () => {
    throw new Error('Foreground voice requires a protected Desktop launch session');
  };
  let sendConversationText: BootstrapHandle['sendConversationText'] = async () => {
    throw new Error('avatar companion input requires a protected Desktop launch session');
  };
  let activateCommittedPresentation: BootstrapHandle['activateCommittedPresentation'] = async () => {
    throw new Error('Avatar live presentation replacement requires an active formal App session.');
  };
  let commitInitialPresentation: BootstrapHandle['commitInitialPresentation'] = async () => {};
  const cleanup = async () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    unsubscribeStatus();
    unsubscribeBundle();
    activeVoiceCapture?.cancel();
    activeVoiceCapture = null;
    await presentationSwap?.cancelPending();
    presentationSwap = null;
    carrier?.shutdown();
    carrier = null;
    if (driver) {
      await driver.stop().catch(() => {});
    }
    await initialMaterializationCommit?.catch(() => undefined);
    if (pendingMaterializationLeaseRef) {
      const leaseRef = pendingMaterializationLeaseRef;
      pendingMaterializationLeaseRef = null;
      await releaseRuntimePresentationMaterializationLease(leaseRef).catch(() => {});
    }
    for (const leaseRef of ownedMaterializationLeaseRefs) {
      await releaseRuntimePresentationMaterializationLease(leaseRef).catch(() => {});
      ownedMaterializationLeaseRefs.delete(leaseRef);
    }
    useAvatarStore.getState().clearRuntimeBinding();
  };
  const buildHandle = (): BootstrapHandle => ({
    get driver() {
      return driver;
    },
    get carrier() {
      return carrier;
    },
    getVoiceInputAvailability,
    startVoiceCapture,
    submitVoiceCaptureTurn,
    interruptConversationTurn,
    sendConversationText,
    activateCommittedPresentation: (input, waitForPresentationReady) => (
      activateCommittedPresentation(input, waitForPresentationReady)
    ),
    commitInitialPresentation: () => commitInitialPresentation(),
    async shutdown() {
      await cleanup();
    },
  });

  try {
    useAvatarStore.getState().markShellReady({
      width: typeof window !== 'undefined' ? window.innerWidth : 400,
      height: typeof window !== 'undefined' ? window.innerHeight : 600,
    });

    if (resolveDriverKind() !== 'mock') {
      useAvatarStore.getState().setConsumeMode({
        mode: 'sdk',
        authority: 'runtime',
        fixtureId: null,
        fixturePlaying: false,
      });
      useAvatarStore.getState().clearBundle();
      useAvatarStore.getState().clearRuntimeBinding();
      const runtimeBridge = installAvatarRuntimeBridge();
      if (!runtimeBridge.installed) {
        useAvatarStore.getState().setRuntimeBindingStatus({
          status: 'unavailable',
          reason: 'desktop_supervisor_bridge_unavailable',
          reasonCode: 'PROTECTED_ORIGIN_ROLE_MISMATCH',
          actionHint: 'launch_avatar_from_desktop_supervisor',
          stage: 'protected_launch_session',
          source: 'runtime',
          retryable: false,
        });
        useAvatarStore.getState().setDriverStatus('stopped');
        return buildHandle();
      }
      const launchContext = await waitForAvatarLaunchContext(5_000);
      useAvatarStore.getState().setLaunchContext(launchContext);
      let runtime: NimiLocalAppClient | null = null;
      const avatarInstanceId = launchContext.avatarInstanceId || `desktop-avatar-${ulid()}`;
      try {
        runtime = getAvatarLocalAppClient();
        const formalSession = await runFirstPartyStage(
          'formal_app_session_status',
          () => runtime!.auth.status(),
        );
        if (!formalSession.sessionBound) {
          throw Object.assign(new Error('Avatar formal App session is unavailable.'), {
            reasonCode: formalSession.reasonCode,
            actionHint: formalSession.actionHint,
            retryable: formalSession.retryable,
          });
        }

        const agentBinding = await runFirstPartyStage(
          'runtime_identity_binding',
          () => createAvatarSessionAgentBinding({
            agents: runtime!.agents,
            conversation: runtime!.conversation,
            conversationAnchorId: launchContext.conversationAnchorId,
            async onHandleChange(agentHandle) {
              await refreshAvatarHostBinding({
                agentHandle,
                conversationAnchorId: launchContext.conversationAnchorId,
              });
              const state = useAvatarStore.getState();
              if (state.consume.avatarInstanceId !== avatarInstanceId
                || state.consume.conversationAnchorId !== launchContext.conversationAnchorId) {
                return;
              }
              state.setRuntimeConsumeContext({
                avatarInstanceId,
                conversationAnchorId: launchContext.conversationAnchorId,
                agentHandle,
                worldId: state.consume.worldId ?? '',
              });
            },
          }),
        );
        const presentationSnapshot = await runFirstPartyStage(
          'runtime_presentation_profile',
          () => agentBinding.run((agentHandle) => (
            runtime!.agentConfigure.presentation.snapshot({ agentHandle })
          )),
        );
        const openedConversation = await runFirstPartyStage(
          'canonical_conversation_handle',
          () => agentBinding.run((agentHandle) => runtime!.conversation.open({ agentHandle })),
        );
        if (openedConversation.conversationAnchorId !== launchContext.conversationAnchorId) {
          throw new Error('Avatar canonical Agent handle does not match the handed-off Conversation anchor.');
        }
        const conversationContext = {
          conversationAnchorId: launchContext.conversationAnchorId,
          recovered: true,
        };
        useAvatarStore.getState().setRuntimeBinding({
          avatarInstanceId,
          conversationAnchorId: conversationContext.conversationAnchorId,
          agentHandle: agentBinding.current(),
          worldId: '',
        });
        if (!presentationSnapshot.profile?.avatarAssetRef || !presentationSnapshot.presentationRevision) {
          const reason = 'runtime_agent_avatar_asset_missing_test_data';
          useAvatarStore.getState().setModelError(
            'The selected Runtime Agent has no admitted Live2D or VRM presentation asset.',
          );
          useAvatarStore.getState().setRuntimeBindingStatus({
            status: 'unavailable',
            reason,
            reasonCode: 'RUNTIME_AGENT_PRESENTATION_ASSET_NOT_CONFIGURED',
            actionHint: 'configure_an_admitted_avatar_asset_for_this_runtime_agent',
            stage: 'runtime_presentation_profile',
            source: 'runtime_agent_test_data',
            retryable: false,
          });
          useAvatarStore.getState().setDriverStatus('stopped');
          return buildHandle();
        }
        const presentationRevision = presentationSnapshot.presentationRevision;

        const resolvedAvatarAsset = await runFirstPartyStage(
          'local_avatar_asset_manifest',
          () => agentBinding.run((agentHandle) => resolveRuntimePresentationAvatarAsset({
            agentHandle,
            presentationRevision,
            presentationProfile: presentationSnapshot.profile,
          })),
        );
        pendingMaterializationLeaseRef = resolvedAvatarAsset.reference.materializationLeaseRef;
        const modelManifest = resolvedAvatarAsset.manifest;
        if (resolvedAvatarAsset.reference.backendKind !== 'live2d'
          && resolvedAvatarAsset.reference.backendKind !== 'vrm') {
          throw new Error('Runtime presentation Avatar preview supports only Live2D or VRM assets.');
        }
        const previewBackendKind = resolvedAvatarAsset.reference.backendKind;
        driver = await runFirstPartyStage('driver_create', async () => createDriver({
          kind: 'sdk',
          sdk: {
            conversation: runtime!.conversation,
            embodiment: runtime!.embodiment,
            agentHandle: agentBinding.current(),
            runWithAgentHandle: agentBinding.run,
            conversationAnchorId: conversationContext.conversationAnchorId,
            activeWorldId: '',
            locale: typeof navigator !== 'undefined' ? navigator.language : 'en-US',
            sessionId: conversationContext.conversationAnchorId,
          },
        }));
        getVoiceInputAvailability = async () => {
          try {
            const session = await runtime!.auth.status();
            if (!session.sessionBound) throw new Error('Avatar formal App session is unavailable.');
            await agentBinding.refresh();
            return { available: true, reason: null };
          } catch (error) {
            return { available: false, reason: errorMessage(error) };
          }
        };
        startVoiceCapture = async (input) => {
          activeVoiceCapture = await startAvatarVoiceCaptureSession({ onLevelChange: input.onLevelChange });
          return activeVoiceCapture;
        };
        sendConversationText = async (input) => {
          if (input.conversationAnchorId !== conversationContext.conversationAnchorId) {
            throw new Error('Avatar canonical Conversation binding changed before send.');
          }
          return agentBinding.run((agentHandle) => runtime!.conversation.send({
            agentHandle,
            conversationAnchorId: conversationContext.conversationAnchorId,
            requestId: `avatar-turn-${ulid()}`,
            parts: [{ kind: 'text', text: input.text }],
          }));
        };
        submitVoiceCaptureTurn = async (input) => {
          const transcription = await agentBinding.run((agentHandle) => (
            runtime!.conversation.transcribeVoice({
              agentHandle,
              conversationAnchorId: conversationContext.conversationAnchorId,
              requestId: `avatar-stt-${ulid()}`,
              mimeType: input.mimeType,
              audioBytes: input.audioBytes,
            }, {
              ...(input.signal ? { signal: input.signal } : {}),
            })
          ));
          const transcript = readNormalizedString(transcription.text);
          if (!transcript) throw new Error('Foreground voice transcription returned an empty transcript.');
          await sendConversationText({
            agentHandle: input.agentHandle,
            conversationAnchorId: input.conversationAnchorId,
            text: transcript,
          });
          return { transcript };
        };
        interruptConversationTurn = async (input) => {
          if (input.conversationAnchorId !== conversationContext.conversationAnchorId) {
            throw new Error('Avatar canonical Conversation binding changed before interrupt.');
          }
          await agentBinding.run((agentHandle) => runtime!.conversation.interruptTurn({
            agentHandle,
            conversationAnchorId: conversationContext.conversationAnchorId,
          }));
        };
        const activeDriver = driver;
        carrier = await runFirstPartyStage('runtime_carrier_start', () => startAvatarRuntimeCarrier({
          driver: activeDriver,
          modelManifest,
          committedPresentationSelection: {
            avatarAssetRef: resolvedAvatarAsset.reference.localAvatarAssetRef,
            backendKind: previewBackendKind,
            previewMaterialRef: resolvedAvatarAsset.reference.materializationRef,
            presentationRevision,
          },
        }));
        commitInitialPresentation = async () => {
          if (!pendingMaterializationLeaseRef || !carrier?.committedPresentationSelection) return;
          if (initialMaterializationCommit) return initialMaterializationCommit;
          const leaseRef = pendingMaterializationLeaseRef;
          const selection = carrier.committedPresentationSelection;
          initialMaterializationCommit = runFirstPartyStage('materialization_lease_commit', () => (
            commitRuntimePresentationMaterializationLease({
              materializationLeaseRef: leaseRef,
              materializationRef: selection.previewMaterialRef,
              avatarAssetRef: selection.avatarAssetRef,
              backendKind: selection.backendKind,
              presentationRevision: selection.presentationRevision,
            })
          )).then(() => {
            ownedMaterializationLeaseRefs.add(leaseRef);
            if (pendingMaterializationLeaseRef === leaseRef) {
              pendingMaterializationLeaseRef = null;
            }
          }).finally(() => {
            initialMaterializationCommit = null;
          });
          return initialMaterializationCommit;
        };
        presentationSwap = createAvatarLivePresentationSwap({
          runtime,
          agentBinding,
          driver: activeDriver,
          getCarrier: () => carrier,
          commitReplacement(replacement) {
            carrier = replacement;
          },
          isClosed: () => cleanedUp,
          trackMaterializationLease(leaseRef) {
            ownedMaterializationLeaseRefs.add(leaseRef);
          },
          untrackMaterializationLease(leaseRef) {
            ownedMaterializationLeaseRefs.delete(leaseRef);
          },
        });
        activateCommittedPresentation = presentationSwap.activate;
      } catch (error) {
        carrier?.shutdown();
        carrier = null;
        if (driver) {
          await driver.stop().catch(() => {});
          driver = null;
        }
        if (pendingMaterializationLeaseRef) {
          const leaseRef = pendingMaterializationLeaseRef;
          pendingMaterializationLeaseRef = null;
          await releaseRuntimePresentationMaterializationLease(leaseRef).catch(() => {});
        }
        const unavailable = firstPartyUnavailableDetail(error);
        setRuntimeBindingUnavailable(unavailable);
        useAvatarStore.getState().setDriverStatus('stopped');
        return buildHandle();
      }
    } else {
      const fixture = await loadSelectedMockScenarioFixture();
      useAvatarStore.getState().setConsumeMode({
        mode: 'mock',
        authority: 'fixture',
        fixtureId: fixture.scenarioId,
        fixturePlaying: true,
      });
      useAvatarStore.getState().setRuntimeConsumeContext({
        avatarInstanceId: `fixture-avatar-${fixture.scenarioId}`,
        conversationAnchorId: `fixture-anchor-${fixture.scenarioId}`,
        agentHandle: `fixture-agent-${fixture.scenarioId}`,
        worldId: fixture.activeWorldId,
      });
      driver = createDriver({
        kind: 'mock',
        scenarioJson: fixture.scenarioJson,
        scenarioSource: fixture.scenarioSource,
      });
      if (fixture.modelManifest) {
        const activeDriver = driver;
        carrier = await runFirstPartyStage('runtime_carrier_start', () => startAvatarRuntimeCarrier({
          driver: activeDriver,
          modelManifest: fixture.modelManifest!,
        }));
      } else {
        useAvatarStore.getState().setModelError(
          `mock fixture "${fixture.scenarioId}" does not declare a visual model manifest`,
        );
      }
    }

    if (!driver) return buildHandle();
    const activeDriver = driver;
    unsubscribeStatus = activeDriver.onStatusChange((status) => {
      const driverError = status === 'error'
        ? readNormalizedString(activeDriver.getLastError?.())
        : null;
      const state = useAvatarStore.getState();
      state.setDriverStatus(status, driverError);
    });
    unsubscribeBundle = activeDriver.onBundleChange((bundle) => {
      useAvatarStore.getState().setBundle(bundle);
    });

    try {
      await runFirstPartyStageWithTimeout(
        'driver_start',
        AVATAR_FIRST_PARTY_DRIVER_START_TIMEOUT_MS,
        () => activeDriver.start(),
      );
    } catch (error) {
      recordDriverStartFailure(error);
      carrier?.shutdown();
      carrier = null;
      await activeDriver.stop().catch(() => {});
      if (pendingMaterializationLeaseRef) {
        const leaseRef = pendingMaterializationLeaseRef;
        pendingMaterializationLeaseRef = null;
        await releaseRuntimePresentationMaterializationLease(leaseRef).catch(() => {});
      }
      driver = null;
      return buildHandle();
    }

    return buildHandle();
  } catch (error) {
    console.error('[avatar:bootstrap] startup failed', error);
    await cleanup();
    throw error;
  }
}
