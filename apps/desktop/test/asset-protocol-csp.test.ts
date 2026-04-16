import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const tauriConfigPath = path.resolve(
  import.meta.dirname ?? __dirname,
  '../src-tauri/tauri.conf.json',
);

const tauriConfig = JSON.parse(fs.readFileSync(tauriConfigPath, 'utf-8')) as {
  app?: {
    security?: {
      csp?: string;
      assetProtocol?: {
        enable?: boolean;
        scope?: unknown;
      };
    };
  };
};

const csp = String(tauriConfig.app?.security?.csp || '');
const assetProtocol = tauriConfig.app?.security?.assetProtocol;

test('desktop CSP allows tauri asset protocol for VRM avatar loading', () => {
  const imgDirective = csp.match(/\bimg-src\b[^;]*/)?.[0] || '';
  const mediaDirective = csp.match(/\bmedia-src\b[^;]*/)?.[0] || '';
  const connectDirective = csp.match(/\bconnect-src\b[^;]*/)?.[0] || '';

  assert.ok(
    imgDirective.includes('asset:'),
    'img-src must allow asset: URLs for local avatar posters and textures',
  );
  assert.ok(
    imgDirective.includes('http://asset.localhost'),
    'img-src must allow http://asset.localhost for Tauri asset protocol compatibility',
  );
  assert.ok(
    mediaDirective.includes('asset:'),
    'media-src must allow asset: URLs for local desktop avatar assets',
  );
  assert.ok(
    connectDirective.includes('asset:'),
    'connect-src must allow asset: URLs so GLTFLoader can fetch local VRM assets',
  );
  assert.ok(
    connectDirective.includes('http://asset.localhost'),
    'connect-src must allow http://asset.localhost for Tauri asset protocol compatibility',
  );
});

test('desktop asset protocol is enabled for local avatar resource loading', () => {
  assert.equal(
    assetProtocol?.enable,
    true,
    'assetProtocol.enable must be true so convertFileSrc URLs resolve in the desktop shell',
  );
  assert.ok(
    Array.isArray(assetProtocol?.scope),
    'assetProtocol.scope must be configured',
  );
  assert.ok(
    (assetProtocol?.scope || []).includes('$HOME/.nimi/data/avatar-resources/resources/**'),
    'assetProtocol.scope must admit the managed desktop avatar resource root',
  );
});
