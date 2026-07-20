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
  AccountReasonCode,
  AccountSessionState,
  AvatarDebugRequestedBy,
  ReasonCode,
  type AccountSessionSnapshot,
  type AvatarDebugProbeResultEnvelope,
} from '@nimiplatform/sdk/runtime/wire-types';
import {
  buildNimiRuntimeGenerationSubmitRequest,
  createNimiSpeechTranscriptionScenario,
} from '@nimiplatform/sdk/features/generation';
import { startAvatarRuntimeCarrier } from '../carrier/avatar-carrier.js';
import type { AvatarRuntimeCarrier } from '../carrier/avatar-carrier.js';
import { createDriver, resolveDriverKind } from '../driver/factory.js';
import { resolveRuntimePresentationAvatarAssetManifest } from '../carrier/model-resolver.js';
import type { AgentDataDriver } from '../driver/types.js';
import { ulid } from '../infra/ids.js';
import { readAvatarShellSettings } from '../settings-state.js';
import { startAvatarVoiceCaptureSession, type AvatarVoiceCaptureSession } from '../voice-capture.js';
import { resolveAvatarConversationContext } from './avatar-conversation-context.js';
import { recordAvatarEvidenceEventually } from './avatar-evidence.js';
import { recordLocalAvatarAssetResolved } from './app-bootstrap-package-evidence.js';
import type { BootstrapHandle } from './app-bootstrap-types.js';
import { detectDeviceTier } from './device-tier-detector.js';
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
  readEnumName,
  recordDriverStartFailure,
  runFirstPartyStage,
  runFirstPartyStageWithTimeout,
  setRuntimeBindingUnavailable,
} from './app-bootstrap-first-party-diagnostics.js';

const AVATAR_FIRST_PARTY_APP_ID = 'nimi.avatar';
const AVATAR_FIRST_PARTY_DRIVER_START_TIMEOUT_MS = 12_000;

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

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

