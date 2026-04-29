import { createLocalFirstPartyRuntimePlatformClient } from '@nimiplatform/sdk';
import {
  AccountCallerMode,
  type AccountCaller,
} from '@nimiplatform/sdk/runtime/browser';
import { getDaemonStatus, getRuntimeDefaults, hasTauriInvoke, startDaemon } from '@renderer/bridge';
import { startAvatarRuntimeCarrier } from '../carrier/avatar-carrier.js';
import { createDriver, resolveDriverKind } from '../driver/factory.js';
import { resolveAgentCenterAvatarPackageManifest } from '../live2d/model-loader.js';
import type { AvatarRuntimeCarrier } from '../carrier/avatar-carrier.js';
import { readAvatarShellSettings } from '../settings-state.js';
import type { AgentDataDriver } from '../driver/types.js';
import { startAvatarVoiceCaptureSession, type AvatarVoiceCaptureSession } from '../voice-capture.js';
import { recordAvatarEvidenceEventually } from './avatar-evidence.js';
import { resolveAvatarConversationContext } from './avatar-conversation-context.js';
import { useAvatarStore } from './app-store.js';
import { isTauriRuntime, onShellReady } from './tauri-lifecycle.js';
import { setAlwaysOnTop } from './tauri-commands.js';
import {
  applyLaunchContextRuntimeDefaults,
  errorMessage,
  installTauriRuntimeSdkHook,
  loadDefaultMockScenarioJson,
  readNormalizedString,
  resolveCapabilityBinding,
  resolveExecutionBinding,
  resolveRuntimeAppId,
  waitForAvatarLaunchContext,
} from './app-bootstrap-helpers.js';

const AVATAR_FIRST_PARTY_APP_ID = 'nimi.avatar';
const AVATAR_FIRST_PARTY_APP_INSTANCE_ID = `${AVATAR_FIRST_PARTY_APP_ID}.local-first-party`;
const AVATAR_FIRST_PARTY_DEVICE_ID = 'local-first-party-device';
const ACCOUNT_SESSION_STATE_AUTHENTICATED = 3;
const AVATAR_FIRST_PARTY_DRIVER_START_TIMEOUT_MS = 12_000;

type FirstPartyBootstrapStage =
  | 'runtime_daemon_prepare'
  | 'platform_client'
  | 'account_session_status'
  | 'account_access_token'
  | 'conversation_context'
  | 'avatar_package_manifest'
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

