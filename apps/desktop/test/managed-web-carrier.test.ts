import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  computeManagedWebPayloadRootDigest,
  createManagedWebProtocolHandler,
  isAllowedManagedWebNavigationUrl,
  loadVerifiedManagedWebSnapshot,
  MANAGED_WEB_CONTENT_SECURITY_POLICY,
  MANAGED_WEB_PAYLOAD_DIGEST_DOMAIN,
  parseDesktopWindowConfig,
  parseHttpRange,
  parseManagedWebCarrierArguments,
} from '../src-electron/managed-web-snapshot.js';
import { resolveLocalDevelopmentElectronHostLaunch } from '../src-electron/local-development-host-arguments.js';

function createValidManagedWebReleaseDir(): {
  readonly dir: string;
  readonly digest: string;
} {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'nimi-managed-web-snap-'));
  mkdirSync(path.join(dir, 'payload', 'assets'), { recursive: true });
  const files = new Map<string, Buffer>([
    ['LICENSE', Buffer.from('MIT\n', 'utf8')],
    ['manifest.json', Buffer.from(JSON.stringify({
      format: 'nimi.app-package/v2',
      app_id: 'nimi.shijing',
      version: '0.1.12',
      target_id: 'desktop-universal',
      os: 'any',
      arch: 'any',
      runtime_entry: 'payload/index.html',
      native_trust: { posture: 'nimi-managed-carrier', certificate_subject: null },
      execution_profile: { launch_mode: 'nimi-managed-web-v1' },
    }), 'utf8')],
    ['app-info.json', Buffer.from(JSON.stringify({
      format: 'nimi.app-info/v1',
      app_id: 'nimi.shijing',
      version: '0.1.12',
      target_id: 'desktop-universal',
      display_name: '时镜',
      summary: 'Test',
      storage_policy: { kind: 'nimi-mediated-default' },
    }), 'utf8')],
    ['nimi.app.yaml', Buffer.from(
      'app_id: nimi.shijing\nversion: 0.1.12\ndisplay_name: 时镜\napp_access:\n  - runtime.consume\ndesktop:\n  window:\n    width: 1320\n    height: 900\n    min_width: 390\n    min_height: 620\n    title_bar_style: hidden\n',
      'utf8',
    )],
    ['payload/index.html', Buffer.from('<!doctype html><html><body>shijing</body></html>', 'utf8')],
    ['payload/assets/app.mjs', Buffer.from('export const ok = 1;\n', 'utf8')],
    ['payload/assets/icon.svg', Buffer.from('<svg></svg>', 'utf8')],
    ['payload/assets/media.mp4', Buffer.from('0123456789', 'utf8')],
    ['payload/assets/empty.bin', Buffer.alloc(0)],
  ]);
  for (const [relative, content] of files.entries()) {
    writeFileSync(path.join(dir, ...relative.split('/')), content);
  }
  return { dir, digest: computeManagedWebPayloadRootDigest(files) };
}

test('computeManagedWebPayloadRootDigest uses UTF-8 byte order matching Go package.go', () => {
  // U+FF21 (EF BC A1) < U+10000 (F0 90 80 80) in UTF-8 byte order,
  // opposite to UTF-16 code unit order (0xFF21 > 0xD800).
  const bmpName = 'payload/assets/\uff21.txt';
  const nonBmpName = 'payload/assets/\u{10000}.txt';
  assert.ok(bmpName > nonBmpName, 'UTF-16 order puts non-BMP surrogate before U+FF21');
  assert.ok(Buffer.compare(Buffer.from(bmpName, 'utf8'), Buffer.from(nonBmpName, 'utf8')) < 0);

  const entries = new Map<string, Buffer>([
    [nonBmpName, Buffer.from('non-bmp', 'utf8')],
    [bmpName, Buffer.from('bmp', 'utf8')],
  ]);
  const observed = computeManagedWebPayloadRootDigest(entries);

  const hash = createHash('sha256');
  hash.update(Buffer.from(MANAGED_WEB_PAYLOAD_DIGEST_DOMAIN, 'utf8'));
  const len = Buffer.allocUnsafe(8);
  for (const [name, content] of [[bmpName, Buffer.from('bmp', 'utf8')], [nonBmpName, Buffer.from('non-bmp', 'utf8')]] as const) {
    const nameBuf = Buffer.from(name, 'utf8');
    len.writeBigUInt64LE(BigInt(nameBuf.byteLength), 0);
    hash.update(len);
    hash.update(nameBuf);
    len.writeBigUInt64LE(BigInt(content.byteLength), 0);
    hash.update(len);
    hash.update(content);
  }
  assert.equal(observed, `sha256:${hash.digest('hex')}`);
});

