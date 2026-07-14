import {
  AppMode,
  ReasonCode,
  WorldRelation,
  type OpenSessionRequest,
  type OpenSessionResponse,
  type RegisterAppRequest,
  type RegisterAppResponse,
  type RuntimeTypedCallOptions,
} from '../core-generated/runtime-typed-client';
import { createNimiClientId, createNimiError, type CoreMetadata } from '../types';
import { withNimiRuntimeIdempotencyMetadata } from './scenario-jobs';

export interface NimiRuntimeAppRegistrationClient {
  registerApp(request: RegisterAppRequest, options?: RuntimeTypedCallOptions): Promise<RegisterAppResponse>;
}

export interface NimiRuntimeAppSessionClient {
  openSession(request: OpenSessionRequest, options?: RuntimeTypedCallOptions): Promise<OpenSessionResponse>;
}

export interface NimiRuntimeAppRegistrationInput {
  readonly appId: string;
  readonly appInstanceId: string;
  readonly deviceId: string;
  readonly appVersion?: string;
  readonly capabilities?: readonly string[];
  readonly rejectionLabel?: string;
  readonly callOptions?: RuntimeTypedCallOptions;
}

export interface NimiRuntimeAppSessionMetadataProviderInput extends NimiRuntimeAppRegistrationInput {
  readonly auth: NimiRuntimeAppRegistrationClient & NimiRuntimeAppSessionClient;
  readonly ttlSeconds?: number;
  readonly refreshSkewMs?: number;
}

export type NimiRuntimeAppRegistration = {
  (): Promise<void>;
  invalidate(reason?: string): void;
};

export type NimiRuntimeAppSessionMetadataProvider = {
  (): Promise<CoreMetadata>;
  invalidate(reason?: string): void;
};

type RuntimeResolver = () => { readonly auth: NimiRuntimeAppRegistrationClient };

type CachedRuntimeAppSession = {
  readonly sessionId: string;
  readonly sessionToken: string;
  readonly expiresAtMs: number;
};

const NIMI_RUNTIME_APP_SESSION_DEFAULT_TTL_SECONDS = 3600;
const NIMI_RUNTIME_APP_SESSION_DEFAULT_REFRESH_SKEW_MS = 60_000;

export function createNimiRuntimeFullAppRegistration(
  resolveRuntime: RuntimeResolver,
  input: NimiRuntimeAppRegistrationInput,
): NimiRuntimeAppRegistration {
  let inflight: Promise<void> | null = null;
  let generation = 0;
  const ensureRegistered = async () => {
    if (inflight) {
      return inflight;
    }
    const requestGeneration = generation;
    const request = (async () => {
      const response = await resolveRuntime().auth.registerApp(
        createNimiRuntimeRegisterAppRequest(input),
        withNimiRuntimeIdempotencyMetadata(input.callOptions, createNimiClientId('runtime-register-app')),
      );
      if (!response.accepted) {
        throw createNimiError({
          message: `${input.rejectionLabel || 'Runtime app registration was rejected'}: ${runtimeReasonCodeName(response.reasonCode) || 'unknown'}`,
          reasonCode: runtimeReasonCodeName(response.reasonCode) || 'RUNTIME_CALL_FAILED',
          actionHint: 'register_runtime_app_first',
          source: 'runtime',
        });
      }
    })();
    inflight = request;
    try {
      await request;
    } catch (error) {
      if (generation === requestGeneration && inflight === request) {
        inflight = null;
      }
      throw error;
    }
  };
  ensureRegistered.invalidate = () => {
    generation += 1;
    inflight = null;
  };
  return ensureRegistered;
}

