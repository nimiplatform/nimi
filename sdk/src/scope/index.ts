import { createNimiError } from '../runtime/index.js';
import { normalizeText } from '../runtime/helpers.js';
import type {
  CatalogHash,
  ScopeCatalogDescriptor,
  ScopeCatalogEntry,
  ScopeCatalogPublishResult,
  ScopeCatalogVersion,
  ScopeListCatalogInput,
  ScopeManifest,
  ScopeName,
  ScopePublishCatalogInput,
  ScopeRegisterAppScopesInput,
  ScopeRevokeAppScopesInput,
  ScopeCatalogRevokeResult,
} from '../types/index.js';
import {
  asCatalogHash,
  asScopeCatalogVersion,
  asScopeName,
  ReasonCode,
} from '../types/index.js';
import {
  GENERATED_REALM_SCOPES,
  GENERATED_RUNTIME_SCOPES,
} from './generated/catalog.js';
import { sha256Hex } from './sha256.js';

const DEFAULT_REALM_SCOPES: readonly ScopeName[] = normalizeScopeList(GENERATED_REALM_SCOPES);
const DEFAULT_RUNTIME_SCOPES: readonly ScopeName[] = normalizeScopeList(GENERATED_RUNTIME_SCOPES);

type ScopeModuleState = {
  appId: string;
  draftManifestVersion: string;
  draftScopes: ScopeName[] | null;
  publishedVersions: Map<ScopeCatalogVersion, ScopeCatalogEntry>;
  publishOrder: ScopeCatalogVersion[];
  revokedScopes: Set<ScopeName>;
  revokedVersions: Set<ScopeCatalogVersion>;
};

export type ScopeModule = {
  listCatalog(input?: Partial<ScopeListCatalogInput>): ScopeCatalogDescriptor;
  registerAppScopes(input: {
    appId?: string;
    manifest: ScopeRegisterAppScopesInput['manifest'];
  }): ScopeCatalogEntry;
  publishCatalog(input?: Partial<ScopePublishCatalogInput>): ScopeCatalogPublishResult;
  revokeAppScopes(input: {
    appId?: string;
    scopes: ScopeRevokeAppScopesInput['scopes'];
  }): ScopeCatalogRevokeResult;
  resolvePublishedCatalogVersion(version?: ScopeCatalogVersion): ScopeCatalogVersion;
};

function normalizeScopeList(scopes: readonly (ScopeName | string)[] | undefined): ScopeName[] {
  return Array.from(new Set((scopes || [])
    .map((scope) => normalizeText(scope))
    .filter((scope) => scope.length > 0))).sort().map(asScopeName);
}

function ensureAppId(input: unknown): string {
  const appId = normalizeText(input);
  if (!appId) {
    throw createNimiError({
      message: 'appId is required for sdk.scope operations',
      reasonCode: ReasonCode.SDK_APP_ID_REQUIRED,
      actionHint: 'set_app_id',
      source: 'sdk',
    });
  }
  return appId;
}

function ensureManifestVersion(value: unknown): ScopeCatalogVersion {
  const manifestVersion = normalizeText(value);
  if (!manifestVersion) {
    throw createNimiError({
      message: 'scope manifestVersion is required',
      reasonCode: ReasonCode.APP_SCOPE_MANIFEST_INVALID,
      actionHint: 'set_scope_manifest_version',
      source: 'sdk',
    });
  }
  return asScopeCatalogVersion(manifestVersion);
}

function ensureScopeNamespace(scope: ScopeName, appId: string): void {
  const expectedPrefix = `app.${appId}.`;
  if (!scope.startsWith(expectedPrefix)) {
    throw createNimiError({
      message: `scope "${scope}" must use namespace ${expectedPrefix}*`,
      reasonCode: ReasonCode.APP_SCOPE_NAMESPACE_FORBIDDEN,
      actionHint: 'use_app_namespace_scope',
      source: 'sdk',
    });
  }
}

function ensureScopes(input: ScopeManifest, appId: string): ScopeName[] {
  const scopes = normalizeScopeList(input.scopes);
  if (scopes.length === 0) {
    throw createNimiError({
      message: 'scope manifest must include at least one scope',
      reasonCode: ReasonCode.APP_SCOPE_MANIFEST_INVALID,
      actionHint: 'add_app_scopes',
      source: 'sdk',
    });
  }
  for (const scope of scopes) {
    ensureScopeNamespace(scope, appId);
  }
  return scopes;
}

function createCatalogHash(manifestVersion: ScopeCatalogVersion, scopes: ScopeName[]): CatalogHash {
  const hashInput = JSON.stringify({
    manifestVersion,
    scopes,
  });
  return asCatalogHash(sha256Hex(hashInput));
}

