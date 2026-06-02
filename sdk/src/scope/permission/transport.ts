// PermissionTransport is the typed transport contract for the SDK
// Permission client. Concrete implementations live in the host.

import type {
  GrantRequestAccepted,
  GrantStatus,
  GrantSpec,
  PermissionGrantEvent,
  PermissionStatusSnapshot,
  PermissionUnsubscribe,
} from './types.js';
import type { AIScopeRef } from '../ai-scope.js';

export interface PermissionTransport {
  list(scopeRef: AIScopeRef): Promise<readonly GrantStatus[]>;
  get(scopeRef: AIScopeRef, grantId: string): Promise<GrantStatus>;
  request(scopeRef: AIScopeRef, grantSpec: GrantSpec): Promise<GrantRequestAccepted>;
  revoke(scopeRef: AIScopeRef, grantId: string): Promise<GrantStatus>;
  subscribe(
    scopeRef: AIScopeRef,
    callback: (event: PermissionGrantEvent) => void,
  ): PermissionUnsubscribe;
  status(scopeRef: AIScopeRef): Promise<PermissionStatusSnapshot>;
}
