export { PermissionClient, PermissionClientError } from './client.js';
export type { PermissionTransport } from './transport.js';
export type {
  GrantRef,
  GrantRequestAccepted,
  GrantState,
  GrantSpec,
  GrantStatus,
  PermissionGrantEvent,
  PermissionScopeFamily,
  PermissionScopeName,
  PermissionScopeRef,
  PermissionStatusSnapshot,
  PermissionUnsubscribe,
} from './types.js';
export {
  CANONICAL_GRANT_STATES,
  CANONICAL_PERMISSION_SCOPE_FAMILIES,
  CANONICAL_PERMISSION_SCOPE_NAMES,
  isCanonicalGrantState,
  isCanonicalPermissionScopeFamily,
  isCanonicalPermissionScopeName,
} from './types.js';
