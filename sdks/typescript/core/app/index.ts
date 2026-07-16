import { createNimiError } from '../../types';
import {
  validateNimiAppInventoryEntry,
  validateNimiAppStatus,
} from './inventory-types.js';
import type { NimiAppAIProfileFactoryRow } from './platform-catalog.generated.js';
import type {
  NimiAppInventoryEntry,
  NimiAppStatus,
  NimiAppTransport,
} from './inventory-types.js';
import {
  isCanonicalGrantState,
  isCanonicalPermissionScopeFamily,
  isCanonicalPermissionScopeName,
} from './permission-types.js';
import type {
  GrantSpec,
  GrantStatus,
  NimiAppScopeRef,
  PermissionGrantEvent,
  PermissionScopeRef,
  PermissionStatusSnapshot,
  PermissionTransport,
  ScopeCatalogEntry,
  ScopeCatalogModule,
  ScopeManifest,
} from './permission-types.js';

export {
  NIMI_DESKTOP_OPEN_RESULT_REASON_CODES,
  NIMI_DESKTOP_OPEN_SCHEMA_VERSION,
  NIMI_DESKTOP_OPEN_SOURCE_HOSTS,
  NimiDesktopOpenIntentParseError,
  composeNimiDesktopOpenIntentEnvelope,
  createNimiDesktopOpenRequestId,
  isNimiDesktopOpenResultReasonCode,
  isNimiDesktopOpenSourceHost,
  parseNimiDesktopOpenIntent,
  parseNimiDesktopOpenIntentEnvelope,
  parseNimiDesktopOpenRendererRequest,
  parseNimiDesktopOpenResult,
  safeParseNimiDesktopOpenIntentEnvelope,
} from './desktop-open.js';
export type {
  ComposeNimiDesktopOpenIntentEnvelopeInput,
  NimiDesktopOpenAcceptedResult,
  NimiDesktopOpenAgentsIntent,
  NimiDesktopOpenAgentsView,
  NimiDesktopOpenAppsIntent,
  NimiDesktopOpenExploreIntent,
  NimiDesktopOpenExploreProductIntent,
  NimiDesktopOpenExploreSection,
  NimiDesktopOpenIntent,
  NimiDesktopOpenIntentEnvelope,
  NimiDesktopOpenIntentKind,
  NimiDesktopOpenIntentParseResult,
  NimiDesktopOpenParseReasonCode,
  NimiDesktopOpenRejectedResult,
  NimiDesktopOpenRejectedActionHint,
  NimiDesktopOpenRendererRequest,
  NimiDesktopOpenResult,
  NimiDesktopOpenResultReasonCode,
  NimiDesktopOpenRuntimeConfigAction,
  NimiDesktopOpenRuntimeConfigIntent,
  NimiDesktopOpenRuntimeConfigPage,
  NimiDesktopOpenSettingsIntent,
  NimiDesktopOpenSettingsSection,
  NimiDesktopOpenSourceHost,
} from './desktop-open.js';
export {
  createRuntimeAccountMediatedDesktopSourceReadinessRealmTransport,
  createRuntimeAccountMediatedRealmTransport,
  NIMI_DESKTOP_SOURCE_READINESS_REALM_OPERATION_IDS,
  type NimiDesktopSourceReadinessRealmOperationID,
  type RuntimeAccountMediatedRealmRuntime,
} from './runtime-account-realm.js';
export {
  createNimiAppRuntimePlatformClient,
} from './local-app-runtime-platform.js';
export type {
  NimiAppAuthMode,
  NimiAppAuthProjection,
  NimiAppAuthUnavailable,
  NimiAppLocalSessionProjection,
  NimiAppPermissionPosture,
  NimiAppPermissionPostureInput,
  NimiAppPermissionRequestInput,
  NimiAppRuntimeAgentConversationSnapshotInput,
  NimiAppRuntimeAgentOpenConversationInput,
  NimiAppRuntimeAgentSendTurnInput,
  NimiAppRuntimeAgentSubscribeTurnInput,
  NimiAppRuntimeAgentTurnEventPage,
  NimiAppRuntimeArtifactBytes,
  NimiAppRuntimePlatformClient,
  NimiAppRuntimePlatformClientInput,
  NimiAppRuntimePlatformStandardShell,
} from './local-app-runtime-platform.js';
export {
  NIMI_APP_AI_PROFILE_FACTORY_CATALOG,
  NIMI_APP_AI_PROFILE_FACTORY_ROWS,
  NIMI_APP_RELEASE_DESCRIPTOR_ROWS,
  NIMI_APP_REGISTRY_ROWS,
  loadNimiAppAIProfileFactoryCatalog,
  loadNimiAppAIProfileFactoryRows,
  loadNimiAppReleaseDescriptorRows,
  loadNimiAppRegistryRows,
} from './platform-catalog.generated.js';
export type { NimiAppAIProfileFactoryRow } from './platform-catalog.generated.js';
export {
  NimiAppRegistryTransportError,
  createNimiAppRegistryTransport,
} from './registry-transport.js';
export {
  parseNimiAppBridgeProjection,
  parseNimiAppBridgeRegistryRow,
  parseNimiAppBridgeReleaseDescriptorRow,
} from './bridge-projection.js';
export * from './inventory-types.js';
export {
  parseNimiAppAccountInventoryProjection,
  parseNimiAppAccountInventoryRecord,
  parseNimiAppAccountInventoryRow,
  parseOptionalNimiAppAccountInventoryProjection,
  parseOptionalNimiAppAccountInventoryRecord,
} from './account-inventory.js';
export type { NimiAppBridgeProjection } from './bridge-projection.js';
export type {
  NimiAppAccountInstallState,
  NimiAppAccountInventoryProjection,
  NimiAppAccountInventoryRecord,
  NimiAppAccountInventoryRow,
  NimiAppAccountInventoryState,
} from './account-inventory.js';
export type {
  NimiAppAdmissionStatus,
  NimiAppRegistrySourceRow,
  NimiAppRegistryTransportOptions,
} from './registry-transport.js';
export {
  CANONICAL_GRANT_STATES,
  CANONICAL_PERMISSION_SCOPE_FAMILIES,
  CANONICAL_PERMISSION_SCOPE_NAMES,
  isCanonicalGrantState,
  isCanonicalPermissionScopeFamily,
  isCanonicalPermissionScopeName,
} from './permission-types.js';
export type {
  GrantRef,
  GrantSpec,
  GrantState,
  GrantStatus,
  NimiAppScopeKind,
  NimiAppScopeRef,
  PermissionGrantEvent,
  PermissionScopeFamily,
  PermissionScopeName,
  PermissionScopeRef,
  PermissionStatusSnapshot,
  PermissionTransport,
  ScopeCatalogDescriptor,
  ScopeCatalogEntry,
  ScopeCatalogModule,
  ScopeCatalogPublishResult,
  ScopeCatalogRevokeResult,
  ScopeManifest,
} from './permission-types.js';
export type NimiFirstRunInstallLevel = 'minimal' | 'recommended';

