import { generateKeyPairSync, sign } from 'node:crypto';

const keyId = 'desktop-local-agent-product-rs256';
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicJwk = keys.publicKey.export({ format: 'jwk' });

export const FIXTURE_RUNTIME_AUTH_JWKS = {
  keys: [{ ...publicJwk, kid: keyId, use: 'sig', alg: 'RS256' }],
};

export function createFixtureRuntimeAccessToken({ issuer, subject, sessionId }) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  const header = encode({ alg: 'RS256', typ: 'JWT', kid: keyId });
  const payload = encode({
    iss: String(issuer),
    aud: 'nimi-runtime',
    sub: String(subject),
    sid: String(sessionId),
    iat: issuedAt,
    exp: issuedAt + 3600,
  });
  const signingInput = `${header}.${payload}`;
  const signature = sign('RSA-SHA256', Buffer.from(signingInput, 'utf8'), keys.privateKey).toString('base64url');
  return `${signingInput}.${signature}`;
}
