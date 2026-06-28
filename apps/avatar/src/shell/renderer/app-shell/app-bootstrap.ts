import { getSharedAudioPipelineController } from '@nimiplatform/kit/features/avatar/headless';
import {
  createNimiRuntimeAgentConsumeClient,
  createNimiRuntimeAgentTurnsModule,
  runNimiRuntimeScenarioJob,
  withNimiRuntimeAgentScopes,
  type NimiRuntimeAgentScopeRunner,
} from '@nimiplatform/sdk/runtime';
import {
  AccountReasonCode,
  AccountSessionState,
  AvatarDebugRequestedBy,
  ReasonCode,
  type AvatarDebugProbeResultEnvelope,
} from '@nimiplatform/sdk/runtime/generated';
import {
  buildNimiRuntimeGenerationSubmitRequest,
  createNimiSpeechTranscriptionScenario,
} from '@nimiplatform/sdk/features/generation';
import { getRuntimeDefaults } from '../bridge/index.js';
import { startAvatarRuntimeCarrier } from '../carrier/avatar-carrier.js';
import { createDriver, resolveDriverKind } from '../driver/factory.js';
import { resolveLocalAvatarAssetManifest } from '../carrier/model-resolver.js';
import type { AvatarRuntimeCarrier } from '../carrier/avatar-carrier.js';
import { ulid } from '../infra/ids.js';
import { readAvatarShellSettings } from '../settings-state.js';
import type { AgentDataDriver } from '../driver/types.js';
import { startAvatarVoiceCaptureSession, type AvatarVoiceCaptureSession } from '../voice-capture.js';
import { recordAvatarEvidenceEventually } from './avatar-evidence.js';
import type { BootstrapHandle } from './app-bootstrap-types.js';
import { detectDeviceTier } from './device-tier-detector.js';
import { resolveAvatarConversationContext } from './avatar-conversation-context.js';
import { useAvatarStore } from './app-store.js';
import {
  createAvatarAccountCaller,
  createAvatarRuntimeClient,
  createAvatarRuntimeAppSessionMetadataProvider,
  registerAvatarRuntimeApp,
  resolveLaunchAgentIdentity,
} from './app-bootstrap-runtime-binding.js';
import { recordLocalAvatarAssetResolved } from './app-bootstrap-package-evidence.js';
import { isTauriRuntime, onShellReady } from './tauri-lifecycle.js';
import { bindAvatarRuntimeIdentity, setAlwaysOnTop } from './tauri-commands.js';
import {
  applyLaunchContextRuntimeDefaults,
  errorMessage,
  installAvatarRuntimeBridge,
  loadSelectedMockScenarioFixture,
  readNormalizedString,
  resolveRuntimeAppId,
  waitForAvatarLaunchContext,
} from './app-bootstrap-helpers.js';
import {
  diagnosticEnumString,
  ensureRuntimeDaemonReady,
  firstPartyUnavailableDetail,
  readEnumName,
  recordDriverStartFailure,
  runFirstPartyStage,
  runFirstPartyStageWithTimeout,
  setRuntimeBindingUnavailable,
} from './app-bootstrap-first-party-diagnostics.js';

const AVATAR_FIRST_PARTY_APP_ID = 'nimi.avatar';
const AVATAR_FIRST_PARTY_DRIVER_START_TIMEOUT_MS = 12_000;

