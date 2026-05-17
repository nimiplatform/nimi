import { createLocalFirstPartyRuntimePlatformClient } from '@nimiplatform/sdk';
import { getSharedAudioPipelineController } from '../audio/audio-pipeline.js';
import {
  type RuntimeCompanionParticipationProjection,
  type Runtime,
} from '@nimiplatform/sdk/runtime/browser';
import { getDaemonStatus, getRuntimeDefaults, hasTauriInvoke, startDaemon } from '@renderer/bridge';
import { startAvatarRuntimeCarrier } from '../carrier/avatar-carrier.js';
import { createDriver, resolveDriverKind } from '../driver/factory.js';
import { resolveLocalAvatarAssetManifest } from '../carrier/model-resolver.js';
import type { AvatarRuntimeCarrier } from '../carrier/avatar-carrier.js';
import { readAvatarShellSettings } from '../settings-state.js';
import type { AgentDataDriver } from '../driver/types.js';
import { startAvatarVoiceCaptureSession, type AvatarVoiceCaptureSession } from '../voice-capture.js';
import { recordAvatarEvidenceEventually } from './avatar-evidence.js';
import { detectDeviceTier } from './device-tier-detector.js';
import { resolveAvatarConversationContext } from './avatar-conversation-context.js';
import { useAvatarStore } from './app-store.js';
import {
  createAvatarAccountCaller,
  resolveLaunchAgentIdentity,
} from './app-bootstrap-runtime-binding.js';
import { recordLocalAvatarAssetResolved } from './app-bootstrap-package-evidence.js';
import { isTauriRuntime, onShellReady } from './tauri-lifecycle.js';
import { bindAvatarRuntimeIdentity, setAlwaysOnTop } from './tauri-commands.js';
import {
  applyLaunchContextRuntimeDefaults,
  errorMessage,
  installTauriRuntimeSdkHook,
  loadDefaultMockScenarioJson,
  readNormalizedString,
  resolveCapabilityBinding,
  resolveRuntimeAppId,
  waitForAvatarLaunchContext,
} from './app-bootstrap-helpers.js';

const AVATAR_FIRST_PARTY_APP_ID = 'nimi.avatar';
const ACCOUNT_SESSION_STATE_AUTHENTICATED = 3;
const AVATAR_FIRST_PARTY_DRIVER_START_TIMEOUT_MS = 12_000;

type FirstPartyBootstrapStage =
  | 'runtime_daemon_prepare'
  | 'platform_client'
  | 'account_session_status'
  | 'account_access_token'
  | 'conversation_context'
  | 'runtime_identity_binding'
  | 'local_avatar_asset_manifest'
  | 'driver_create'
  | 'runtime_carrier_start'
  | 'driver_start';

type FirstPartyBootstrapErrorDetail = {
  reason: string;
  stage: string | null;
  reasonCode: string | null;
  accountReasonCode: string | null;
  actionHint: string | null;
  source: string | null;
  retryable: boolean | null;
  message: string | null;
};

type FirstPartyStageFallbackDiagnostic = {
  reasonCode: string;
  actionHint: string;
  source: string;
  retryable: boolean;
};

function readErrorField(error: unknown, field: string): string {
  if (!error || typeof error !== 'object') {
    return '';
  }
  const value = (error as Record<string, unknown>)[field];
  return typeof value === 'string' ? value.trim() : '';
}

function readErrorBooleanField(error: unknown, field: string): boolean | null {
  if (!error || typeof error !== 'object') {
    return null;
  }
  const value = (error as Record<string, unknown>)[field];
  return typeof value === 'boolean' ? value : null;
}

function truncateErrorText(value: string, limit = 220): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}

function describeRuntimeDaemonStatus(status: {
  running?: boolean;
  managed?: boolean;
  launchMode?: string;
  grpcAddr?: string;
  lastError?: string;
} | null | undefined): string {
  if (!status) {
    return 'missing status';
  }
  const parts = [
    `running=${status.running === true ? 'true' : 'false'}`,
    `managed=${status.managed === true ? 'true' : 'false'}`,
    `mode=${readNormalizedString(status.launchMode) || 'unknown'}`,
  ];
  const grpcAddr = readNormalizedString(status.grpcAddr);
  if (grpcAddr) {
    parts.push(`grpc=${grpcAddr}`);
  }
  const lastError = readNormalizedString(status.lastError);
  if (lastError) {
    parts.push(`error=${lastError}`);
  }
  return parts.join(' ');
}

