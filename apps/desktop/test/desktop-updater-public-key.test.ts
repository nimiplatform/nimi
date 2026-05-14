import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';

import { normalizeDesktopUpdaterPublicKey } from '../scripts/lib/desktop-updater-public-key.mjs';

const rawPublicKey = 'RWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3';
const publicKeyText = `untrusted comment: minisign public key\n${rawPublicKey}\n`;

function decodeNormalized(value: string): string {
  return Buffer.from(value, 'base64').toString('utf8');
}

test('desktop updater public key normalizer accepts raw minisign public key lines', () => {
  const normalized = normalizeDesktopUpdaterPublicKey(rawPublicKey);
  const decoded = decodeNormalized(normalized);

  assert.match(decoded, /^untrusted comment: Nimi Desktop updater public key\n/);
  assert.equal(decoded.split('\n')[1], rawPublicKey);
});

test('desktop updater public key normalizer preserves minisign public key text', () => {
  const normalized = normalizeDesktopUpdaterPublicKey(publicKeyText);

  assert.equal(decodeNormalized(normalized), publicKeyText);
});

test('desktop updater public key normalizer accepts base64-encoded minisign public key text', () => {
  const encodedText = Buffer.from(publicKeyText, 'utf8').toString('base64');
  const normalized = normalizeDesktopUpdaterPublicKey(encodedText);

  assert.equal(decodeNormalized(normalized), publicKeyText);
});

test('desktop updater public key normalizer rejects non-minisign material', () => {
  assert.throws(
    () => normalizeDesktopUpdaterPublicKey('not-a-minisign-key'),
    /must be a minisign public key line/,
  );
});

