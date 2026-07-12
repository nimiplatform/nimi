import type { CoreTransport } from '../../core-client';
import {
  AccountCallerMode,
  AccountReasonCode,
  ReasonCode as RuntimeWireReasonCode,
} from '../../core-generated/runtime-typed-client';
import { Realm, createRealmFetchTransport } from '../../realm';
import type { NimiRuntimeAccountCaller, Runtime } from '../../runtime';
import { createNimiClientId, createNimiError, type CoreStreamRequest, type CoreUnaryRequest, ReasonCode } from '../../types';

export type RuntimeAccountRealmRuntime = {
  readonly account: Pick<Runtime['account'], 'getAccessToken'>;
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
  assertRuntimeMediatedRealmCallerMode(input.accountCaller);
  return {
    async unary<Response = unknown, Body = unknown>(request: CoreUnaryRequest<Body>): Promise<Response> {
      const realmBaseUrl = normalizeText(input.realmBaseUrl);
      const requestJson = JSON.stringify(request.body ?? {});
      const idempotencyKey = runtimeRealmMediationIdempotencyKey(request.methodId);
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
        const failure = runtimeMediatedRealmFailure(response);
        throw createNimiError({
          message: `Runtime Realm mediation rejected ${request.methodId}.`,
          reasonCode: failure.reasonCode,
          actionHint: failure.actionHint,
          retryable: failure.retryable,
          source: failure.source,
          details: {
            methodId: request.methodId,
            accountReasonCode: runtimeEnumName(AccountReasonCode, response.accountReasonCode),
            httpStatus: response.httpStatus,
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

function runtimeMediatedRealmFailure(response: {
  readonly reasonCode: RuntimeWireReasonCode;
  readonly accountReasonCode: AccountReasonCode;
  readonly httpStatus: number;
}): {
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly retryable: boolean;
  readonly source: 'realm' | 'runtime';
} {
  if (response.accountReasonCode === AccountReasonCode.BROKER_UPSTREAM_FAILED) {
    const reasonCode = response.httpStatus === 404
      ? ReasonCode.REALM_NOT_FOUND
      : response.httpStatus === 409
        ? ReasonCode.REALM_CONFLICT
        : response.httpStatus === 429
          ? ReasonCode.REALM_RATE_LIMITED
          : ReasonCode.REALM_UNAVAILABLE;
    return {
      reasonCode,
      actionHint: reasonCode === ReasonCode.REALM_UNAVAILABLE
        ? 'retry_realm_operation_when_available'
        : 'inspect_realm_operation_failure',
      retryable: reasonCode === ReasonCode.REALM_UNAVAILABLE || reasonCode === ReasonCode.REALM_RATE_LIMITED,
      source: 'realm',
    };
  }
  return {
    reasonCode: runtimeEnumName(RuntimeWireReasonCode, response.reasonCode) || ReasonCode.RUNTIME_UNAVAILABLE,
    actionHint: 'check_runtime_realm_mediation',
    retryable: false,
    source: 'runtime',
  };
}

function runtimeEnumName(enumType: Record<number, string>, value: number): string {
  return normalizeText(enumType[value]);
}

export function createRealmWithRuntimeAccountToken(input: {
  readonly baseUrl: string;
  readonly fetchImpl?: RuntimeAccountRealmFetch;
  readonly runtime: RuntimeAccountRealmRuntime;
  readonly accountCaller: NimiRuntimeAccountCaller;
}): Realm {
  if (input.accountCaller.mode !== AccountCallerMode.LOCAL_FIRST_PARTY_APP) {
    throw createNimiError({
      message: 'Raw Runtime account token Realm transport is restricted to explicitly admitted local first-party callers.',
      reasonCode: 'SDK_RUNTIME_ACCOUNT_RAW_TOKEN_MODE_FORBIDDEN',
      actionHint: 'use_runtime_account_mediated_realm_transport',
      source: 'sdk',
    });
  }
  return new Realm({
    transport: createRealmFetchTransport({
      baseUrl: input.baseUrl,
      fetch: resolveFetchImpl(input.fetchImpl),
      headers: async () => {
        const accessToken = await getRuntimeAccountAccessToken(input);
        return {
          authorization: `Bearer ${accessToken}`,
        };
      },
    }),
  });
}

function assertRuntimeMediatedRealmCallerMode(caller: NimiRuntimeAccountCaller): void {
  if (
    caller.mode !== AccountCallerMode.LOCAL_FIRST_PARTY_APP
    && caller.mode !== AccountCallerMode.LOCAL_DEVELOPER_APP
    && caller.mode !== AccountCallerMode.DESKTOP_LAUNCHED_NIMI_APP
    && caller.mode !== AccountCallerMode.DESKTOP_SHELL
  ) {
    throw createNimiError({
      message: 'Runtime-mediated Realm transport requires an admitted shared-auth caller mode.',
      reasonCode: 'SDK_RUNTIME_REALM_MEDIATION_CALLER_MODE_FORBIDDEN',
      actionHint: 'register_the_app_or_use_a_scoped_binding_surface',
      source: 'sdk',
    });
  }
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

function runtimeRealmMediationIdempotencyKey(methodId: string): string {
  const method = normalizeIdempotencySegment(methodId) || 'realm-unary';
  return createNimiClientId(`runtime-realm-${method}`);
}

function normalizeIdempotencySegment(value: unknown): string {
  return normalizeText(value)
    .replace(/[^a-zA-Z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
}

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}