function createDraftEntry(manifestVersion: ScopeCatalogVersion, scopes: ScopeName[]): ScopeCatalogEntry {
  return {
    scopeCatalogVersion: manifestVersion,
    catalogHash: createCatalogHash(manifestVersion, scopes),
    status: 'draft',
    scopes,
  };
}

function bumpDraftVersion(version: ScopeCatalogVersion | string): ScopeCatalogVersion {
  const normalized = normalizeText(version);
  if (!normalized) {
    return asScopeCatalogVersion('1.0.0-r1');
  }
  const match = normalized.match(/^(.*)-r(\d+)$/);
  if (!match) {
    return asScopeCatalogVersion(`${normalized}-r1`);
  }
  const prefix = match[1] ?? '';
  const revision = Number(match[2] || 0) + 1;
  return asScopeCatalogVersion(`${prefix}-r${revision}`);
}

function latestPublished(state: ScopeModuleState): ScopeCatalogEntry | null {
  if (state.publishOrder.length === 0) {
    return null;
  }
  const version = state.publishOrder[state.publishOrder.length - 1] || '';
  return state.publishedVersions.get(version) || null;
}

function ensureInputAppId(appId: string, inputAppId?: string): void {
  if (!inputAppId) {
    return;
  }
  const normalized = ensureAppId(inputAppId);
  if (normalized !== appId) {
    throw createNimiError({
      message: `scope module is bound to appId "${appId}" (received "${normalized}")`,
      reasonCode: ReasonCode.APP_SCOPE_CONFLICT,
      actionHint: 'use_matching_app_id',
      source: 'sdk',
    });
  }
}

