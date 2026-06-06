export type {
  JsonPrimitive,
  JsonValue,
  JsonObject,
} from './json.js';
export {
  isJsonObject,
  asJsonObject,
  parseJsonObjectResponse,
  tryParseJsonLike,
} from './json.js';
export {
  getRetryDelayMs,
  normalizeApiError,
  requestWithRetry,
} from './network-retry.js';
export type {
  RetryEvent,
  RetryOptions,
  RetryReasonKind,
} from './network-retry.js';
export type {
  CreateOfflineNimiErrorInput,
  NimiError,
  NimiErrorFields,
  NimiErrorSource,
} from './errors.js';
export {
  createOfflineNimiError,
  extractNimiErrorFields,
  isNimiErrorLike,
} from './errors.js';

export type VersionCompatibilityStatus = {
  state: 'unknown' | 'compatible' | 'incompatible';
  compatible: boolean;
  checked: boolean;
  sdkRuntimeMajor: number;
  runtimeVersion: string | null;
  runtimeMajor: number | null;
  reason?: 'metadata_missing' | 'runtime_version_unparseable' | 'major_mismatch';
};

declare const nimiBrand: unique symbol;

type BrandedString<Brand extends string> = string & { readonly [nimiBrand]?: Brand };

export type ScopeName = BrandedString<'ScopeName'>;

export type ScopeCatalogVersion = BrandedString<'ScopeCatalogVersion'>;

export type CatalogHash = BrandedString<'CatalogHash'>;

export type ExternalPrincipalId = BrandedString<'ExternalPrincipalId'>;

export function asScopeName(value: string): ScopeName {
  return value as ScopeName;
}

export function asScopeCatalogVersion(value: string): ScopeCatalogVersion {
  return value as ScopeCatalogVersion;
}

export function asCatalogHash(value: string): CatalogHash {
  return value as CatalogHash;
}

export function asExternalPrincipalId(value: string): ExternalPrincipalId {
  return value as ExternalPrincipalId;
}

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

export type AiRoutePolicy = 'local' | 'cloud';

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

export {
  ReasonCode,
  classifyOfflineReasonCode,
  isRealmOfflineReasonCode,
  isRetryableReasonCode,
  isRuntimeOfflineReasonCode,
} from './reason-code.js';
export type {
  NimiErrorCode,
  OfflineReasonCodeOwner,
  ReasonCodeValue,
} from './reason-code.js';
export {
  classifyOfflineError,
  getNimiErrorMessage,
  isRealmOfflineErrorLike,
  isRuntimeOfflineErrorLike,
} from './offline.js';
export type { OfflineErrorClassificationOptions } from './offline.js';