function createAvatarAccountCaller(appId: string): AccountCaller {
  return {
    appId,
    appInstanceId: AVATAR_FIRST_PARTY_APP_INSTANCE_ID,
    deviceId: AVATAR_FIRST_PARTY_DEVICE_ID,
    mode: AccountCallerMode.LOCAL_FIRST_PARTY_APP,
    scopes: [],
  };
}

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
  const accountReasonCode = readErrorField(error, 'accountReasonCode') || null;
  const reasonCode = readErrorField(error, 'reasonCode') || null;
  const actionHint = readErrorField(error, 'actionHint') || null;
  const source = readErrorField(error, 'source') || null;
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
    retryable: readErrorBooleanField(error, 'retryable'),
    message: message || null,
  };
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
  interruptTurn(input: {
    agentId: string;
    conversationAnchorId: string;
    turnId?: string;
    reason?: string;
  }): Promise<void>;
  requestTextTurn(input: {
    agentId: string;
    conversationAnchorId: string;
    text: string;
  }): Promise<void>;
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
  let interruptTurn: BootstrapHandle['interruptTurn'] = async () => {
    throw new Error('Foreground voice is unavailable outside runtime-bound mode');
  };
  let requestTextTurn: BootstrapHandle['requestTextTurn'] = async () => {
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
    interruptTurn,
    requestTextTurn,
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

      const agentId = readNormalizedString(launchContext.agentId);
      if (!agentId) {
        throw new Error('avatar launch context is missing agentId');
      }
      useAvatarStore.getState().setConsumeMode({
        mode: 'sdk',
        authority: 'runtime',
        fixtureId: null,
        fixturePlaying: false,
      });
      const runtimeAppId = resolveRuntimeAppId(launchContext);
      useAvatarStore.getState().clearBundle();
      useAvatarStore.getState().clearRuntimeBinding();
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
        const accountCaller = createAvatarAccountCaller(runtimeAppId);
        const accountStatus = await runFirstPartyStage('account_session_status', () => runtime.account.getAccountSessionStatus({ caller: accountCaller }));
        const accountId = readNormalizedString(accountStatus.accountProjection?.accountId);
        if (accountStatus.state !== ACCOUNT_SESSION_STATE_AUTHENTICATED || !accountId) {
          useAvatarStore.getState().setRuntimeBindingStatus({
            status: 'unavailable',
            reason: 'runtime_account_session_unavailable',
          });
          useAvatarStore.getState().setDriverStatus('stopped');
          recordAvatarEvidenceEventually({
            kind: 'avatar.runtime.bind-failed',
            detail: {
              agentId,
              avatar_instance_id: launchContext.avatarInstanceId || null,
              launch_source: launchContext.launchSource,
              runtime_app_id: runtimeAppId,
              account_state: accountStatus.state,
              reason: 'runtime_account_session_unavailable',
            },
          });
          return buildHandle();
        }

        const tokenResponse = await runFirstPartyStage('account_access_token', () => runtime.account.getAccessToken({
          caller: accountCaller,
          requestedScopes: [],
        }));
        if (!tokenResponse.accepted || !readNormalizedString(tokenResponse.accessToken)) {
          useAvatarStore.getState().setRuntimeBindingStatus({
            status: 'unavailable',
            reason: 'runtime_account_access_token_unavailable',
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
        const conversationContext = await runFirstPartyStage('conversation_context', () => resolveAvatarConversationContext({
          runtime,
          accountId,
          agentId,
          avatarInstanceId,
          launchSource: launchContext.launchSource,
        }));
        const { conversationAnchorId, subjectUserId } = conversationContext;

        const modelManifest = await runFirstPartyStage('avatar_package_manifest', () => resolveAgentCenterAvatarPackageManifest({
          accountId,
          agentId,
        }));
        driver = await runFirstPartyStage('driver_create', async () => createDriver({
          kind: 'sdk',
          sdk: {
            runtime,
            agentId,
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
        const requestRuntimeTextTurn = async (input: {
          agentId: string;
          conversationAnchorId: string;
          text: string;
        }) => {
          const executionBinding = resolveExecutionBinding({
            runtimeDefaults: useAvatarStore.getState().runtime.defaults,
            bundle: useAvatarStore.getState().bundle,
          });
          if (!executionBinding) {
            throw new Error('avatar companion input requires an admitted execution route.');
          }
          await runtime.agent.turns.request({
            agentId: input.agentId,
            conversationAnchorId: input.conversationAnchorId,
            messages: [{ role: 'user', content: input.text }],
            executionBinding,
          });
        };
        requestTextTurn = requestRuntimeTextTurn;
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
          await requestRuntimeTextTurn({
            agentId: input.agentId,
            conversationAnchorId: input.conversationAnchorId,
            text: transcript,
          });
          return { transcript };
        };
        interruptTurn = async (input) => {
          await runtime.agent.turns.interrupt({
            agentId: input.agentId,
            conversationAnchorId: input.conversationAnchorId,
            ...(input.turnId ? { turnId: input.turnId } : {}),
            ...(input.reason ? { reason: input.reason } : {}),
          });
        };
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
            agentId,
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
        useAvatarStore.getState().setRuntimeBindingStatus({
          status: 'unavailable',
          reason: unavailable.reason,
        });
        useAvatarStore.getState().setDriverStatus('stopped');
        recordAvatarEvidenceEventually({
          kind: 'avatar.runtime.bind-failed',
          detail: {
            agentId,
            avatar_instance_id: launchContext.avatarInstanceId || null,
            launch_source: launchContext.launchSource,
            runtime_app_id: runtimeAppId,
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

    await runFirstPartyStageWithTimeout(
      'driver_start',
      AVATAR_FIRST_PARTY_DRIVER_START_TIMEOUT_MS,
      () => driver?.start() ?? Promise.resolve(),
    );

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