export class NimiAppClient {
  constructor(private readonly transport: NimiAppTransport) {
    if (!transport || typeof transport.list !== 'function' || typeof transport.get !== 'function' || typeof transport.status !== 'function') {
      appError('SDK_APP_TRANSPORT_INVALID', 'NimiAppClient requires explicit read-projection transport', 'provide_app_transport');
    }
  }

  async list(): Promise<readonly NimiAppInventoryEntry[]> {
    try {
      const entries = await this.transport.list();
      if (!Array.isArray(entries)) {
        appError('SDK_APP_RESPONSE_INVALID', 'Nimi app list response must be an array', 'fix_app_transport_response');
      }
      for (const entry of entries) {
        validateNimiAppInventoryEntry(entry);
      }
      return entries;
    } catch (error) {
      throw wrapTransportError(error, 'list Nimi apps');
    }
  }

  async get(appId: string): Promise<NimiAppInventoryEntry> {
    const normalizedAppId = requireText(appId, 'appId is required', 'SDK_APP_ID_REQUIRED', 'set_app_id');
    try {
      const entry = await this.transport.get(normalizedAppId);
      validateNimiAppInventoryEntry(entry);
      if (entry.appId !== normalizedAppId) {
        appError('SDK_APP_RESPONSE_INVALID', 'Nimi app inventory entry appId does not match request', 'fix_app_transport_response');
      }
      return entry;
    } catch (error) {
      throw wrapTransportError(error, 'get Nimi app');
    }
  }

  async status(appId: string): Promise<NimiAppStatus> {
    const normalizedAppId = requireText(appId, 'appId is required', 'SDK_APP_ID_REQUIRED', 'set_app_id');
    try {
      const status = await this.transport.status(normalizedAppId);
      validateNimiAppStatus(status, normalizedAppId);
      return status;
    } catch (error) {
      throw wrapTransportError(error, 'get Nimi app status');
    }
  }
}

export class PermissionClient {
  constructor(private readonly transport: PermissionTransport) {
    if (!isPermissionTransport(transport)) {
      appError('SDK_PERMISSION_TRANSPORT_INVALID', 'PermissionClient requires explicit grant transport', 'provide_permission_transport');
    }
  }

