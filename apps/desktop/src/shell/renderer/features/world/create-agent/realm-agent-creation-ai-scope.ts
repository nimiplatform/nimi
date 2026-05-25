/**
 * AIScopeRef identity for lightweight RealmAgent creation (D-EXPL-008,
 * P-AISC-001 / P-AISC-004).
 *
 * AI-assisted generation is an AI execution path, so it must carry an explicit
 * `AIScopeRef`. This is the canonical app-scoped ref for the Explore → World
 * detail → Create Agent surface. It is distinct from the built-in chat scopes;
 * the creation surface owns its own AIConfig scope.
 */

import type { AIScopeRef } from '@nimiplatform/sdk/ai';

export const REALM_AGENT_CREATION_AI_OWNER_ID = 'desktop.explore';
export const REALM_AGENT_CREATION_AI_SURFACE_ID = 'create-agent';

export const REALM_AGENT_CREATION_AI_SCOPE_REF: AIScopeRef = {
  kind: 'app',
  ownerId: REALM_AGENT_CREATION_AI_OWNER_ID,
  surfaceId: REALM_AGENT_CREATION_AI_SURFACE_ID,
};
