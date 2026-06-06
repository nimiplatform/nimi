import {
  getAvatarLaunchContext,
  getRuntimeDefaults,
  installNimiShellRuntimeBridge,
  type AvatarLaunchContext,
  type NimiShellRuntimeBridgeResult,
} from '@renderer/bridge';
import { useAvatarStore } from './app-store.js';

export function readNormalizedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function installAvatarRuntimeBridge(): NimiShellRuntimeBridgeResult {
  return installNimiShellRuntimeBridge();
}

export function applyLaunchContextRuntimeDefaults(
  runtimeDefaults: Awaited<ReturnType<typeof getRuntimeDefaults>>,
  _launchContext: AvatarLaunchContext,
): Awaited<ReturnType<typeof getRuntimeDefaults>> {
  return runtimeDefaults;
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

export function resolveRuntimeAppId(_launchContext: AvatarLaunchContext): string {
  return 'nimi.avatar';
}

export type RuntimeExecutionBinding = {
  route: 'local' | 'cloud';
  modelId: string;
  connectorId?: string;
};

export async function loadDefaultMockScenarioJson(): Promise<string> {
  const module = await import('../mock/scenarios/default.mock.json?raw');
  return module.default;
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

  return null;
}
