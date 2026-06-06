import { createNimiClient, type NimiClient } from '@nimiplatform/sdk';
import type { RuntimeOptions } from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';
export { appId, appTitle, scaffoldProfile } from './app-identity.js';
import { appId } from './app-identity.js';

export const runtimeAccountLoginEnabled = true;

type RuntimeEnv = Record<string, string | boolean | undefined>;

export type TesterRuntimeAuthMode =
  | 'local-first-party'
  | 'third-party-nimi-app';

export type TesterRuntimePlatformClient = Pick<NimiClient, 'appId' | 'runtime' | 'realm' | 'ai' | 'features'>;

export type TesterRuntimeAuthUnavailable = {
  status: 'unavailable' | 'action-required';
  mode: TesterRuntimeAuthMode;
  reasonCode: string;
  actionHint: string;
  message: string;
};

export type TesterRuntimePlatformProjection =
  | {
      status: 'ready';
      mode: TesterRuntimeAuthMode;
      client: TesterRuntimePlatformClient;
      auth: {
        state: 'ready';
        source: 'runtime-local-first-party';
      };
    }
  | TesterRuntimeAuthUnavailable;

let runtimeProjection: Promise<TesterRuntimePlatformProjection> | null = null;

function runtimeEnv(): RuntimeEnv {
  return ((import.meta as ImportMeta & { env?: RuntimeEnv }).env || {});
}

function resolveRuntimeAuthMode(): TesterRuntimeAuthMode {
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
  mode: TesterRuntimeAuthMode,
): Promise<TesterRuntimePlatformProjection> {
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

function unavailable(input: TesterRuntimeAuthUnavailable): TesterRuntimeAuthUnavailable {
  return input;
}

function isNodeRuntime(): boolean {
  const maybeProcess = (globalThis as typeof globalThis & {
    process?: { versions?: { node?: string } };
  }).process;
  return Boolean(maybeProcess?.versions?.node);
}
