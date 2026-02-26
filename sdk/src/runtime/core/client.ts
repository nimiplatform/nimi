import { createNimiError } from '../errors';
import { ReasonCode } from '../../types/index.js';
import { isRuntimeWriteMethod, RuntimeMethodIds } from '../method-ids';
import { createNodeGrpcTransport } from '../transports/node-grpc/index';
import { createTauriIpcTransport } from '../transports/tauri-ipc/index';
import {
  FallbackPolicy,
  RoutePolicy,
  type EmbedRequest,
  type GenerateImageRequest,
  type GenerateRequest,
  type GenerateVideoRequest,
  type StreamGenerateRequest,
  type SynthesizeSpeechRequest,
  type TranscribeAudioRequest,
} from '../generated/runtime/v1/ai';
import {
  AuthorizationPreset,
  PolicyMode,
  type AuthorizeExternalPrincipalRequest,
} from '../generated/runtime/v1/grant';
import { ExternalPrincipalType } from '../generated/runtime/v1/common';
import type {
  RuntimeCallOptions,
  RuntimeClient,
  RuntimeClientConfig,
  RuntimeOpenStreamCall,
  RuntimeStreamCallOptions,
  RuntimeTransport,
  RuntimeUnaryCall,
  RuntimeWireMessage,
} from '../types';
import { mergeRuntimeMetadata } from './metadata';
import {
  RuntimeStreamMethodCodecs,
  RuntimeUnaryMethodCodecs,
  type RuntimeStreamMethodCodec,
  type RuntimeUnaryMethodCodec,
} from './method-codecs';

function ensureAppId(appId: string): string {
  const normalized = String(appId || '').trim();
  if (!normalized) {
    throw createNimiError({
      message: 'createRuntimeClient requires appId',
      reasonCode: ReasonCode.SDK_RUNTIME_APP_ID_REQUIRED,
      actionHint: 'set_app_id',
      source: 'sdk',
    });
  }
  return normalized;
}

function createTransport(config: RuntimeClientConfig): RuntimeTransport {
  if (config.transport.type === 'tauri-ipc') {
    return createTauriIpcTransport(config.transport);
  }
  return createNodeGrpcTransport(config.transport);
}

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function throwValidationError(reasonCode: string, message: string, actionHint: string): never {
  throw createNimiError({
    message,
    reasonCode,
    actionHint,
    source: 'sdk',
  });
}

function requireNonEmptyField(
  value: unknown,
  fieldName: string,
  reasonCode: string,
  actionHint: string,
): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throwValidationError(reasonCode, `${fieldName} is required`, actionHint);
  }
  return normalized;
}

type RuntimeAiRouteRequest = {
  routePolicy: RoutePolicy;
  fallback: FallbackPolicy;
};

function withAiRouteValidation<Request extends RuntimeAiRouteRequest>(
  methodId: string,
  request: Request,
): Request {
  if (request.routePolicy === RoutePolicy.UNSPECIFIED) {
    throwValidationError(
      'SDK_RUNTIME_AI_ROUTE_POLICY_REQUIRED',
      `${methodId} requires explicit routePolicy`,
      'set_route_policy_local_runtime_or_token_api',
    );
  }

  if (request.fallback === FallbackPolicy.UNSPECIFIED) {
    return {
      ...request,
      fallback: FallbackPolicy.DENY,
    };
  }

  return request;
}

function hasDecisionAtValue(
  decisionAt: AuthorizeExternalPrincipalRequest['decisionAt'],
): boolean {
  if (!decisionAt) {
    return false;
  }
  const seconds = normalizeText((decisionAt as { seconds?: unknown }).seconds);
  if (seconds) {
    return true;
  }
  const nanosRaw = (decisionAt as { nanos?: unknown }).nanos;
  const nanos = typeof nanosRaw === 'number' ? nanosRaw : Number(nanosRaw);
  return Number.isFinite(nanos) && nanos !== 0;
}

