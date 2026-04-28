import { Runtime } from '@nimiplatform/sdk/runtime/browser';
import { invoke as tauriInvoke, type InvokeArgs } from '@tauri-apps/api/core';
import { listen as tauriListen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  getAvatarLaunchContext,
  getRuntimeDefaults,
  hasTauriInvoke,
  startDaemon,
  type AvatarLaunchContext,
} from '@renderer/bridge';
import { createDriver, resolveDriverKind } from '../driver/factory.js';
import { startAvatarVisualCarrier, type AvatarRuntimeCarrier } from '../carrier/avatar-carrier.js';
import { resolveAgentCenterAvatarPackageManifest } from '../live2d/model-loader.js';
import { readAvatarShellSettings } from '../settings-state.js';
import type { AgentDataDriver } from '../driver/types.js';
import { startAvatarVoiceCaptureSession, type AvatarVoiceCaptureSession } from '../voice-capture.js';
import { recordAvatarEvidenceEventually } from './avatar-evidence.js';
import { useAvatarStore } from './app-store.js';
import { isTauriRuntime, onShellReady } from './tauri-lifecycle.js';
import { setAlwaysOnTop } from './tauri-commands.js';

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

function readNormalizedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

type TauriRuntimeSdkHook = {
  invoke: (command: string, payload?: unknown) => Promise<unknown>;
  listen: (
    eventName: string,
    handler: (event: { event?: string; id?: number; payload: unknown }) => void,
  ) => Promise<UnlistenFn>;
};

function installTauriRuntimeSdkHook(): void {
  if (!hasTauriInvoke()) {
    return;
  }
  const hook: TauriRuntimeSdkHook = {
    invoke: (command, payload) => tauriInvoke(command, payload as InvokeArgs | undefined),
    listen: (eventName, handler) => tauriListen(eventName, handler),
  };
  const target = globalThis as typeof globalThis & {
    __NIMI_TAURI_RUNTIME__?: TauriRuntimeSdkHook;
    window?: Window & { __NIMI_TAURI_RUNTIME__?: TauriRuntimeSdkHook };
  };
  target.__NIMI_TAURI_RUNTIME__ = hook;
  if (target.window) {
    target.window.__NIMI_TAURI_RUNTIME__ = hook;
  }
}

function applyLaunchContextRuntimeDefaults(
  runtimeDefaults: Awaited<ReturnType<typeof getRuntimeDefaults>>,
  launchContext: AvatarLaunchContext,
): Awaited<ReturnType<typeof getRuntimeDefaults>> {
  const worldId = readNormalizedString(launchContext.worldId);
  if (!worldId) {
    return runtimeDefaults;
  }
  return {
    ...runtimeDefaults,
    runtime: {
      ...runtimeDefaults.runtime,
      ...(worldId ? { worldId } : {}),
    },
  };
}

function createAbortError(message: string): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function waitForAvatarLaunchContext(timeoutMs: number): Promise<AvatarLaunchContext> {
  const startedAt = Date.now();
  let lastError: unknown = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await getAvatarLaunchContext();
    } catch (error) {
      lastError = error;
      await wait(100);
    }
  }
  throw new Error(`avatar launch context was not bound within ${timeoutMs}ms: ${errorMessage(lastError)}`);
}

function resolveRuntimeAppId(launchContext: AvatarLaunchContext): string {
  const explicitRuntimeAppId = readNormalizedString(launchContext.runtimeAppId);
  if (explicitRuntimeAppId) {
    return explicitRuntimeAppId;
  }
  const launchedBy = readNormalizedString(launchContext.launchedBy);
  if (launchedBy === 'desktop') {
    return 'nimi.desktop';
  }
  return launchedBy || 'nimi.avatar';
}

type RuntimeExecutionBinding = {
  route: 'local' | 'cloud';
  modelId: string;
  connectorId?: string;
};

type RuntimeWithRoute = Runtime & {
  route: {
    listOptions: (input: { capability: 'audio.transcribe' }) => Promise<{
      selected: {
        source: 'local' | 'cloud';
        connectorId?: string;
        model?: string;
        modelId?: string;
        localModelId?: string;
      } | null;
      resolvedDefault?: {
        source: 'local' | 'cloud';
        connectorId?: string;
        model?: string;
        modelId?: string;
        localModelId?: string;
      } | null;
    }>;
    checkHealth: (input: {
      capability: 'audio.transcribe';
      binding: {
        source: 'local' | 'cloud';
        connectorId?: string;
        model?: string;
        modelId?: string;
        localModelId?: string;
      };
    }) => Promise<{ healthy: boolean }>;
  };
};

