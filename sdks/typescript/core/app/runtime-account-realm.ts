import type { CoreTransport } from '../../core-client';
import {
  AccountCallerMode,
  AccountReasonCode,
  ReasonCode as RuntimeWireReasonCode,
} from '../../core-generated/runtime-typed-client';
import type { NimiRuntimeAccountCaller, Runtime } from '../../runtime';
import { createNimiClientId, createNimiError, type CoreStreamRequest, type CoreUnaryRequest, ReasonCode } from '../../types';

export type RuntimeAccountMediatedRealmRuntime = {
  readonly account: Pick<Runtime['account'], 'invokeRealmUnary'>;
};

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
function assertRuntimeMediatedRealmCallerMode(caller: NimiRuntimeAccountCaller): void {
  if (
    caller.mode !== AccountCallerMode.LOCAL_FIRST_PARTY_APP
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
