// SDK Permission client types. Mirrors P-PERM-003 / S-PERM-004.

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

export interface GrantRef {
  readonly grantId: string;
  readonly appId: string;
  readonly subjectUserId: string;
  readonly scopeKey: string;
}

export interface GrantStatus {
  readonly grant: GrantRef;
  readonly state: GrantState;
  readonly issuedAt?: string;
  readonly expiresAt?: string;
  readonly detail?: string;
}

export interface GrantRequest {
  readonly appId: string;
  readonly subjectUserId: string;
  readonly scopeKey: string;
  readonly reason: string;
}

export interface GrantRequestAccepted {
  readonly accepted: true;
  readonly grantId: string;
  readonly state: 'pending';
}