function projectAccountSnapshot(snapshot: AccountSessionSnapshot): Readonly<Record<string, unknown>> {
  return {
    sequence: snapshot.sequence,
    state: snapshot.state,
    state_name: readEnumName(AccountSessionState, snapshot.state),
    reason_code: snapshot.reasonCode,
    reason_code_name: readEnumName(ReasonCode, snapshot.reasonCode),
    account_reason_code: snapshot.accountReasonCode,
    account_reason_code_name: readEnumName(AccountReasonCode, snapshot.accountReasonCode),
    account_projection_present: Boolean(snapshot.accountProjection),
    account_id_present: Boolean(readNormalizedString(snapshot.accountProjection?.accountId)),
  };
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
    try {
      const tierDetection = detectDeviceTier();
      recordAvatarEvidenceEventually({
        kind: 'avatar.device.tier_detected',
        detail: {
          tier: tierDetection.tier,
          reason: tierDetection.reason,
          renderer_string: tierDetection.rendererString,
          webgl_available: tierDetection.webglAvailable,
        },
      });
    } catch (error) {
      console.warn('[avatar:bootstrap] device tier detection threw; falling back to tier C', error);
    }

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
        recordAvatarEvidenceEventually({
          kind: 'avatar.runtime.bind-failed',
          detail: {
            runtime_app_id: AVATAR_FIRST_PARTY_APP_ID,
            reason: 'desktop_supervisor_bridge_unavailable',
            bridge_reason: runtimeBridge.reason,
            error_stage: 'protected_launch_session',
            error_reason_code: 'PROTECTED_ORIGIN_ROLE_MISMATCH',
            error_action_hint: 'launch_avatar_from_desktop_supervisor',
            error_source: 'runtime',
            error_retryable: false,
          },
        });
        return buildHandle();
      }
      const launchContext = await waitForAvatarLaunchContext(5_000);
      useAvatarStore.getState().setLaunchContext(launchContext);
      let runtime: NimiBundledAvatarRuntimeClient | null = null;
      let evidenceAgentId = launchContext.agentId;
      let conversationAnchorId: string | null = null;
      const avatarInstanceId = launchContext.avatarInstanceId || `desktop-avatar-${ulid()}`;
      try {
        runtime = createNimiBundledAvatarRuntimeClient();
        await runFirstPartyStage('runtime_client_ready', () => runtime!.ready());
        const accountSnapshot = await runFirstPartyStage(
          'account_session_status',
          () => runtime!.session.getSnapshot(),
        );
        recordAvatarEvidenceEventually({
          kind: 'avatar.runtime.account-snapshot',
          detail: projectAccountSnapshot(accountSnapshot),
        });
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
        const accountStream = runtime.session.subscribe(accountSnapshot.sequence, {
          signal: accountStreamAbort.signal,
        });
        accountStreamTask = (async () => {
          try {
            for await (const event of accountStream) {
              if (accountStreamAbort?.signal.aborted) break;
              if (!event.snapshot) continue;
              recordAvatarEvidenceEventually({
                kind: 'avatar.runtime.account-stream-event',
                detail: {
                  event_id_present: Boolean(readNormalizedString(event.eventId)),
                  delivery_kind: event.deliveryKind,
                  replay_truncated: event.replayTruncated,
                  ...projectAccountSnapshot(event.snapshot),
                },
              });
              const eventFailure = accountStateUnavailableReason(event.snapshot);
              const eventAccountId = readNormalizedString(event.snapshot.accountProjection?.accountId);
              if (eventFailure || eventAccountId !== accountId) {
                useAvatarStore.getState().setRuntimeBindingStatus({
                  status: eventAccountId && eventAccountId !== accountId ? 'revoked' : eventFailure?.status || 'unavailable',
                  reason: eventAccountId && eventAccountId !== accountId
                    ? 'runtime_account_switched'
                    : eventFailure?.reason || 'runtime_account_projection_unavailable',
                  reasonCode: diagnosticEnumString(event.snapshot.reasonCode),
                  accountReasonCode: diagnosticEnumString(event.snapshot.accountReasonCode),
                  actionHint: eventAccountId && eventAccountId !== accountId
                    ? 'relaunch_avatar_from_desktop'
                    : eventFailure?.actionHint || 'repair_runtime_account_session',
                  stage: 'account_session_stream',
                  source: 'runtime',
                  retryable: eventFailure?.retryable ?? true,
                });
              }
            }
          } catch (error) {
            if (!accountStreamAbort?.signal.aborted) {
              useAvatarStore.getState().setRuntimeBindingStatus({
                status: 'unavailable',
                reason: 'runtime_account_stream_unavailable',
                reasonCode: readNormalizedString(optionalRecord(error)?.['reasonCode']),
                actionHint: 'reconnect_desktop_supervised_avatar_session',
                stage: 'account_session_stream',
                source: 'runtime',
                retryable: true,
              });
            }
          }
        })();

        const personaCharacters = await runFirstPartyStage(
          'realm_connectivity',
          () => runtime!.realm.listPersonaCharacters(),
        );
        recordAvatarEvidenceEventually({
          kind: 'avatar.runtime.realm-connectivity',
          detail: {
            operation: 'WorldCoreController_listPersonaCharacters',
            success: true,
            response_count: personaCharacters.length,
            response_body_recorded: false,
          },
        });

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
        evidenceAgentId = localAgentRef;
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
        conversationAnchorId = conversationContext.conversationAnchorId;
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
        recordAvatarEvidenceEventually({
          kind: 'avatar.startup.runtime-bound',
          detail: {
            runtime_app_id: AVATAR_FIRST_PARTY_APP_ID,
            agent_id: localAgentRef,
            avatar_instance_id: avatarInstanceId,
            launch_source: launchContext.launchSource,
            account_authority: 'runtime',
            conversation_anchor_present: true,
            conversation_recovered: conversationContext.recovered,
          },
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
          recordAvatarEvidenceEventually({
            kind: 'avatar.runtime.asset-unavailable',
            detail: {
              agent_id: localAgentRef,
              reason,
              capability_status: 'platform_available_test_data_missing',
              presentation_revision: presentation.committedRevision,
            },
          });
          return buildHandle();
        }

        const modelManifest = await runFirstPartyStage(
          'local_avatar_asset_manifest',
          () => resolveRuntimePresentationAvatarAssetManifest({
            accountId,
            ownerUserId,
            runtimeSourceRef,
            localAgentRef,
            presentationProfile: presentation.profile,
          }),
        );
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
        recordLocalAvatarAssetResolved({
          localAgentRef,
          avatarInstanceId,
          conversationAnchorId: conversationContext.conversationAnchorId,
          manifest: modelManifest,
        });
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
            request: buildNimiRuntimeGenerationSubmitRequest({
              appId: AVATAR_FIRST_PARTY_APP_ID,
              subjectUserId: accountId,
              timeoutMs: 90_000,
            }, {
              scenario: createNimiSpeechTranscriptionScenario({
                kind: 'speech-transcribe',
                mimeType: input.mimeType,
                audio: { type: 'bytes', bytes: input.audioBytes },
                ...(input.language ? { language: input.language } : {}),
              }),
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
          snapshot: (input) => runtime!.withAgentScopes(
            ['runtime.agent.avatar_debug.read'],
            (options) => runtimeAgent.avatarDebug.snapshot({
              ownerUserId,
              runtimeSourceRef,
              localAgentRef: input.agentId,
              conversationAnchorId: input.conversationAnchorId,
            }, options),
          ),
          requestProbe: (input) => runtime!.withAgentScopes(
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
            }, options),
          ),
          listProbeResults: (input) => runtime!.withAgentScopes(
            ['runtime.agent.avatar_debug.read'],
            (options) => runtimeAgent.avatarDebug.listProbeResults({
              ownerUserId,
              runtimeSourceRef,
              localAgentRef: input.agentId,
              conversationAnchorId: input.conversationAnchorId,
              ...(input.probeKind ? { probeKind: input.probeKind } : {}),
            }, options),
          ),
        };
        const activeDriver = driver;
        carrier = await runFirstPartyStage('runtime_carrier_start', () => startAvatarRuntimeCarrier({
          driver: activeDriver,
          modelManifest,
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
        recordAvatarEvidenceEventually({
          kind: 'avatar.runtime.bind-failed',
          detail: {
            agent_id: evidenceAgentId,
            avatar_instance_id: avatarInstanceId,
            launch_source: launchContext.launchSource,
            runtime_app_id: AVATAR_FIRST_PARTY_APP_ID,
            conversation_anchor_present: Boolean(conversationAnchorId),
            reason: unavailable.reason,
            error_stage: unavailable.stage,
            error_reason_code: unavailable.reasonCode,
            error_account_reason_code: unavailable.accountReasonCode,
            error_action_hint: unavailable.actionHint,
            error_source: unavailable.source,
            error_retryable: unavailable.retryable,
          },
        });
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
      if (status === 'error') {
        recordAvatarEvidenceEventually({
          kind: 'avatar.runtime.driver-error',
          detail: {
            agentId: state.consume.agentId || '',
            avatar_instance_id: state.consume.avatarInstanceId,
            launch_source: state.launch.context?.launchSource || null,
            runtime_app_id: AVATAR_FIRST_PARTY_APP_ID,
            conversation_anchor_id: state.consume.conversationAnchorId,
            driver_status: status,
            error_message: driverError,
          },
        });
      }
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
      const state = useAvatarStore.getState();
      recordDriverStartFailure(error, {
        agentId: state.consume.agentId || '',
        avatarInstanceId: state.consume.avatarInstanceId,
        launchSource: state.launch.context?.launchSource || null,
        runtimeAppId: AVATAR_FIRST_PARTY_APP_ID,
      });
      carrier?.shutdown();
      carrier = null;
      await activeDriver.stop().catch(() => {});
      driver = null;
      return buildHandle();
    }

    return buildHandle();
  } catch (error) {
    const errorRecord = error as {
      message?: unknown;
      name?: unknown;
      stack?: unknown;
      reasonCode?: unknown;
      actionHint?: unknown;
      source?: unknown;
      retryable?: unknown;
      cause?: unknown;
    };
    recordAvatarEvidenceEventually({
      kind: 'avatar.startup.failed',
      detail: {
        error: error instanceof Error ? error.message : String(error || 'unknown avatar startup failure'),
        error_name: error instanceof Error ? error.name : null,
        error_reason_code: typeof errorRecord.reasonCode === 'string' ? errorRecord.reasonCode : null,
        error_action_hint: typeof errorRecord.actionHint === 'string' ? errorRecord.actionHint : null,
        error_source: typeof errorRecord.source === 'string' ? errorRecord.source : null,
        error_retryable: typeof errorRecord.retryable === 'boolean' ? errorRecord.retryable : null,
        error_stack: typeof errorRecord.stack === 'string' ? errorRecord.stack.slice(0, 2_000) : null,
        error_cause: errorRecord.cause ? String(errorRecord.cause).slice(0, 1_000) : null,
      },
    });
    await cleanup();
    throw error;
  }
}