  async list(scopeRef: NimiAppScopeRef): Promise<readonly GrantStatus[]> {
    validateScopeRef(scopeRef);
    try {
      const grants = await this.transport.list(scopeRef);
      if (!Array.isArray(grants)) {
        appError('SDK_PERMISSION_RESPONSE_INVALID', 'permission list response must be an array', 'fix_permission_transport_response');
      }
      for (const grant of grants) {
        validateGrantStatus(grant, scopeRef);
      }
      return grants;
    } catch (error) {
      throw wrapTransportError(error, 'list permission grants');
    }
  }

  async get(scopeRef: NimiAppScopeRef, grantId: string): Promise<GrantStatus> {
    validateScopeRef(scopeRef);
    requireText(grantId, 'grantId is required', 'SDK_PERMISSION_GRANT_ID_REQUIRED', 'provide_grant_id');
    try {
      const grant = await this.transport.get(scopeRef, grantId);
      validateGrantStatus(grant, scopeRef);
      return grant;
    } catch (error) {
      throw wrapTransportError(error, 'get permission grant');
    }
  }

  async request(scopeRef: NimiAppScopeRef, grantSpec: GrantSpec): Promise<GrantStatus> {
    validateScopeRef(scopeRef);
    validateGrantSpec(grantSpec);
    validateGrantSpecMatchesScopeRef(scopeRef, grantSpec);
    try {
      const grant = await this.transport.request(scopeRef, grantSpec);
      validateGrantStatus(grant, scopeRef);
      return grant;
    } catch (error) {
      throw wrapTransportError(error, 'request permission grant');
    }
  }

  async revoke(scopeRef: NimiAppScopeRef, grantId: string): Promise<GrantStatus> {
    validateScopeRef(scopeRef);
    requireText(grantId, 'grantId is required', 'SDK_PERMISSION_GRANT_ID_REQUIRED', 'provide_grant_id');
    try {
      const grant = await this.transport.revoke(scopeRef, grantId);
      validateGrantStatus(grant, scopeRef);
      return grant;
    } catch (error) {
      throw wrapTransportError(error, 'revoke permission grant');
    }
  }

  async status(scopeRef: NimiAppScopeRef): Promise<PermissionStatusSnapshot> {
    validateScopeRef(scopeRef);
    try {
      const snapshot = await this.transport.status(scopeRef);
      if (!snapshot || !Array.isArray(snapshot.grants)) {
        appError('SDK_PERMISSION_RESPONSE_INVALID', 'permission status response must include grants', 'fix_permission_transport_response');
      }
      validateMatchingScopeRef(snapshot.scopeRef, scopeRef);
      for (const grant of snapshot.grants) {
        validateGrantStatus(grant, scopeRef);
      }
      return snapshot;
    } catch (error) {
      throw wrapTransportError(error, 'read permission status');
    }
  }

  subscribe(scopeRef: NimiAppScopeRef, callback: (event: PermissionGrantEvent) => void): () => void {
    validateScopeRef(scopeRef);
    if (typeof callback !== 'function') {
      appError('SDK_PERMISSION_CALLBACK_INVALID', 'permission subscribe callback is required', 'provide_permission_callback');
    }
    try {
      return this.transport.subscribe(scopeRef, (event) => {
        validateMatchingScopeRef(event.scopeRef, scopeRef);
        validateGrantStatus(event.grant, scopeRef);
        callback(event);
      });
    } catch (error) {
      throw wrapTransportError(error, 'subscribe permission grants');
    }
  }
}

export function createNimiAppClient(transport: NimiAppTransport): NimiAppClient {
  return new NimiAppClient(transport);
}

export function createPermissionClient(transport: PermissionTransport): PermissionClient {
  return new PermissionClient(transport);
}

export function createAppScopeRef(input: {
  readonly appId: unknown;
  readonly surfaceId?: unknown;
}): NimiAppScopeRef {
  return {
    kind: 'app',
    ownerId: requireText(input.appId, 'scope appId is required', 'SDK_APP_ID_REQUIRED', 'set_app_id'),
    ...(normalizeText(input.surfaceId) ? { surfaceId: normalizeText(input.surfaceId) } : {}),
  };
}

