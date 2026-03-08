import { createNimiError } from '../errors.js';
import { ReasonCode } from '../../types/index.js';
import { RuntimeMethodIds } from '../method-ids.js';
import {
  FallbackPolicy,
  RoutePolicy,
} from '../generated/runtime/v1/ai.js';
import {
  AuthorizationPreset,
  PolicyMode,
  type AuthorizeExternalPrincipalRequest,
} from '../generated/runtime/v1/grant.js';
import { ExternalPrincipalType } from '../generated/runtime/v1/common.js';
import type {
  RuntimeCallOptions,
  RuntimeStreamCallOptions,
} from '../types.js';

export type RuntimeAiRouteRequest = {
  routePolicy?: RoutePolicy;
  fallback?: FallbackPolicy;
  connectorId?: string;
  head?: {
    routePolicy?: RoutePolicy;
    fallback?: FallbackPolicy;
    connectorId?: string;
  };
};

export function ensureAppId(appId: string): string {
  const normalized = String(appId || '').trim();
  if (!normalized) {
    throw createNimiError({
      message: 'createRuntimeClient requires appId',
      reasonCode: ReasonCode.SDK_APP_ID_REQUIRED,
      actionHint: 'set_app_id',
      source: 'sdk',
    });
  }
  return normalized;
}

export function normalizeText(value: unknown): string {
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

function withAiRouteValidation<Request extends RuntimeAiRouteRequest>(
  methodId: string,
  request: Request,
): Request {
  const routePolicy = request.routePolicy ?? request.head?.routePolicy ?? RoutePolicy.UNSPECIFIED;
  if (routePolicy === RoutePolicy.UNSPECIFIED) {
    throwValidationError(
      'SDK_RUNTIME_AI_ROUTE_POLICY_REQUIRED',
      `${methodId} requires explicit routePolicy`,
      'set_route_policy_local_or_cloud',
    );
  }

  const fallback = request.fallback ?? request.head?.fallback ?? FallbackPolicy.UNSPECIFIED;
  if (fallback === FallbackPolicy.UNSPECIFIED) {
    if (typeof request.routePolicy !== 'undefined') {
      return {
        ...request,
        fallback: FallbackPolicy.DENY,
      };
    }
    return {
      ...request,
      head: {
        ...(request.head || {}),
        fallback: FallbackPolicy.DENY,
      },
    };
  }

  return request;
}

function validateAiCredentialMetadata(
  methodId: string,
  request: RuntimeAiRouteRequest,
  options?: RuntimeCallOptions | RuntimeStreamCallOptions,
): void {
  const source = normalizeText(options?.metadata?.keySource).toLowerCase();
  const apiKey = normalizeText(options?.metadata?.providerApiKey);

  if (source && source !== 'managed' && source !== 'inline') {
    throwValidationError(
      'SDK_RUNTIME_AI_CREDENTIAL_SOURCE_INVALID',
      `${methodId} metadata.keySource is invalid`,
      'set_key_source_managed_or_inline',
    );
  }

  const routePolicy = request.routePolicy ?? request.head?.routePolicy ?? RoutePolicy.UNSPECIFIED;
  if (routePolicy === RoutePolicy.CLOUD && source === 'inline' && !apiKey) {
    throwValidationError(
      'SDK_RUNTIME_AI_CREDENTIAL_MISSING',
      `${methodId} inline source requires metadata.providerApiKey`,
      'set_provider_api_key',
    );
  }

  if (routePolicy === RoutePolicy.LOCAL && source === 'inline') {
    throwValidationError(
      'SDK_RUNTIME_AI_CREDENTIAL_SCOPE_FORBIDDEN',
      `${methodId} local route does not allow inline keySource`,
      'use_managed_key_source',
    );
  }
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

export function normalizeRequestForMethod<Request>(
  methodId: string,
  request: Request,
  options?: RuntimeCallOptions | RuntimeStreamCallOptions,
): Request {
  switch (methodId) {
    case RuntimeMethodIds.ai.executeScenario:
    case RuntimeMethodIds.ai.streamScenario:
    case RuntimeMethodIds.ai.submitScenarioJob: {
      const normalized = withAiRouteValidation(
        methodId,
        request as unknown as RuntimeAiRouteRequest,
      ) as unknown as RuntimeAiRouteRequest;
      validateAiCredentialMetadata(methodId, normalized, options);
      return normalized as Request;
    }
    case RuntimeMethodIds.appAuth.authorizeExternalPrincipal:
      return validateAuthorizeExternalPrincipalRequest(
        request as unknown as AuthorizeExternalPrincipalRequest,
      ) as Request;
    default:
      return request;
  }
}
