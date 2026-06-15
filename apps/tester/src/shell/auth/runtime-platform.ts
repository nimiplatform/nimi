import { createNimiClient, createNimiClientId, createNimiError, type NimiClient } from '@nimiplatform/sdk';
import {
  Runtime,
  createNimiDeveloperRegisteredRuntimeAccountCaller,
  createNimiRuntimeAppSessionMetadataProvider,
  createNimiRuntimeFullAppRegistration,
  toNimiRuntimeTimestamp,
  withNimiRuntimeIdempotencyMetadata,
  type NimiRuntimeAccountCaller,
  type RuntimeOptions,
} from '@nimiplatform/sdk/runtime';
import {
  AccountSessionState,
  AuthorizationPreset,
  ExternalPrincipalType,
  PolicyMode,
  type AuthorizeExternalPrincipalResponse,
  type RuntimeTypedCallOptions,
} from '@nimiplatform/sdk/runtime/generated';
import type { CoreMetadata } from '@nimiplatform/sdk/types';
import { ReasonCode } from '@nimiplatform/sdk/types';
export { appId, appTitle, scaffoldProfile } from './app-identity.js';
import { appId, appTitle } from './app-identity.js';

export const runtimeAccountLoginEnabled = true;

const runtimeDeveloperRegistrationRequested = true;
const runtimeClientIdPrefix = normalizeClientIdPrefix(appId);
const runtimeAccountAppInstanceId = `${appId}.local-developer`;
const runtimeAccountDeviceId = `${runtimeClientIdPrefix}-local-developer-device`;
const runtimeAppSessionInstanceId = `${appId}.platform-runtime-session`;
const runtimeAppSessionDeviceId = 'platform-runtime-session';
const runtimeAppSessionTtlSeconds = 3600;
const runtimeAppSessionRefreshSkewMs = 30_000;
const runtimeProtectedScopes = ['ai.spend.meter'] as const;
const runtimeProtectedScopeCatalogVersion = 'sdk-v2';
const runtimeProtectedTokenTtlSeconds = 3600;
const runtimeProtectedTokenRefreshSkewMs = 60_000;
const runtimeAccountRefreshSurfaceId = 'runtime-account.refresh';

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
  protectedAccessCache = null;
  protectedAccessInflight = null;
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
      reasonCode: 'SDK_PLATFORM_CLIENT_NOT_READY',
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

export function createRuntimeAccountRefreshCallOptions(): RuntimeTypedCallOptions {
  return createRuntimeAccountCallOptions(
    runtimeAccountRefreshSurfaceId,
    createScopedClientId('runtime-account-refresh'),
  );
}

function createRuntimeAccountCallOptions(surfaceId: string, idempotencyKey: string): RuntimeTypedCallOptions {
  return withNimiRuntimeIdempotencyMetadata({
    metadata: {
      callerKind: 'developer-registered-local-app',
      callerId: appId,
      surfaceId,
    },
  }, idempotencyKey);
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
    const runtime = new Runtime({
      ...runtimeOptions(),
      authMetadata: createRuntimeAppSessionMetadataProvider(accountRuntime, accountCaller),
    });
    const client = createNimiClient({
      appId,
      runtime,
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
      capabilities: [...runtimeProtectedScopes],
      developerRegistration: runtimeDeveloperRegistrationRequested,
      rejectionLabel: `${appTitle} Runtime account caller registration rejected`,
    },
  )();
}

