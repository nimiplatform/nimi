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
      devCsp?: string;
      assetProtocol?: {
        enable?: boolean;
        scope?: unknown;
      };
    };
  };
};

const csp = String(tauriConfig.app?.security?.csp || '');
const devCsp = String(tauriConfig.app?.security?.devCsp || '');
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
  assert.ok(
    connectDirective.includes('http://ipc.localhost'),
    'connect-src must allow http://ipc.localhost for Tauri Windows IPC fallback',
  );
  assert.ok(
    connectDirective.includes('data:'),
    'connect-src must allow data: wasm payloads emitted by packaged renderer dependencies',
  );
});

test('desktop CSP allows blob module scripts for runtime mod loading', () => {
  const scriptDirective = csp.match(/\bscript-src\b[^;]*/)?.[0] || '';

  assert.ok(
    scriptDirective.includes('blob:'),
    'script-src must allow blob: module URLs for hosted mod package shims and source fallback loading',
  );
  assert.ok(
    scriptDirective.includes("'wasm-unsafe-eval'"),
    'script-src must allow wasm-unsafe-eval so packaged WebKit can instantiate renderer WASM dependencies without enabling unsafe-eval',
  );
  assert.ok(
    !scriptDirective.includes("'unsafe-inline'"),
    'production script-src must not allow inline scripts',
  );
});

test('desktop dev CSP keeps production script restrictions while HMR is disabled', () => {
  const devScriptDirective = devCsp.match(/\bscript-src\b[^;]*/)?.[0] || '';
  const prodScriptDirective = csp.match(/\bscript-src\b[^;]*/)?.[0] || '';

  assert.equal(
    devScriptDirective,
    prodScriptDirective,
    'dev script-src must stay aligned with production script-src when desktop HMR is disabled',
  );
  assert.ok(
    devScriptDirective.includes('blob:'),
    'dev script-src must preserve blob module support for runtime mod loading',
  );
  assert.ok(
    devScriptDirective.includes("'wasm-unsafe-eval'"),
    'dev script-src must preserve WebKit WASM support',
  );
  assert.ok(
    !devScriptDirective.includes("'unsafe-inline'"),
    'dev script-src must not allow inline scripts when React refresh is disabled',
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