export function createScopeModule(input: { appId: string }): ScopeModule {
  if (!input || typeof input !== 'object') {
    throw createNimiError({
      message: 'scope catalog input is invalid',
      reasonCode: ReasonCode.SDK_SCOPE_CATALOG_INVALID,
      actionHint: 'provide_valid_scope_catalog_input',
      source: 'sdk',
    });
  }
  const appId = ensureAppId(input.appId);

  const state: ScopeModuleState = {
    appId,
    draftManifestVersion: asScopeCatalogVersion('1.0.0'),
    draftScopes: null,
    publishedVersions: new Map(),
    publishOrder: [],
    revokedScopes: new Set(),
    revokedVersions: new Set(),
  };

  const resolvePublishedCatalogVersion = (version?: ScopeCatalogVersion): ScopeCatalogVersion => {
    const requested = normalizeText(version);
    const latest = latestPublished(state);
    if (!latest) {
      throw createNimiError({
        message: 'scope catalog is not published',
        reasonCode: ReasonCode.APP_SCOPE_CATALOG_UNPUBLISHED,
        actionHint: 'publish_scope_catalog',
        source: 'sdk',
      });
    }

    const resolved = asScopeCatalogVersion(requested || latest.scopeCatalogVersion);
    const published = state.publishedVersions.get(resolved);
    if (!published) {
      throw createNimiError({
        message: `scope catalog version "${resolved}" is not published`,
        reasonCode: ReasonCode.APP_SCOPE_CATALOG_UNPUBLISHED,
        actionHint: 'publish_scope_catalog',
        source: 'sdk',
      });
    }

    if (state.revokedVersions.has(resolved)) {
      throw createNimiError({
        message: `scope catalog version "${resolved}" contains revoked scopes`,
        reasonCode: ReasonCode.APP_SCOPE_REVOKED,
        actionHint: 'publish_new_scope_catalog_and_reauthorize',
        source: 'sdk',
      });
    }

    return resolved;
  };

  return {
    listCatalog(inputValue?: Partial<ScopeListCatalogInput>): ScopeCatalogDescriptor {
      ensureInputAppId(appId, normalizeText(inputValue?.appId));
      const include = new Set(
        (inputValue?.include || ['realm', 'runtime', 'app'])
          .map((item) => normalizeText(item))
          .filter((item) => item === 'realm' || item === 'runtime' || item === 'app'),
      );
      if (include.size === 0) {
        include.add('realm');
        include.add('runtime');
        include.add('app');
      }

      const latest = latestPublished(state);
      const latestStatus = latest && state.revokedVersions.has(latest.scopeCatalogVersion)
        ? { ...latest, status: 'revoked' as ScopeCatalogEntry['status'] }
        : latest;
      const draft = state.draftScopes
        ? createDraftEntry(state.draftManifestVersion, state.draftScopes)
        : null;

      return {
        appId,
        realmScopes: include.has('realm') ? [...DEFAULT_REALM_SCOPES] : [],
        runtimeScopes: include.has('runtime') ? [...DEFAULT_RUNTIME_SCOPES] : [],
        appScopes: include.has('app') && latest ? [...latest.scopes] : [],
        draft,
        published: latestStatus || null,
        revokedScopes: Array.from(state.revokedScopes).sort(),
      };
    },

    registerAppScopes(inputValue: {
      appId?: string;
      manifest: ScopeRegisterAppScopesInput['manifest'];
    }): ScopeCatalogEntry {
      ensureInputAppId(appId, normalizeText(inputValue.appId));
      const manifest = inputValue.manifest;
      if (!manifest) {
        throw createNimiError({
          message: 'scope manifest is required',
          reasonCode: ReasonCode.APP_SCOPE_MANIFEST_INVALID,
          actionHint: 'set_scope_manifest',
          source: 'sdk',
        });
      }
      const manifestVersion = ensureManifestVersion(manifest?.manifestVersion);
      const scopes = ensureScopes(manifest, appId);
      state.draftManifestVersion = manifestVersion;
      state.draftScopes = scopes;
      return createDraftEntry(manifestVersion, scopes);
    },

    publishCatalog(inputValue?: Partial<ScopePublishCatalogInput>): ScopeCatalogPublishResult {
      ensureInputAppId(appId, normalizeText(inputValue?.appId));
      if (!state.draftScopes || state.draftScopes.length === 0) {
        throw createNimiError({
          message: 'cannot publish scope catalog without draft scopes',
          reasonCode: ReasonCode.APP_SCOPE_MANIFEST_INVALID,
          actionHint: 'register_app_scopes_first',
          source: 'sdk',
        });
      }

      const version = state.draftManifestVersion;
      const scopes = [...state.draftScopes];
      const catalogHash = createCatalogHash(version, scopes);
      const existing = state.publishedVersions.get(version);
      if (existing && state.revokedVersions.has(version)) {
        throw createNimiError({
          message: `scope catalog version "${version}" is revoked and must use a new version`,
          reasonCode: ReasonCode.APP_SCOPE_REVOKED,
          actionHint: 'bump_scope_manifest_version',
          source: 'sdk',
        });
      }
      if (existing && existing.catalogHash !== catalogHash) {
        throw createNimiError({
          message: `scope catalog version "${version}" already exists with different content`,
          reasonCode: ReasonCode.APP_SCOPE_CONFLICT,
          actionHint: 'bump_scope_manifest_version',
          source: 'sdk',
        });
      }

      const entry: ScopeCatalogEntry = existing || {
        scopeCatalogVersion: version,
        catalogHash,
        status: 'published',
        scopes,
      };

      state.publishedVersions.set(version, entry);
      if (!existing) {
        state.publishOrder.push(version);
      }
      state.draftScopes = null;

      return {
        ...entry,
        publishedAt: new Date().toISOString(),
      };
    },

    revokeAppScopes(inputValue: {
      appId?: string;
      scopes: ScopeRevokeAppScopesInput['scopes'];
    }): ScopeCatalogRevokeResult {
      ensureInputAppId(appId, normalizeText(inputValue.appId));
      const revokeScopes = normalizeScopeList(inputValue.scopes);
      if (revokeScopes.length === 0) {
        throw createNimiError({
          message: 'revokeAppScopes requires at least one scope',
          reasonCode: ReasonCode.APP_SCOPE_MANIFEST_INVALID,
          actionHint: 'provide_scopes_to_revoke',
          source: 'sdk',
        });
      }
      for (const scope of revokeScopes) {
        ensureScopeNamespace(scope, appId);
      }

      const latest = latestPublished(state);
      if (!latest) {
        throw createNimiError({
          message: 'cannot revoke scopes before catalog is published',
          reasonCode: ReasonCode.APP_SCOPE_CATALOG_UNPUBLISHED,
          actionHint: 'publish_scope_catalog',
          source: 'sdk',
        });
      }

      for (const scope of revokeScopes) {
        if (!latest.scopes.includes(scope)) {
          throw createNimiError({
            message: `scope "${scope}" is not present in latest catalog`,
            reasonCode: ReasonCode.APP_SCOPE_CONFLICT,
            actionHint: 'revoke_existing_scopes_only',
            source: 'sdk',
          });
        }
      }

      for (const scope of revokeScopes) {
        state.revokedScopes.add(scope);
      }
      for (const [version, entry] of state.publishedVersions.entries()) {
        if (entry.scopes.some((scope) => state.revokedScopes.has(scope))) {
          state.revokedVersions.add(version);
        }
      }

      state.draftManifestVersion = bumpDraftVersion(latest.scopeCatalogVersion);
      state.draftScopes = latest.scopes.filter((scope) => !state.revokedScopes.has(scope));

      return {
        ...latest,
        status: 'revoked',
        revokedScopes: Array.from(state.revokedScopes).sort(),
        reauthorizeRequired: true,
      };
    },

    resolvePublishedCatalogVersion,
  };
}