function runtimeDaemonUnavailableError(status: {
  running?: boolean;
  managed?: boolean;
  launchMode?: string;
  grpcAddr?: string;
  lastError?: string;
} | null | undefined): Error {
  return Object.assign(
    new Error(`runtime daemon unavailable after start: ${describeRuntimeDaemonStatus(status)}`),
    {
      reasonCode: readNormalizedString(status?.lastError) || 'RUNTIME_BRIDGE_DAEMON_UNAVAILABLE',
      actionHint: 'start_runtime_daemon',
      source: 'runtime',
      retryable: true,
    },
  );
}

function readEnumName(enumObject: Record<string, string | number>, value: unknown): string | null {
  return typeof value === 'number'
    ? readNormalizedString(enumObject[value])
    : null;
}

function diagnosticEnumString(value: unknown): string | null {
  if (typeof value === 'string') {
    return readNormalizedString(value);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function fallbackDiagnosticForFirstPartyStage(
  stage: string | null,
): FirstPartyStageFallbackDiagnostic | null {
  switch (stage) {
    case 'local_avatar_asset_manifest':
      return {
        reasonCode: 'LOCAL_AVATAR_ASSET_RESOLVE_FAILED',
        actionHint: 'reimport_or_select_local_avatar_asset',
        source: 'avatar_local_materialization',
        retryable: false,
      };
    default:
      return null;
  }
}

async function ensureRuntimeDaemonReady(): Promise<void> {
  const current = await getDaemonStatus();
  if (current.running) {
    return;
  }
  const started = await startDaemon();
  if (!started.running) {
    throw runtimeDaemonUnavailableError(started);
  }
}

function annotateFirstPartyBootstrapError(stage: FirstPartyBootstrapStage, error: unknown): never {
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    if (typeof record.avatarBootstrapStage !== 'string' || !record.avatarBootstrapStage.trim()) {
      record.avatarBootstrapStage = stage;
    }
    throw error;
  }
  const wrapped = new Error(String(error || 'avatar_first_party_runtime_unavailable')) as Error & {
    avatarBootstrapStage?: string;
  };
  wrapped.avatarBootstrapStage = stage;
  throw wrapped;
}

async function runFirstPartyStage<T>(
  stage: FirstPartyBootstrapStage,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    annotateFirstPartyBootstrapError(stage, error);
  }
}