export type { BootstrapHandle } from './app-bootstrap-types.js';

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export async function bootstrapAvatar(): Promise<BootstrapHandle> {
  let shellUnlisten: (() => void) | null = null;
  let driver: AgentDataDriver | null = null;
  let carrier: AvatarRuntimeCarrier | null = null;
  let unsubscribeStatus = () => {};
  let unsubscribeBundle = () => {};
  let activeVoiceCapture: AvatarVoiceCaptureSession | null = null;
  let cleanedUp = false;
  let getVoiceInputAvailability: BootstrapHandle['getVoiceInputAvailability'] = async () => ({
    available: false,
    reason: 'Foreground voice is unavailable outside runtime-bound mode.',
  });
  let startVoiceCapture: BootstrapHandle['startVoiceCapture'] = async () => {
    throw new Error('Foreground voice is unavailable outside runtime-bound mode');
  };
  let submitVoiceCaptureTurn: BootstrapHandle['submitVoiceCaptureTurn'] = async () => {
    throw new Error('Foreground voice is unavailable outside runtime-bound mode');
  };
  let cancelCompanionParticipation: BootstrapHandle['cancelCompanionParticipation'] = async () => {
    throw new Error('Foreground voice is unavailable outside runtime-bound mode');
  };
  let interruptActiveTurn: BootstrapHandle['interruptActiveTurn'] = async () => {
    throw new Error('Foreground voice is unavailable outside runtime-bound mode');
  };
  let requestCompanionParticipation: BootstrapHandle['requestCompanionParticipation'] = async () => {
    throw new Error('avatar companion input is unavailable outside runtime-bound mode');
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
    // Wave 4 chunk 4-C: one-shot device-tier detection (cached). The
    // result drives alpha-mask vs bbox-only fallback in the per-backend
    // hit-region constructors. If detection throws, we proceed — the
    // hit-region constructors fall back to tier C (bbox-only) per
    // app-shell-contract.md §2.3.2.
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
      // Browser dev mode (pnpm dev:renderer without Tauri shell) — mark shell ready immediately with current window size
      useAvatarStore.getState().markShellReady({
        width: typeof window !== 'undefined' ? window.innerWidth : 400,
        height: typeof window !== 'undefined' ? window.innerHeight : 600,
      });
    }

    const driverKind = resolveDriverKind();

    if (driverKind === 'mock') {
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
    } else {
      const runtimeBridge = installAvatarRuntimeBridge();
      if (!runtimeBridge.installed) {
        throw new Error(`avatar real runtime bootstrap requires Nimi shell runtime bridge: ${runtimeBridge.reason}`);
      }
      const launchContext = await waitForAvatarLaunchContext(5_000);
      useAvatarStore.getState().setLaunchContext(launchContext);

      const runtimeDefaults = applyLaunchContextRuntimeDefaults(
        await getRuntimeDefaults(),
        launchContext,
      );
      useAvatarStore.getState().setRuntimeDefaults(runtimeDefaults);

      useAvatarStore.getState().setConsumeMode({
        mode: 'sdk',
        authority: 'runtime',
        fixtureId: null,
        fixturePlaying: false,
      });
      const runtimeAppId = resolveRuntimeAppId(launchContext);
      useAvatarStore.getState().clearBundle();
      useAvatarStore.getState().clearRuntimeBinding();
      let evidenceAgentId = readNormalizedString(launchContext.agentId);
      let currentConversationAnchorId: string | null = null;
      let currentAvatarInstanceId: string | null = readNormalizedString(launchContext.avatarInstanceId);
      try {
        await runFirstPartyStage('runtime_daemon_prepare', () => ensureRuntimeDaemonReady());
        const nimiClient = createAvatarRuntimeClient({
          appId: runtimeAppId,
          host: runtimeBridge.host,
        });
        await runFirstPartyStage('runtime_client_ready', () => nimiClient.runtime.ready());
        const runtime = nimiClient.runtime;
        const runtimeAgent = createNimiRuntimeAgentConsumeClient({
          runtime,
          runtimeAppId,
        });
        // Wave_1 step_4: hand the SDK Runtime instance to the shared
        // audio pipeline so AudioPipelineController.play() can resolve
        // `runtime.artifacts.readArtifactBytes` (S-RUNTIME-111). Idempotent —
        // first non-null wins; subsequent rebinds (e.g. logout/login)
        // are dropped to keep a single Runtime authority over voice
        // playback for this session.
        getSharedAudioPipelineController().setRuntime(runtime);
        const accountCaller = createAvatarAccountCaller(runtimeAppId);
        await runFirstPartyStage('runtime_app_registration', () => registerAvatarRuntimeApp(runtime.auth, runtimeAppId));
        const accountStatus = await runFirstPartyStage('account_session_status', () => runtime.account.getAccountSessionStatus({ caller: accountCaller }));
        const accountId = readNormalizedString(accountStatus.accountProjection?.accountId);
        if (accountStatus.state !== AccountSessionState.AUTHENTICATED || !accountId) {
          const accountStatusRecord = accountStatus as unknown as Record<string, unknown>;
          useAvatarStore.getState().setRuntimeBindingStatus({
            status: 'unavailable',
            reason: 'runtime_account_session_unavailable',
            reasonCode: diagnosticEnumString(accountStatus.reasonCode),
            accountReasonCode: diagnosticEnumString(accountStatus.accountReasonCode),
            actionHint: 'authenticate_runtime_account',
            stage: 'account_session_status',
            source: 'runtime',
            retryable: true,
          });
          useAvatarStore.getState().setDriverStatus('stopped');
          recordAvatarEvidenceEventually({
            kind: 'avatar.runtime.bind-failed',
            detail: {
              agentId: evidenceAgentId,
              avatar_instance_id: launchContext.avatarInstanceId || null,
              launch_source: launchContext.launchSource,
              runtime_app_id: runtimeAppId,
              account_state: accountStatus.state,
              account_state_name: readEnumName(
                AccountSessionState,
                accountStatus.state,
              ),
              reason_code: accountStatus.reasonCode,
              reason_code_name: readEnumName(
                ReasonCode,
                accountStatus.reasonCode,
              ),
              account_reason_code: accountStatus.accountReasonCode,
              account_reason_code_name: readEnumName(
                AccountReasonCode,
                accountStatus.accountReasonCode,
              ),
              account_projection_present: Boolean(accountStatus.accountProjection),
              account_projection_account_id: accountId || null,
              production_inert: accountStatus.productionInert,
              caller_app_id: accountCaller.appId,
              caller_app_instance_id: accountCaller.appInstanceId,
              caller_mode: accountCaller.mode,
              raw_account_reason_code: accountStatusRecord.accountReasonCode ?? null,
              raw_reason_code: accountStatusRecord.reasonCode ?? null,
              reason: 'runtime_account_session_unavailable',
            },
          });
          return buildHandle();
        }

        const {
          ownerUserId,
          runtimeSourceRef,
          localAgentRef,
        } = resolveLaunchAgentIdentity({
          agentId: launchContext.agentId,
          accountId,
        });
        evidenceAgentId = localAgentRef;
        const agentId = localAgentRef;

        const tokenResponse = await runFirstPartyStage('account_access_token', () => runtime.account.getAccessToken({
          caller: accountCaller,
          requestedScopes: [],
        }));
        if (!tokenResponse.accepted || !readNormalizedString(tokenResponse.accessToken)) {
          useAvatarStore.getState().setRuntimeBindingStatus({
            status: 'unavailable',
            reason: 'runtime_account_access_token_unavailable',
            reasonCode: diagnosticEnumString(tokenResponse.reasonCode),
            accountReasonCode: diagnosticEnumString(tokenResponse.accountReasonCode),
            actionHint: 'refresh_runtime_account_access',
            stage: 'account_access_token',
            source: 'runtime',
            retryable: true,
          });
          useAvatarStore.getState().setDriverStatus('stopped');
          recordAvatarEvidenceEventually({
            kind: 'avatar.runtime.bind-failed',
            detail: {
              agentId,
              avatar_instance_id: launchContext.avatarInstanceId || null,
              launch_source: launchContext.launchSource,
              runtime_app_id: runtimeAppId,
              reason: 'runtime_account_access_token_unavailable',
              account_reason_code: tokenResponse.accountReasonCode || null,
              reason_code: tokenResponse.reasonCode || null,
            },
          });
          return buildHandle();
        }

        const avatarInstanceId = readNormalizedString(launchContext.avatarInstanceId) || `avatar-${Date.now()}`;
        currentAvatarInstanceId = avatarInstanceId;
        const avatarRuntimeAppSessionMetadata = createAvatarRuntimeAppSessionMetadataProvider(runtime.auth, runtimeAppId);
        const withAvatarRuntimeAgentScopes: NimiRuntimeAgentScopeRunner = async (scopes, operation) => {
          const sessionMetadata = await avatarRuntimeAppSessionMetadata();
          return withNimiRuntimeAgentScopes({
            runtime: {
              appId: runtimeAppId,
              auth: runtime.auth,
              appAuth: runtime.grants,
            },
            subjectUserId: accountId,
          }, scopes, async (options) => operation({
            ...options,
            metadata: {
              ...sessionMetadata,
              ...(options.metadata ?? {}),
            },
          }));
        };
        const conversationContext = await runFirstPartyStage('conversation_context', () => resolveAvatarConversationContext({
          runtimeAgent,
          withScopes: withAvatarRuntimeAgentScopes,
          accountId,
          ownerUserId,
          runtimeSourceRef,
          localAgentRef,
          avatarInstanceId,
        }));
        const { conversationAnchorId, subjectUserId } = conversationContext;
        const runtimeAgentTurns = createNimiRuntimeAgentTurnsModule({
          runtime: {
            appId: runtimeAppId,
            auth: runtime.auth,
            appAuth: runtime.grants,
            agents: {
              getPublicChatSessionSnapshot: runtime.agents.getPublicChatSessionSnapshot,
              subscribeAgentEvents: runtime.agents.subscribeAgentEvents,
            },
            appMessages: runtime.appMessages,
          },
          getSubjectUserId: () => subjectUserId,
          withScopes: withAvatarRuntimeAgentScopes,
        });
        currentConversationAnchorId = conversationAnchorId;
        await runFirstPartyStage('runtime_identity_binding', () => bindAvatarRuntimeIdentity({
          avatarInstanceId,
          ownerUserId,
          runtimeSourceRef,
          localAgentRef,
          launchSource: launchContext.launchSource,
        }));
        useAvatarStore.getState().setRuntimeConsumeContext({
          avatarInstanceId,
          conversationAnchorId,
          agentId,
          worldId: '',
        });
        const modelManifest = await runFirstPartyStage('local_avatar_asset_manifest', () => resolveLocalAvatarAssetManifest({
          accountId,
          ownerUserId,
          runtimeSourceRef,
          localAgentRef,
        }));
        driver = await runFirstPartyStage('driver_create', async () => createDriver({
          kind: 'sdk',
          sdk: {
            runtimeAgent,
            withScopes: withAvatarRuntimeAgentScopes,
            ownerUserId,
            runtimeSourceRef,
            localAgentRef,
            conversationAnchorId,
            activeWorldId: '',
            activeUserId: subjectUserId,
            locale: typeof navigator !== 'undefined' ? navigator.language : 'en-US',
            sessionId: conversationAnchorId,
          },
        }));
        useAvatarStore.getState().setRuntimeBinding({
          avatarInstanceId,
          conversationAnchorId,
          agentId,
          worldId: '',
        });
        recordAvatarEvidenceEventually({
          kind: 'avatar.startup.runtime-bound',
          detail: {
            runtime_app_id: AVATAR_FIRST_PARTY_APP_ID,
            avatar_instance_id: avatarInstanceId,
            launch_source: launchContext.launchSource,
          },
        });
        recordLocalAvatarAssetResolved({
          localAgentRef,
          avatarInstanceId,
          conversationAnchorId,
          manifest: modelManifest,
        });
        getVoiceInputAvailability = async () => {
          try {
            await runtime.ready();
            return { available: true, reason: null };
          } catch (error) {
            return { available: false, reason: errorMessage(error) };
          }
        };
        startVoiceCapture = async (input) => {
          activeVoiceCapture = await startAvatarVoiceCaptureSession({
            onLevelChange: input.onLevelChange,
          });
          return activeVoiceCapture;
        };
        const requestRuntimeCompanionParticipation = async (input: {
          agentId: string;
          conversationAnchorId: string;
          text: string;
        }) => {
          return runtimeAgent.companionParticipation.request({
            ownerUserId,
            runtimeSourceRef,
            localAgentRef: input.agentId,
            conversationAnchorId: input.conversationAnchorId,
            surfaceKind: 'avatar_companion',
            triggerSource: 'user_explicit',
            text: input.text,
          });
        };
        requestCompanionParticipation = requestRuntimeCompanionParticipation;
        submitVoiceCaptureTurn = async (input) => {
          const transcription = await runNimiRuntimeScenarioJob({
            ai: runtime.ai,
            request: buildNimiRuntimeGenerationSubmitRequest({
              appId: runtimeAppId,
              subjectUserId,
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
          if (!transcript) {
            throw new Error('Foreground voice transcription returned an empty transcript.');
          }
          await requestRuntimeCompanionParticipation({
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
            ...(input.reason ? { reason: input.reason } : {}),
          });
        };
        avatarDebug = {
          snapshot: async (input) => withAvatarRuntimeAgentScopes(
            ['runtime.agent.avatar_debug.read'],
            (options) => runtimeAgent.avatarDebug.snapshot({
              ownerUserId,
              runtimeSourceRef,
              localAgentRef: input.agentId,
              conversationAnchorId: input.conversationAnchorId,
            }, options),
          ),
          requestProbe: async (input) => withAvatarRuntimeAgentScopes(
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
          listProbeResults: async (input) => withAvatarRuntimeAgentScopes(
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
        if (!activeDriver) {
          throw new Error('Avatar runtime driver was not created');
        }
        carrier = await runFirstPartyStage('runtime_carrier_start', () => startAvatarRuntimeCarrier({
          driver: activeDriver,
          modelManifest,
          submitDebugProbeResult: async (
            result: AvatarDebugProbeResultEnvelope,
            scopedBinding: unknown,
          ) => {
            const scopedBindingRecord = optionalRecord(scopedBinding);
            await withAvatarRuntimeAgentScopes(
              ['runtime.agent.avatar_debug.write'],
              async (options) => {
                await runtime.agents.submitAvatarDebugProbeResult({
                  context: {
                    appId: runtimeAppId,
                    subjectUserId,
                    ownerUserId,
                    runtimeSourceRef,
                    localAgentRef,
                    ...(scopedBindingRecord ? { scopedBinding: scopedBindingRecord as never } : {}),
                  },
                  agentId,
                  conversationAnchorId,
                  result,
                }, options);
              },
            );
          },
        }));
        recordAvatarEvidenceEventually({
          kind: 'avatar.runtime.bound',
          detail: {
            agentId: evidenceAgentId,
            avatar_instance_id: launchContext.avatarInstanceId || null,
            launch_source: launchContext.launchSource,
            runtime_app_id: runtimeAppId,
            conversation_anchor_id: conversationAnchorId,
            account_projection: 'runtime',
            conversation_recovered: conversationContext.recovered,
          },
        });
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
            agentId: evidenceAgentId,
            avatar_instance_id: currentAvatarInstanceId || launchContext.avatarInstanceId || null,
            launch_source: launchContext.launchSource,
            runtime_app_id: runtimeAppId,
            conversation_anchor_id: currentConversationAnchorId,
            reason: unavailable.reason,
            error_stage: unavailable.stage,
            error_reason_code: unavailable.reasonCode,
            error_account_reason_code: unavailable.accountReasonCode,
            error_action_hint: unavailable.actionHint,
            error_source: unavailable.source,
            error_retryable: unavailable.retryable,
            error_message: unavailable.message,
          },
        });
        return buildHandle();
      }
    }

    if (!driver) {
      return buildHandle();
    }

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
            agentId: state.consume.agentId || state.launch.context?.agentId || '',
            avatar_instance_id: state.consume.avatarInstanceId || state.launch.context?.avatarInstanceId || null,
            launch_source: state.launch.context?.launchSource || null,
            runtime_app_id: AVATAR_FIRST_PARTY_APP_ID,
            conversation_anchor_id: state.consume.conversationAnchorId || null,
            driver_status: status,
            error_message: driverError,
          },
        });
      }
    });

    unsubscribeBundle = driver.onBundleChange((bundle) => {
      useAvatarStore.getState().setBundle(bundle);
    });

    try {
      await runFirstPartyStageWithTimeout(
        'driver_start',
        AVATAR_FIRST_PARTY_DRIVER_START_TIMEOUT_MS,
        () => activeDriver?.start() ?? Promise.resolve(),
      );
      if (activeDriver?.kind === 'sdk') {
        const state = useAvatarStore.getState();
        const bundle = activeDriver.getBundle();
        const custom = bundle.custom || {};
        recordAvatarEvidenceEventually({
          kind: 'avatar.runtime.consume-ready',
          detail: {
            agentId: state.consume.agentId || state.launch.context?.agentId || '',
            avatar_instance_id: state.consume.avatarInstanceId || state.launch.context?.avatarInstanceId || null,
            launch_source: state.launch.context?.launchSource || null,
            runtime_app_id: AVATAR_FIRST_PARTY_APP_ID,
            conversation_anchor_id: state.consume.conversationAnchorId || null,
            driver_status: activeDriver.status,
            session_id: bundle.runtime.session_id,
            session_status: custom.session_status ?? null,
            transcript_message_count: custom.transcript_message_count ?? null,
            latest_committed_message_id: custom.latest_committed_message_id ?? null,
            latest_committed_turn_id: custom.latest_committed_turn_id ?? null,
            scoped_binding_attached: false,
          },
        });
      }
    } catch (error) {
      const state = useAvatarStore.getState();
      recordDriverStartFailure(error, {
        agentId: state.consume.agentId || state.launch.context?.agentId || '',
        avatarInstanceId: state.consume.avatarInstanceId || state.launch.context?.avatarInstanceId || null,
        launchSource: state.launch.context?.launchSource || null,
        runtimeAppId: AVATAR_FIRST_PARTY_APP_ID,
      });
      carrier?.shutdown();
      carrier = null;
      if (driver) {
        await driver.stop().catch(() => {});
        driver = null;
      }
      useAvatarStore.getState().setDriverStatus('error');
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
