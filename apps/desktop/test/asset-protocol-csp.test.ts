import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const rendererIndexPath = path.resolve(
  import.meta.dirname ?? __dirname,
  '../src/shell/renderer/index.html',
);
const rendererIndex = fs.readFileSync(rendererIndexPath, 'utf8');
const csp = rendererIndex.match(
  /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/u,
)?.[1] ?? '';

function directive(name: string): string {
  return csp.match(new RegExp(`(?:^|;)\\s*${name}\\b[^;]*`, 'u'))?.[0] ?? '';
}

test('Electron Desktop renderer has one explicit CSP', () => {
  assert.ok(csp, 'renderer index must declare Content-Security-Policy');
  assert.equal(
    rendererIndex.match(/http-equiv="Content-Security-Policy"/gu)?.length,
    1,
  );
  assert.ok(directive('default-src').includes("'self'"));
  assert.ok(directive('object-src').includes("'none'"));
  assert.ok(directive('base-uri').includes("'self'"));
});

test('Electron CSP admits only the current local asset protocol', () => {
  for (const name of ['img-src', 'media-src', 'font-src', 'connect-src']) {
    assert.ok(
      directive(name).includes('nimi-shell-file:'),
      `${name} must admit the registered-only Electron local file protocol`,
    );
  }
  assert.ok(!csp.includes('asset:'), 'retired Tauri asset protocol must not remain');
  assert.ok(!csp.includes('ipc:'), 'retired Tauri IPC protocol must not remain');
  assert.ok(!csp.includes('asset.localhost'), 'retired Tauri asset host must not remain');
  assert.ok(!csp.includes('ipc.localhost'), 'retired Tauri IPC host must not remain');
});

test('Electron CSP allows reviewed remote media without widening scripts', () => {
  assert.ok(directive('img-src').includes('https:'));
  assert.ok(directive('media-src').includes('https:'));
  assert.ok(!directive('script-src').includes('https:'));
});

test('Electron CSP preserves WASM and loopback development without unsafe script execution', () => {
  const scripts = directive('script-src');
  const connections = directive('connect-src');
  assert.ok(scripts.includes('blob:'));
  assert.ok(scripts.includes("'wasm-unsafe-eval'"));
  assert.ok(!scripts.includes("'unsafe-inline'"));
  assert.ok(!scripts.includes("'unsafe-eval'"));
  assert.ok(connections.includes('http://127.0.0.1:*'));
  assert.ok(connections.includes('ws://127.0.0.1:*'));
});