function createRuntimeAppSessionMetadataProvider(
  accountRuntime: Runtime,
  accountCaller: NimiRuntimeAccountCaller,
): () => Promise<CoreMetadata> {
  const requiredRuntimeSessionMetadata = createNimiRuntimeAppSessionMetadataProvider({
    appId,
    appInstanceId: runtimeAppSessionInstanceId,
    deviceId: runtimeAppSessionDeviceId,
    capabilities: [...runtimeProtectedScopes],
    ttlSeconds: runtimeAppSessionTtlSeconds,
    refreshSkewMs: runtimeAppSessionRefreshSkewMs,
    auth: accountRuntime.auth,
    developerRegistration: runtimeDeveloperRegistrationRequested,
  });
  return async () => {
    const subjectUserId = await readRuntimeSubjectUserId(accountRuntime, accountCaller);
    if (!subjectUserId) {
      return {};
    }
    const appSessionMetadata = await requiredRuntimeSessionMetadata();
    const protectedAccessMetadata = await getRuntimeProtectedAccessMetadata(accountRuntime, subjectUserId);
    return {
      ...appSessionMetadata,
      ...protectedAccessMetadata,
    };
  };
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

let protectedAccessCache: {
  readonly subjectUserId: string;
  readonly metadata: CoreMetadata;
  readonly expiresAtMs: number;
} | null = null;
let protectedAccessInflight: Promise<{
  readonly subjectUserId: string;
  readonly metadata: CoreMetadata;
  readonly expiresAtMs: number;
}> | null = null;

async function getRuntimeProtectedAccessMetadata(
  accountRuntime: Runtime,
  subjectUserId: string,
): Promise<CoreMetadata> {
  if (
    protectedAccessCache &&
    protectedAccessCache.subjectUserId === subjectUserId &&
    protectedAccessCache.expiresAtMs - Date.now() > runtimeProtectedTokenRefreshSkewMs
  ) {
    return protectedAccessCache.metadata;
  }
  protectedAccessInflight ??= issueRuntimeProtectedAccessMetadata(accountRuntime, subjectUserId);
  try {
    protectedAccessCache = await protectedAccessInflight;
    return protectedAccessCache.metadata;
  } finally {
    protectedAccessInflight = null;
  }
}

async function issueRuntimeProtectedAccessMetadata(
  accountRuntime: Runtime,
  subjectUserId: string,
): Promise<{
  readonly subjectUserId: string;
  readonly metadata: CoreMetadata;
  readonly expiresAtMs: number;
}> {
  const normalizedSubject = subjectUserId.replace(/[^a-zA-Z0-9._:-]/g, '_').slice(0, 80) || 'unknown';
  const token = await accountRuntime.grants.authorizeExternalPrincipal({
    domain: 'app-auth',
    appId,
    externalPrincipalId: appId,
    externalPrincipalType: ExternalPrincipalType.APP,
    subjectUserId,
    consentId: `${runtimeClientIdPrefix}-runtime-account`,
    consentVersion: 'v1',
    decisionAt: toNimiRuntimeTimestamp(new Date()),
    policyVersion: `${runtimeClientIdPrefix}-runtime-account-v1`,
    policyMode: PolicyMode.CUSTOM,
    preset: AuthorizationPreset.UNSPECIFIED,
    scopes: [...runtimeProtectedScopes],
    resourceSelectors: {
      conversationIds: [],
      messageIds: [],
      documentIds: [],
      labels: {},
    },
    canDelegate: false,
    maxDelegationDepth: 0,
    ttlSeconds: runtimeProtectedTokenTtlSeconds,
    scopeCatalogVersion: runtimeProtectedScopeCatalogVersion,
    policyOverride: false,
  }, withNimiRuntimeIdempotencyMetadata({
    metadata: { domain: 'app-auth' },
  }, createScopedClientId(`runtime-protected-${normalizedSubject}`)));
  const tokenId = normalizeText(token.tokenId);
  const secret = normalizeText(token.secret);
  if (!tokenId || !secret) {
    throw createNimiError({
      message: 'Runtime protected access token response is missing credentials.',
      reasonCode: 'PRINCIPAL_UNAUTHORIZED',
      actionHint: 'authorize_runtime_protected_access',
      source: 'runtime',
    });
  }
  return {
    subjectUserId,
    metadata: {
      'x-nimi-access-token-id': tokenId,
      'x-nimi-access-token-secret': secret,
    },
    expiresAtMs: runtimeAuthorizeResponseExpiresAtMs(token) || Date.now() + (runtimeProtectedTokenTtlSeconds * 1000),
  };
}

function unavailableFromError(mode: RuntimeAuthMode, error: unknown): RuntimePlatformUnavailableProjection {
  const reasonCode = typeof error === 'object' && error !== null && 'reasonCode' in error
    ? normalizeText((error as { reasonCode?: unknown }).reasonCode) || 'RUNTIME_UNAVAILABLE'
    : typeof error === 'object' && error !== null && 'code' in error
      ? normalizeText((error as { code?: unknown }).code) || 'RUNTIME_UNAVAILABLE'
      : 'RUNTIME_UNAVAILABLE';
  return {
    status: 'action-required',
    mode,
    reasonCode,
    actionHint: 'enable_desktop_developer_mode_and_complete_runtime_account_setup',
    message: error instanceof Error ? error.message : 'developer-registered Runtime account setup is required',
  };
}

function runtimeAuthorizeResponseExpiresAtMs(token: AuthorizeExternalPrincipalResponse): number {
  const expiresAt = token.expiresAt;
  if (!expiresAt) return 0;
  const seconds = Number(expiresAt.seconds || 0);
  const nanos = Number(expiresAt.nanos || 0);
  const millis = (seconds * 1000) + Math.floor(nanos / 1_000_000);
  return Number.isFinite(millis) && millis > 0 ? millis : 0;
}

function runtimeOptions(): RuntimeOptions {
  const base: RuntimeOptions = { appId };
  return isNodeRuntime()
    ? base
    : {
        ...base,
        transport: {
          type: 'tauri-ipc',
          commandNamespace: 'runtime_bridge',
          eventNamespace: 'runtime_bridge',
        },
      };
}

function createScopedClientId(suffix: string): string {
  return createNimiClientId(`${runtimeClientIdPrefix}-${suffix}`);
}

function normalizeClientIdPrefix(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'nimi-app';
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isNodeRuntime(): boolean {
  const maybeProcess = (globalThis as typeof globalThis & {
    process?: { versions?: { node?: string } };
  }).process;
  return Boolean(maybeProcess?.versions?.node);
}