async function loadDefaultMockScenarioJson(): Promise<string> {
  const module = await import('../mock/scenarios/default.mock.json?raw');
  return module.default;
}

async function resolveConversationAnchorId(
  runtime: Runtime,
  launchContext: AvatarLaunchContext,
): Promise<string> {
  if (launchContext.anchorMode === 'existing') {
    return launchContext.conversationAnchorId || '';
  }
  const opened = await runtime.agent.anchors.open({
    agentId: launchContext.agentId,
    metadata: {
      surface: 'avatar-carrier',
      launchedBy: launchContext.launchedBy,
      avatarInstanceId: launchContext.avatarInstanceId,
      sourceSurface: launchContext.sourceSurface || 'desktop-avatar-launcher',
    },
  });
  const record = opened as unknown as Record<string, unknown>;
  const conversationAnchorId = readNormalizedString(
    record.conversationAnchorId ?? record.conversation_anchor_id,
  );
  if (!conversationAnchorId) {
    throw new Error('runtime.agent anchor open did not return conversationAnchorId');
  }
  return conversationAnchorId;
}

function resolveExecutionBinding(input: {
  runtimeDefaults: ReturnType<typeof useAvatarStore.getState>['runtime']['defaults'];
  bundle: ReturnType<typeof useAvatarStore.getState>['bundle'];
}): RuntimeExecutionBinding | null {
  const executionBinding = input.bundle?.custom?.['execution_binding'];
  if (executionBinding && typeof executionBinding === 'object') {
    const record = executionBinding as Record<string, unknown>;
    const route = readNormalizedString(record.route);
    const modelId = readNormalizedString(record.modelId);
    const connectorId = readNormalizedString(record.connectorId);
    if ((route === 'local' || route === 'cloud') && modelId) {
      return {
        route,
        modelId,
        ...(connectorId ? { connectorId } : {}),
      };
    }
  }

  const runtimeFields = input.runtimeDefaults?.runtime;
  const modelId = readNormalizedString(runtimeFields?.localProviderModel);
  const connectorId = readNormalizedString(runtimeFields?.connectorId);
  if (!modelId) {
    return null;
  }
  return {
    route: connectorId ? 'cloud' : 'local',
    modelId,
    ...(connectorId ? { connectorId } : {}),
  };
}

async function resolveCapabilityBinding(
  runtime: Runtime,
  capability: 'audio.transcribe',
): Promise<RuntimeExecutionBinding> {
  const runtimeWithRoute = runtime as RuntimeWithRoute;
  const options = await runtimeWithRoute.route.listOptions({ capability });
  const selected = options.selected ?? options.resolvedDefault ?? null;
  if (!selected) {
    throw new Error('Foreground voice requires an admitted transcribe route.');
  }
  const modelId = readNormalizedString(selected.modelId || selected.model || selected.localModelId);
  if (!modelId) {
    throw new Error('Foreground voice requires a resolved transcribe model.');
  }
  const health = await runtimeWithRoute.route.checkHealth({
    capability,
    binding: selected,
  });
  if (!health.healthy) {
    throw new Error('Foreground voice is unavailable because the transcribe route is not ready.');
  }
  return {
    route: selected.source,
    modelId,
    ...(readNormalizedString(selected.connectorId) ? { connectorId: readNormalizedString(selected.connectorId) } : {}),
  };
}

