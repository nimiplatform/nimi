import { Runtime } from '@nimiplatform/sdk/runtime/browser';
import type { RuntimeScopedBindingAttachment } from '@nimiplatform/sdk/runtime/browser';
import { invoke as tauriInvoke, type InvokeArgs } from '@tauri-apps/api/core';
import { listen as tauriListen, type UnlistenFn } from '@tauri-apps/api/event';
import { getAvatarLaunchContext, getRuntimeDefaults, hasTauriInvoke, type AvatarLaunchContext } from '@renderer/bridge';
import { type RuntimeBindingStatus, useAvatarStore } from './app-store.js';

export function readNormalizedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

type TauriRuntimeSdkHook = {
  invoke: (command: string, payload?: unknown) => Promise<unknown>;
  listen: (
    eventName: string,
    handler: (event: { event?: string; id?: number; payload: unknown }) => void,
  ) => Promise<UnlistenFn>;
};

export function installTauriRuntimeSdkHook(): void {
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

export function applyLaunchContextRuntimeDefaults(
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

export function createAbortError(message: string): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export async function waitForAvatarLaunchContext(timeoutMs: number): Promise<AvatarLaunchContext> {
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

export function resolveRuntimeAppId(launchContext: AvatarLaunchContext): string {
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

export function bindingStatusFromProjection(binding: AvatarLaunchContext['scopedBinding'] | null): RuntimeBindingStatus {
  if (!binding) {
    return 'unavailable';
  }
  const state = readNormalizedString(binding.state).toLowerCase();
  if (state === 'revoked' || state === 'suspended' || state === 'superseded') {
    return 'revoked';
  }
  if (state === 'expired') {
    return 'expired';
  }
  const expiresAt = readNormalizedString(binding.expiresAt);
  if (expiresAt) {
    const expiresAtMs = Date.parse(expiresAt);
    if (Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now()) {
      return 'expired';
    }
  }
  return state === 'active' ? 'active' : 'stale';
}

export function toRuntimeScopedBindingAttachment(input: {
  binding: AvatarLaunchContext['scopedBinding'];
  runtimeAppId: string;
  agentId: string;
  conversationAnchorId: string;
  worldId: string;
}): RuntimeScopedBindingAttachment {
  return {
    bindingId: input.binding.bindingId,
    bindingHandle: input.binding.bindingHandle ?? undefined,
    runtimeAppId: input.binding.runtimeAppId || input.runtimeAppId,
    appInstanceId: input.binding.appInstanceId,
    windowId: input.binding.windowId,
    avatarInstanceId: input.binding.avatarInstanceId,
    agentId: input.binding.agentId || input.agentId,
    conversationAnchorId: input.binding.conversationAnchorId || input.conversationAnchorId,
    worldId: input.binding.worldId || input.worldId,
  };
}

export function bindingUnavailableMessage(status: RuntimeBindingStatus, reason?: string | null): string {
  const suffix = reason ? ` (${reason})` : '';
  switch (status) {
    case 'revoked':
      return `Runtime interaction is unavailable because the scoped binding was revoked${suffix}.`;
    case 'expired':
      return `Runtime interaction is unavailable because the scoped binding expired${suffix}.`;
    case 'stale':
      return `Runtime interaction is unavailable because the scoped binding is stale${suffix}.`;
    case 'unavailable':
      return `Runtime interaction is unavailable because the scoped binding is unavailable${suffix}.`;
    case 'active':
    default:
      return 'Runtime interaction is unavailable.';
  }
}

export type RuntimeExecutionBinding = {
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

export async function loadDefaultMockScenarioJson(): Promise<string> {
  const module = await import('../mock/scenarios/default.mock.json?raw');
  return module.default;
}

export async function resolveConversationAnchorId(
  launchContext: AvatarLaunchContext,
): Promise<string> {
  const conversationAnchorId = readNormalizedString(launchContext.conversationAnchorId);
  if (!conversationAnchorId) {
    throw new Error('avatar launch context did not include committed conversationAnchorId');
  }
  return conversationAnchorId;
}

export function resolveExecutionBinding(input: {
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

export async function resolveCapabilityBinding(
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
