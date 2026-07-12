import { FIXTURE_PERSONA_SOURCE_REF, FIXTURE_SOURCE_REF } from '../../e2e/fixtures/source-materialization-packet-v2.mjs';

function fixtureIdentity(environmentKey, fallback) {
  const value = String(process.env[environmentKey] || fallback).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
    throw new Error(`${environmentKey} must be a bounded product identity`);
  }
  return value;
}

export const APP_ID = 'nimi.desktop';
export const OWNER_USER_ID = fixtureIdentity('NIMI_LOCAL_AGENT_PRODUCT_ACCOUNT_ID', 'user-e2e-primary');
export const VALID_CHARACTER_ID = FIXTURE_SOURCE_REF.sourceId;
export const DISABLED_CHARACTER_ID = fixtureIdentity('NIMI_LOCAL_AGENT_PRODUCT_DISABLED_SOURCE_ID', 'character-acceptance-missing-hash');
export const VALID_SOURCE_REF = FIXTURE_SOURCE_REF;
export const VALID_PERSONA_SOURCE_REF = FIXTURE_PERSONA_SOURCE_REF;
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
export const ACCOUNT_BROKER_CAPABILITIES = [
  'account.session.read',
  'data.scope.read#realm.worlds.read-probe',
  'data.scope.read#realm.core.world-characters',
  'data.scope.read#realm.core.personas',
  'data.scope.read#realm.core.world-entities',
  'data.scope.read#realm.core.world-relationships',
  'data.scope.read#realm.account.private',
  'data.scope.read#realm.social.private',
  'data.scope.read#realm.group-chats.private',
  'realm_source.snapshot.bind',
];
export const REGISTRATION_CAPABILITIES = [
  ...PROTECTED_SCOPES,
  ...ACCOUNT_BROKER_CAPABILITIES,
];
