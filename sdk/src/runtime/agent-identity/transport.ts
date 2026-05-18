// AgentIdentityTransport is the typed transport contract for the SDK
// Agent Identity Reference client. Concrete implementations live in
// the host.

import type { AgentReference } from './types.js';

export interface AgentIdentityTransport {
  getAgentReference(refId: string): Promise<AgentReference>;
  listAgentReferencesForUser(subjectUserId: string): Promise<readonly AgentReference[]>;
}
