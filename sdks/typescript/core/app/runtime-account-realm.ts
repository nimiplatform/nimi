import type { CoreTransport } from '../../core-client';
import { Realm, createRealmFetchTransport } from '../../realm';
import type { NimiRuntimeAccountCaller, Runtime } from '../../runtime';
import { createNimiError, type CoreStreamRequest, type CoreUnaryRequest, ReasonCode } from '../../types';

export type RuntimeAccountRealmRuntime = {
  readonly account: Pick<Runtime['account'], 'getAccessToken' | 'refreshAccountSession'>;
};

export type RuntimeAccountMediatedRealmRuntime = {
  readonly account: Pick<Runtime['account'], 'invokeRealmUnary'>;
};

export type RuntimeAccountRealmFetch = typeof fetch;

export function createRuntimeAccountMediatedRealmTransport(input: {
  readonly runtime: RuntimeAccountMediatedRealmRuntime;
  readonly accountCaller: NimiRuntimeAccountCaller;
  readonly realmBaseUrl?: string;
}): CoreTransport {
  return {
    async unary<Response = unknown, Body = unknown>(request: CoreUnaryRequest<Body>): Promise<Response> {
      const realmBaseUrl = normalizeText(input.realmBaseUrl);
      const requestJson = JSON.stringify(request.body ?? {});
      const idempotencyKey = runtimeRealmMediationIdempotencyKey({
        methodId: request.methodId,
        realmBaseUrl,
        requestJson,
      });
      const response = await input.runtime.account.invokeRealmUnary({
        caller: input.accountCaller,
        methodId: request.methodId,
        realmBaseUrl,
        requestJson,
        timeoutMs: request.timeoutMs ?? 30_000,
      }, {
        metadata: withRuntimeRealmIdempotencyMetadata(request.metadata, idempotencyKey),
        timeoutMs: request.timeoutMs,
        signal: request.signal,
        responseMetadataObserver: request.responseMetadataObserver,
      });
      if (!response.accepted) {
        throw createNimiError({
          message: `Runtime Realm mediation rejected ${request.methodId}.`,
          reasonCode: normalizeText(response.reasonCode) || ReasonCode.RUNTIME_UNAVAILABLE,
          actionHint: 'check_runtime_realm_mediation',
          source: 'runtime',
          details: {
            methodId: request.methodId,
            accountReasonCode: normalizeText(response.accountReasonCode),
            errorMessage: normalizeText(response.errorMessage),
          },
        });
      }
      return JSON.parse(response.responseJson || '{}') as Response;
    },
    async *serverStream<Response = unknown, Body = unknown>(
      _request: CoreStreamRequest<Body>,
    ): AsyncIterable<Response> {
      throw createNimiError({
        message: 'Runtime Realm mediation does not support server streams.',
        reasonCode: 'SDK_RUNTIME_REALM_MEDIATION_STREAM_UNSUPPORTED',
        actionHint: 'use_unary_realm_operation',
        source: 'sdk',
      });
    },
  };
}

export function createRealmWithRuntimeAccountToken(input: {
  readonly baseUrl: string;
  readonly fetchImpl?: RuntimeAccountRealmFetch;
  readonly runtime: RuntimeAccountRealmRuntime;
  readonly accountCaller: NimiRuntimeAccountCaller;
}): Realm {
  return new Realm({
    transport: createRealmFetchTransport({
      baseUrl: input.baseUrl,
      fetch: createRuntimeAccountRefreshingRealmFetch(input),
      headers: async () => {
        const accessToken = await getRuntimeAccountAccessToken(input);
        return {
          authorization: `Bearer ${accessToken}`,
        };
      },
    }),
  });
}

function createRuntimeAccountRefreshingRealmFetch(input: {
  readonly fetchImpl?: RuntimeAccountRealmFetch;
  readonly runtime: RuntimeAccountRealmRuntime;
  readonly accountCaller: NimiRuntimeAccountCaller;
}): RuntimeAccountRealmFetch {
  const fetchImpl = resolveFetchImpl(input.fetchImpl);
  return async (request, init) => {
    const response = await fetchImpl(request, init);
    if (response.status !== 401) {
      return response;
    }

    const refreshed = await input.runtime.account.refreshAccountSession({
      caller: input.accountCaller,
    });
    if (!refreshed.accepted) {
      return response;
    }

    const accessToken = await readRuntimeAccountAccessToken(input);
    if (!accessToken) {
      return response;
    }

    const retryInit: RequestInit = {
      ...init,
      headers: withAuthorizationHeader(init?.headers, accessToken),
    };
    return fetchImpl(request, retryInit);
  };
}

async function getRuntimeAccountAccessToken(input: {
  readonly runtime: RuntimeAccountRealmRuntime;
  readonly accountCaller: NimiRuntimeAccountCaller;
}): Promise<string> {
  const accessToken = await readRuntimeAccountAccessToken(input);
  if (!accessToken) {
    throw createNimiError({
      message: 'Runtime account access token unavailable.',
      reasonCode: ReasonCode.PRINCIPAL_UNAUTHORIZED,
      actionHint: 'complete_runtime_account_login',
      source: 'runtime',
    });
  }
  return accessToken;
}

async function readRuntimeAccountAccessToken(input: {
  readonly runtime: RuntimeAccountRealmRuntime;
  readonly accountCaller: NimiRuntimeAccountCaller;
}): Promise<string> {
  const token = await input.runtime.account.getAccessToken({
    caller: input.accountCaller,
    requestedScopes: [],
  });
  const accessToken = normalizeText(token.accessToken);
  return token.accepted && accessToken ? accessToken : '';
}

function withAuthorizationHeader(headers: HeadersInit | undefined, accessToken: string): Headers {
  const next = new Headers(headers);
  next.set('authorization', `Bearer ${accessToken}`);
  return next;
}

function resolveFetchImpl(fetchImpl: RuntimeAccountRealmFetch | undefined): RuntimeAccountRealmFetch {
  const resolved = fetchImpl ?? globalThis.fetch?.bind(globalThis);
  if (typeof resolved !== 'function') {
    throw createNimiError({
      message: 'Realm Runtime account helper requires a fetch implementation.',
      reasonCode: ReasonCode.SDK_REALM_FETCH_UNAVAILABLE,
      actionHint: 'provide_realm_fetch_transport_fetch',
      source: 'sdk',
    });
  }
  return resolved;
}

function withRuntimeRealmIdempotencyMetadata(
  metadata: CoreUnaryRequest['metadata'],
  idempotencyKey: string,
): CoreUnaryRequest['metadata'] {
  return {
    ...(metadata ?? {}),
    idempotencyKey,
    'x-nimi-idempotency-key': idempotencyKey,
  };
}

function runtimeRealmMediationIdempotencyKey(input: {
  readonly methodId: string;
  readonly realmBaseUrl: string;
  readonly requestJson: string;
}): string {
  const method = normalizeIdempotencySegment(input.methodId) || 'realm-unary';
  const hash = fnv1a64Hex(`${input.methodId}\n${input.realmBaseUrl}\n${input.requestJson}`);
  return `runtime-realm:${method}:${hash}`;
}

function normalizeIdempotencySegment(value: unknown): string {
  return normalizeText(value)
    .replace(/[^a-zA-Z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
}

function fnv1a64Hex(value: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}
