import { createHash } from 'node:crypto';

const segment = '[a-z0-9](?:[a-z0-9-]*[a-z0-9])?';
const productId = new RegExp('^' + segment + '(?:\\.' + segment + ')+$');
const clientId = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/u;
const publicSlug = new RegExp('^' + segment + '$');

export function isAppId(value) {
  return typeof value === 'string' && value.length >= 3 && value.length <= 120 && productId.test(value);
}

export function isClientId(value) {
  return typeof value === 'string' && value.length >= 3 && value.length <= 120 && clientId.test(value);
}

export function hostedWebIdentity(appId, slug, registeredClient) {
  if (!isAppId(appId)) throw new Error('Invalid hosted Web product ID.');
  if (typeof slug !== 'string' || slug.length > 63 || !publicSlug.test(slug))
    throw new Error('Invalid hosted Web slug.');
  const preferred = appId + '.web';
  const id =
    registeredClient ??
    (isClientId(preferred) ? preferred : 'web.' + createHash('sha256').update(appId).digest('hex'));
  if (!isClientId(id)) throw new Error('Invalid hosted Web client ID.');
  const origin = 'https://' + slug + '.nimi.xyz';
  return { appId, slug, clientId: id, origin, redirectUri: origin + '/' };
}
