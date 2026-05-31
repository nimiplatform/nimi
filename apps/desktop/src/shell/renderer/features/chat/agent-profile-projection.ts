// RealmAgent profile-content projection.
//
// Projects ordinary RealmAgent profile content — the first-turn `greeting` and
// the optional built-in usage documentation corpus — out of the Realm/SDK
// `agentProfile` projection blob into the desktop's `AgentLocalTargetSnapshot`.
//
// Authority: runtime `runtime-agent-service-contract.md` K-AGCORE-140 (guide
// welcome copy / docs are ordinary RealmAgent profile content reached through
// the admitted Realm/SDK projection) and K-AGCORE-142 (the built-in usage
// documentation corpus is stored on the RealmAgent profile `dna` knowledge
// slot and attached per-turn as context only).
//
// This is a generic, ordinary projection: it applies to ANY RealmAgent's
// profile content. It carries no guide-specific identifier and takes no
// guide-special branch.

import { parseOptionalJsonObject, parseOptionalString } from '@nimiplatform/kit/shell/renderer/bridge';

/** The `dna.knowledge` corpus payload format authored by the backend. */
const GUIDE_DOCS_KNOWLEDGE_FORMAT = 'nimi-guide-docs-v1';

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

/**
 * Project the optional built-in usage documentation corpus carried on the
 * RealmAgent profile `dna` knowledge slot into a single static context block.
 *
 * The corpus is product knowledge/context only. This renders it for per-turn
 * prompt-context attachment; it never becomes Agent authority, memory truth,
 * or a runtime catalog (K-AGCORE-140/142). Returns `null` when the agent
 * carries no built-in documentation knowledge payload.
 */
export function projectRealmAgentBuiltinDocsContext(
  agentProfile: Record<string, unknown> | null | undefined,
): string | null {
  const dna = parseOptionalJsonObject(agentProfile?.dna);
  const knowledge = parseOptionalJsonObject(dna?.knowledge);
  if (!knowledge || parseOptionalString(knowledge.format) !== GUIDE_DOCS_KNOWLEDGE_FORMAT) {
    return null;
  }
  const documentation = parseOptionalJsonObject(knowledge.documentation);
  const rawSections = Array.isArray(documentation?.sections) ? documentation.sections : [];
  const rendered = rawSections
    .map((entry) => {
      const section = parseOptionalJsonObject(entry);
      const title = parseOptionalString(section?.title);
      const body = parseOptionalString(section?.body);
      if (!title || !body) {
        return null;
      }
      return `## ${title}\n${body}`;
    })
    .filter((value): value is string => value !== null);
  return rendered.length > 0 ? rendered.join('\n\n') : null;
}
