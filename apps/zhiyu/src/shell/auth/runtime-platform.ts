import { createNimiClient } from '@nimiplatform/sdk';
import type { NimiLocalAppClient } from '@nimiplatform/sdk/app';
import { ReasonCode } from '@nimiplatform/sdk/types';
import { createNimiLocalAppStandardShellSurface } from '@nimiplatform/kit/shell/renderer/bridge';
import { normalizeZhiyuElectronRuntimeUnavailableError } from '../runtime/electron-runtime-unavailable';

export const appId = 'nimi.zhiyu';
export const appTitle = '织羽 Zhiyu';
export const runtimeAccountLoginEnabled = false;

export type RuntimeAuthMode = 'first-party-local-app';
export type ZhiyuLocalAppClient = NimiLocalAppClient;

export type RuntimePlatformReadyProjection = {
  readonly status: 'ready';
  readonly mode: RuntimeAuthMode;
  readonly client: ZhiyuLocalAppClient;
};

export type RuntimePlatformLoginRequiredProjection = {
  readonly status: 'login-required';
  readonly mode: RuntimeAuthMode;
  readonly client: ZhiyuLocalAppClient;
  readonly reasonCode: string;
  readonly message: string;
  readonly actionHint: string;
};

export type RuntimePlatformUnavailableProjection = {
  readonly status: 'unavailable' | 'action-required';
  readonly mode: RuntimeAuthMode;
  readonly reasonCode: string;
  readonly message: string;
  readonly actionHint?: string;
};

export type RuntimePlatformProjection =
  | RuntimePlatformReadyProjection
  | RuntimePlatformLoginRequiredProjection
  | RuntimePlatformUnavailableProjection;

export function getRuntimePlatformProjection(): Promise<RuntimePlatformProjection> {
  return createLocalAppRuntimeProjection('first-party-local-app');
}

let localAppClient: ZhiyuLocalAppClient | null = null;

export function getZhiyuLocalAppClient(): ZhiyuLocalAppClient {
  if (!localAppClient) {
    localAppClient = createNimiClient({
      localApp: {
        standardShell: createNimiLocalAppStandardShellSurface(),
      },
    });
  }
  return localAppClient;
}

export function requireZhiyuLocalAppCapability(capability: string): never {
  const normalized = capability.trim() || 'unknown';
  throw Object.assign(new Error(`Zhiyu local-app capability "${normalized}" is not admitted.`), {
    reasonCode: `zhiyu-${normalized.replaceAll('.', '-')}-capability-not-admitted`,
    actionHint: `admit_zhiyu_${normalized.replaceAll('.', '_').replaceAll('-', '_')}_capability`,
    source: 'sdk',
    retryable: false,
  });
}

async function createLocalAppRuntimeProjection(
  mode: RuntimeAuthMode,
): Promise<RuntimePlatformProjection> {
  try {
    const client = getZhiyuLocalAppClient();
    const session = await client.auth.status();
    if (!session.sessionBound) {
      throw Object.assign(new Error('Zhiyu local-app session is not bound.'), {
        reasonCode: session.reasonCode,
        actionHint: session.actionHint,
        source: 'sdk',
      });
    }
    return {
      status: 'ready',
      mode,
      client,
    };
  } catch (error) {
    return unavailableFromError(mode, error);
  }
}

function unavailableFromError(mode: RuntimeAuthMode, error: unknown): RuntimePlatformUnavailableProjection {
  const unavailable = normalizeZhiyuElectronRuntimeUnavailableError(error);
  if (unavailable) {
    return {
      status: 'action-required',
      mode,
      reasonCode: unavailable.reasonCode,
      actionHint: unavailable.actionHint,
      message: error instanceof Error ? error.message : 'Zhiyu Runtime account setup is required.',
    };
  }
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const reasonCode = normalizeText(record.reasonCode)
    || normalizeText(record.code)
    || ReasonCode.RUNTIME_UNAVAILABLE;
  const actionHint = normalizeText(record.actionHint ?? record.action_hint);
  const hasActionHint = Object.hasOwn(record, 'actionHint') || Object.hasOwn(record, 'action_hint');
  return {
    status: 'action-required',
    mode,
    reasonCode,
    actionHint: actionHint || (hasActionHint ? undefined : fallbackActionHint(reasonCode)),
    message: error instanceof Error ? error.message : 'Zhiyu Runtime account setup is required.',
  };
}

function fallbackActionHint(reasonCode: string): string {
  return reasonCode === 'electron-standard-capability-not-in-host-set'
    ? 'use_command_admitted_by_electron_standard_shell_capability_set'
    : 'start_external_runtime_daemon';
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