export function createScopeCatalogModule(input: {
  readonly appId: string;
  readonly defaultRealmScopes?: readonly string[];
  readonly defaultRuntimeScopes?: readonly string[];
}): ScopeCatalogModule {
  const appId = requireText(input.appId, 'appId is required for scope catalog', 'SDK_APP_ID_REQUIRED', 'set_app_id');
  let draft: ScopeCatalogEntry | null = null;
  let published: ScopeCatalogEntry[] = [];
  const revokedScopes = new Set<string>();
  const revokedVersions = new Set<string>();

  return {
    listCatalog() {
      return {
        appId,
        defaultRealmScopes: normalizeScopeList(input.defaultRealmScopes),
        defaultRuntimeScopes: normalizeScopeList(input.defaultRuntimeScopes),
        published: published.map((entry) => ({ ...entry, scopes: [...entry.scopes] })),
        draft: draft ? { ...draft, scopes: [...draft.scopes] } : null,
      };
    },
    registerAppScopes({ manifest }) {
      const scopes = validateScopeManifest(appId, manifest);
      draft = {
        appId,
        manifestVersion: manifest.manifestVersion,
        catalogHash: scopeCatalogHash(manifest.manifestVersion, scopes),
        status: 'draft',
        scopes,
      };
      return draft;
    },
    publishCatalog() {
      if (!draft) {
        appError('SDK_SCOPE_CATALOG_INVALID', 'scope catalog has no draft to publish', 'register_app_scopes');
      }
      const entry: ScopeCatalogEntry = { ...draft, status: 'published' };
      published.push(entry);
      draft = null;
      return {
        appId,
        scopeCatalogVersion: entry.manifestVersion,
        catalogHash: entry.catalogHash,
        status: 'published',
      };
    },
    revokeAppScopes({ scopes }) {
      for (const scope of normalizeScopeList(scopes)) {
        revokedScopes.add(scope);
      }
      for (const entry of published) {
        if (entry.scopes.some((scope) => revokedScopes.has(scope))) {
          revokedVersions.add(entry.manifestVersion);
        }
      }
      published = published.map((entry) =>
        entry.scopes.some((scope) => revokedScopes.has(scope))
          ? { ...entry, status: 'revoked' }
          : entry);
      return {
        appId,
        revokedScopes: [...revokedScopes].sort(),
        revokedVersions: [...revokedVersions].sort(),
      };
    },
  };
}

export function isAdmittedNimiFirstRunLocalBaseline(row: NimiAppAIProfileFactoryRow): boolean {
  const levels = new Set(row.firstRunInstallLevels.map((level) => level.trim().toLowerCase()));
  if (!levels.has('minimal') && !levels.has('recommended')) return false;
  if (!row.applicableScopes.includes('first-run')) return false;
  if (row.computePosture === 'cloud-only') return false;
  if (row.routingPolicy === 'cloud-first' || row.routingPolicy === 'hybrid-explicit') return false;
  if (row.capabilitySet.includes('video.generate')) return false;
  return row.localComputePackRefs.length > 0 && row.dependencyFamilyRefs.length > 0;
}

export function selectNimiAppFactoryAIProfileForFirstRun(
  rows: readonly NimiAppAIProfileFactoryRow[],
  installLevel: NimiFirstRunInstallLevel = 'minimal',
): NimiAppAIProfileFactoryRow | null {
  const candidates = rows.filter((row) =>
    isAdmittedNimiFirstRunLocalBaseline(row) && row.firstRunInstallLevels.includes(installLevel));
  if (installLevel === 'recommended') {
    return candidates.find((row) => !row.firstRunInstallLevels.includes('minimal')) ?? candidates[0] ?? null;
  }
  return candidates[0] ?? null;
}

function validateScopeRef(scopeRef: NimiAppScopeRef | null | undefined): void {
  if (!scopeRef || scopeRef.kind !== 'app' || !normalizeText(scopeRef.ownerId)) {
    appError('SDK_SCOPE_REF_INVALID', 'explicit app scopeRef is required', 'provide_app_scope_ref');
  }
}

function validateMatchingScopeRef(actual: NimiAppScopeRef, expected: NimiAppScopeRef): void {
  validateScopeRef(actual);
  if (actual.kind !== expected.kind || actual.ownerId !== expected.ownerId || (actual.surfaceId ?? '') !== (expected.surfaceId ?? '')) {
    appError('SDK_PERMISSION_RESPONSE_INVALID', 'permission response scopeRef does not match request', 'fix_permission_transport_response');
  }
}

function validateGrantSpec(spec: GrantSpec | null | undefined): void {
  if (!spec || typeof spec !== 'object') {
    appError('SDK_PERMISSION_GRANT_SPEC_INVALID', 'grantSpec is required', 'provide_grant_spec');
  }
  validatePermissionScopeRef(spec.permissionScope);
  requireText(spec.reason, 'grant reason is required', 'SDK_PERMISSION_GRANT_SPEC_INVALID', 'provide_permission_reason');
}

