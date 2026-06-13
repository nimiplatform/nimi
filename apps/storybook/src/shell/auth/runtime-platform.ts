import { createNimiClient, type NimiClient } from '@nimiplatform/sdk';
import {
  createNimiLocalFirstPartyRuntimeAccountCaller,
  type NimiRuntimeAccountCaller,
  type RuntimeOptions,
} from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';

export const appId = 'nimi.storybook';
export const appTitle = 'Storybook';
export const scaffoldProfile = 'standalone' as const;
export const runtimeAccountLoginEnabled = true;
const runtimeAccountAppInstanceId = 'nimi.storybook.local-first-party';
const runtimeAccountDeviceId = 'storybook-shell-runtime-bridge';

type RuntimeEnv = Record<string, string | boolean | undefined>;

export type StorybookRuntimeAuthMode =
  | 'local-first-party'
  | 'third-party-nimi-app';

export type StorybookRuntimePlatformClient = Pick<NimiClient, 'appId' | 'runtime' | 'ai' | 'features'>;

export type StorybookRuntimeAuthUnavailable = {
  status: 'unavailable' | 'action-required';
  mode: StorybookRuntimeAuthMode;
  reasonCode: string;
  actionHint: string;
  message: string;
};

export type StorybookRuntimePlatformProjection =
  | {
      status: 'ready';
      mode: StorybookRuntimeAuthMode;
      client: StorybookRuntimePlatformClient;
      auth: {
        state: 'ready';
        source: 'runtime-local-first-party';
      };
    }
  | StorybookRuntimeAuthUnavailable;

let runtimeProjection: Promise<StorybookRuntimePlatformProjection> | null = null;
let runtimeAccountCaller: NimiRuntimeAccountCaller | null = null;

function runtimeEnv(): RuntimeEnv {
  return ((import.meta as ImportMeta & { env?: RuntimeEnv }).env || {});
}

function resolveRuntimeAuthMode(): StorybookRuntimeAuthMode {
  // Single connection model: a local dev app connects exactly the way a shipped
  // app does — through runtime account login. There is no separate standalone
  // developer-session mode; the runtime developer-registration gate (driven by
  // the desktop Developer Mode toggle) is what admits a not-yet-admitted local
  // app, not a parallel auth path.
  return runtimeAccountLoginEnabled ? 'local-first-party' : 'third-party-nimi-app';
}

export function clearRuntimePlatformProjection() {
  runtimeProjection = null;
}

export function getRuntimeAccountCaller(): NimiRuntimeAccountCaller {
  runtimeAccountCaller ??= createNimiLocalFirstPartyRuntimeAccountCaller({
    appId,
    appInstanceId: runtimeAccountAppInstanceId,
    deviceId: runtimeAccountDeviceId,
  });
  return runtimeAccountCaller;
}

export function getRuntimePlatformProjection() {
  const mode = resolveRuntimeAuthMode();

  if (mode === 'local-first-party') {
    runtimeProjection ??= createLocalFirstPartyRuntimeProjection(mode);
    return runtimeProjection;
  }

  runtimeProjection ??= Promise.resolve(unavailable({
    status: 'unavailable',
    mode,
    reasonCode: ReasonCode.SDK_RUNTIME_METHOD_UNAVAILABLE,
    actionHint: 'wait_for_runtime_nimi_app_session_projection',
    message: 'third-party Nimi App Runtime session projection is not exposed by this SDK/runtime pair',
  }));
  return runtimeProjection;
}

async function createLocalFirstPartyRuntimeProjection(
  mode: StorybookRuntimeAuthMode,
): Promise<StorybookRuntimePlatformProjection> {
  try {
    const client = createNimiClient({
      appId,
      runtime: runtimeOptions(),
    });
    await client.runtime.ready();
    return {
      status: 'ready',
      mode,
      client,
      auth: {
        state: 'ready',
        source: 'runtime-local-first-party',
      },
    };
  } catch (error) {
    const reasonCode = typeof error === 'object' && error !== null && 'reasonCode' in error
      ? String((error as { reasonCode?: string }).reasonCode || 'RUNTIME_UNAVAILABLE')
      : typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: string }).code || 'RUNTIME_UNAVAILABLE')
        : 'RUNTIME_UNAVAILABLE';
    return unavailable({
      status: 'action-required',
      mode,
      reasonCode,
      actionHint: 'complete_runtime_local_first_party_account_setup',
      message: error instanceof Error ? error.message : 'local first-party Runtime account setup is required',
    });
  }
}

function runtimeOptions(): RuntimeOptions {
  const env = runtimeEnv();
  const base: RuntimeOptions = {
    appId,
    metadata: env.DEV === true
      ? { developerRegistration: 'true' }
      : undefined,
  };
  return isNodeRuntime()
    ? base
    : {
      ...base,
      transport: { type: 'tauri-ipc' },
    };
}

function unavailable(input: StorybookRuntimeAuthUnavailable): StorybookRuntimeAuthUnavailable {
  return input;
}

function isNodeRuntime(): boolean {
  const maybeProcess = (globalThis as typeof globalThis & {
    process?: { versions?: { node?: string } };
  }).process;
  return Boolean(maybeProcess?.versions?.node);
}
