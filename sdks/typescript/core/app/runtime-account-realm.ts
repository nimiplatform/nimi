import type { CoreTransport } from '../../core-client';
import {
  AccountCallerMode,
  AccountReasonCode,
  ReasonCode as RuntimeWireReasonCode,
} from '../../core-generated/runtime-typed-client';
import type { NimiRuntimeAccountCaller, Runtime } from '../../runtime';
import {
  NIMI_BUNDLED_AVATAR_APP_ID,
  NIMI_BUNDLED_AVATAR_APP_INSTANCE_ID,
  NIMI_BUNDLED_AVATAR_DEVICE_ID,
} from '../../runtime/bundled-avatar-profile.generated.js';
import { createNimiClientId, createNimiError, type CoreStreamRequest, type CoreUnaryRequest, ReasonCode } from '../../types';
import {
  NIMI_BUNDLED_AVATAR_REALM_OPERATION_ID,
  isNimiDesktopProductRealmOperationID,
  isNimiDesktopSourceReadinessRealmOperationID,
} from './runtime-account-realm-source-readiness.generated.js';

export {
  NIMI_BUNDLED_AVATAR_REALM_OPERATION_ID,
  NIMI_DESKTOP_PRODUCT_REALM_OPERATION_IDS,
  NIMI_DESKTOP_SOURCE_READINESS_REALM_OPERATION_IDS,
  type NimiDesktopProductRealmOperationID,
  type NimiDesktopSourceReadinessRealmOperationID,
} from './runtime-account-realm-source-readiness.generated.js';

export type RuntimeAccountMediatedRealmRuntime = {
  readonly account: Pick<Runtime['account'], 'invokeRealmUnary'>;
};

export function createRuntimeAccountMediatedRealmTransport(input: {
  readonly runtime: RuntimeAccountMediatedRealmRuntime;
  readonly accountCaller: NimiRuntimeAccountCaller;
  readonly realmBaseUrl?: string;
}): CoreTransport {
  assertRuntimeMediatedRealmCallerMode(input.accountCaller);
  return createRuntimeAccountMediatedRealmTransportInternal(input);
}

export function createRuntimeAccountMediatedBundledAvatarRealmTransport(input: {
  readonly runtime: RuntimeAccountMediatedRealmRuntime;
  readonly accountCaller: NimiRuntimeAccountCaller;
}): CoreTransport {
  assertBundledAvatarRealmCaller(input.accountCaller);
  const transport = createRuntimeAccountMediatedRealmTransportInternal(input);
  return {
    async unary<Response = unknown, Body = unknown>(request: CoreUnaryRequest<Body>): Promise<Response> {
      if (request.methodId !== NIMI_BUNDLED_AVATAR_REALM_OPERATION_ID) {
        throw createNimiError({
          message: `Realm operation is outside the bundled Avatar admission: ${request.methodId}.`,
          reasonCode: 'SDK_RUNTIME_REALM_OPERATION_NOT_ADMITTED',
          actionHint: 'use_the_fixed_bundled_avatar_realm_operation',
          source: 'sdk',
          details: { methodId: request.methodId },
        });
      }
      return transport.unary<Response, Body>(request);
    },
    serverStream<Response = unknown, Body = unknown>(request: CoreStreamRequest<Body>): AsyncIterable<Response> {
      return transport.serverStream<Response, Body>(request);
    },
  };
}