function validateGrantSpecMatchesScopeRef(scopeRef: NimiAppScopeRef, spec: GrantSpec): void {
  if (normalizeText(spec.permissionScope.appId) !== normalizeText(scopeRef.ownerId)) {
    appError(
      'SDK_PERMISSION_CROSS_APP_ACCESS_NOT_ADMITTED',
      'cross-app permission request is not admitted on permission.request',
      'use_non_live_cross_app_permission_flow_shape',
    );
  }
}

function validatePermissionScopeRef(scope: PermissionScopeRef | null | undefined): void {
  if (!scope || typeof scope !== 'object') {
    appError('SDK_PERMISSION_SCOPE_INVALID', 'permissionScope is required', 'provide_permission_scope');
  }
  requireText(scope.appId, 'permissionScope appId is required', 'SDK_PERMISSION_SCOPE_INVALID', 'provide_permission_scope_app_id');
  if (!isCanonicalPermissionScopeFamily(scope.scopeFamily)) {
    appError('SDK_PERMISSION_SCOPE_INVALID', `permission scopeFamily "${String(scope.scopeFamily)}" is not canonical`, 'use_canonical_permission_scope');
  }
  if (!isCanonicalPermissionScopeName(scope.scopeName)) {
    appError('SDK_PERMISSION_SCOPE_INVALID', `permission scopeName "${String(scope.scopeName)}" is not canonical`, 'use_canonical_permission_scope');
  }
}

function validateGrantStatus(status: GrantStatus | null | undefined, expectedScopeRef: NimiAppScopeRef): void {
  if (!status || typeof status !== 'object') {
    appError('SDK_PERMISSION_RESPONSE_INVALID', 'grant status is missing', 'fix_permission_transport_response');
  }
  validateMatchingScopeRef(status.scopeRef, expectedScopeRef);
  if (!status.grant || !normalizeText(status.grant.grantId)) {
    appError('SDK_PERMISSION_RESPONSE_INVALID', 'grant status missing grant id', 'fix_permission_transport_response');
  }
  validatePermissionScopeRef(status.grant.permissionScope);
  if (normalizeText(status.grant.permissionScope.appId) !== normalizeText(expectedScopeRef.ownerId)) {
    appError('SDK_PERMISSION_RESPONSE_INVALID', 'grant permissionScope appId does not match request scopeRef', 'fix_permission_transport_response');
  }
  if (!isCanonicalGrantState(status.state)) {
    appError('SDK_PERMISSION_RESPONSE_INVALID', `grant state "${String(status.state)}" is not canonical`, 'fix_permission_transport_response');
  }
}

function isPermissionTransport(value: unknown): value is PermissionTransport {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return ['list', 'get', 'request', 'revoke', 'status', 'subscribe']
    .every((method) => typeof candidate[method] === 'function');
}

function validateScopeManifest(appId: string, manifest: ScopeManifest): readonly string[] {
  requireText(manifest?.manifestVersion, 'scope manifestVersion is required', 'SDK_SCOPE_CATALOG_INVALID', 'set_scope_manifest_version');
  const scopes = normalizeScopeList(manifest?.scopes);
  if (scopes.length === 0) {
    appError('SDK_SCOPE_CATALOG_INVALID', 'scope manifest must include at least one scope', 'add_app_scopes');
  }
  const prefix = `app.${appId}.`;
  for (const scope of scopes) {
    if (!scope.startsWith(prefix)) {
      appError('SDK_SCOPE_NAMESPACE_FORBIDDEN', `scope "${scope}" must use namespace ${prefix}*`, 'use_app_namespace_scope');
    }
  }
  return scopes;
}

function normalizeScopeList(scopes: readonly unknown[] | undefined): string[] {
  return Array.from(new Set((scopes ?? []).map(normalizeText).filter(Boolean))).sort();
}

function scopeCatalogHash(version: string, scopes: readonly string[]): string {
  const input = `${version}:${scopes.join(',')}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function requireText(value: unknown, message: string, code: string, actionHint: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    appError(code, message, actionHint);
  }
  return normalized;
}

function wrapTransportError(error: unknown, action: string): never {
  if (isNimiSdkError(error)) {
    throw error;
  }
  appError('SDK_APP_TRANSPORT_FAILED', `failed to ${action}`, 'check_app_transport', error);
}

function isNimiSdkError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && typeof (error as { reasonCode?: unknown }).reasonCode === 'string');
}

function appError(code: string, message: string, actionHint: string, cause?: unknown): never {
  throw createNimiError({
    message,
    code,
    reasonCode: code,
    actionHint,
    source: 'sdk',
    details: cause === undefined ? undefined : { cause: String(cause instanceof Error ? cause.message : cause) },
  });
}
