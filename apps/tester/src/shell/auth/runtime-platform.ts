import type { NimiClient } from '@nimiplatform/sdk';
import { ReasonCode } from '@nimiplatform/sdk/types';

export { appId, appTitle, scaffoldProfile } from './app-identity.js';

export const runtimeAccountLoginEnabled = false;

export type RuntimeAuthMode = 'third-party-nimi-app';

export type RuntimePlatformReadyProjection = {
  readonly status: 'ready';
  readonly mode: RuntimeAuthMode;
  readonly client: NimiClient;
  readonly auth: {
    readonly state: 'ready';
    readonly source: 'runtime-installed-app-session';
    readonly subjectUserId: string;
  };
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
  | RuntimePlatformUnavailableProjection;

let runtimeProjection: Promise<RuntimePlatformProjection> | null = null;

export function clearRuntimePlatformProjection(): void {
  runtimeProjection = null;
}

export function getRuntimePlatformProjection(): Promise<RuntimePlatformProjection> {
  runtimeProjection ??= Promise.resolve({
    status: 'action-required',
    mode: 'third-party-nimi-app',
    reasonCode: ReasonCode.SDK_RUNTIME_METHOD_UNAVAILABLE,
    actionHint: 'use_admitted_protected_runtime_carrier',
    message: 'Tester installed account, Realm, and AI access requires a Runtime-issued protected app session.',
  });
  return runtimeProjection;
}
