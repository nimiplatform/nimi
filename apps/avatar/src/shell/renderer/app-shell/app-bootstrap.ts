import { Runtime, type RuntimeScopedBindingAttachment } from '@nimiplatform/sdk/runtime/browser';
import { getRuntimeDefaults, hasTauriInvoke, startDaemon, type AvatarLaunchContext } from '@renderer/bridge';
import { createDriver, resolveDriverKind } from '../driver/factory.js';
import { startAvatarVisualCarrier, type AvatarRuntimeCarrier } from '../carrier/avatar-carrier.js';
import { resolveAgentCenterAvatarPackageManifest } from '../live2d/model-loader.js';
import { readAvatarShellSettings } from '../settings-state.js';
import type { AgentDataDriver } from '../driver/types.js';
import { startAvatarVoiceCaptureSession, type AvatarVoiceCaptureSession } from '../voice-capture.js';
import { recordAvatarEvidenceEventually } from './avatar-evidence.js';
import { type RuntimeBindingStatus, useAvatarStore } from './app-store.js';
import { isTauriRuntime, onShellReady } from './tauri-lifecycle.js';
import { setAlwaysOnTop } from './tauri-commands.js';
import {
  applyLaunchContextRuntimeDefaults,
  bindingStatusFromProjection,
  bindingUnavailableMessage,
  createAbortError,
  errorMessage,
  installTauriRuntimeSdkHook,
  loadDefaultMockScenarioJson,
  readNormalizedString,
  resolveCapabilityBinding,
  resolveConversationAnchorId,
  resolveExecutionBinding,
  resolveRuntimeAppId,
  waitForAvatarLaunchContext,
  toRuntimeScopedBindingAttachment,
} from './app-bootstrap-helpers.js';

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
  const store = useAvatarStore.getState();

  let shellUnlisten: (() => void) | null = null;
  let driver: AgentDataDriver | null = null;
  let carrier: AvatarRuntimeCarrier | null = null;
  let runtimeClient: Runtime | null = null;
  let unsubscribeStatus = () => {};
  let unsubscribeBundle = () => {};
  let invalidateRuntimeBindingFromDriver: ((status: RuntimeBindingStatus, reason: string) => Promise<void>) | null = null;
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
  let finishRuntimeBindFailure: ((
    reason: string,
    error: unknown,
    status?: RuntimeBindingStatus,
  ) => Promise<BootstrapHandle>) | null = null;

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
    if (runtimeClient) {
      useAvatarStore.getState().clearRuntimeBinding();
      await runtimeClient.close().catch(() => {});
      runtimeClient = null;
    }
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
      const modelManifest = await resolveAgentCenterAvatarPackageManifest({
        agentId,
        avatarPackageKind: launchContext.avatarPackageKind,
        avatarPackageId: launchContext.avatarPackageId,
        avatarPackageSchemaVersion: launchContext.avatarPackageSchemaVersion,
      });
      recordAvatarEvidenceEventually({
        kind: 'avatar.visual.package-resolved',
        detail: {
          agent_id: agentId,
          avatar_package_kind: launchContext.avatarPackageKind,
          avatar_package_id: launchContext.avatarPackageId,
          runtime_dir: modelManifest.runtimeDir,
          model_id: modelManifest.modelId,
        },
      });
      recordAvatarEvidenceEventually({
        kind: 'avatar.visual.model3-found',
        detail: {
          model_id: modelManifest.modelId,
          model3_json_path: modelManifest.model3JsonPath,
        },
      });
      carrier = await startAvatarVisualCarrier({ modelManifest });
	      finishRuntimeBindFailure = async (
	        reason: string,
	        error: unknown,
	        status: RuntimeBindingStatus = 'unavailable',
	      ): Promise<BootstrapHandle> => {
	        useAvatarStore.getState().clearBundle();
	        useAvatarStore.getState().clearRuntimeBinding();
	        useAvatarStore.getState().setRuntimeBindingStatus({ status, reason });
	        useAvatarStore.getState().setDriverStatus('stopped');
        carrier?.detachRuntimeDriver();
        if (driver) {
          await driver.stop().catch(() => {});
          driver = null;
        }
        if (runtimeClient) {
          await runtimeClient.close().catch(() => {});
          runtimeClient = null;
        }
        recordAvatarEvidenceEventually({
          kind: 'avatar.runtime.bind-failed',
          detail: {
            reason,
            error: error instanceof Error ? error.message : String(error),
            agent_id: agentId,
            avatar_instance_id: launchContext.avatarInstanceId,
          },
        });
        return buildHandle();
      };

      const runtimeAppId = resolveRuntimeAppId(launchContext);
      const runtime = new Runtime({
        appId: runtimeAppId,
        transport: {
          type: 'tauri-ipc',
          commandNamespace: 'runtime_bridge',
          eventNamespace: 'runtime_bridge',
        },
        defaults: {
          callerKind: 'desktop-core',
          callerId: runtimeAppId,
          surfaceId: 'avatar-window',
        },
      });
      runtimeClient = runtime;

      const startedDaemon = await startDaemon();
      if (!startedDaemon.running) {
        return finishRuntimeBindFailure!(
          'daemon_unavailable',
          startedDaemon.lastError?.trim() || 'runtime daemon failed to start',
        );
      }
      try {
        await Promise.race([
          runtime.ready(),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('avatar runtime ready timeout (15s)')), 15_000);
          }),
        ]);
      } catch (error) {
        return finishRuntimeBindFailure!('runtime_ready_failed', error);
      }

      const worldId = readNormalizedString(runtimeDefaults.runtime.worldId);
      if (!worldId) {
        return finishRuntimeBindFailure!('world_id_missing', 'avatar runtime defaults are missing runtime.worldId');
      }

      let conversationAnchorId: string;
      try {
        conversationAnchorId = await resolveConversationAnchorId(launchContext);
      } catch (error) {
        return finishRuntimeBindFailure!('conversation_anchor_failed', error);
      }
	      if (!conversationAnchorId) {
	        return finishRuntimeBindFailure!(
	          'conversation_anchor_missing',
	          'avatar launch context did not resolve conversationAnchorId',
	        );
	      }
	      const launchBindingStatus = bindingStatusFromProjection(launchContext.scopedBinding);
	      useAvatarStore.getState().setRuntimeBinding({
	        avatarInstanceId: launchContext.avatarInstanceId,
	        conversationAnchorId,
	        agentId,
	        worldId,
	        scopedBinding: launchContext.scopedBinding,
	      });
	      if (launchBindingStatus !== 'active') {
	        return finishRuntimeBindFailure!(
	          'scoped_binding_unavailable',
	          bindingUnavailableMessage(launchBindingStatus, launchContext.scopedBinding.reasonCode),
	          launchBindingStatus,
	        );
	      }
	      const scopedBinding = toRuntimeScopedBindingAttachment({
	        binding: launchContext.scopedBinding,
	        runtimeAppId,
	        agentId,
	        conversationAnchorId,
	        worldId,
	      });
	      const invalidateRuntimeBinding = async (status: RuntimeBindingStatus, reason: string) => {
	        useAvatarStore.getState().setRuntimeBindingStatus({ status, reason });
	        useAvatarStore.getState().clearBundle();
	        activeVoiceCapture?.cancel();
	        activeVoiceCapture = null;
	        if (driver) {
	          await driver.stop().catch(() => {});
	        }
	        carrier?.detachRuntimeDriver();
	      };
	      invalidateRuntimeBindingFromDriver = invalidateRuntimeBinding;
	      const requireActiveBinding = (input: {
	        agentId: string;
	        conversationAnchorId: string;
	      }): RuntimeScopedBindingAttachment => {
	        const current = useAvatarStore.getState();
	        const currentStatus = bindingStatusFromProjection(current.runtime.binding.projection);
	        if (currentStatus !== 'active') {
	          useAvatarStore.getState().setRuntimeBindingStatus({
	            status: currentStatus,
	            reason: current.runtime.binding.reason,
	          });
	          throw new Error(bindingUnavailableMessage(currentStatus, current.runtime.binding.reason));
	        }
	        if (current.runtime.binding.status !== 'active') {
	          throw new Error(bindingUnavailableMessage(current.runtime.binding.status, current.runtime.binding.reason));
	        }
	        if (
	          current.consume.authority !== 'runtime'
	          || current.consume.agentId !== input.agentId
	          || current.consume.conversationAnchorId !== input.conversationAnchorId
	          || current.consume.avatarInstanceId !== launchContext.avatarInstanceId
	          || current.consume.worldId !== worldId
	        ) {
	          throw new Error('Runtime interaction requires the current scoped binding target.');
	        }
	        return scopedBinding;
	      };
	      recordAvatarEvidenceEventually({
	        kind: 'avatar.startup.runtime-bound',
        detail: {
          driver_kind: 'sdk',
          authority: 'runtime',
          agent_id: agentId,
          conversation_anchor_id: conversationAnchorId,
          avatar_instance_id: launchContext.avatarInstanceId,
          world_id: worldId,
          launched_by: launchContext.launchedBy,
          runtime_app_id: runtimeAppId,
          source_surface: launchContext.sourceSurface || null,
	          binding_id: launchContext.scopedBinding.bindingId,
	        },
	      });
	      driver = createDriver({
	        kind: 'sdk',
	        sdk: {
	          runtime,
          agentId,
	          conversationAnchorId,
	          activeWorldId: worldId,
	          activeUserId: '',
	          scopedBinding,
	          locale: navigator.language || 'en-US',
          windowInfo: () => {
            const state = useAvatarStore.getState();
            return {
              x: 0,
              y: 0,
              width: state.shell.windowSize.width,
              height: state.shell.windowSize.height,
            };
          },
        },
      });
      try {
        await carrier.attachRuntimeDriver(driver);
      } catch (error) {
        return finishRuntimeBindFailure!('carrier_runtime_attach_failed', error);
      }
      recordAvatarEvidenceEventually({
        kind: 'avatar.runtime.bound',
        detail: {
          agent_id: agentId,
          conversation_anchor_id: conversationAnchorId,
          avatar_instance_id: launchContext.avatarInstanceId,
          world_id: worldId,
        },
      });

      requestTextTurn = async (input) => {
        const normalizedText = readNormalizedString(input.text);
        if (!normalizedText) {
          throw new Error('avatar companion input requires non-empty text');
        }
	        if (cleanedUp) {
	          throw new Error('avatar companion input is unavailable after shutdown');
	        }
	        const state = useAvatarStore.getState();
	        const activeScopedBinding = requireActiveBinding(input);
	        const executionBinding = resolveExecutionBinding({
	          runtimeDefaults,
	          bundle: state.bundle,
        });
        if (!executionBinding) {
          throw new Error('avatar companion input requires an explicit execution binding');
        }
        await runtime.agent.turns.request({
          agentId: input.agentId,
          conversationAnchorId: input.conversationAnchorId,
	          worldId,
	          messages: [{ role: 'user', content: normalizedText }],
	          executionBinding,
	          scopedBinding: activeScopedBinding,
	        });
	      };

      getVoiceInputAvailability = async (input) => {
        try {
	          if (cleanedUp) {
	            throw new Error('Foreground voice is unavailable after shutdown.');
	          }
	          const state = useAvatarStore.getState();
	          requireActiveBinding(input);
	          await resolveCapabilityBinding(runtime, 'audio.transcribe');
          const executionBinding = resolveExecutionBinding({
            runtimeDefaults,
            bundle: state.bundle,
          });
          if (!executionBinding) {
            throw new Error('Foreground voice requires an explicit execution binding for reply continuity.');
          }
          return {
            available: true,
            reason: null,
          };
        } catch (error) {
          return {
            available: false,
            reason: error instanceof Error ? error.message : String(error),
          };
        }
      };

      startVoiceCapture = async (input) => {
	        if (cleanedUp) {
	          throw new Error('Foreground voice is unavailable after shutdown');
	        }
	        requireActiveBinding(input);
	        const availability = await getVoiceInputAvailability(input);
        if (!availability.available) {
          throw new Error(availability.reason || 'Foreground voice is unavailable for the current anchor.');
        }
	        activeVoiceCapture = await startAvatarVoiceCaptureSession({
	          onLevelChange: input.onLevelChange,
	        });
	        return activeVoiceCapture;
	      };

      submitVoiceCaptureTurn = async (input) => {
        if (!(input.audioBytes instanceof Uint8Array) || input.audioBytes.length === 0) {
          throw new Error('Foreground voice requires recorded audio bytes.');
        }
        const mimeType = readNormalizedString(input.mimeType);
        if (!mimeType) {
          throw new Error('Foreground voice requires an audio mimeType.');
        }
	        if (cleanedUp) {
	          throw new Error('Foreground voice is unavailable after shutdown');
	        }
	        requireActiveBinding(input);
	        const transcribeBinding = await resolveCapabilityBinding(runtime, 'audio.transcribe');
        const transcriptResult = await runtime.media.stt.transcribe({
          model: transcribeBinding.modelId,
          audio: {
            kind: 'bytes',
            bytes: input.audioBytes,
          },
          mimeType,
          ...(readNormalizedString(input.language) ? { language: readNormalizedString(input.language) } : {}),
          route: transcribeBinding.route,
          ...(transcribeBinding.connectorId ? { connectorId: transcribeBinding.connectorId } : {}),
          signal: input.signal,
        });
        const transcript = readNormalizedString(transcriptResult.text);
        if (!transcript) {
          throw new Error('Foreground voice transcription returned no transcript text.');
        }
        if (input.signal?.aborted) {
          throw createAbortError('Foreground voice request aborted before reply submission.');
        }
	        const activeScopedBinding = requireActiveBinding(input);
	        const currentState = useAvatarStore.getState();
	        const executionBinding = resolveExecutionBinding({
	          runtimeDefaults,
          bundle: currentState.bundle,
        });
        if (!executionBinding) {
          throw new Error('Foreground voice requires an explicit execution binding for reply continuity.');
        }
        await runtime.agent.turns.request({
          agentId: input.agentId,
          conversationAnchorId: input.conversationAnchorId,
	          worldId,
	          messages: [{ role: 'user', content: transcript }],
	          executionBinding,
	          scopedBinding: activeScopedBinding,
	        });
	        return { transcript };
	      };

      interruptTurn = async (input) => {
	        if (cleanedUp) {
	          throw new Error('Foreground voice is unavailable after shutdown');
	        }
	        const activeScopedBinding = requireActiveBinding(input);
	        await runtime.agent.turns.interrupt({
	          agentId: input.agentId,
	          conversationAnchorId: input.conversationAnchorId,
	          worldId,
	          scopedBinding: activeScopedBinding,
	          ...(readNormalizedString(input.turnId) ? { turnId: readNormalizedString(input.turnId) } : {}),
	          ...(readNormalizedString(input.reason) ? { reason: readNormalizedString(input.reason) } : {}),
	        });
      };
    }

    if (!driver) {
      return buildHandle();
    }

    unsubscribeStatus = driver.onStatusChange((status) => {
      useAvatarStore.getState().setDriverStatus(status);
      if (status === 'error' && invalidateRuntimeBindingFromDriver) {
        void invalidateRuntimeBindingFromDriver('unavailable', 'runtime_agent_binding_stream_unavailable');
      }
    });

    unsubscribeBundle = driver.onBundleChange((bundle) => {
      useAvatarStore.getState().setBundle(bundle);
    });

    try {
      await driver.start();
    } catch (error) {
      if (finishRuntimeBindFailure) {
        return finishRuntimeBindFailure('runtime_driver_start_failed', error);
      }
      throw error;
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
