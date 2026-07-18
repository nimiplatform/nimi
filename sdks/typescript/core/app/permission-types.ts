export type NimiAppScopeKind = 'app';

export interface NimiAppScopeRef {
  readonly kind: NimiAppScopeKind;
  readonly ownerId: string;
  readonly surfaceId?: string;
}

export type PermissionScopeFamily =
  | 'account'
  | 'data'
  | 'agent'
  | 'ai_spend'
  | 'memory'
  | 'knowledge'
  | 'notification'
  | 'file_device'
  | 'audit'
  | 'ai_profile';

export type PermissionScopeName =
  | 'account.read'
  | 'account.session.read'
  | 'data.scope.read'
  | 'data.scope.write'
  | 'agent.identity.project'
  | 'agent.identity.bind'
  | 'ai.spend.meter'
  | 'ai.spend.delegate'
  | 'memory.read.bounded'
  | 'memory.write.admitted'
  | 'knowledge.read.bounded'
  | 'knowledge.write.admitted'
  | 'notification.send'
  | 'notification.subscribe'
  | 'file.read.scoped'
  | 'file.write.scoped'
  | 'device.use.scoped'
  | 'audit.read.scoped'
  | 'ai_profile.selection.consume';

export type GrantState = 'pending' | 'granted' | 'denied' | 'expired' | 'revoked' | 'superseded';

export const CANONICAL_PERMISSION_SCOPE_FAMILIES: readonly PermissionScopeFamily[] = [
  'account',
  'data',
  'agent',
  'ai_spend',
  'memory',
  'knowledge',
  'notification',
  'file_device',
  'audit',
  'ai_profile',
];

export const CANONICAL_PERMISSION_SCOPE_NAMES: readonly PermissionScopeName[] = [
  'account.read',
  'account.session.read',
  'data.scope.read',
  'data.scope.write',
  'agent.identity.project',
  'agent.identity.bind',
  'ai.spend.meter',
  'ai.spend.delegate',
  'memory.read.bounded',
  'memory.write.admitted',
  'knowledge.read.bounded',
  'knowledge.write.admitted',
  'notification.send',
  'notification.subscribe',
  'file.read.scoped',
  'file.write.scoped',
  'device.use.scoped',
  'audit.read.scoped',
  'ai_profile.selection.consume',
];

export const CANONICAL_GRANT_STATES: readonly GrantState[] = [
  'pending',
  'granted',
  'denied',
  'expired',
  'revoked',
  'superseded',
];

export interface PermissionScopeRef {
  readonly appId: string;
  readonly scopeFamily: PermissionScopeFamily;
  readonly scopeName: PermissionScopeName;
  readonly qualifier?: string;
}

export interface GrantRef {
  readonly grantId: string;
  readonly permissionScope: PermissionScopeRef;
  readonly subjectUserId?: string;
}

export interface GrantStatus {
  readonly scopeRef: NimiAppScopeRef;
  readonly grant: GrantRef;
  readonly state: GrantState;
  readonly issuedAt?: string;
  readonly expiresAt?: string;
  readonly detail?: string;
}

export interface GrantSpec {
  readonly permissionScope: PermissionScopeRef;
  readonly subjectUserId?: string;
  readonly reason: string;
}

export interface PermissionStatusSnapshot {
  readonly scopeRef: NimiAppScopeRef;
  readonly grants: readonly GrantStatus[];
  readonly generatedAt?: string;
}

export interface PermissionGrantEvent {
  readonly scopeRef: NimiAppScopeRef;
  readonly grant: GrantStatus;
  readonly eventId?: string;
}

export interface PermissionTransport {
  list(scopeRef: NimiAppScopeRef): Promise<readonly GrantStatus[]>;
  get(scopeRef: NimiAppScopeRef, grantId: string): Promise<GrantStatus>;
  request(scopeRef: NimiAppScopeRef, grantSpec: GrantSpec): Promise<GrantStatus>;
  revoke(scopeRef: NimiAppScopeRef, grantId: string): Promise<GrantStatus>;
  status(scopeRef: NimiAppScopeRef): Promise<PermissionStatusSnapshot>;
  subscribe(scopeRef: NimiAppScopeRef, callback: (event: PermissionGrantEvent) => void): () => void;
}

export interface ScopeManifest {
  readonly manifestVersion: string;
  readonly scopes: readonly string[];
}

export interface ScopeCatalogEntry {
  readonly appId: string;
  readonly manifestVersion: string;
  readonly catalogHash: string;
  readonly status: 'draft' | 'published' | 'revoked';
  readonly scopes: readonly string[];
}

export interface ScopeCatalogDescriptor {
  readonly appId: string;
  readonly defaultRealmScopes: readonly string[];
  readonly defaultRuntimeScopes: readonly string[];
  readonly published: readonly ScopeCatalogEntry[];
  readonly draft: ScopeCatalogEntry | null;
}

export interface ScopeCatalogPublishResult {
  readonly appId: string;
  readonly scopeCatalogVersion: string;
  readonly catalogHash: string;
  readonly status: 'published';
}

export interface ScopeCatalogRevokeResult {
  readonly appId: string;
  readonly revokedScopes: readonly string[];
  readonly revokedVersions: readonly string[];
}

export interface ScopeCatalogModule {
  listCatalog(): ScopeCatalogDescriptor;
  registerAppScopes(input: { readonly manifest: ScopeManifest }): ScopeCatalogEntry;
  publishCatalog(): ScopeCatalogPublishResult;
  revokeAppScopes(input: { readonly scopes: readonly string[] }): ScopeCatalogRevokeResult;
}

export function isCanonicalPermissionScopeFamily(value: unknown): value is PermissionScopeFamily {
  return typeof value === 'string' && CANONICAL_PERMISSION_SCOPE_FAMILIES.includes(value as PermissionScopeFamily);
}

export function isCanonicalPermissionScopeName(value: unknown): value is PermissionScopeName {
  return typeof value === 'string' && CANONICAL_PERMISSION_SCOPE_NAMES.includes(value as PermissionScopeName);
}

export function isCanonicalGrantState(value: unknown): value is GrantState {
  return typeof value === 'string' && CANONICAL_GRANT_STATES.includes(value as GrantState);
}
