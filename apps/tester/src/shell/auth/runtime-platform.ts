import { createNimiClient, type NimiClient } from '@nimiplatform/sdk';
import {
  Runtime,
  createNimiLocalFirstPartyRuntimeAccountCaller,
  createNimiRuntimeAppSessionMetadataProvider,
  createNimiRuntimeFullAppRegistration,
  toNimiRuntimeTimestamp,
  withNimiRuntimeIdempotencyMetadata,
  type NimiRuntimeAccountCaller,
  type RuntimeOptions,
} from '@nimiplatform/sdk/runtime';
import { createNimiClientId } from '@nimiplatform/sdk/types';
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
import { appId } from './app-identity.js';

export const runtimeAccountLoginEnabled = true;
const runtimeDeveloperRegistrationRequested = true;
const runtimeAccountAppInstanceId = `${appId}.local-dev`;
const runtimeAccountDeviceId = 'nimi-tester-local-dev-device';
const runtimeAppSessionInstanceId = `${appId}.platform-runtime-session`;
const runtimeAppSessionDeviceId = 'platform-runtime-session';
const runtimeAppSessionTtlSeconds = 3600;
const runtimeAppSessionRefreshSkewMs = 30_000;
const runtimeProtectedScopes = ['ai.spend.meter'] as const;
const runtimeProtectedScopeCatalogVersion = 'sdk-v2';
const runtimeProtectedTokenTtlSeconds = 3600;
const runtimeProtectedTokenRefreshSkewMs = 60_000;
const runtimeAccountAccessTokenSurfaceId = 'runtime-account.access-token';
const runtimeAccountRefreshSurfaceId = 'runtime-account.refresh';

let runtimeAccountCaller: NimiRuntimeAccountCaller | null = null;

export function getRuntimeAccountCaller(): NimiRuntimeAccountCaller {
  runtimeAccountCaller ??= createNimiLocalFirstPartyRuntimeAccountCaller({
    appId,
    appInstanceId: runtimeAccountAppInstanceId,
    deviceId: runtimeAccountDeviceId,
  });
  return runtimeAccountCaller;
}

export function createRuntimeAccountRefreshCallOptions(): RuntimeTypedCallOptions {
  return createRuntimeAccountCallOptions(
    runtimeAccountRefreshSurfaceId,
    'tester-runtime-account-refresh',
  );
}

export function createRuntimeAccountAccessTokenCallOptions(): RuntimeTypedCallOptions {
  return createRuntimeAccountCallOptions(
    runtimeAccountAccessTokenSurfaceId,
    'tester-runtime-account-access-token',
  );
}