export function createNimiRuntimeAppSessionMetadataProvider(
  input: NimiRuntimeAppSessionMetadataProviderInput,
): NimiRuntimeAppSessionMetadataProvider {
  const ttlSeconds = normalizePositiveInt(input.ttlSeconds, NIMI_RUNTIME_APP_SESSION_DEFAULT_TTL_SECONDS);
  const refreshSkewMs = normalizeNonNegativeInt(input.refreshSkewMs, NIMI_RUNTIME_APP_SESSION_DEFAULT_REFRESH_SKEW_MS);
  const ensureRegistered = createNimiRuntimeFullAppRegistration(
    () => ({ auth: input.auth }),
    input,
  );
  let cached: CachedRuntimeAppSession | null = null;
  let inflight: Promise<CachedRuntimeAppSession> | null = null;
  let generation = 0;

  const provider = async () => {
    if (cached && cached.expiresAtMs - Date.now() > refreshSkewMs) {
      return runtimeAppSessionMetadata(cached);
    }
    const requestGeneration = generation;
    if (!inflight) {
      inflight = openNimiRuntimeAppSession(input, ensureRegistered, ttlSeconds);
    }
    const request = inflight;
    try {
      const session = await request;
      if (generation !== requestGeneration) {
        return provider();
      }
      cached = session;
      return runtimeAppSessionMetadata(session);
    } finally {
      if (inflight === request) {
        inflight = null;
      }
    }
  };
  provider.invalidate = (reason?: string) => {
    generation += 1;
    cached = null;
    inflight = null;
    ensureRegistered.invalidate(reason);
  };
  return provider;
}

function createNimiRuntimeRegisterAppRequest(input: NimiRuntimeAppRegistrationInput): RegisterAppRequest {
  return {
    appId: requireText(input.appId, 'appId'),
    appInstanceId: requireText(input.appInstanceId, 'appInstanceId'),
    deviceId: requireText(input.deviceId, 'deviceId'),
    appVersion: normalizeText(input.appVersion) || '1',
    capabilities: normalizeStrings(input.capabilities || []),
    modeManifest: {
      appMode: AppMode.FULL,
      runtimeRequired: true,
      realmRequired: true,
      worldRelation: WorldRelation.NONE,
    },
  };
}

async function openNimiRuntimeAppSession(
  input: NimiRuntimeAppSessionMetadataProviderInput,
  ensureRegistered: () => Promise<void>,
  ttlSeconds: number,
): Promise<CachedRuntimeAppSession> {
  await ensureRegistered();
  const response = await input.auth.openSession({
    appId: requireText(input.appId, 'appId'),
    appInstanceId: requireText(input.appInstanceId, 'appInstanceId'),
    deviceId: requireText(input.deviceId, 'deviceId'),
    subjectUserId: '',
    ttlSeconds,
  }, withNimiRuntimeIdempotencyMetadata(input.callOptions, createNimiClientId('runtime-open-session')));
  const sessionId = normalizeText(response.sessionId);
  const sessionToken = normalizeText(response.sessionToken);
  if (!sessionId || !sessionToken) {
    throw createNimiError({
      message: `Runtime app session open failed: ${runtimeReasonCodeName(response.reasonCode) || 'unknown'}`,
      reasonCode: runtimeReasonCodeName(response.reasonCode) || 'RUNTIME_CALL_FAILED',
      actionHint: 'open_runtime_app_session',
      source: 'runtime',
    });
  }
  return {
    sessionId,
    sessionToken,
    expiresAtMs: timestampToMillis(response.expiresAt) || Date.now() + ttlSeconds * 1000,
  };
}

function runtimeAppSessionMetadata(session: CachedRuntimeAppSession): CoreMetadata {
  return {
    'x-nimi-session-id': session.sessionId,
    'x-nimi-session-token': session.sessionToken,
  };
}

function runtimeReasonCodeName(reasonCode: ReasonCode): string {
  return ReasonCode[reasonCode] || '';
}

function timestampToMillis(timestamp: { readonly seconds?: string | number; readonly nanos?: number } | undefined): number {
  if (!timestamp) {
    return 0;
  }
  const seconds = Number(timestamp.seconds || 0);
  const nanos = Number(timestamp.nanos || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return 0;
  }
  return Math.floor(seconds * 1000 + (Number.isFinite(nanos) ? nanos / 1_000_000 : 0));
}

function normalizePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeNonNegativeInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeStrings(values: readonly unknown[]): string[] {
  return [...new Set(values.map((value) => normalizeText(value)).filter(Boolean))];
}

function requireText(value: unknown, field: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw createNimiError({
      message: `Runtime app session requires ${field}.`,
      reasonCode: 'SDK_RUNTIME_APP_SESSION_INPUT_INVALID',
      actionHint: 'provide_runtime_app_session_identity',
      source: 'sdk',
    });
  }
  return normalized;
}

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}
