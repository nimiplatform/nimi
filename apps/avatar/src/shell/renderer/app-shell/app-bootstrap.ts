import { startAvatarRuntimeCarrier } from '../carrier/avatar-carrier.js';
import type { AvatarRuntimeCarrier } from '../carrier/avatar-carrier.js';
import { createDriver, resolveDriverKind } from '../driver/factory.js';
import type { AgentDataDriver } from '../driver/types.js';
import { readAvatarShellSettings } from '../settings-state.js';
import { recordAvatarEvidenceEventually } from './avatar-evidence.js';
import type { BootstrapHandle } from './app-bootstrap-types.js';
import { detectDeviceTier } from './device-tier-detector.js';
import { useAvatarStore } from './app-store.js';
import { isTauriRuntime, onShellReady } from './tauri-lifecycle.js';
import { setAlwaysOnTop } from './tauri-commands.js';
import {
  loadSelectedMockScenarioFixture,
  readNormalizedString,
} from './app-bootstrap-helpers.js';
import {
  recordDriverStartFailure,
  runFirstPartyStage,
  runFirstPartyStageWithTimeout,
} from './app-bootstrap-first-party-diagnostics.js';

const AVATAR_FIRST_PARTY_APP_ID = 'nimi.avatar';
const AVATAR_FIRST_PARTY_DRIVER_START_TIMEOUT_MS = 12_000;

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
  let cleanedUp = false;
  const getVoiceInputAvailability: BootstrapHandle['getVoiceInputAvailability'] = async () => ({
    available: false,
    reason: 'Foreground voice requires a protected Desktop launch session.',
  });
  const startVoiceCapture: BootstrapHandle['startVoiceCapture'] = async () => {
    throw new Error('Foreground voice requires a protected Desktop launch session');
  };
  const submitVoiceCaptureTurn: BootstrapHandle['submitVoiceCaptureTurn'] = async () => {
    throw new Error('Foreground voice requires a protected Desktop launch session');
  };
  const cancelCompanionParticipation: BootstrapHandle['cancelCompanionParticipation'] = async () => {
    throw new Error('Foreground voice requires a protected Desktop launch session');
  };
  const interruptActiveTurn: BootstrapHandle['interruptActiveTurn'] = async () => {
    throw new Error('Foreground voice requires a protected Desktop launch session');
  };
  const requestCompanionParticipation: BootstrapHandle['requestCompanionParticipation'] = async () => {
    throw new Error('avatar companion input requires a protected Desktop launch session');
  };
  const avatarDebug: BootstrapHandle['avatarDebug'] = null;
  const cleanup = async () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    unsubscribeStatus();
    unsubscribeBundle();
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
      useAvatarStore.getState().setRuntimeBindingStatus({
        status: 'unavailable',
        reason: 'protected_launch_session_required',
        reasonCode: 'PROTECTED_ORIGIN_ROLE_MISMATCH',
        actionHint: 'connect_protected_desktop_control_carrier',
        stage: 'protected_launch_session',
        source: 'runtime',
        retryable: false,
      });
      useAvatarStore.getState().setDriverStatus('stopped');
      recordAvatarEvidenceEventually({
        kind: 'avatar.runtime.bind-failed',
        detail: {
          runtime_app_id: AVATAR_FIRST_PARTY_APP_ID,
          reason: 'protected_launch_session_required',
          error_stage: 'protected_launch_session',
          error_reason_code: 'PROTECTED_ORIGIN_ROLE_MISMATCH',
          error_action_hint: 'connect_protected_desktop_control_carrier',
          error_source: 'runtime',
          error_retryable: false,
        },
      });
      return buildHandle();
    }

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
