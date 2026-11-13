import { REALM_PROFILES } from './realm-environments.generated.mjs';

// @nimi-authority: rule.nimi.platform.core-protocol.development-topology
export function resolveDevelopmentRealm(selection, env = process.env) {
  const name = selection ?? env.NIMI_DEV_REALM ?? 'official';
  if (!Object.hasOwn(REALM_PROFILES, name)) throw new Error('Choose --realm official or --realm local.');
  const profile = { ...REALM_PROFILES[name] };
  if (name === 'local') {
    for (const [field, key] of [['apiOrigin', 'NIMI_DEV_REALM_URL'], ['realtimeOrigin', 'NIMI_DEV_REALTIME_URL'], ['webOrigin', 'NIMI_DEV_WEB_URL']]) {
      if (env[key] !== undefined) profile[field] = exactDevelopmentOrigin(env[key], key);
    }
    if (profile.apiOrigin === REALM_PROFILES.official.apiOrigin) throw new Error('Official Realm requires the official environment.');
    if (env.NIMI_DEV_REALM_ENVIRONMENT_ID !== undefined) profile.environmentId = env.NIMI_DEV_REALM_ENVIRONMENT_ID;
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(profile.environmentId)) throw new Error('Invalid development Realm environment id.');
  return Object.freeze({ name, ...profile });
}

export function exactDevelopmentOrigin(value, label) {
  const url = new URL(value);
  if (value !== url.origin || url.username || url.password || (url.protocol !== 'https:'
    && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) {
    throw new Error(`${label} requires an exact HTTPS origin (HTTP only for loopback).`);
  }
  return url.origin;
}

export function developmentRealmEnvironment(realm) {
  return {
    NIMI_DEV_REALM: realm.name,
    NIMI_REALM_URL: realm.apiOrigin,
    NIMI_REALTIME_URL: realm.realtimeOrigin,
    NIMI_WEB_URL: realm.webOrigin,
    NIMI_DEV_REALM_URL: realm.apiOrigin,
    NIMI_DEV_REALTIME_URL: realm.realtimeOrigin,
    NIMI_DEV_WEB_URL: realm.webOrigin,
    NIMI_DEV_REALM_ENVIRONMENT_ID: realm.environmentId,
  };
}
