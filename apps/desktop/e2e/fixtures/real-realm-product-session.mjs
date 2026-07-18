import { randomBytes, randomUUID } from 'node:crypto';
import { createFixtureRealmCoreSeed } from './source-materialization-packet-v3.mjs';

async function requestJson(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  const body = (() => {
    try { return text ? JSON.parse(text) : null; } catch { return null; }
  })();
  if (!response.ok) {
    const reason = String(body?.reasonCode || body?.code || body?.message || 'unknown')
      .replace(/[A-Za-z0-9._~-]{24,}/gu, '<redacted>').slice(0, 200);
    throw new Error(`real Realm request ${new URL(url).pathname} failed with ${response.status} (${reason})`);
  }
  return { response, body };
}

function cookieHeader(response) {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie') || ''];
  const cookies = values.map((value) => value.split(';', 1)[0]).filter(Boolean);
  if (cookies.length < 2) throw new Error('real Realm password registration did not establish an access session');
  return cookies.join('; ');
}

export async function prepareRealRealmProductSession({ realmBaseUrl, trialId }) {
  const origin = new URL(realmBaseUrl).origin;
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const email = `local-agent-product-${suffix}@example.test`;
  const password = `I7-${randomBytes(18).toString('base64url')}`;
  const registration = await requestJson(`${origin}/api/auth/password/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const accessToken = registration.body?.tokens?.accessToken;
  const accountId = registration.body?.tokens?.user?.id;
  if (!accessToken || !accountId || !['ok', 'needs_onboarding'].includes(registration.body?.loginState)) {
    throw new Error('real Realm password registration did not return an authenticated account');
  }
  const realmIssuer = (() => {
    try { return String(JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url')).iss || ''); } catch { return ''; }
  })();
  if (!/^https?:\/\//u.test(realmIssuer)) throw new Error('real Realm access token has no absolute issuer binding');
  const authorization = { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' };
  const seed = createFixtureRealmCoreSeed(`${trialId}-${suffix}`);
  const world = (await requestJson(`${origin}/api/realm/core/worlds`, {
    method: 'POST', headers: authorization, body: JSON.stringify(seed.world),
  })).body;
  const entity = (await requestJson(`${origin}/api/realm/core/worlds/${encodeURIComponent(world.id)}/entities`, {
    method: 'POST', headers: authorization, body: JSON.stringify(seed.entity),
  })).body;
  const character = (await requestJson(`${origin}/api/realm/core/worlds/${encodeURIComponent(world.id)}/characters`, {
    method: 'POST', headers: authorization, body: JSON.stringify({
      ...seed.character,
      worldEntityRef: { kind: 'worldEntity', worldId: world.id, entityId: entity.id },
    }),
  })).body;
  const persona = (await requestJson(`${origin}/api/realm/core/persona-characters`, {
    method: 'POST', headers: authorization, body: JSON.stringify({ ...seed.persona, worldId: world.id }),
  })).body;
  for (const [label, value] of Object.entries({ world, character, persona })) {
    if (!value?.id || !value?.contentHash || (label !== 'world' && !value?.sourceHash)) {
      throw new Error(`real Realm ${label} seed response is incomplete`);
    }
  }
  const publicDetail = (await requestJson(`${origin}/api/world/by-id/${encodeURIComponent(world.id)}/detail-with-characters`)).body;
  const publicCharacterIds = (publicDetail?.sources?.characters || []).map((value) => value?.id);
  const publicPersonaIds = (publicDetail?.sources?.personaCharacters || []).map((value) => value?.id);
  if (!publicCharacterIds.includes(character.id) || !publicPersonaIds.includes(persona.id)) {
    throw new Error('real Realm public source projection did not expose the canonical product seeds');
  }
  return {
    realmBaseUrl: origin,
    realmIssuer,
    accountId,
    cookie: cookieHeader(registration.response),
    displayName: seed.displayName,
    sourceRefs: {
      worldCharacter: {
        kind: 'worldCharacter', id: character.id, worldId: world.id,
        worldEntityRef: character.worldEntityRef, sourceHash: character.sourceHash,
      },
      personaCharacter: {
        kind: 'personaCharacter', id: persona.id, worldId: world.id,
        ownerAccountId: persona.ownerAccountId, sourceHash: persona.sourceHash,
      },
    },
  };
}
