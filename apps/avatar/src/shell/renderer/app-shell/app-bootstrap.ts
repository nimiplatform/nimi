import {
  createNimiBundledAvatarRuntimeClient,
  type NimiBundledAvatarRuntimeClient,
} from '@nimiplatform/sdk/runtime';
import type { NimiLocalAppAgentHandle } from '@nimiplatform/sdk/app';
import {
  AccountSessionState,
  type AccountSessionSnapshot,
} from '@nimiplatform/sdk/runtime/wire-types';
import { startAvatarRuntimeCarrier } from '../carrier/avatar-carrier.js';
import type { AvatarRuntimeCarrier } from '../carrier/avatar-carrier.js';
import { createDriver, resolveDriverKind } from '../driver/factory.js';
import { resolveRuntimePresentationAvatarAsset } from '../carrier/model-resolver.js';
import type { AgentDataDriver } from '../driver/types.js';
import { ulid } from '../infra/ids.js';
import { readAvatarShellSettings } from '../settings-state.js';
import { startAvatarVoiceCaptureSession, type AvatarVoiceCaptureSession } from '../voice-capture.js';
import type { BootstrapHandle } from './app-bootstrap-types.js';
import { useAvatarStore } from './app-store.js';
import { isTauriRuntime, onShellReady } from './tauri-lifecycle.js';
import { setAlwaysOnTop } from './avatar-window-commands.js';
import {
  errorMessage,
  installAvatarRuntimeBridge,
  loadSelectedMockScenarioFixture,
  readNormalizedString,
  waitForAvatarLaunchContext,
} from './app-bootstrap-helpers.js';
import {
  diagnosticEnumString,
  firstPartyUnavailableDetail,
  recordDriverStartFailure,
  runFirstPartyStage,
  runFirstPartyStageWithTimeout,
  setRuntimeBindingUnavailable,
} from './app-bootstrap-first-party-diagnostics.js';
import { consumeAvatarAccountSessionWithResync } from './account-session-resync.js';

const AVATAR_FIRST_PARTY_DRIVER_START_TIMEOUT_MS = 12_000;

function accountStateUnavailableReason(snapshot: AccountSessionSnapshot): {
  readonly status: 'unavailable' | 'expired' | 'stale';
  readonly reason: string;
  readonly actionHint: string;
  readonly retryable: boolean;
} | null {
  switch (snapshot.state) {
    case AccountSessionState.AUTHENTICATED:
      return null;
    case AccountSessionState.EXPIRED:
    case AccountSessionState.REAUTH_REQUIRED:
      return {
        status: 'expired',
        reason: 'runtime_account_reauth_required',
        actionHint: 'reauthenticate_from_desktop_account_flow',
        retryable: true,
      };
    case AccountSessionState.REFRESH_PENDING:
    case AccountSessionState.SWITCHING:
    case AccountSessionState.LOGGING_OUT:
      return {
        status: 'stale',
        reason: 'runtime_account_transition_in_progress',
        actionHint: 'wait_for_runtime_account_transition',
        retryable: true,
      };
    case AccountSessionState.ANONYMOUS:
    case AccountSessionState.LOGIN_PENDING:
      return {
        status: 'unavailable',
        reason: 'runtime_account_session_anonymous',
        actionHint: 'authenticate_from_desktop_account_flow',
        retryable: true,
      };
    default:
      return {
        status: 'unavailable',
        reason: 'runtime_account_carrier_unavailable',
        actionHint: 'repair_runtime_account_session',
        retryable: true,
      };
  }
}

export type { BootstrapHandle } from './app-bootstrap-types.js';

/**
 * A0 deliberately admits only fixture execution here. A real Avatar session
 * must be opened by the protected Desktop carrier in A1; renderer code must
 * not reconstruct a first-party Runtime identity or request credentials.
 */
