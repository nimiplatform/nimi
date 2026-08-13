import { getSharedAudioPipelineController } from '@nimiplatform/kit/features/avatar/headless';
import {
  createNimiBundledAvatarRuntimeClient,
  createNimiRuntimeAgentConsumeClient,
  createNimiRuntimeAgentTurnsModule,
  createNimiRuntimeAgentVoiceModule,
  projectNimiRuntimeAgentPresentationRecord,
  runNimiRuntimeScenarioJob,
  type NimiBundledAvatarRuntimeClient,
  type NimiRuntimeAgentTurnCancellationReason,
} from '@nimiplatform/sdk/runtime';
import {
  AccountSessionState,
  AvatarDebugRequestedBy,
  type AccountSessionSnapshot,
  type AvatarDebugProbeResultEnvelope,
} from '@nimiplatform/sdk/runtime/wire-types';
import { startAvatarRuntimeCarrier } from '../carrier/avatar-carrier.js';
import type { AvatarRuntimeCarrier } from '../carrier/avatar-carrier.js';
import { createDriver, resolveDriverKind } from '../driver/factory.js';
import { resolveRuntimePresentationAvatarAsset } from '../carrier/model-resolver.js';
import type { AgentDataDriver } from '../driver/types.js';
import { ulid } from '../infra/ids.js';
import { readAvatarShellSettings } from '../settings-state.js';
import { startAvatarVoiceCaptureSession, type AvatarVoiceCaptureSession } from '../voice-capture.js';
import { resolveAvatarConversationContext } from './avatar-conversation-context.js';
import {
  AVATAR_FIRST_PARTY_APP_ID,
  buildAvatarSpeechTranscriptionSubmitRequest,
} from './avatar-generation-intent.js';
import type { BootstrapHandle } from './app-bootstrap-types.js';
import { useAvatarStore } from './app-store.js';
import { isTauriRuntime, onShellReady } from './tauri-lifecycle.js';
import { setAlwaysOnTop } from './tauri-commands.js';
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

