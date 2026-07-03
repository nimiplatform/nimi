import { createNimiClient, type NimiClient } from '@nimiplatform/sdk';
import {
  Runtime,
  createNimiLocalFirstPartyRuntimeAccountCaller,
  type NimiRuntimeAccountCaller,
} from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';
import { normalizeZhiyuElectronRuntimeUnavailableError } from '../runtime/electron-runtime-unavailable';

export const appId = 'nimi.zhiyu';
export const appTitle = '织羽 Zhiyu';
export const runtimeAccountLoginEnabled = true;

const runtimeClientIdPrefix = normalizeClientIdPrefix(appId);
const runtimeAccountAppInstanceId = `${appId}.local-first-party`;
const runtimeAccountDeviceId = `${runtimeClientIdPrefix}-local-first-party-device`;

export type RuntimeAuthMode = 'first-party-local-app';

export type RuntimePlatformReadyProjection = {
  readonly status: 'ready';
  readonly mode: RuntimeAuthMode;
  readonly client: NimiClient;
  readonly accountRuntime: Runtime;
  readonly accountCaller: NimiRuntimeAccountCaller;
};

export type RuntimePlatformLoginRequiredProjection = {
  readonly status: 'login-required';
  readonly mode: RuntimeAuthMode;
  readonly client: NimiClient;
  readonly accountRuntime: Runtime;
  readonly accountCaller: NimiRuntimeAccountCaller;
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

let runtimeProjection: Promise<RuntimePlatformProjection> | null = null;
let runtimeReadyProjection: RuntimePlatformReadyProjection | null = null;
let runtimeAccountCaller: NimiRuntimeAccountCaller | null = null;

export function clearRuntimePlatformProjection(): void {
  runtimeProjection = null;
  runtimeReadyProjection = null;
}

export function getRuntimePlatformProjection(): Promise<RuntimePlatformProjection> {
  runtimeProjection ??= createFirstPartyRuntimeProjection('first-party-local-app');
  return runtimeProjection;
}

export function getRuntimeNimiClient(): NimiClient {
  if (!runtimeReadyProjection) {
    throw new Error('Zhiyu Runtime client is not initialized. Wait for Runtime platform projection to become ready.');
  }
  return runtimeReadyProjection.client;
}

export function getRuntimeAccountCaller(): NimiRuntimeAccountCaller {
  runtimeAccountCaller ??= createNimiLocalFirstPartyRuntimeAccountCaller({
    appId,
    appInstanceId: runtimeAccountAppInstanceId,
    deviceId: runtimeAccountDeviceId,
  });
  return runtimeAccountCaller;
}

async function createFirstPartyRuntimeProjection(
  mode: RuntimeAuthMode,
): Promise<RuntimePlatformProjection> {
  try {
    const accountRuntime = new Runtime({
      appId,
      transport: { type: 'electron-ipc' },
    });
    const client = createNimiClient({
      appId,
      runtime: accountRuntime,
      realm: false,
      app: false,
      permissions: false,
    });
    await client.runtime.ready();
    runtimeReadyProjection = {
      status: 'ready',
      mode,
      client,
      accountRuntime,
      accountCaller: getRuntimeAccountCaller(),
    };
    return runtimeReadyProjection;
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
  return {
    status: 'action-required',
    mode,
    reasonCode,
    actionHint: 'start_external_runtime_daemon',
    message: error instanceof Error ? error.message : 'Zhiyu Runtime account setup is required.',
  };
}

function normalizeClientIdPrefix(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'nimi-app';
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