test('loadVerifiedManagedWebSnapshot verifies once, drops control files, and resists post-load disk tampering (zero TOCTOU)', async () => {
  const { dir, digest } = createValidManagedWebReleaseDir();
  try {
    const snapshot = loadVerifiedManagedWebSnapshot(dir, digest);
    assert.equal(snapshot.appId, 'nimi.shijing');
    assert.equal(snapshot.displayName, '时镜');
    assert.deepEqual(snapshot.windowConfig, {
      width: 1320,
      height: 900,
      minWidth: 390,
      minHeight: 620,
      titleBarStyle: 'hidden',
    });
    assert.equal(snapshot.payloadFiles.has('manifest.json'), false);
    assert.equal(snapshot.payloadFiles.has('app-info.json'), false);
    assert.equal(snapshot.payloadFiles.has('nimi.app.yaml'), false);
    assert.equal(snapshot.payloadFiles.has('index.html'), true);

    // Tamper disk files AFTER snapshot load; memory handler must keep serving verified bytes!
    writeFileSync(path.join(dir, 'payload', 'index.html'), '<h1>EVIL</h1>', 'utf8');
    rmSync(path.join(dir, 'payload', 'assets', 'app.mjs'));

    const handler = createManagedWebProtocolHandler(snapshot);
    const htmlResp = handler(new Request('nimi-app://nimi.shijing/index.html'));
    assert.equal(htmlResp.status, 200);
    assert.equal(htmlResp.headers.get('content-security-policy'), MANAGED_WEB_CONTENT_SECURITY_POLICY);
    assert.equal(await htmlResp.text(), '<!doctype html><html><body>shijing</body></html>');

    const mjsResp = handler(new Request('nimi-app://nimi.shijing/assets/app.mjs'));
    assert.equal(mjsResp.status, 200);
    assert.equal(mjsResp.headers.get('content-type'), 'text/javascript; charset=utf-8');
    assert.equal(await mjsResp.text(), 'export const ok = 1;\n');

    // Re-loading from tampered disk MUST fail closed!
    assert.throws(() => loadVerifiedManagedWebSnapshot(dir, digest), /managed-web-payload-digest-mismatch/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('managed-web protocol handler supports Range bytes=0-, slices, suffix, 416, and blocks cross-host/traversal', async () => {
  const { dir, digest } = createValidManagedWebReleaseDir();
  try {
    const snapshot = loadVerifiedManagedWebSnapshot(dir, digest);
    const handler = createManagedWebProtocolHandler(snapshot);

    // Chromium probe bytes=0-
    const probe = handler(new Request('nimi-app://nimi.shijing/assets/media.mp4', { headers: { range: 'bytes=0-' } }));
    assert.equal(probe.status, 206);
    assert.equal(probe.headers.get('content-range'), 'bytes 0-9/10');
    assert.equal(await probe.text(), '0123456789');

    // Partial slice
    const slice = handler(new Request('nimi-app://nimi.shijing/assets/media.mp4', { headers: { range: 'bytes=2-5' } }));
    assert.equal(slice.status, 206);
    assert.equal(slice.headers.get('content-range'), 'bytes 2-5/10');
    assert.equal(await slice.text(), '2345');

    // Suffix slice
    const suffix = handler(new Request('nimi-app://nimi.shijing/assets/media.mp4', { headers: { range: 'bytes=-3' } }));
    assert.equal(suffix.status, 206);
    assert.equal(suffix.headers.get('content-range'), 'bytes 7-9/10');
    assert.equal(await suffix.text(), '789');

    // Out-of-range -> 416
    const oob = handler(new Request('nimi-app://nimi.shijing/assets/media.mp4', { headers: { range: 'bytes=20-30' } }));
    assert.equal(oob.status, 416);
    assert.equal(oob.headers.get('content-range'), 'bytes */10');

    // Empty file Range -> 416
    const emptyRange = handler(new Request('nimi-app://nimi.shijing/assets/empty.bin', { headers: { range: 'bytes=0-' } }));
    assert.equal(emptyRange.status, 416);
    assert.equal(emptyRange.headers.get('content-range'), 'bytes */0');
    assert.equal(parseHttpRange('bytes=0-', 0), null);

    // Cross-host, control-file access, and traversal blocked
    assert.equal(handler(new Request('nimi-app://other.app/index.html')).status, 404);
    assert.equal(handler(new Request('nimi-app://nimi.shijing/manifest.json')).status, 404);
    assert.equal(handler(new Request('nimi-app://nimi.shijing/%2e%2e/manifest.json')).status, 404);
    assert.equal(handler(new Request('nimi-app://nimi.shijing/assets/%2e%2e%2findex.html')).status, 403);
    assert.equal(handler(new Request('nimi-app://nimi.shijing/assets%5capp.mjs')).status, 403);
    assert.equal(handler(new Request('nimi-app://nimi.shijing/index.html', { method: 'POST' })).status, 405);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

import {
  isAllowedElectronRendererUrl,
} from '@nimiplatform/kit/shell/electron/main';

test('managed-web navigation guard and Kit IPC bridge agree on query/hash on entry index.html and block SVG', () => {
  const entry = 'nimi-app://nimi.shijing/index.html';
  assert.equal(isAllowedManagedWebNavigationUrl('nimi-app://nimi.shijing/index.html', entry), true);
  assert.equal(isAllowedManagedWebNavigationUrl('nimi-app://nimi.shijing/index.html?tab=chart#top', entry), true);
  assert.equal(isAllowedElectronRendererUrl('nimi-app://nimi.shijing/index.html?tab=chart#top', [entry]), true);
  assert.equal(isAllowedManagedWebNavigationUrl('nimi-app://nimi.shijing/assets/icon.svg', entry), false);
  assert.equal(isAllowedElectronRendererUrl('nimi-app://nimi.shijing/assets/icon.svg?tab=chart', [entry]), false);
  assert.equal(isAllowedManagedWebNavigationUrl('nimi-app://other.app/index.html', entry), false);
  assert.equal(isAllowedManagedWebNavigationUrl('https://example.com/', entry), false);
});

test('parseDesktopWindowConfig enforces closed keys and geometric bounds', () => {
  assert.deepEqual(parseDesktopWindowConfig({}), {
    width: 1280, height: 840, minWidth: 480, minHeight: 420, titleBarStyle: 'native',
  });
  assert.throws(() => parseDesktopWindowConfig({ desktop: { window: { width: 300 } } }));
  assert.throws(() => parseDesktopWindowConfig({ desktop: { window: { width: 500, min_width: 600 } } }));
  assert.throws(() => parseDesktopWindowConfig({ desktop: { window: { fullscreen: true } } }));
});

test('parseManagedWebCarrierArguments enforces mutually exclusive Mode B and Mode C', () => {
  const cwd = path.resolve(os.tmpdir());
  const digest = `sha256:${'a'.repeat(64)}`;
  const installed = parseManagedWebCarrierArguments({
    argv: ['NimiAppHost.exe', '--nimi-managed-web-app', `--nimi-payload-digest=${digest}`],
    workingDirectory: cwd,
  });
  assert.equal(installed.mode, 'installed');
  if (installed.mode === 'installed') assert.equal(installed.payloadDigest, digest);

  const dev = parseManagedWebCarrierArguments({
    argv: [
      'NimiAppHost.exe',
      `--user-data-dir=${path.join(cwd, 'user-data')}`,
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=0',
      path.join(cwd, 'managed-web-carrier.js'),
      '--nimi-managed-web-dev',
      '--nimi-dev-renderer-url=http://127.0.0.1:5173',
    ],
    workingDirectory: cwd,
    allowLeadingScriptArgument: true,
  });
  assert.equal(dev.mode, 'dev');
  if (dev.mode === 'dev') {
    assert.equal(dev.rendererOrigin, 'http://127.0.0.1:5173');
    assert.equal(dev.cdpPort, 0);
  }

  // Mixing Mode B + Mode C rejected
  assert.throws(() => parseManagedWebCarrierArguments({
    argv: ['NimiAppHost.exe', '--nimi-managed-web-app', '--nimi-managed-web-dev', `--nimi-payload-digest=${digest}`],
    workingDirectory: cwd,
  }));
  // Forbidden Chromium flags rejected
  assert.throws(() => parseManagedWebCarrierArguments({
    argv: ['NimiAppHost.exe', '--no-sandbox', '--nimi-managed-web-app', `--nimi-payload-digest=${digest}`],
    workingDirectory: cwd,
  }));

  // Mode B host argument builder emits clean dev flags
  const built = resolveLocalDevelopmentElectronHostLaunch({
    carrier: 'managed-web',
    carrierScript: 'C:\\repo\\apps\\desktop\\dist-electron\\managed-web-carrier.js',
    rendererOrigin: 'http://127.0.0.1:5173',
    cdpPort: 0,
    platform: 'win32',
    sourceLocalDevelopment: true,
  });
  assert.deepEqual(built.arguments, [
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0',
    'C:\\repo\\apps\\desktop\\dist-electron\\managed-web-carrier.js',
    '--nimi-managed-web-dev',
    '--nimi-dev-renderer-url=http://127.0.0.1:5173',
  ]);
});
