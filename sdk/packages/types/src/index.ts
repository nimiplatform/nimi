export type NimiErrorSource = 'realm' | 'runtime' | 'sdk';

export type NimiError = Error & {
  reasonCode: string;
  actionHint: string;
  traceId: string;
  retryable: boolean;
  source: NimiErrorSource;
};

export type ScopeName = string;

export type ScopeCatalogVersion = string;

export type CatalogHash = string;

export type ExternalPrincipalId = string;

export type ScopeDomain = 'realm' | 'runtime' | 'app';

export type ScopeCatalogStatus = 'draft' | 'published' | 'revoked';

export type ScopeManifest = {
  manifestVersion: string;
  scopes: ScopeName[];
};

export type ScopeCatalogEntry = {
  scopeCatalogVersion: ScopeCatalogVersion;
  catalogHash: CatalogHash;
  status: ScopeCatalogStatus;
  scopes: ScopeName[];
};

export type ScopeListCatalogInput = {
  appId: string;
  include?: ScopeDomain[];
};

export type ScopeRegisterAppScopesInput = {
  appId: string;
  manifest: ScopeManifest;
};

export type ScopePublishCatalogInput = {
  appId: string;
};

export type ScopeRevokeAppScopesInput = {
  appId: string;
  scopes: ScopeName[];
};

export type ScopeCatalogDescriptor = {
  appId: string;
  realmScopes: ScopeName[];
  runtimeScopes: ScopeName[];
  appScopes: ScopeName[];
  draft: ScopeCatalogEntry | null;
  published: ScopeCatalogEntry | null;
  revokedScopes: ScopeName[];
};

export type ScopeCatalogPublishResult = ScopeCatalogEntry & {
  publishedAt: string;
};

export type ScopeCatalogRevokeResult = ScopeCatalogEntry & {
  revokedScopes: ScopeName[];
  reauthorizeRequired: boolean;
};

export type AiRoutePolicy = 'local-runtime' | 'token-api';

export type AiFallbackPolicy = 'deny' | 'allow';

export type AiStreamEventType =
  | 'started'
  | 'delta'
  | 'tool_call'
  | 'tool_result'
  | 'usage'
  | 'completed'
  | 'failed';

export type AuthorizationPreset = 'readOnly' | 'full' | 'delegate';

export type AppPolicyMode = 'preset' | 'custom';

export type AppResourceSelectors = Record<string, string[]>;

export type AppConsentEvidence = {
  subjectUserId: string;
  consentId: string;
  consentVersion: string;
  decisionAt: string;
};

export type AppGrantPolicy = {
  policyVersion: string;
  policyMode: AppPolicyMode;
  preset?: AuthorizationPreset;
  scopes: ScopeName[];
  resourceSelectors?: AppResourceSelectors;
  canDelegate: boolean;
  maxDelegationDepth: number;
  ttlSeconds: number;
};

export type AppAccessTokenDescriptor = {
  tokenId: string;
  appId: string;
  subjectUserId: string;
  externalPrincipalId: ExternalPrincipalId;
  effectiveScopes: ScopeName[];
  policyVersion: string;
  issuedScopeCatalogVersion: ScopeCatalogVersion;
  expiresAt?: string;
};

export type DelegatedAccessTokenDescriptor = {
  tokenId: string;
  parentTokenId: string;
  effectiveScopes: ScopeName[];
  expiresAt?: string;
};

