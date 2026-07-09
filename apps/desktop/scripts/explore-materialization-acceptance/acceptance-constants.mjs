export const APP_ID = 'nimi.desktop';
export const OWNER_USER_ID = 'user-e2e-primary';
export const VALID_CHARACTER_ID = 'character-acceptance-yan-zhenqing';
export const DISABLED_CHARACTER_ID = 'character-acceptance-missing-hash';
export const VALID_SOURCE_REF = {
  kind: 'worldCharacter',
  worldId: 'world-explore-acceptance',
  sourceId: VALID_CHARACTER_ID,
  sourceContentHash: 'character-acceptance-yan-zhenqing-hash',
};
export const PROTECTED_SCOPES = [
  'ai.spend.meter',
  'runtime.agent.admin',
  'runtime.agent.ai_config.read',
  'runtime.agent.ai_config.write',
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
