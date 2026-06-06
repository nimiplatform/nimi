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
import { createNimiError, type CoreMetadata } from '../types';

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
  readonly developerRegistration?: boolean;
  readonly rejectionLabel?: string;
  readonly callOptions?: RuntimeTypedCallOptions;
}

export interface NimiRuntimeAppSessionMetadataProviderInput extends NimiRuntimeAppRegistrationInput {
  readonly auth: NimiRuntimeAppRegistrationClient & NimiRuntimeAppSessionClient;
  readonly getSubjectUserId: () => string | Promise<string | undefined> | undefined;
  readonly ttlSeconds?: number;
  readonly refreshSkewMs?: number;
}

export type NimiRuntimeAppSessionMetadataProvider = () => Promise<CoreMetadata>;

type RuntimeResolver = () => { readonly auth: NimiRuntimeAppRegistrationClient };

type CachedRuntimeAppSession = {
  readonly subjectUserId: string;
  readonly sessionId: string;
  readonly sessionToken: string;
  readonly expiresAtMs: number;
};

const NIMI_RUNTIME_APP_SESSION_DEFAULT_TTL_SECONDS = 3600;
const NIMI_RUNTIME_APP_SESSION_DEFAULT_REFRESH_SKEW_MS = 60_000;

export function createNimiRuntimeFullAppRegistration(
  resolveRuntime: RuntimeResolver,
  input: NimiRuntimeAppRegistrationInput,
): () => Promise<void> {
  let inflight: Promise<void> | null = null;
  return async () => {
    if (inflight) {
      return inflight;
    }
    inflight = (async () => {
      const response = await resolveRuntime().auth.registerApp(createNimiRuntimeRegisterAppRequest(input), input.callOptions);
      if (!response.accepted) {
        throw createNimiError({
          message: `${input.rejectionLabel || 'Runtime app registration was rejected'}: ${runtimeReasonCodeName(response.reasonCode) || 'unknown'}`,
          reasonCode: runtimeReasonCodeName(response.reasonCode) || 'RUNTIME_CALL_FAILED',
          actionHint: 'register_runtime_app_first',
          source: 'runtime',
        });
      }
    })();
    try {
      await inflight;
    } catch (error) {
      inflight = null;
      throw error;
    }
  };
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

  return async () => {
    const subjectUserId = normalizeText(await input.getSubjectUserId());
    if (!subjectUserId) {
      throw createNimiError({
        message: 'Runtime app session requires subjectUserId.',
        reasonCode: 'SDK_RUNTIME_APP_SESSION_SUBJECT_REQUIRED',
        actionHint: 'provide_runtime_app_session_subject_user_id',
        source: 'sdk',
      });
    }
    if (cached && cached.subjectUserId === subjectUserId && cached.expiresAtMs - Date.now() > refreshSkewMs) {
      return runtimeAppSessionMetadata(cached);
    }
    if (!inflight) {
      inflight = openNimiRuntimeAppSession(input, ensureRegistered, subjectUserId, ttlSeconds);
    }
    try {
      cached = await inflight;
      return runtimeAppSessionMetadata(cached);
    } finally {
      inflight = null;
    }
  };
}

function createNimiRuntimeRegisterAppRequest(input: NimiRuntimeAppRegistrationInput): RegisterAppRequest {
  return {
    appId: requireText(input.appId, 'appId'),
    appInstanceId: requireText(input.appInstanceId, 'appInstanceId'),
    deviceId: requireText(input.deviceId, 'deviceId'),
    appVersion: normalizeText(input.appVersion) || '1',
    capabilities: normalizeStrings(input.capabilities || []),
    developerRegistration: input.developerRegistration === true,
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
  subjectUserId: string,
  ttlSeconds: number,
): Promise<CachedRuntimeAppSession> {
  await ensureRegistered();
  const response = await input.auth.openSession({
    appId: requireText(input.appId, 'appId'),
    appInstanceId: requireText(input.appInstanceId, 'appInstanceId'),
    deviceId: requireText(input.deviceId, 'deviceId'),
    subjectUserId,
    ttlSeconds,
  }, input.callOptions);
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
    subjectUserId,
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
