export const PLATFORM_RUNTIME_SESSION_APP_INSTANCE_SUFFIX = '.platform-runtime-session';
export const PLATFORM_RUNTIME_SESSION_DEVICE_ID = 'platform-runtime-session';
export const PLATFORM_RUNTIME_SESSION_TTL_SECONDS = 3600;
export const PLATFORM_RUNTIME_SESSION_REFRESH_SKEW_MS = 30_000;

export const DESKTOP_RUNTIME_PROTECTED_SCOPES = [
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
] as const;
export const DESKTOP_RUNTIME_ACCOUNT_BROKER_CAPABILITIES = [
  'account.session.read',
  'data.scope.read#realm.worlds.read-probe',
  'data.scope.read#realm.core.world-characters',
  'data.scope.read#realm.core.world-entities',
  'data.scope.read#realm.core.world-relationships',
  'data.scope.read#realm.account.private',
  'data.scope.read#realm.social.private',
  'data.scope.read#realm.group-chats.private',
  'realm_source.snapshot.bind',
] as const;
export const DESKTOP_RUNTIME_REGISTRATION_CAPABILITIES = [
  ...DESKTOP_RUNTIME_PROTECTED_SCOPES,
  ...DESKTOP_RUNTIME_ACCOUNT_BROKER_CAPABILITIES,
] as const;

export const DESKTOP_RUNTIME_PROTECTED_SCOPE_CATALOG_VERSION = 'sdk-v2';
export const DESKTOP_RUNTIME_PROTECTED_TOKEN_TTL_SECONDS = 3600;
export const DESKTOP_RUNTIME_PROTECTED_TOKEN_REFRESH_SKEW_MS = 60_000;
export const DESKTOP_RUNTIME_PROTECTED_CONSENT_ID = 'desktop-shell-runtime-account';
export const DESKTOP_RUNTIME_PROTECTED_SCOPE_SIGNATURE = buildDesktopRuntimeProtectedScopeSignature();
export const DESKTOP_RUNTIME_PROTECTED_AUTHORIZATION_VERSION = [
  'desktop-shell-runtime-account',
  DESKTOP_RUNTIME_PROTECTED_SCOPE_CATALOG_VERSION,
  DESKTOP_RUNTIME_PROTECTED_SCOPE_SIGNATURE,
].join('-');

function buildDesktopRuntimeProtectedScopeSignature(): string {
  const scopeMaterial = [...DESKTOP_RUNTIME_PROTECTED_SCOPES].sort().join('|');
  let hash = 0x811c9dc5;
  for (let index = 0; index < scopeMaterial.length; index += 1) {
    hash ^= scopeMaterial.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `s${DESKTOP_RUNTIME_PROTECTED_SCOPES.length}-${hash.toString(36)}`;
}