function normalizeTurnCancellationReason(value: unknown): NimiRuntimeAgentTurnCancellationReason {
  switch (readNormalizedString(value)) {
    case 'room_closed':
      return 'room_closed';
    case 'superseded_turn':
      return 'superseded_turn';
    case 'budget_exhausted':
      return 'budget_exhausted';
    case 'timeout':
      return 'timeout';
    case 'gateway_revoked':
      return 'gateway_revoked';
    case 'policy_refusal':
      return 'policy_refusal';
    default:
      return 'user_cancel';
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
        const accountId = readNormalizedString(accountSnapshot.accountProjection?.accountId);
        if (accountFailure || !accountId) {
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
          expectedAccountId: accountId,
          signal: accountStreamAbort.signal,
          classifySnapshot(snapshot) {
            return {
              accountId: readNormalizedString(snapshot.accountProjection?.accountId),
              failure: accountStateUnavailableReason(snapshot),
            };
          },
          onUnavailable(failure) {
            useAvatarStore.getState().setRuntimeBindingStatus({
              status: failure.reason === 'runtime_account_switched' ? 'revoked' : failure.status,
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

        const agent = await runFirstPartyStage(
          'runtime_presentation_profile',
          () => runtime!.currentAgent.get(launchContext.agentId),
        );
        if (agent.ownerUserId !== accountId) {
          throw Object.assign(new Error('Runtime Agent owner does not match the current Runtime account.'), {
            reasonCode: 'RUNTIME_AGENT_ACCOUNT_MISMATCH',
            actionHint: 'relaunch_avatar_for_the_current_account',
            source: 'runtime',
            retryable: false,
          });
        }
        const ownerUserId = agent.ownerUserId;
        const runtimeSourceRef = agent.runtimeSourceRef;
        const localAgentRef = agent.localAgentRef;
        const runtimeAgent = createNimiRuntimeAgentConsumeClient({
          runtime: {
            agents: runtime.agents,
            appMessages: runtime.appMessages,
          },
          runtimeAppId: AVATAR_FIRST_PARTY_APP_ID,
        });
        const conversationContext = await runFirstPartyStage(
          'conversation_context',
          () => resolveAvatarConversationContext({
            runtimeAgent,
            withScopes: runtime!.withAgentScopes,
            accountId,
            ownerUserId,
            runtimeSourceRef,
            localAgentRef,
            avatarInstanceId,
          }),
        );
        await runtime.withAgentScopes(['runtime.agent.write'], (options) => (
          runtimeAgent.anchors.registerAvatarLiveInstance({
            ownerUserId,
            runtimeSourceRef,
            localAgentRef,
            avatarInstanceId,
            conversationAnchorId: conversationContext.conversationAnchorId,
          }, options)
        ));
        useAvatarStore.getState().setRuntimeBinding({
          avatarInstanceId,
          conversationAnchorId: conversationContext.conversationAnchorId,
          agentId: localAgentRef,
          worldId: '',
        });
        const presentation = projectNimiRuntimeAgentPresentationRecord(agent);
        if (!presentation.profile?.avatarAssetRef) {
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

        const resolvedAvatarAsset = await runFirstPartyStage(
          'local_avatar_asset_manifest',
          () => resolveRuntimePresentationAvatarAsset({
            accountId,
            ownerUserId,
            runtimeSourceRef,
            localAgentRef,
            presentationProfile: presentation.profile,
          }),
        );
        const modelManifest = resolvedAvatarAsset.manifest;
        if (resolvedAvatarAsset.reference.backendKind !== 'live2d'
          && resolvedAvatarAsset.reference.backendKind !== 'vrm') {
          throw new Error('Runtime presentation Avatar preview supports only Live2D or VRM assets.');
        }
        const previewBackendKind = resolvedAvatarAsset.reference.backendKind;
        const runtimeAgentTurns = createNimiRuntimeAgentTurnsModule({
          runtime: {
            appId: AVATAR_FIRST_PARTY_APP_ID,
            agents: runtime.agents,
            appMessages: runtime.appMessages,
          },
          getSubjectUserId: () => accountId,
          withScopes: runtime.withAgentScopes,
        });
        const runtimeAgentVoice = createNimiRuntimeAgentVoiceModule({
          runtime: {
            appId: AVATAR_FIRST_PARTY_APP_ID,
            agents: runtime.agents,
            artifacts: runtime.artifacts,
          },
          getSubjectUserId: () => accountId,
          withScopes: runtime.withAgentScopes,
        });
        getSharedAudioPipelineController().setRuntime({ artifacts: runtime.artifacts });
        driver = await runFirstPartyStage('driver_create', async () => createDriver({
          kind: 'sdk',
          sdk: {
            runtimeAgent,
            runtimeVoice: runtimeAgentVoice,
            withScopes: runtime!.withAgentScopes,
            ownerUserId,
            runtimeSourceRef,
            localAgentRef,
            conversationAnchorId: conversationContext.conversationAnchorId,
            activeWorldId: '',
            activeUserId: accountId,
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
        requestCompanionParticipation = async (input) => runtimeAgent.companionParticipation.request({
          ownerUserId,
          runtimeSourceRef,
          localAgentRef: input.agentId,
          conversationAnchorId: input.conversationAnchorId,
          surfaceKind: 'avatar_companion',
          triggerSource: 'user_explicit',
          text: input.text,
        });
        submitVoiceCaptureTurn = async (input) => {
          const transcription = await runNimiRuntimeScenarioJob({
            ai: runtime!.ai,
            request: buildAvatarSpeechTranscriptionSubmitRequest({
              subjectUserId: accountId,
              mimeType: input.mimeType,
              audioBytes: input.audioBytes,
              ...(input.language ? { language: input.language } : {}),
              requestId: `avatar-stt-${ulid()}`,
              idempotencyKey: `avatar-stt-${ulid()}`,
            }),
            ...(input.signal ? { signal: input.signal } : {}),
            abortReason: 'avatar_voice_capture_aborted',
          });
          const transcript = readNormalizedString(
            transcription.output?.output.oneofKind === 'speechTranscribe'
              ? transcription.output.output.speechTranscribe.text
              : '',
          );
          if (!transcript) throw new Error('Foreground voice transcription returned an empty transcript.');
          await requestCompanionParticipation({
            agentId: input.agentId,
            conversationAnchorId: input.conversationAnchorId,
            text: transcript,
          });
          return { transcript };
        };
        cancelCompanionParticipation = async (input) => runtimeAgent.companionParticipation.cancel({
          ownerUserId,
          runtimeSourceRef,
          localAgentRef: input.agentId,
          conversationAnchorId: input.conversationAnchorId,
          surfaceKind: 'avatar_companion',
          triggerSource: 'user_explicit',
          ...(input.projectionId ? { projectionId: input.projectionId } : {}),
          ...(input.turnId ? { turnId: input.turnId } : {}),
          ...(input.reason ? { reason: input.reason } : {}),
        });
        interruptActiveTurn = async (input) => {
          await runtimeAgentTurns.interrupt({
            ownerUserId,
            runtimeSourceRef,
            localAgentRef: input.agentId,
            conversationAnchorId: input.conversationAnchorId,
            ...(input.turnId ? { turnId: input.turnId } : {}),
            ...(input.reason ? { reason: normalizeTurnCancellationReason(input.reason) } : {}),
          });
        };
        avatarDebug = {
          snapshot: (input, callOptions) => runtime!.withAgentScopes(
            ['runtime.agent.avatar_debug.read'],
            (options) => runtimeAgent.avatarDebug.snapshot({
              ownerUserId,
              runtimeSourceRef,
              localAgentRef: input.agentId,
              conversationAnchorId: input.conversationAnchorId,
            }, { ...options, ...callOptions }),
          ),
          requestProbe: (input, callOptions) => runtime!.withAgentScopes(
            ['runtime.agent.avatar_debug.write'],
            (options) => runtimeAgent.avatarDebug.requestProbe({
              ownerUserId,
              runtimeSourceRef,
              localAgentRef: input.agentId,
              conversationAnchorId: input.conversationAnchorId,
              probeKind: input.probeKind,
              requestedBy: AvatarDebugRequestedBy.DESKTOP_DEBUG_WORKBENCH,
              replayRequested: true,
              ...(input.avatarInstanceId ? { avatarInstanceId: input.avatarInstanceId } : {}),
            }, { ...options, ...callOptions }),
          ),
          listProbeResults: (input, callOptions) => runtime!.withAgentScopes(
            ['runtime.agent.avatar_debug.read'],
            (options) => runtimeAgent.avatarDebug.listProbeResults({
              ownerUserId,
              runtimeSourceRef,
              localAgentRef: input.agentId,
              conversationAnchorId: input.conversationAnchorId,
              ...(input.probeKind ? { probeKind: input.probeKind } : {}),
            }, { ...options, ...callOptions }),
          ),
        };
        const activeDriver = driver;
        carrier = await runFirstPartyStage('runtime_carrier_start', () => startAvatarRuntimeCarrier({
          driver: activeDriver,
          modelManifest,
          committedPresentationSelection: {
            avatarAssetRef: resolvedAvatarAsset.reference.localAvatarAssetRef,
            backendKind: previewBackendKind,
            previewMaterialRef: resolvedAvatarAsset.reference.materializationRef,
          },
          submitDebugProbeResult: async (result: AvatarDebugProbeResultEnvelope) => {
            await runtime!.withAgentScopes(
              ['runtime.agent.avatar_debug.write'],
              (options) => runtimeAgent.avatarDebug.submitProbeResult({
                ownerUserId,
                runtimeSourceRef,
                localAgentRef,
                conversationAnchorId: conversationContext.conversationAnchorId,
                result,
              }, options),
            );
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