export async function bootstrapAvatar(): Promise<BootstrapHandle> {
  const store = useAvatarStore.getState();

  let shellUnlisten: (() => void) | null = null;
  let driver: AgentDataDriver | null = null;
  let carrier: AvatarRuntimeCarrier | null = null;
  let runtimeClient: Runtime | null = null;
  let unsubscribeStatus = () => {};
  let unsubscribeBundle = () => {};
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
  let finishRuntimeBindFailure: ((reason: string, error: unknown) => Promise<BootstrapHandle>) | null = null;

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
        agentCenterAccountId: launchContext.agentCenterAccountId,
        agentId,
        avatarPackageKind: launchContext.avatarPackageKind,
        avatarPackageId: launchContext.avatarPackageId,
        avatarPackageSchemaVersion: launchContext.avatarPackageSchemaVersion,
      });
      recordAvatarEvidenceEventually({
        kind: 'avatar.visual.package-resolved',
        detail: {
          agent_center_account_id: launchContext.agentCenterAccountId,
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
      ): Promise<BootstrapHandle> => {
        useAvatarStore.getState().clearBundle();
        useAvatarStore.getState().clearRuntimeBinding();
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
        conversationAnchorId = await resolveConversationAnchorId(runtime, launchContext);
      } catch (error) {
        return finishRuntimeBindFailure!('conversation_anchor_failed', error);
      }
      if (!conversationAnchorId) {
        return finishRuntimeBindFailure!(
          'conversation_anchor_missing',
          'avatar launch context did not resolve conversationAnchorId',
        );
      }
      useAvatarStore.getState().setRuntimeBinding({
        avatarInstanceId: launchContext.avatarInstanceId,
        conversationAnchorId,
        agentId,
        worldId,
      });
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
        if (state.consume.authority !== 'runtime' || !state.consume.conversationAnchorId) {
          throw new Error('avatar companion input requires an active runtime binding');
        }
        if (input.agentId !== agentId || input.conversationAnchorId !== conversationAnchorId) {
          throw new Error('avatar companion input requires the current explicit agent and anchor binding');
        }
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
        });
      };

      getVoiceInputAvailability = async (input) => {
        try {
          if (cleanedUp) {
            throw new Error('Foreground voice is unavailable after shutdown.');
          }
          const state = useAvatarStore.getState();
          if (state.consume.authority !== 'runtime' || !state.consume.conversationAnchorId) {
            throw new Error('Foreground voice requires an active runtime binding.');
          }
          if (input.agentId !== agentId || input.conversationAnchorId !== conversationAnchorId) {
            throw new Error('Foreground voice requires the current explicit agent and anchor binding.');
          }
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
        const state = useAvatarStore.getState();
        if (state.consume.authority !== 'runtime' || !state.consume.conversationAnchorId) {
          throw new Error('Foreground voice requires an active runtime binding');
        }
        if (input.agentId !== agentId || input.conversationAnchorId !== conversationAnchorId) {
          throw new Error('Foreground voice requires the current explicit agent and anchor binding');
        }
        const availability = await getVoiceInputAvailability(input);
        if (!availability.available) {
          throw new Error(availability.reason || 'Foreground voice is unavailable for the current anchor.');
        }
        return startAvatarVoiceCaptureSession({
          onLevelChange: input.onLevelChange,
        });
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
        const state = useAvatarStore.getState();
        if (state.consume.authority !== 'runtime' || !state.consume.conversationAnchorId) {
          throw new Error('Foreground voice requires an active runtime binding');
        }
        if (input.agentId !== agentId || input.conversationAnchorId !== conversationAnchorId) {
          throw new Error('Foreground voice requires the current explicit agent and anchor binding');
        }
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
        const currentState = useAvatarStore.getState();
        if (currentState.consume.authority !== 'runtime' || !currentState.consume.conversationAnchorId) {
          throw new Error('Foreground voice requires an active runtime binding');
        }
        if (
          currentState.consume.agentId !== input.agentId
          || currentState.consume.conversationAnchorId !== input.conversationAnchorId
        ) {
          throw new Error('Foreground voice requires the current explicit agent and anchor binding');
        }
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
        });
        return { transcript };
      };

      interruptTurn = async (input) => {
        if (cleanedUp) {
          throw new Error('Foreground voice is unavailable after shutdown');
        }
        const state = useAvatarStore.getState();
        if (state.consume.authority !== 'runtime' || !state.consume.conversationAnchorId) {
          throw new Error('Foreground voice requires an active runtime binding');
        }
        if (input.agentId !== agentId || input.conversationAnchorId !== conversationAnchorId) {
          throw new Error('Foreground voice requires the current explicit agent and anchor binding');
        }
        await runtime.agent.turns.interrupt({
          agentId: input.agentId,
          conversationAnchorId: input.conversationAnchorId,
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