function validateAuthorizeExternalPrincipalRequest(
  request: AuthorizeExternalPrincipalRequest,
): AuthorizeExternalPrincipalRequest {
  requireNonEmptyField(
    request.domain,
    'domain',
    'SDK_RUNTIME_APP_AUTH_DOMAIN_REQUIRED',
    'set_domain_app_auth',
  );
  requireNonEmptyField(
    request.appId,
    'appId',
    'SDK_RUNTIME_APP_AUTH_APP_ID_REQUIRED',
    'set_app_id',
  );
  requireNonEmptyField(
    request.externalPrincipalId,
    'externalPrincipalId',
    'SDK_RUNTIME_APP_AUTH_EXTERNAL_PRINCIPAL_ID_REQUIRED',
    'set_external_principal_id',
  );
  if (request.externalPrincipalType === ExternalPrincipalType.UNSPECIFIED) {
    throwValidationError(
      'SDK_RUNTIME_APP_AUTH_EXTERNAL_PRINCIPAL_TYPE_REQUIRED',
      'externalPrincipalType is required',
      'set_external_principal_type',
    );
  }

  requireNonEmptyField(
    request.subjectUserId,
    'subjectUserId',
    'SDK_RUNTIME_APP_AUTH_SUBJECT_USER_ID_REQUIRED',
    'set_subject_user_id',
  );
  requireNonEmptyField(
    request.consentId,
    'consentId',
    'SDK_RUNTIME_APP_AUTH_CONSENT_ID_REQUIRED',
    'set_consent_id',
  );
  requireNonEmptyField(
    request.consentVersion,
    'consentVersion',
    'SDK_RUNTIME_APP_AUTH_CONSENT_VERSION_REQUIRED',
    'set_consent_version',
  );
  if (!hasDecisionAtValue(request.decisionAt)) {
    throwValidationError(
      'SDK_RUNTIME_APP_AUTH_DECISION_AT_REQUIRED',
      'decisionAt is required',
      'set_decision_at',
    );
  }

  requireNonEmptyField(
    request.policyVersion,
    'policyVersion',
    'SDK_RUNTIME_APP_AUTH_POLICY_VERSION_REQUIRED',
    'set_policy_version',
  );
  if (request.policyMode === PolicyMode.UNSPECIFIED) {
    throwValidationError(
      'SDK_RUNTIME_APP_AUTH_POLICY_MODE_REQUIRED',
      'policyMode is required',
      'set_policy_mode_preset_or_custom',
    );
  }
  if (
    request.policyMode === PolicyMode.PRESET
    && request.preset === AuthorizationPreset.UNSPECIFIED
  ) {
    throwValidationError(
      'SDK_RUNTIME_APP_AUTH_PRESET_REQUIRED',
      'preset is required when policyMode is preset',
      'set_authorization_preset',
    );
  }
  if (
    request.policyMode === PolicyMode.CUSTOM
    && (!Array.isArray(request.scopes) || request.scopes.length === 0)
  ) {
    throwValidationError(
      'SDK_RUNTIME_APP_AUTH_CUSTOM_SCOPES_REQUIRED',
      'custom policy requires scopes',
      'set_custom_policy_scopes',
    );
  }
  if (request.policyMode === PolicyMode.CUSTOM) {
    if (typeof request.ttlSeconds !== 'number' || request.ttlSeconds <= 0) {
      throwValidationError(
        'SDK_RUNTIME_APP_AUTH_CUSTOM_TTL_REQUIRED',
        'custom policy requires ttlSeconds > 0',
        'set_ttl_seconds',
      );
    }
    if (typeof request.canDelegate !== 'boolean') {
      throwValidationError(
        'SDK_RUNTIME_APP_AUTH_CUSTOM_DELEGATE_REQUIRED',
        'custom policy requires explicit canDelegate boolean',
        'set_can_delegate',
      );
    }
  }
  requireNonEmptyField(
    request.scopeCatalogVersion,
    'scopeCatalogVersion',
    'SDK_RUNTIME_APP_AUTH_SCOPE_CATALOG_VERSION_REQUIRED',
    'publish_scope_catalog_before_authorize',
  );
  return request;
}

