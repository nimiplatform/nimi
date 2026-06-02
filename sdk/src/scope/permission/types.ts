// SDK Permission client types. Mirrors P-PERM-003 / S-PERM-004.

import type { AIScopeRef } from '../ai-scope.js';

export type GrantState =
  | 'pending'
  | 'granted'
  | 'denied'
  | 'expired'
  | 'revoked'
  | 'superseded';

export const CANONICAL_GRANT_STATES: readonly GrantState[] = [
  'pending',
  'granted',
  'denied',
  'expired',
  'revoked',
  'superseded',
];

export function isCanonicalGrantState(value: unknown): value is GrantState {
  return typeof value === 'string' && CANONICAL_GRANT_STATES.includes(value as GrantState);
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

export function isCanonicalPermissionScopeFamily(value: unknown): value is PermissionScopeFamily {
  return typeof value === 'string'
    && CANONICAL_PERMISSION_SCOPE_FAMILIES.includes(value as PermissionScopeFamily);
}

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

export function isCanonicalPermissionScopeName(value: unknown): value is PermissionScopeName {
  return typeof value === 'string'
    && CANONICAL_PERMISSION_SCOPE_NAMES.includes(value as PermissionScopeName);
}

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
  readonly scopeRef: AIScopeRef;
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

export interface GrantRequestAccepted {
  readonly scopeRef: AIScopeRef;
  readonly accepted: true;
  readonly grantId: string;
  readonly state: 'pending';
}

export interface PermissionStatusSnapshot {
  readonly scopeRef: AIScopeRef;
  readonly grants: readonly GrantStatus[];
  readonly generatedAt?: string;
}

export interface PermissionGrantEvent {
  readonly scopeRef: AIScopeRef;
  readonly grant: GrantStatus;
  readonly eventId?: string;
}

export type PermissionUnsubscribe = () => void;