export const ReasonCode = {
  ACTION_EXECUTED: 'ACTION_EXECUTED',
  PROTOCOL_ENVELOPE_INVALID: 'PROTOCOL_ENVELOPE_INVALID',
  PROTOCOL_DOMAIN_FIELD_CONFLICT: 'PROTOCOL_DOMAIN_FIELD_CONFLICT',
  CAPABILITY_CATALOG_MISMATCH: 'CAPABILITY_CATALOG_MISMATCH',
  APP_NOT_REGISTERED: 'APP_NOT_REGISTERED',
  EXTERNAL_PRINCIPAL_NOT_REGISTERED: 'EXTERNAL_PRINCIPAL_NOT_REGISTERED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  PRINCIPAL_UNAUTHORIZED: 'PRINCIPAL_UNAUTHORIZED',
  APP_AUTHORIZATION_DENIED: 'APP_AUTHORIZATION_DENIED',
  APP_GRANT_INVALID: 'APP_GRANT_INVALID',
  APP_TOKEN_EXPIRED: 'APP_TOKEN_EXPIRED',
  APP_TOKEN_REVOKED: 'APP_TOKEN_REVOKED',
  APP_SCOPE_FORBIDDEN: 'APP_SCOPE_FORBIDDEN',
  APP_SCOPE_CATALOG_UNPUBLISHED: 'APP_SCOPE_CATALOG_UNPUBLISHED',
  APP_SCOPE_REVOKED: 'APP_SCOPE_REVOKED',
  APP_DELEGATION_FORBIDDEN: 'APP_DELEGATION_FORBIDDEN',
  APP_DELEGATION_DEPTH_EXCEEDED: 'APP_DELEGATION_DEPTH_EXCEEDED',
  APP_RESOURCE_SELECTOR_INVALID: 'APP_RESOURCE_SELECTOR_INVALID',
  APP_RESOURCE_OUT_OF_SCOPE: 'APP_RESOURCE_OUT_OF_SCOPE',
  APP_CONSENT_MISSING: 'APP_CONSENT_MISSING',
  APP_CONSENT_INVALID: 'APP_CONSENT_INVALID',
  EXTERNAL_PRINCIPAL_PROOF_MISSING: 'EXTERNAL_PRINCIPAL_PROOF_MISSING',
  EXTERNAL_PRINCIPAL_PROOF_INVALID: 'EXTERNAL_PRINCIPAL_PROOF_INVALID',
  APP_MODE_DOMAIN_FORBIDDEN: 'APP_MODE_DOMAIN_FORBIDDEN',
  APP_MODE_SCOPE_FORBIDDEN: 'APP_MODE_SCOPE_FORBIDDEN',
  APP_MODE_WORLD_RELATION_FORBIDDEN: 'APP_MODE_WORLD_RELATION_FORBIDDEN',
  APP_MODE_MANIFEST_INVALID: 'APP_MODE_MANIFEST_INVALID',
  AI_MODEL_NOT_FOUND: 'AI_MODEL_NOT_FOUND',
  AI_MODEL_NOT_READY: 'AI_MODEL_NOT_READY',
  AI_PROVIDER_UNAVAILABLE: 'AI_PROVIDER_UNAVAILABLE',
  AI_PROVIDER_TIMEOUT: 'AI_PROVIDER_TIMEOUT',
  AI_ROUTE_UNSUPPORTED: 'AI_ROUTE_UNSUPPORTED',
  AI_ROUTE_FALLBACK_DENIED: 'AI_ROUTE_FALLBACK_DENIED',
  AI_INPUT_INVALID: 'AI_INPUT_INVALID',
  AI_OUTPUT_INVALID: 'AI_OUTPUT_INVALID',
  AI_STREAM_BROKEN: 'AI_STREAM_BROKEN',
  AI_CONTENT_FILTER_BLOCKED: 'AI_CONTENT_FILTER_BLOCKED',
} as const;

export type ReasonCodeValue = typeof ReasonCode[keyof typeof ReasonCode];

const RETRYABLE_REASON_CODES: ReadonlySet<string> = new Set([
  ReasonCode.AI_PROVIDER_UNAVAILABLE,
  ReasonCode.AI_PROVIDER_TIMEOUT,
  ReasonCode.AI_STREAM_BROKEN,
  ReasonCode.SESSION_EXPIRED,
]);

export function isRetryableReasonCode(code: string): boolean {
  return RETRYABLE_REASON_CODES.has(code);
}