function normalizeRequestForMethod<Request>(methodId: string, request: Request): Request {
  switch (methodId) {
    case RuntimeMethodIds.ai.generate:
      return withAiRouteValidation(methodId, request as unknown as GenerateRequest) as Request;
    case RuntimeMethodIds.ai.streamGenerate:
      return withAiRouteValidation(methodId, request as unknown as StreamGenerateRequest) as Request;
    case RuntimeMethodIds.ai.embed:
      return withAiRouteValidation(methodId, request as unknown as EmbedRequest) as Request;
    case RuntimeMethodIds.ai.generateImage:
      return withAiRouteValidation(methodId, request as unknown as GenerateImageRequest) as Request;
    case RuntimeMethodIds.ai.generateVideo:
      return withAiRouteValidation(methodId, request as unknown as GenerateVideoRequest) as Request;
    case RuntimeMethodIds.ai.synthesizeSpeech:
      return withAiRouteValidation(methodId, request as unknown as SynthesizeSpeechRequest) as Request;
    case RuntimeMethodIds.ai.transcribeAudio:
      return withAiRouteValidation(methodId, request as unknown as TranscribeAudioRequest) as Request;
    case RuntimeMethodIds.appAuth.authorizeExternalPrincipal:
      return validateAuthorizeExternalPrincipalRequest(
        request as unknown as AuthorizeExternalPrincipalRequest,
      ) as Request;
    default:
      return request;
  }
}

function createIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `sdk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function withIdempotencyKey(
  methodId: string,
  options?: RuntimeCallOptions | RuntimeStreamCallOptions,
): RuntimeCallOptions | RuntimeStreamCallOptions | undefined {
  if (!isRuntimeWriteMethod(methodId)) {
    return options;
  }
  if (options?.idempotencyKey || options?.metadata?.idempotencyKey) {
    return options;
  }
  return {
    ...(options || {}),
    idempotencyKey: createIdempotencyKey(),
  };
}

function toUnaryCall(
  config: RuntimeClientConfig,
  methodId: string,
  request: RuntimeWireMessage,
  options?: RuntimeCallOptions,
): RuntimeUnaryCall<RuntimeWireMessage> {
  const resolvedOptions = withIdempotencyKey(methodId, options) as RuntimeCallOptions | undefined;
  return {
    methodId,
    request,
    metadata: mergeRuntimeMetadata(config, resolvedOptions),
    timeoutMs: resolvedOptions?.timeoutMs,
  };
}

function toStreamCall(
  config: RuntimeClientConfig,
  methodId: string,
  request: RuntimeWireMessage,
  options?: RuntimeStreamCallOptions,
): RuntimeOpenStreamCall<RuntimeWireMessage> {
  const resolvedOptions = withIdempotencyKey(methodId, options) as RuntimeStreamCallOptions | undefined;
  return {
    methodId,
    request,
    metadata: mergeRuntimeMetadata(config, resolvedOptions),
    timeoutMs: resolvedOptions?.timeoutMs,
    signal: resolvedOptions?.signal,
  };
}

type BinarySerdeType<T> = {
  create(value?: Partial<T>): T;
  toBinary(message: T): RuntimeWireMessage;
  fromBinary(bytes: RuntimeWireMessage): T;
};

function asBinarySerdeType<T>(type: unknown): BinarySerdeType<T> {
  return type as BinarySerdeType<T>;
}

function encodeRequest<Request>(
  methodId: string,
  codec: RuntimeUnaryMethodCodec<Request, unknown> | RuntimeStreamMethodCodec<Request, unknown>,
  request: Request,
): RuntimeWireMessage {
  try {
    const requestType = asBinarySerdeType<Request>(codec.requestType);
    const payload = requestType.create(request as Partial<Request>);
    return requestType.toBinary(payload);
  } catch (error) {
    throw createNimiError({
      message: `${methodId} request encode failed: ${error instanceof Error ? error.message : String(error)}`,
      reasonCode: ReasonCode.SDK_RUNTIME_REQUEST_ENCODE_FAILED,
      actionHint: 'validate_request_payload_against_proto',
      source: 'sdk',
    });
  }
}

function decodeUnaryResponse<Response>(
  methodId: string,
  codec: RuntimeUnaryMethodCodec<unknown, Response>,
  payload: RuntimeWireMessage,
): Response {
  try {
    return asBinarySerdeType<Response>(codec.responseType).fromBinary(payload);
  } catch (error) {
    throw createNimiError({
      message: `${methodId} response decode failed: ${error instanceof Error ? error.message : String(error)}`,
      reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
      actionHint: 'check_transport_payload_contract',
      source: 'sdk',
    });
  }
}

function decodeStreamEvent<Event>(
  methodId: string,
  codec: RuntimeStreamMethodCodec<unknown, Event>,
  payload: RuntimeWireMessage,
): Event {
  try {
    return asBinarySerdeType<Event>(codec.eventType).fromBinary(payload);
  } catch (error) {
    throw createNimiError({
      message: `${methodId} stream event decode failed: ${error instanceof Error ? error.message : String(error)}`,
      reasonCode: ReasonCode.SDK_RUNTIME_STREAM_DECODE_FAILED,
      actionHint: 'check_transport_payload_contract',
      source: 'sdk',
    });
  }
}

export function createRuntimeClient(input: RuntimeClientConfig): RuntimeClient {
  const config: RuntimeClientConfig = {
    ...input,
    appId: ensureAppId(input.appId),
  };

  const transport = createTransport(config);

  const unary = <Request, Response>(methodId: string) => async (
    request: Request,
    options?: RuntimeCallOptions,
  ): Promise<Response> => {
    const codec = RuntimeUnaryMethodCodecs[methodId as keyof typeof RuntimeUnaryMethodCodecs] as unknown as
      | RuntimeUnaryMethodCodec<Request, Response>
      | undefined;
    if (!codec) {
      throw createNimiError({
        message: `missing unary codec for ${methodId}`,
        reasonCode: ReasonCode.SDK_RUNTIME_CODEC_MISSING,
        actionHint: 'regenerate_proto_and_update_codec_map',
        source: 'sdk',
      });
    }

    const normalizedRequest = normalizeRequestForMethod(methodId, request);
    const wireRequest = encodeRequest(methodId, codec, normalizedRequest);
    const wireResponse = await transport.invokeUnary(
      toUnaryCall(config, methodId, wireRequest, options),
    );
    return decodeUnaryResponse(methodId, codec as RuntimeUnaryMethodCodec<unknown, Response>, wireResponse);
  };

  const stream = <Request, Event>(methodId: string) => async (
    request: Request,
    options?: RuntimeStreamCallOptions,
  ): Promise<AsyncIterable<Event>> => {
    const codec = RuntimeStreamMethodCodecs[methodId as keyof typeof RuntimeStreamMethodCodecs] as unknown as
      | RuntimeStreamMethodCodec<Request, Event>
      | undefined;
    if (!codec) {
      throw createNimiError({
        message: `missing stream codec for ${methodId}`,
        reasonCode: ReasonCode.SDK_RUNTIME_CODEC_MISSING,
        actionHint: 'regenerate_proto_and_update_codec_map',
        source: 'sdk',
      });
    }

    const normalizedRequest = normalizeRequestForMethod(methodId, request);
    const wireRequest = encodeRequest(methodId, codec, normalizedRequest);
    const wireStream = await transport.openStream(
      toStreamCall(config, methodId, wireRequest, options),
    );

    return {
      async *[Symbol.asyncIterator](): AsyncIterator<Event> {
        for await (const eventBytes of wireStream) {
          yield decodeStreamEvent(
            methodId,
            codec as RuntimeStreamMethodCodec<unknown, Event>,
            eventBytes,
          );
        }
      },
    };
  };

  return {
    appId: config.appId,
    transport: config.transport,
    auth: {
      registerApp: unary(RuntimeMethodIds.auth.registerApp),
      openSession: unary(RuntimeMethodIds.auth.openSession),
      refreshSession: unary(RuntimeMethodIds.auth.refreshSession),
      revokeSession: unary(RuntimeMethodIds.auth.revokeSession),
      registerExternalPrincipal: unary(RuntimeMethodIds.auth.registerExternalPrincipal),
      openExternalPrincipalSession: unary(RuntimeMethodIds.auth.openExternalPrincipalSession),
      revokeExternalPrincipalSession: unary(RuntimeMethodIds.auth.revokeExternalPrincipalSession),
    },
    appAuth: {
      authorizeExternalPrincipal: unary(RuntimeMethodIds.appAuth.authorizeExternalPrincipal),
      validateToken: unary(RuntimeMethodIds.appAuth.validateToken),
      revokeToken: unary(RuntimeMethodIds.appAuth.revokeToken),
      issueDelegatedToken: unary(RuntimeMethodIds.appAuth.issueDelegatedToken),
      listTokenChain: unary(RuntimeMethodIds.appAuth.listTokenChain),
    },
    ai: {
      generate: unary(RuntimeMethodIds.ai.generate),
      streamGenerate: stream(RuntimeMethodIds.ai.streamGenerate),
      embed: unary(RuntimeMethodIds.ai.embed),
      generateImage: stream(RuntimeMethodIds.ai.generateImage),
      generateVideo: stream(RuntimeMethodIds.ai.generateVideo),
      synthesizeSpeech: stream(RuntimeMethodIds.ai.synthesizeSpeech),
      transcribeAudio: unary(RuntimeMethodIds.ai.transcribeAudio),
    },
    workflow: {
      submit: unary(RuntimeMethodIds.workflow.submit),
      get: unary(RuntimeMethodIds.workflow.get),
      cancel: unary(RuntimeMethodIds.workflow.cancel),
      subscribeEvents: stream(RuntimeMethodIds.workflow.subscribeEvents),
    },
    model: {
      list: unary(RuntimeMethodIds.model.list),
      pull: unary(RuntimeMethodIds.model.pull),
      remove: unary(RuntimeMethodIds.model.remove),
      checkHealth: unary(RuntimeMethodIds.model.checkHealth),
    },
    localRuntime: {
      listLocalModels: unary(RuntimeMethodIds.localRuntime.listLocalModels),
      listVerifiedModels: unary(RuntimeMethodIds.localRuntime.listVerifiedModels),
      searchCatalogModels: unary(RuntimeMethodIds.localRuntime.searchCatalogModels),
      resolveModelInstallPlan: unary(RuntimeMethodIds.localRuntime.resolveModelInstallPlan),
      installLocalModel: unary(RuntimeMethodIds.localRuntime.installLocalModel),
      installVerifiedModel: unary(RuntimeMethodIds.localRuntime.installVerifiedModel),
      importLocalModel: unary(RuntimeMethodIds.localRuntime.importLocalModel),
      removeLocalModel: unary(RuntimeMethodIds.localRuntime.removeLocalModel),
      startLocalModel: unary(RuntimeMethodIds.localRuntime.startLocalModel),
      stopLocalModel: unary(RuntimeMethodIds.localRuntime.stopLocalModel),
      checkLocalModelHealth: unary(RuntimeMethodIds.localRuntime.checkLocalModelHealth),
      collectDeviceProfile: unary(RuntimeMethodIds.localRuntime.collectDeviceProfile),
      resolveDependencies: unary(RuntimeMethodIds.localRuntime.resolveDependencies),
      applyDependencies: unary(RuntimeMethodIds.localRuntime.applyDependencies),
      listLocalServices: unary(RuntimeMethodIds.localRuntime.listLocalServices),
      installLocalService: unary(RuntimeMethodIds.localRuntime.installLocalService),
      startLocalService: unary(RuntimeMethodIds.localRuntime.startLocalService),
      stopLocalService: unary(RuntimeMethodIds.localRuntime.stopLocalService),
      checkLocalServiceHealth: unary(RuntimeMethodIds.localRuntime.checkLocalServiceHealth),
      removeLocalService: unary(RuntimeMethodIds.localRuntime.removeLocalService),
      listNodeCatalog: unary(RuntimeMethodIds.localRuntime.listNodeCatalog),
      listLocalAudits: unary(RuntimeMethodIds.localRuntime.listLocalAudits),
      appendInferenceAudit: unary(RuntimeMethodIds.localRuntime.appendInferenceAudit),
      appendRuntimeAudit: unary(RuntimeMethodIds.localRuntime.appendRuntimeAudit),
    },
    knowledge: {
      buildIndex: unary(RuntimeMethodIds.knowledge.buildIndex),
      searchIndex: unary(RuntimeMethodIds.knowledge.searchIndex),
      deleteIndex: unary(RuntimeMethodIds.knowledge.deleteIndex),
    },
    app: {
      sendAppMessage: unary(RuntimeMethodIds.app.sendAppMessage),
      subscribeAppMessages: stream(RuntimeMethodIds.app.subscribeAppMessages),
    },
    audit: {
      listAuditEvents: unary(RuntimeMethodIds.audit.listAuditEvents),
      exportAuditEvents: stream(RuntimeMethodIds.audit.exportAuditEvents),
      listUsageStats: unary(RuntimeMethodIds.audit.listUsageStats),
      getRuntimeHealth: unary(RuntimeMethodIds.audit.getRuntimeHealth),
      listAIProviderHealth: unary(RuntimeMethodIds.audit.listAIProviderHealth),
      subscribeAIProviderHealthEvents: stream(RuntimeMethodIds.audit.subscribeAIProviderHealthEvents),
      subscribeRuntimeHealthEvents: stream(RuntimeMethodIds.audit.subscribeRuntimeHealthEvents),
    },
    closeStream: async (streamId: string) => {
      await transport.closeStream({ streamId });
    },
  };
}