function createRuntimeAccountMediatedRealmTransportInternal(input: {
  readonly runtime: RuntimeAccountMediatedRealmRuntime;
  readonly accountCaller: NimiRuntimeAccountCaller;
  readonly realmBaseUrl?: string;
}): CoreTransport {
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

export function createRuntimeAccountMediatedDesktopProductRealmTransport(input: {
  readonly runtime: RuntimeAccountMediatedRealmRuntime;
  readonly accountCaller: NimiRuntimeAccountCaller;
}): CoreTransport {
  if (input.accountCaller.mode !== AccountCallerMode.DESKTOP_SHELL) {
    throw createNimiError({
      message: 'Desktop product Realm transport requires the protected Desktop shell caller.',
      reasonCode: 'SDK_RUNTIME_REALM_DESKTOP_CALLER_REQUIRED',
      actionHint: 'use_protected_desktop_account_host',
      source: 'sdk',
    });
  }
  const transport = createRuntimeAccountMediatedRealmTransport(input);
  return {
    async unary<Response = unknown, Body = unknown>(request: CoreUnaryRequest<Body>): Promise<Response> {
      if (!isNimiDesktopProductRealmOperationID(request.methodId)) {
        throw createNimiError({
          message: `Realm operation is outside the Desktop product admission: ${request.methodId}.`,
          reasonCode: 'SDK_RUNTIME_REALM_OPERATION_NOT_ADMITTED',
          actionHint: 'use_an_admitted_desktop_product_operation',
          source: 'sdk',
          details: { methodId: request.methodId },
        });
      }
      return transport.unary<Response, Body>(request);
    },
    serverStream<Response = unknown, Body = unknown>(request: CoreStreamRequest<Body>): AsyncIterable<Response> {
      return transport.serverStream<Response, Body>(request);
    },
  };
}

export function createRuntimeAccountMediatedDesktopSourceReadinessRealmTransport(input: {
  readonly runtime: RuntimeAccountMediatedRealmRuntime;
  readonly accountCaller: NimiRuntimeAccountCaller;
}): CoreTransport {
  if (input.accountCaller.mode !== AccountCallerMode.DESKTOP_SHELL) {
    throw createNimiError({
      message: 'Desktop source-readiness Realm transport requires the protected Desktop shell caller.',
      reasonCode: 'SDK_RUNTIME_REALM_DESKTOP_CALLER_REQUIRED',
      actionHint: 'use_protected_desktop_account_host',
      source: 'sdk',
    });
  }
  const transport = createRuntimeAccountMediatedRealmTransport(input);
  return {
    async unary<Response = unknown, Body = unknown>(request: CoreUnaryRequest<Body>): Promise<Response> {
      if (!isNimiDesktopSourceReadinessRealmOperationID(request.methodId)) {
        throw createNimiError({
          message: `Realm operation is outside the Desktop source-readiness admission: ${request.methodId}.`,
          reasonCode: 'SDK_RUNTIME_REALM_OPERATION_NOT_ADMITTED',
          actionHint: 'use_an_admitted_desktop_source_readiness_operation',
          source: 'sdk',
          details: { methodId: request.methodId },
        });
      }
      return transport.unary<Response, Body>(request);
    },
    serverStream<Response = unknown, Body = unknown>(request: CoreStreamRequest<Body>): AsyncIterable<Response> {
      return transport.serverStream<Response, Body>(request);
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
  const brokerReasonCode = BROKER_REASON_CODE_BY_ACCOUNT_REASON[response.accountReasonCode];
  if (brokerReasonCode) {
    return {
      reasonCode: brokerReasonCode,
      actionHint: brokerReasonCode === ReasonCode.REALM_UNAVAILABLE
        ? 'retry_realm_operation_when_available'
        : 'inspect_realm_operation_failure',
      retryable: brokerReasonCode === ReasonCode.REALM_UNAVAILABLE
        || brokerReasonCode === ReasonCode.REALM_RATE_LIMITED,
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

const BROKER_REASON_CODE_BY_ACCOUNT_REASON: Readonly<Partial<Record<AccountReasonCode, string>>> = {
  [AccountReasonCode.BROKER_REALM_UNAVAILABLE]: ReasonCode.REALM_UNAVAILABLE,
  [AccountReasonCode.BROKER_AUTH_INVALID]: ReasonCode.AUTH_TOKEN_INVALID,
  [AccountReasonCode.BROKER_FORBIDDEN]: ReasonCode.PRINCIPAL_UNAUTHORIZED,
  [AccountReasonCode.BROKER_NOT_FOUND]: ReasonCode.REALM_NOT_FOUND,
  [AccountReasonCode.BROKER_CONFLICT]: ReasonCode.REALM_CONFLICT,
  [AccountReasonCode.BROKER_RATE_LIMITED]: ReasonCode.REALM_RATE_LIMITED,
  [AccountReasonCode.BROKER_REQUEST_REJECTED]: ReasonCode.REALM_REQUEST_REJECTED,
  [AccountReasonCode.BROKER_CONTRACT_FAILED]: ReasonCode.REALM_CONTRACT_INVALID,
  [AccountReasonCode.BROKER_OPERATION_FAILED]: ReasonCode.REALM_OPERATION_FAILED,
};

function runtimeEnumName(enumType: Record<number, string>, value: number): string {
  return normalizeText(enumType[value]);
}
function assertRuntimeMediatedRealmCallerMode(caller: NimiRuntimeAccountCaller): void {
  if (
    caller.mode !== AccountCallerMode.LOCAL_FIRST_PARTY_APP
    && caller.mode !== AccountCallerMode.DESKTOP_SHELL
  ) {
    throw createNimiError({
      message: 'Runtime-mediated Realm transport requires an admitted Runtime account caller mode.',
      reasonCode: 'SDK_RUNTIME_REALM_MEDIATION_CALLER_MODE_FORBIDDEN',
      actionHint: 'request_runtime_account_caller_registration',
      source: 'sdk',
    });
  }
}

function assertBundledAvatarRealmCaller(caller: NimiRuntimeAccountCaller): void {
  if (
    caller.mode !== AccountCallerMode.AVATAR_NATIVE_HOST
    || caller.appId !== NIMI_BUNDLED_AVATAR_APP_ID
    || caller.appInstanceId !== NIMI_BUNDLED_AVATAR_APP_INSTANCE_ID
    || caller.deviceId !== NIMI_BUNDLED_AVATAR_DEVICE_ID
    || caller.launchHostId !== ''
    || caller.launchNonce !== ''
    || caller.releaseDescriptorRef !== ''
    || caller.scopes.length !== 0
  ) {
    throw createNimiError({
      message: 'Bundled Avatar Realm transport requires the fixed verified Avatar native-host caller.',
      reasonCode: 'SDK_RUNTIME_REALM_BUNDLED_AVATAR_CALLER_REQUIRED',
      actionHint: 'use_create_nimi_bundled_avatar_runtime_client',
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
