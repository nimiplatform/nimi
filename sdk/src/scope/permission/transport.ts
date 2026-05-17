// PermissionTransport is the typed transport contract for the SDK
// Permission client. Concrete implementations live in the host.

import type { GrantRequest, GrantRequestAccepted, GrantStatus } from './types.js';

export interface PermissionTransport {
  getGrantStatus(grantId: string): Promise<GrantStatus>;
  requestGrant(request: GrantRequest): Promise<GrantRequestAccepted>;
}
