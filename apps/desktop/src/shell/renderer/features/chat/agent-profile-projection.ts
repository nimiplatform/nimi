// RealmAgent profile-content projection.
//
// Desktop projects ordinary RealmAgent profile content for display only. Runtime
// owns prompt/context assembly; Desktop must not turn profile documentation into
// per-turn execution input.

import { parseOptionalString } from '@nimiplatform/kit/shell/renderer/bridge';

/**
 * Extract the ordinary RealmAgent first-turn opening message
 * (`AgentProfile.greeting`) from the Realm `agentProfile` projection blob.
 * Returns `null` when the agent carries no greeting.
 */
export function projectRealmAgentGreeting(
  agentProfile: Record<string, unknown> | null | undefined,
): string | null {
  return parseOptionalString(agentProfile?.greeting) || null;
}

export function projectRealmAgentBuiltinDocsContext(
  _agentProfile: Record<string, unknown> | null | undefined,
): string | null {
  return null;
}
