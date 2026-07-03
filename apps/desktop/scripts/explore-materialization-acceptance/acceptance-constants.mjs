export const APP_ID = 'nimi.desktop';
export const OWNER_USER_ID = 'user-e2e-primary';
export const VALID_PERSONA_ID = 'persona-acceptance-partner';
export const DISABLED_PERSONA_ID = 'persona-acceptance-missing-hash';
export const VALID_SOURCE_REF = {
  kind: 'realmPersona',
  worldId: 'world-explore-acceptance',
  sourceId: VALID_PERSONA_ID,
  sourceContentHash: 'persona-acceptance-partner-hash',
};
export const PROTECTED_SCOPES = [
  'ai.spend.meter',
  'runtime.agent.admin',
  'runtime.agent.autonomy.write',
  'runtime.agent.avatar_debug.read',
  'runtime.agent.avatar_debug.write',
  'runtime.agent.companion_participation.read',
  'runtime.agent.companion_participation.write',
  'runtime.agent.delegation.read',
  'runtime.agent.delegation.write',
  'runtime.agent.read',
  'runtime.agent.turn.read',
  'runtime.agent.turn.write',
  'runtime.agent.write',
];
