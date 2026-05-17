// SDK Permission client types. Transport floor only per Wave 2
// admission rule. Full grant lifecycle (request/grant/use/revoke/
// expire/deny/failed) is Wave 5 ownership; this module only types the
// status read + grant request transport.

export type GrantState =
  | 'requested'
  | 'prompted'
  | 'granted'
  | 'in-use'
  | 'revoked'
  | 'expired'
  | 'denied'
  | 'failed';

export const CANONICAL_GRANT_STATES: readonly GrantState[] = [
  'requested',
  'prompted',
  'granted',
  'in-use',
  'revoked',
  'expired',
  'denied',
  'failed',
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
  readonly state: 'requested' | 'prompted';
}