export async function bootstrapAvatar(): Promise<BootstrapHandle> {
  let shellUnlisten: (() => void) | null = null;
  let driver: AgentDataDriver | null = null;
  let carrier: AvatarRuntimeCarrier | null = null;
  let unsubscribeStatus = () => {};
  let unsubscribeBundle = () => {};
  let activeVoiceCapture: AvatarVoiceCaptureSession | null = null;
  let accountStreamAbort: AbortController | null = null;
  let accountStreamTask: Promise<void> | null = null;
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
  let cancelCompanionParticipation: BootstrapHandle['cancelCompanionParticipation'] = async () => {
    throw new Error('Foreground voice requires a protected Desktop launch session');
  };
  let interruptActiveTurn: BootstrapHandle['interruptActiveTurn'] = async () => {
    throw new Error('Foreground voice requires a protected Desktop launch session');
  };
  let requestCompanionParticipation: BootstrapHandle['requestCompanionParticipation'] = async () => {
    throw new Error('avatar companion input requires a protected Desktop launch session');
  };
  let avatarDebug: BootstrapHandle['avatarDebug'] = null;
  const cleanup = async () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    unsubscribeStatus();
    unsubscribeBundle();
    activeVoiceCapture?.cancel();
    activeVoiceCapture = null;
    accountStreamAbort?.abort();
    accountStreamAbort = null;
    await accountStreamTask?.catch(() => {});
    accountStreamTask = null;
    shellUnlisten?.();
    carrier?.shutdown();
    carrier = null;
    if (driver) {
      await driver.stop().catch(() => {});
    }
    useAvatarStore.getState().clearRuntimeBinding();
  };
  const buildHandle = (): BootstrapHandle => ({
    driver,
    carrier,
    getVoiceInputAvailability,
    startVoiceCapture,
    submitVoiceCaptureTurn,
    cancelCompanionParticipation,
    interruptActiveTurn,
    requestCompanionParticipation,
    avatarDebug,
    async shutdown() {
      await cleanup();
    },
  });

  try {
    if (isTauriRuntime()) {
      const shellSettings = readAvatarShellSettings();
      useAvatarStore.getState().setAlwaysOnTop(shellSettings.alwaysOnTop);
      shellUnlisten = await onShellReady((payload) => {
        useAvatarStore.getState().markShellReady({ width: payload.width, height: payload.height });
      });
      await setAlwaysOnTop(shellSettings.alwaysOnTop);
    } else {
      useAvatarStore.getState().markShellReady({
        width: typeof window !== 'undefined' ? window.innerWidth : 400,
        height: typeof window !== 'undefined' ? window.innerHeight : 600,
      });
    }

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
      let runtime: NimiBundledAvatarRuntimeClient | null = null;
      const avatarInstanceId = launchContext.avatarInstanceId || `desktop-avatar-${ulid()}`;
      try {
        runtime = createNimiBundledAvatarRuntimeClient();
        await runFirstPartyStage('runtime_client_ready', () => runtime!.ready());
        const accountSnapshot = await runFirstPartyStage(
          'account_session_status',
          () => runtime!.session.getSnapshot(),
        );
        const accountFailure = accountStateUnavailableReason(accountSnapshot);
        if (accountFailure) {
          useAvatarStore.getState().setRuntimeBindingStatus({
            status: accountFailure?.status || 'unavailable',
            reason: accountFailure?.reason || 'runtime_account_projection_unavailable',
            reasonCode: diagnosticEnumString(accountSnapshot.reasonCode),
            accountReasonCode: diagnosticEnumString(accountSnapshot.accountReasonCode),
            actionHint: accountFailure?.actionHint || 'repair_runtime_account_session',
            stage: 'account_session_status',
            source: 'runtime',
            retryable: accountFailure?.retryable ?? true,
          });
          useAvatarStore.getState().setDriverStatus('stopped');
          return buildHandle();
        }

        accountStreamAbort = new AbortController();
        accountStreamTask = consumeAvatarAccountSessionWithResync({
          runtime,
          initialSnapshot: accountSnapshot,
          signal: accountStreamAbort.signal,
          classifySnapshot: accountStateUnavailableReason,
          onUnavailable(failure) {
            useAvatarStore.getState().setRuntimeBindingStatus({
              status: failure.status,
              reason: failure.reason,
              reasonCode: failure.reasonCode ?? null,
              actionHint: failure.actionHint,
              stage: failure.stage,
              source: 'runtime',
              retryable: failure.retryable,
            });
          },
          onRecovered(snapshot) {
            useAvatarStore.getState().setRuntimeBindingStatus({
              status: 'active',
              reasonCode: diagnosticEnumString(snapshot.reasonCode),
              accountReasonCode: diagnosticEnumString(snapshot.accountReasonCode),
              stage: 'account_session_resync',
              source: 'runtime',
            });
          },
        });

        await runFirstPartyStage(
          'realm_connectivity',
          () => runtime!.realm.listPersonaCharacters(),
        );

        const agentHandle = launchContext.agentHandle as NimiLocalAppAgentHandle;
        const presentationSnapshot = await runFirstPartyStage(
          'runtime_presentation_profile',
          () => runtime!.agentConfigure.presentation.snapshot({ agentHandle }),
        );
        const openedConversation = await runFirstPartyStage(
          'canonical_conversation_handle',
          () => runtime!.conversation.open({ agentHandle }),
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
          agentId: agentHandle,
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
          () => resolveRuntimePresentationAvatarAsset({
            agentHandle,
            presentationProfile: presentationSnapshot.profile,
          }),
        );
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
            agentHandle,
            conversationAnchorId: conversationContext.conversationAnchorId,
            activeWorldId: '',
            locale: typeof navigator !== 'undefined' ? navigator.language : 'en-US',
            sessionId: conversationContext.conversationAnchorId,
          },
        }));
        getVoiceInputAvailability = async () => {
          try {
            await runtime!.ready();
            return { available: true, reason: null };
          } catch (error) {
            return { available: false, reason: errorMessage(error) };
          }
        };
        startVoiceCapture = async (input) => {
          activeVoiceCapture = await startAvatarVoiceCaptureSession({ onLevelChange: input.onLevelChange });
          return activeVoiceCapture;
        };
        requestCompanionParticipation = async (input) => {
          if (input.agentId !== agentHandle || input.conversationAnchorId !== conversationContext.conversationAnchorId) {
            throw new Error('Avatar canonical Conversation binding changed before send.');
          }
          return runtime!.conversation.send({
            agentHandle,
            conversationAnchorId: conversationContext.conversationAnchorId,
            requestId: `avatar-turn-${ulid()}`,
            parts: [{ kind: 'text', text: input.text }],
          });
        };
        submitVoiceCaptureTurn = async (input) => {
          const transcription = await runtime!.conversation.transcribeVoice({
            agentHandle,
            conversationAnchorId: conversationContext.conversationAnchorId,
            requestId: `avatar-stt-${ulid()}`,
            mimeType: input.mimeType,
            audioBytes: input.audioBytes,
          }, {
            ...(input.signal ? { signal: input.signal } : {}),
          });
          const transcript = readNormalizedString(transcription.text);
          if (!transcript) throw new Error('Foreground voice transcription returned an empty transcript.');
          await requestCompanionParticipation({
            agentId: input.agentId,
            conversationAnchorId: input.conversationAnchorId,
            text: transcript,
          });
          return { transcript };
        };
        cancelCompanionParticipation = async (input) => {
          if (input.agentId !== agentHandle || input.conversationAnchorId !== conversationContext.conversationAnchorId) {
            throw new Error('Avatar canonical Conversation binding changed before cancel.');
          }
          await runtime!.conversation.interruptTurn({
            agentHandle,
            conversationAnchorId: conversationContext.conversationAnchorId,
          });
        };
        interruptActiveTurn = async (input) => {
          if (input.agentId !== agentHandle || input.conversationAnchorId !== conversationContext.conversationAnchorId) {
            throw new Error('Avatar canonical Conversation binding changed before interrupt.');
          }
          await runtime!.conversation.interruptTurn({
            agentHandle,
            conversationAnchorId: conversationContext.conversationAnchorId,
          });
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
      } catch (error) {
        carrier?.shutdown();
        carrier = null;
        if (driver) {
          await driver.stop().catch(() => {});
          driver = null;
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
        agentId: `fixture-agent-${fixture.scenarioId}`,
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
