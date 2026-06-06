// SDK Agent Identity Reference types.
//
// Per `.nimi/spec/platform/kernel/agent-identity-floor-contract.md`,
// agent identity is account-scoped (not app-local). The SDK exposes
// only a typed reference projection; it MUST NOT mint canonical
// Nimi-wide agent truth.

export type AgentIdentityTier = 'account-scoped' | 'family-scoped' | 'persona-scoped';

export const CANONICAL_AGENT_TIERS: readonly AgentIdentityTier[] = [
  'account-scoped',
  'family-scoped',
  'persona-scoped',
];

export function isCanonicalAgentTier(value: unknown): value is AgentIdentityTier {
  return typeof value === 'string' && CANONICAL_AGENT_TIERS.includes(value as AgentIdentityTier);
}

// AgentReference is the durable cross-app reference projection. It
// intentionally exposes minimal fields; the canonical identity record
// is owned by Runtime + Realm, not by apps or the SDK consumer.
export interface AgentReference {
  readonly agentRefId: string;
  readonly tier: AgentIdentityTier;
  readonly subjectUserId: string;
  readonly displayHint?: string;
}
