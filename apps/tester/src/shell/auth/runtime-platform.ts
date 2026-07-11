import { createNimiClient, createNimiError, type NimiClient } from '@nimiplatform/sdk';
import { createRuntimeAccountMediatedRealmTransport } from '@nimiplatform/sdk/app';
import { Realm } from '@nimiplatform/sdk/realm';
import {
  Runtime,
  createNimiDeveloperRegisteredRuntimeAccountCaller,
  createNimiRuntimeAppSessionMetadataProvider,
  createNimiRuntimeFullAppRegistration,
  type NimiRuntimeAccountCaller,
  type RuntimeOptions,
} from '@nimiplatform/sdk/runtime';
import { AccountSessionState } from '@nimiplatform/sdk/runtime/wire-types';
import { ReasonCode } from '@nimiplatform/sdk/types';
export { appId, appTitle, scaffoldProfile } from './app-identity.js';
import { appId, appTitle } from './app-identity.js';
import { createTesterRuntimeTransportConfig, resolveTesterRuntimeHostKind } from './runtime-transport.js';

export const runtimeAccountLoginEnabled = true;

const runtimeDeveloperRegistrationRequested = true;
const runtimeClientIdPrefix = normalizeClientIdPrefix(appId);
const runtimeAccountAppInstanceId = `${appId}.local-developer`;
const runtimeAccountDeviceId = `${runtimeClientIdPrefix}-local-developer-device`;
const runtimeAppSessionInstanceId = runtimeAccountAppInstanceId;
const runtimeAppSessionDeviceId = runtimeAccountDeviceId;
const runtimeAppSessionTtlSeconds = 3600;
const runtimeAppSessionRefreshSkewMs = 30_000;
const runtimeAccountBrokerCapabilities = [
  'account.session.read',
  'data.scope.read#realm.worlds.read-probe',
] as const;
const runtimeRegistrationCapabilities = [
  ...runtimeAccountBrokerCapabilities,
] as const;

export type RuntimeAuthMode = 'developer-registered-local-app' | 'third-party-nimi-app';