async function runFirstPartyStageWithTimeout<T>(
  stage: FirstPartyBootstrapStage,
  timeoutMs: number,
  operation: () => Promise<T>,
): Promise<T> {
  let timeoutId: number | null = null;
  try {
    return await runFirstPartyStage(stage, () => Promise.race([
      operation(),
      new Promise<T>((_, reject) => {
        timeoutId = window.setTimeout(() => {
          reject(new Error(`${stage} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]));
  } finally {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  }
}

function firstPartyUnavailableDetail(error: unknown): FirstPartyBootstrapErrorDetail {
  const stage = readErrorField(error, 'avatarBootstrapStage') || null;
  const fallback = fallbackDiagnosticForFirstPartyStage(stage);
  const accountReasonCode = readErrorField(error, 'accountReasonCode') || null;
  const reasonCode = readErrorField(error, 'reasonCode') || fallback?.reasonCode || null;
  const actionHint = readErrorField(error, 'actionHint') || fallback?.actionHint || null;
  const source = readErrorField(error, 'source') || fallback?.source || null;
  const message = error instanceof Error
    ? truncateErrorText(error.message)
    : truncateErrorText(String(error || 'avatar_first_party_runtime_unavailable'));
  const primary = accountReasonCode || reasonCode || message || 'avatar_first_party_runtime_unavailable';
  const suffix = actionHint ? ` / ${actionHint}` : '';
  return {
    reason: stage ? `${stage}: ${primary}${suffix}` : `${primary}${suffix}`,
    stage,
    reasonCode,
    accountReasonCode,
    actionHint,
    source,
    retryable: readErrorBooleanField(error, 'retryable') ?? fallback?.retryable ?? null,
    message: message || null,
  };
}

function setRuntimeBindingUnavailable(detail: FirstPartyBootstrapErrorDetail): void {
  useAvatarStore.getState().setRuntimeBindingStatus({
    status: 'unavailable',
    reason: detail.reason,
    reasonCode: detail.reasonCode,
    accountReasonCode: detail.accountReasonCode,
    actionHint: detail.actionHint,
    stage: detail.stage,
    source: detail.source,
    retryable: detail.retryable,
  });
}

function recordDriverStartFailure(error: unknown, input: {
  agentId: string;
  avatarInstanceId: string | null;
  launchSource: string | null;
  runtimeAppId: string;
}): void {
  const unavailable = firstPartyUnavailableDetail(error);
  setRuntimeBindingUnavailable(unavailable);
  useAvatarStore.getState().setDriverStatus('error');
  recordAvatarEvidenceEventually({
    kind: 'avatar.runtime.bind-failed',
    detail: {
      agentId: input.agentId,
      avatar_instance_id: input.avatarInstanceId,
      launch_source: input.launchSource,
      runtime_app_id: input.runtimeAppId,
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
}

export type BootstrapHandle = {
  driver?: AgentDataDriver | null;
  carrier?: AvatarRuntimeCarrier | null;
  getVoiceInputAvailability(input: {
    agentId: string;
    conversationAnchorId: string;
  }): Promise<{
    available: boolean;
    reason: string | null;
  }>;
  startVoiceCapture(input: {
    agentId: string;
    conversationAnchorId: string;
    onLevelChange?: (amplitude: number) => void;
  }): Promise<AvatarVoiceCaptureSession>;
  submitVoiceCaptureTurn(input: {
    agentId: string;
    conversationAnchorId: string;
    audioBytes: Uint8Array;
    mimeType: string;
    language?: string;
    signal?: AbortSignal;
  }): Promise<{
    transcript: string;
  }>;
  cancelCompanionParticipation(input: {
    agentId: string;
    conversationAnchorId: string;
    projectionId?: string;
    turnId?: string;
    reason?: string;
  }): Promise<RuntimeCompanionParticipationProjection>;
  requestCompanionParticipation(input: {
    agentId: string;
    conversationAnchorId: string;
    text: string;
  }): Promise<RuntimeCompanionParticipationProjection>;
  shutdown(): Promise<void>;
};

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
  let requestCompanionParticipation: BootstrapHandle['requestCompanionParticipation'] = async () => {
    throw new Error('avatar companion input is unavailable outside runtime-bound mode');
  };
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
    requestCompanionParticipation,
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
      const scenarioJson = await loadDefaultMockScenarioJson();
      useAvatarStore.getState().setConsumeMode({
        mode: 'mock',
        authority: 'fixture',
        fixtureId: 'default',
        fixturePlaying: true,
      });
      driver = createDriver({
        kind: 'mock',
        scenarioJson,
        scenarioSource: 'default.mock.json',
      });
    } else {
      if (!isTauriRuntime() || !hasTauriInvoke()) {
        throw new Error('avatar real runtime bootstrap requires Tauri runtime');
      }
      installTauriRuntimeSdkHook();
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
        const platformClient = await runFirstPartyStage('platform_client', () => createLocalFirstPartyRuntimePlatformClient({
          appId: runtimeAppId,
          realmBaseUrl: runtimeDefaults.realm.realmBaseUrl,
          runtimeTransport: {
            type: 'tauri-ipc',
            commandNamespace: 'runtime_bridge',
            eventNamespace: 'runtime_bridge',
          },
        }));
        const runtime = platformClient.runtime;
        // Wave_1 step_4: hand the SDK Runtime instance to the shared
        // audio pipeline so AudioPipelineController.play() can resolve
        // `runtime.artifacts.readBytes` (S-RUNTIME-111). Idempotent —
        // first non-null wins; subsequent rebinds (e.g. logout/login)
        // are dropped to keep a single Runtime authority over voice
        // playback for this session.
        getSharedAudioPipelineController().setRuntime(runtime);
        const accountCaller = createAvatarAccountCaller(runtimeAppId);
        const accountStatus = await runFirstPartyStage('account_session_status', () => runtime.account.getAccountSessionStatus({ caller: accountCaller }));
        const accountId = readNormalizedString(accountStatus.accountProjection?.accountId);
        if (accountStatus.state !== ACCOUNT_SESSION_STATE_AUTHENTICATED || !accountId) {
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
                // Numeric protobuf enums expose a reverse lookup in the generated runtime.
                // Keep this evidence local so product logic stays keyed on the numeric contract.
                { 0: 'UNSPECIFIED', 1: 'ANONYMOUS', 2: 'LOGIN_PENDING', 3: 'AUTHENTICATED', 4: 'REFRESH_PENDING', 5: 'EXPIRED', 6: 'REAUTH_REQUIRED', 7: 'SWITCHING', 8: 'LOGGING_OUT', 9: 'LOGGED_OUT', 10: 'UNAVAILABLE' },
                accountStatus.state,
              ),
              reason_code: accountStatus.reasonCode,
              reason_code_name: readEnumName(
                { 0: 'REASON_CODE_UNSPECIFIED', 1: 'ACTION_EXECUTED', 5: 'PRINCIPAL_UNAUTHORIZED', 6: 'AUTH_CONTEXT_MISSING', 7: 'SESSION_EXPIRED' },
                accountStatus.reasonCode,
              ),
              account_reason_code: accountStatus.accountReasonCode,
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
          realmAgentId,
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
        const conversationContext = await runFirstPartyStage('conversation_context', () => resolveAvatarConversationContext({
          runtime,
          accountId,
          ownerUserId,
          realmAgentId,
          localAgentRef,
          avatarInstanceId,
        }));
        const { conversationAnchorId, subjectUserId } = conversationContext;
        currentConversationAnchorId = conversationAnchorId;
        await runFirstPartyStage('runtime_identity_binding', () => bindAvatarRuntimeIdentity({
          avatarInstanceId,
          ownerUserId,
          realmAgentId,
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
          realmAgentId,
          localAgentRef,
        }));
        driver = await runFirstPartyStage('driver_create', async () => createDriver({
          kind: 'sdk',
          sdk: {
            runtime,
            ownerUserId,
            realmAgentId,
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
            await resolveCapabilityBinding(runtime, 'audio.transcribe');
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
          return runtime.companionParticipation.request({
            ownerUserId,
            realmAgentId,
            localAgentRef: input.agentId,
            conversationAnchorId: input.conversationAnchorId,
            surfaceKind: 'avatar_companion',
            triggerSource: 'user_explicit',
            text: input.text,
          });
        };
        requestCompanionParticipation = requestRuntimeCompanionParticipation;
        submitVoiceCaptureTurn = async (input) => {
          const transcribeBinding = await resolveCapabilityBinding(runtime, 'audio.transcribe');
          const result = await runtime.media.stt.transcribe({
            model: transcribeBinding.modelId,
            ...(transcribeBinding.connectorId ? { connectorId: transcribeBinding.connectorId } : {}),
            audio: { kind: 'bytes', bytes: input.audioBytes },
            mimeType: input.mimeType,
            ...(input.language ? { language: input.language } : {}),
            ...(input.signal ? { signal: input.signal } : {}),
          });
          const transcript = readNormalizedString(result.text);
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
        cancelCompanionParticipation = async (input) => runtime.companionParticipation.cancel({
          ownerUserId,
          realmAgentId,
          localAgentRef: input.agentId,
          conversationAnchorId: input.conversationAnchorId,
          surfaceKind: 'avatar_companion',
          triggerSource: 'user_explicit',
          ...(input.projectionId ? { projectionId: input.projectionId } : {}),
          ...(input.turnId ? { turnId: input.turnId } : {}),
          ...(input.reason ? { reason: input.reason } : {}),
        });
        const activeDriver = driver;
        if (!activeDriver) {
          throw new Error('Avatar runtime driver was not created');
        }
        carrier = await runFirstPartyStage('runtime_carrier_start', () => startAvatarRuntimeCarrier({
          driver: activeDriver,
          modelManifest,
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

    unsubscribeStatus = driver.onStatusChange((status) => {
      useAvatarStore.getState().setDriverStatus(status);
    });

    unsubscribeBundle = driver.onBundleChange((bundle) => {
      useAvatarStore.getState().setBundle(bundle);
    });

    const activeDriver = driver;
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
