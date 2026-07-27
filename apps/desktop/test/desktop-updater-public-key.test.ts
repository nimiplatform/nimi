import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { normalizeDesktopUpdaterPublicKey } from '../scripts/lib/desktop-updater-public-key.mjs';
import {
  createDesktopUpdaterTauriConfig,
  desktopUpdaterTauriConfigAuthority,
  readRustDefaultUpdaterEndpoint,
} from '../scripts/lib/desktop-updater-tauri-config.mjs';

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

test('desktop updater Tauri config overlay carries normalized updater public key and endpoint', () => {
  const endpoint = 'https://updates.example.test/desktop/latest.json';
  const config = createDesktopUpdaterTauriConfig({
    publicKey: rawPublicKey,
    endpoint,
  });

  assert.equal(config.plugins.updater.pubkey, normalizeDesktopUpdaterPublicKey(rawPublicKey));
  assert.deepEqual(config.plugins.updater.endpoints, [endpoint]);
  assert.equal(config.plugins.updater.windows.installMode, 'passive');
});

test('desktop updater Tauri config default endpoint is read from Rust updater source', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-updater-rust-source-'));
  const rustSourcePath = path.join(tempRoot, 'desktop_updates.rs');
  fs.writeFileSync(
    rustSourcePath,
    'const DEFAULT_UPDATE_ENDPOINT: &str = "https://updates.example.test/desktop/latest.json";\n',
  );

  try {
    const config = createDesktopUpdaterTauriConfig({
      publicKey: rawPublicKey,
      rustSourcePath,
    });

    assert.equal(readRustDefaultUpdaterEndpoint(rustSourcePath), 'https://updates.example.test/desktop/latest.json');
    assert.deepEqual(config.plugins.updater.endpoints, ['https://updates.example.test/desktop/latest.json']);
    assert.match(desktopUpdaterTauriConfigAuthority.endpointSource, /desktop_updates\.rs::DEFAULT_UPDATE_ENDPOINT/u);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('desktop updater Tauri config overlay rejects non-https updater endpoints', () => {
  assert.throws(
    () => createDesktopUpdaterTauriConfig({
      publicKey: rawPublicKey,
      endpoint: 'http://install.nimi.ai/desktop/latest.json',
    }),
    /must use https/,
  );
});
