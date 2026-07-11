import type { CoreTransport } from '../../core-client';
import { AccountCallerMode } from '../../core-generated/runtime-typed-client';
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

function assertRuntimeMediatedRealmCallerMode(caller: NimiRuntimeAccountCaller): void {
  if (
    caller.mode !== AccountCallerMode.LOCAL_FIRST_PARTY_APP
    && caller.mode !== AccountCallerMode.LOCAL_DEVELOPER_APP
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