function createRuntimeAccountCallOptions(surfaceId: string, idempotencyPrefix: string): RuntimeTypedCallOptions {
  return withNimiRuntimeIdempotencyMetadata({
    metadata: {
      callerKind: 'third-party-app',
      callerId: appId,
      surfaceId,
    },
  }, createNimiClientId(idempotencyPrefix));
}

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
    const accountRuntime = new Runtime(runtimeOptions());
    await accountRuntime.ready();
    await registerLocalFirstPartyRuntimeAccountCaller(accountRuntime);
    const runtime = new Runtime({
      ...runtimeOptions(),
      authMetadata: createRuntimeAppSessionMetadataProvider(accountRuntime),
    });
    const client = createNimiClient({
      appId,
      runtime,
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

async function registerLocalFirstPartyRuntimeAccountCaller(runtime: Runtime): Promise<void> {
  const caller = getRuntimeAccountCaller();
  await createNimiRuntimeFullAppRegistration(
    () => ({ auth: runtime.auth }),
    {
      appId,
      appInstanceId: caller.appInstanceId,
      deviceId: caller.deviceId,
      capabilities: [...runtimeProtectedScopes],
      developerRegistration: runtimeDeveloperRegistrationRequested,
      rejectionLabel: 'Nimi Tester Runtime account caller registration rejected',
    },
  )();
}

function createRuntimeAppSessionMetadataProvider(accountRuntime: Runtime): () => Promise<CoreMetadata> {
  const caller = getRuntimeAccountCaller();
  const requiredRuntimeSessionMetadata = createNimiRuntimeAppSessionMetadataProvider({
    appId,
    appInstanceId: runtimeAppSessionInstanceId,
    deviceId: runtimeAppSessionDeviceId,
    ttlSeconds: runtimeAppSessionTtlSeconds,
    refreshSkewMs: runtimeAppSessionRefreshSkewMs,
    auth: accountRuntime.auth,
    developerRegistration: runtimeDeveloperRegistrationRequested,
  });
  return async () => {
    const session = await accountRuntime.account.getAccountSessionStatus({ caller });
    if (session.state !== AccountSessionState.AUTHENTICATED || !session.accountProjection?.accountId) {
      return {};
    }
    if (!(await ensureRuntimeAccessToken(accountRuntime, caller))) {
      return {};
    }
    const appSessionMetadata = await requiredRuntimeSessionMetadata();
    const protectedAccessMetadata = await getRuntimeProtectedAccessMetadata(
      accountRuntime,
      session.accountProjection.accountId,
    );
    return {
      ...appSessionMetadata,
      ...protectedAccessMetadata,
    };
  };
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
    protectedAccessCache
    && protectedAccessCache.subjectUserId === subjectUserId
    && protectedAccessCache.expiresAtMs - Date.now() > runtimeProtectedTokenRefreshSkewMs
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
  const requestIdempotencyKey = createRuntimeProtectedAccessIdempotencyKey(subjectUserId);
  const token = await accountRuntime.grants.authorizeExternalPrincipal({
    domain: 'app-auth',
    appId,
    externalPrincipalId: appId,
    externalPrincipalType: ExternalPrincipalType.APP,
    subjectUserId,
    consentId: 'nimi-tester-runtime-account',
    consentVersion: 'v1',
    decisionAt: toNimiRuntimeTimestamp(new Date()),
    policyVersion: 'nimi-tester-runtime-account-v1',
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
  }, requestIdempotencyKey));
  const tokenId = normalizeRuntimeAuthText(token.tokenId);
  const secret = normalizeRuntimeAuthText(token.secret);
  if (!tokenId || !secret) {
    throw new Error('Runtime protected access token response is missing credentials.');
  }
  return {
    subjectUserId,
    metadata: {
      'x-nimi-access-token-id': tokenId,
      'x-nimi-access-token-secret': secret,
    },
    expiresAtMs: runtimeTimestampMillis(token) || Date.now() + (runtimeProtectedTokenTtlSeconds * 1000),
  };
}

async function ensureRuntimeAccessToken(
  accountRuntime: Runtime,
  caller: NimiRuntimeAccountCaller,
): Promise<boolean> {
  const token = await accountRuntime.account.getAccessToken({
    caller,
    requestedScopes: [],
  }, createRuntimeAccountAccessTokenCallOptions());
  if (token.accepted && String(token.accessToken || '').trim()) {
    return true;
  }
  const refreshed = await accountRuntime.account.refreshAccountSession(
    { caller },
    createRuntimeAccountRefreshCallOptions(),
  );
  if (!refreshed.accepted) {
    return false;
  }
  const retry = await accountRuntime.account.getAccessToken({
    caller,
    requestedScopes: [],
  }, createRuntimeAccountAccessTokenCallOptions());
  return Boolean(retry.accepted && String(retry.accessToken || '').trim());
}

function runtimeTimestampMillis(token: AuthorizeExternalPrincipalResponse): number {
  const expiresAt = token.expiresAt;
  if (!expiresAt) {
    return 0;
  }
  const seconds = Number(expiresAt.seconds || 0);
  const nanos = Number(expiresAt.nanos || 0);
  const millis = (seconds * 1000) + Math.floor(nanos / 1_000_000);
  return Number.isFinite(millis) && millis > 0 ? millis : 0;
}

function createRuntimeProtectedAccessIdempotencyKey(subjectUserId: string): string {
  const normalizedSubject = subjectUserId.replace(/[^a-zA-Z0-9._:-]/g, '_').slice(0, 80) || 'unknown';
  return createNimiClientId(`tester-runtime-protected-${normalizedSubject}`);
}

function normalizeRuntimeAuthText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function runtimeOptions(): RuntimeOptions {
  const base: RuntimeOptions = {
    appId,
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