export type RuntimePlatformReadyProjection = {
  readonly status: 'ready';
  readonly mode: RuntimeAuthMode;
  readonly client: NimiClient;
  readonly accountRuntime: Runtime;
  readonly accountCaller: NimiRuntimeAccountCaller;
  readonly auth: {
    readonly state: 'ready';
    readonly source: 'runtime-local-developer-app';
    readonly subjectUserId: string;
  };
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

function resolveRuntimeAuthMode(): RuntimeAuthMode {
  return runtimeAccountLoginEnabled ? 'developer-registered-local-app' : 'third-party-nimi-app';
}

export function clearRuntimePlatformProjection() {
  runtimeProjection = null;
  runtimeReadyProjection = null;
}

export function getRuntimePlatformProjection() {
  const mode = resolveRuntimeAuthMode();
  if (mode === 'developer-registered-local-app') {
    runtimeProjection ??= createDeveloperRegisteredRuntimeProjection(mode);
    return runtimeProjection;
  }
  runtimeProjection ??= Promise.resolve({
    status: 'unavailable',
    mode,
    reasonCode: ReasonCode.SDK_RUNTIME_METHOD_UNAVAILABLE,
    actionHint: 'wait_for_runtime_nimi_app_session_projection',
    message: 'third-party Nimi App Runtime session projection is not exposed by this SDK/runtime pair',
  });
  return runtimeProjection;
}

export function getRuntimeNimiClient(): NimiClient {
  if (!runtimeReadyProjection) {
    throw createNimiError({
      message: 'Nimi Runtime client is not initialized. Wait for Runtime platform projection to become ready.',
      reasonCode: ReasonCode.SDK_PLATFORM_CLIENT_NOT_READY,
      actionHint: 'wait_for_runtime_platform_projection',
      source: 'sdk',
    });
  }
  return runtimeReadyProjection.client;
}

export function getRuntimeAccountCaller(): NimiRuntimeAccountCaller {
  runtimeAccountCaller ??= createNimiDeveloperRegisteredRuntimeAccountCaller({
    appId,
    appInstanceId: runtimeAccountAppInstanceId,
    deviceId: runtimeAccountDeviceId,
  });
  return runtimeAccountCaller;
}

export function getRuntimeSubjectUserId(): string | undefined {
  return runtimeReadyProjection?.auth.subjectUserId;
}

async function createDeveloperRegisteredRuntimeProjection(
  mode: RuntimeAuthMode,
): Promise<RuntimePlatformProjection> {
  try {
    const accountRuntime = new Runtime(runtimeOptions());
    await accountRuntime.ready();
    await registerDeveloperRegisteredRuntimeAccountCaller(accountRuntime);
    const accountCaller = getRuntimeAccountCaller();
    const accountClient = createNimiClient({
      appId,
      runtime: accountRuntime,
      realm: false,
      app: false,
      permissions: false,
    });
    const subjectUserId = await readRuntimeSubjectUserId(accountRuntime, accountCaller);
    if (!subjectUserId) {
      return {
        status: 'login-required',
        mode,
        client: accountClient,
        accountRuntime,
        accountCaller,
        reasonCode: 'ACCOUNT_SESSION_NOT_AUTHENTICATED',
        actionHint: 'complete_runtime_developer_registered_account_setup',
        message: 'Runtime account session is not authenticated; sign in with Runtime account login to provide accountProjection.accountId as subjectUserId.',
      };
    }
    const runtime = new Runtime(
      resolveTesterRuntimeHostKind() !== 'node'
        ? runtimeOptions()
        : {
            ...runtimeOptions(),
            authMetadata: createRuntimeAppSessionMetadataProvider(accountRuntime),
          },
    );
    const client = createNimiClient({
      appId,
      runtime,
      realm: new Realm({
        transport: createRuntimeAccountMediatedRealmTransport({
          runtime,
          accountCaller,
        }),
      }),
      app: false,
      permissions: false,
    });
    await client.runtime.ready();

    runtimeReadyProjection = {
      status: 'ready',
      mode,
      client,
      accountRuntime,
      accountCaller,
      auth: {
        state: 'ready',
        source: 'runtime-local-developer-app',
        subjectUserId,
      },
    };
    return runtimeReadyProjection;
  } catch (error) {
    return unavailableFromError(mode, error);
  }
}

async function registerDeveloperRegisteredRuntimeAccountCaller(accountRuntime: Runtime): Promise<void> {
  const caller = getRuntimeAccountCaller();
  await createNimiRuntimeFullAppRegistration(
    () => ({ auth: accountRuntime.auth }),
    {
      appId,
      appInstanceId: caller.appInstanceId,
      deviceId: caller.deviceId,
      capabilities: [...runtimeRegistrationCapabilities],
      developerRegistration: runtimeDeveloperRegistrationRequested,
      rejectionLabel: `${appTitle} Runtime account caller registration rejected`,
    },
  )();
}

function createRuntimeAppSessionMetadataProvider(
  accountRuntime: Runtime,
): ReturnType<typeof createNimiRuntimeAppSessionMetadataProvider> {
  const requiredRuntimeSessionMetadata = createNimiRuntimeAppSessionMetadataProvider({
    appId,
    appInstanceId: runtimeAppSessionInstanceId,
    deviceId: runtimeAppSessionDeviceId,
    capabilities: [...runtimeRegistrationCapabilities],
    ttlSeconds: runtimeAppSessionTtlSeconds,
    refreshSkewMs: runtimeAppSessionRefreshSkewMs,
    auth: accountRuntime.auth,
    developerRegistration: runtimeDeveloperRegistrationRequested,
  });
  return requiredRuntimeSessionMetadata;
}

async function readRuntimeSubjectUserId(
  accountRuntime: Runtime,
  accountCaller: NimiRuntimeAccountCaller,
): Promise<string> {
  const session = await accountRuntime.account.getAccountSessionStatus({ caller: accountCaller });
  if (session.state === AccountSessionState.AUTHENTICATED && session.accountProjection?.accountId) {
    return normalizeText(session.accountProjection.accountId);
  }
  return '';
}

function unavailableFromError(mode: RuntimeAuthMode, error: unknown): RuntimePlatformUnavailableProjection {
  const reasonCode = typeof error === 'object' && error !== null && 'reasonCode' in error
    ? normalizeText((error as { reasonCode?: unknown }).reasonCode) || ReasonCode.RUNTIME_UNAVAILABLE
    : typeof error === 'object' && error !== null && 'code' in error
      ? normalizeText((error as { code?: unknown }).code) || ReasonCode.RUNTIME_UNAVAILABLE
      : ReasonCode.RUNTIME_UNAVAILABLE;
  return {
    status: 'action-required',
    mode,
    reasonCode,
    actionHint: 'enable_desktop_developer_mode_and_complete_runtime_account_setup',
    message: error instanceof Error ? error.message : 'developer-registered Runtime account setup is required',
  };
}

function runtimeOptions(): RuntimeOptions {
  const base: RuntimeOptions = { appId };
  const transport = createTesterRuntimeTransportConfig();
  return transport ? { ...base, transport } : base;
}

function normalizeClientIdPrefix(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'nimi-app';
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
