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
  managedWebContentType,
  MANAGED_WEB_CONTENT_SECURITY_POLICY,
  MANAGED_WEB_PAYLOAD_DIGEST_DOMAIN,
  parseDesktopWindowConfig,
  parseHttpRange,
  parseManagedWebCarrierArguments,
} from '../src-electron/managed-web-snapshot.js';
import {
  buildManagedWebUnloadDialogCopy,
  createManagedWebLifecycleController,
  createRollingWindowRateLimiter,
  evaluateManagedWebExternalOpenRequest,
  parseManagedWebExternalUrl,
} from '../src-electron/managed-web-carrier-policy.js';
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

test('H5: managedWebContentType maps markdown assets to text/markdown; charset=utf-8', () => {
  assert.equal(managedWebContentType('stories/README.md'), 'text/markdown; charset=utf-8');
});

test('SEC-6: parseManagedWebExternalUrl rejects non-HTTPS, credentials, raw IPs, local domains, and malformed inputs', () => {
  assert.equal(parseManagedWebExternalUrl('https://nimi.ai/docs?ref=storybook#sec'), 'https://nimi.ai/docs?ref=storybook#sec');
  assert.equal(parseManagedWebExternalUrl('https://github.com./nimiplatform/nimi'), 'https://github.com./nimiplatform/nimi');

  const rejected = [
    '',
    ' https://nimi.ai/',
    'https://nimi.ai/ ',
    'https://nimi.ai/\npath',
    'https://nimi.ai/\tpath',
    `https://nimi.ai/${'a'.repeat(2050)}`,
    'http://nimi.ai/',
    'file:///C:/Windows/System32/calc.exe',
    'javascript:alert(1)',
    'data:text/html,<h1>x</h1>',
    'nimi-app://nimi.storybook/index.html',
    'https://user:pass@nimi.ai/',
    'https://user@nimi.ai/',
    'https://localhost/',
    'https://localhost./',
    'https://localhost../',
    'https://sub.localhost/',
    'https://printer.local/',
    'https://metadata.google.internal/',
    'https://home.arpa/',
    'https://corp.home.arpa/',
    'https://foo.invalid/',
    'https://foo.test/',
    'https://router/',
    'https://127.0.0.1/',
    'https://127.0.0.1./',
    'https://127.0.0.2/',
    'https://2130706433/',
    'https://0x7f000001/',
    'https://0177.0.0.1/',
    'https://10.0.0.1/',
    'https://172.16.0.1/',
    'https://192.168.1.1/',
    'https://169.254.169.254/',
    'https://198.18.0.1/',
    'https://8.8.8.8/',
    'https://[::1]/',
    'https://[::]/',
    'https://[::ffff:127.0.0.1]/',
    'https://[::ffff:0:127.0.0.1]/',
    'https://[::7f00:1]/',
    'https://[64:ff9b::127.0.0.1]/',
    'https://[fe80::1]/',
    'https://[2606:4700:4700::1111]/',
    'https://a..b.com/',
  ];
  for (const url of rejected) {
    assert.equal(parseManagedWebExternalUrl(url), undefined, `expected rejection for ${JSON.stringify(url)}`);
  }
});

test('SEC-6: evaluateManagedWebExternalOpenRequest enforces focus, visibility, disposition whitelist, postBody, and rolling 10s limit', () => {
  let clock = 10_000;
  const limiter = createRollingWindowRateLimiter({ maxEvents: 3, windowMs: 10_000, minIntervalMs: 500, now: () => clock });
  const call = (overrides: Partial<Parameters<typeof evaluateManagedWebExternalOpenRequest>[0]> = {}) =>
    evaluateManagedWebExternalOpenRequest({
      url: 'https://nimi.ai/guide',
      disposition: 'foreground-tab',
      hasPostBody: false,
      windowDestroyed: false,
      windowVisible: true,
      windowFocused: true,
      rateLimiter: limiter,
      ...overrides,
    });

  // Unfocused, invisible, destroyed, postBody, or non-whitelisted disposition are denied without consuming quota.
  assert.equal(call({ windowFocused: false }), undefined);
  assert.equal(call({ windowVisible: false }), undefined);
  assert.equal(call({ windowDestroyed: true }), undefined);
  assert.equal(call({ hasPostBody: true }), undefined);
  assert.equal(call({ disposition: 'other' }), undefined);
  assert.equal(call({ disposition: 'default' }), undefined);

  // Rolling 10s window: 3 events allowed with >= 500ms spacing.
  assert.equal(call(), 'https://nimi.ai/guide');
  clock += 200;
  assert.equal(call(), undefined); // < 500ms min interval
  clock += 400; // t = 10_600
  assert.equal(call({ disposition: 'new-window' }), 'https://nimi.ai/guide');
  clock += 600; // t = 11_200
  assert.equal(call({ disposition: 'background-tab' }), 'https://nimi.ai/guide');
  clock += 1_000; // t = 12_200 (3 events still inside [2_200, 12_200])
  assert.equal(call(), undefined);
  clock = 20_000; // first event at 10_000 expired cleanly
  assert.equal(call(), 'https://nimi.ai/guide');
});

test('SEC-7: managed-web lifecycle handles unload confirmation, reload DoS blocking, cooldown consumption, Cmd+Q upgrade, immediate account revocation, and SIGTERM', async () => {
  type FakeWin = { id: number; destroyed: boolean };
  let clock = 1_000;
  let nextWinId = 1;
  const windows: FakeWin[] = [];
  let quitCount = 0;
  let unregistered = 0;
  let chromeDisposed = 0;
  const pendingConfirms: Array<{
    win: FakeWin;
    signal: AbortSignal;
    resolve: (discard: boolean) => void;
  }> = [];
  const pendingLoadResolvers: Array<() => void> = [];

  const controller = createManagedWebLifecycleController<FakeWin>({
    platform: 'darwin',
    now: () => clock,
    cancelCooldownMs: 300,
    getWindows: () => windows.filter((w) => !w.destroyed),
    isWindowDestroyed: (w) => w.destroyed,
    destroyWindow: (w) => {
      if (w.destroyed) return;
      w.destroyed = true;
      controller.markWindowClosed(w);
    },
    createWindow: async (onConstructed) => {
      const win: FakeWin = { id: nextWinId++, destroyed: false };
      windows.push(win);
      controller.markWindowCreated();
      onConstructed();
      await new Promise<void>((resolve) => {
        pendingLoadResolvers.push(resolve);
      });
    },
    confirmUnload: (win, signal) =>
      new Promise<boolean>((resolve) => {
        pendingConfirms.push({ win, signal, resolve });
      }),
    quitApp: () => {
      quitCount += 1;
    },
    unregisterBridge: () => {
      unregistered += 1;
    },
    disposeChromeHost: () => {
      chromeDisposed += 1;
    },
  });

  // Bilingual copy sanity check
  assert.equal(buildManagedWebUnloadDialogCopy('Studio', 'zh-CN').buttons[1], '放弃并离开');
  assert.equal(buildManagedWebUnloadDialogCopy('Studio', 'en-US').buttons[1], 'Discard and leave');

  // 1. Clean close on macOS then new window -> reload does NOT trigger unload dialog.
  const win1: FakeWin = { id: nextWinId++, destroyed: false };
  windows.push(win1);
  controller.markWindowClose(win1);
  win1.destroyed = true;
  controller.markWindowClosed(win1);

  const win2: FakeWin = { id: nextWinId++, destroyed: false };
  windows.push(win2);
  controller.markWindowCreated();
  let prevented = false;
  controller.handleWillPreventUnload(win2, () => { prevented = true; });
  assert.equal(prevented, false);
  assert.equal(pendingConfirms.length, 0);

  // 2. Real close -> cancel -> immediate retry within 300ms cooldown consumes intent -> reload after cooldown does NOT pop dialog.
  controller.markWindowClose(win2);
  controller.handleWillPreventUnload(win2, () => { prevented = true; });
  assert.equal(pendingConfirms.length, 1);
  pendingConfirms.shift()!.resolve(false);
  await Promise.resolve();
  assert.equal(win2.destroyed, false);

  clock += 100;
  controller.markWindowClose(win2);
  controller.handleWillPreventUnload(win2, () => { prevented = true; });
  assert.equal(pendingConfirms.length, 0); // blocked by cooldown, and closingWindows consumed!

  clock += 400; // past cooldown
  controller.handleWillPreventUnload(win2, () => { prevented = true; });
  assert.equal(pendingConfirms.length, 0); // reload still blocked!

  // 3. Close dialog open -> concurrent Cmd+Q upgrades intent -> Discard quits app cleanly.
  controller.markWindowClose(win2);
  controller.handleWillPreventUnload(win2, () => { prevented = true; });
  assert.equal(pendingConfirms.length, 1);
  controller.markBeforeQuit();
  pendingConfirms.shift()!.resolve(true);
  await Promise.resolve();
  assert.equal(quitCount, 1);
  assert.equal(win2.destroyed, false);

  // 4. Fresh controller: Cmd+Q dialog open -> account switch IMMEDIATELY aborts dialog & destroys old window, clears quit intent, and second invalidation mid-load IMMEDIATELY destroys replacement window!
  const windows2: FakeWin[] = [];
  const confirms2: typeof pendingConfirms = [];
  const loads2: Array<() => void> = [];
  let quits2 = 0;
  let unreg2 = 0;
  let disp2 = 0;
  let wid2 = 1;
  const ctrl2 = createManagedWebLifecycleController<FakeWin>({
    platform: 'win32',
    now: () => clock,
    getWindows: () => windows2.filter((w) => !w.destroyed),
    isWindowDestroyed: (w) => w.destroyed,
    destroyWindow: (w) => {
      if (w.destroyed) return;
      w.destroyed = true;
      ctrl2.markWindowClosed(w);
    },
    createWindow: async (onConstructed) => {
      const w: FakeWin = { id: wid2++, destroyed: false };
      windows2.push(w);
      ctrl2.markWindowCreated();
      onConstructed();
      await new Promise<void>((resolve) => { loads2.push(resolve); });
    },
    confirmUnload: (w, signal) => new Promise<boolean>((resolve) => { confirms2.push({ win: w, signal, resolve }); }),
    quitApp: () => { quits2 += 1; },
    unregisterBridge: () => { unreg2 += 1; ctrl2.handleSessionInvalidated(); },
    disposeChromeHost: () => { disp2 += 1; },
  });

  const wA: FakeWin = { id: wid2++, destroyed: false };
  windows2.push(wA);
  ctrl2.markBeforeQuit();
  ctrl2.markWindowClose(wA);
  ctrl2.handleWillPreventUnload(wA, () => {});
  assert.equal(confirms2.length, 1);
  const firstConfirm = confirms2.shift()!;

  // Account switch fires while Cmd+Q modal is open -> immediate abort & destroy, replacement wB constructed synchronously!
  ctrl2.handleSessionInvalidated();
  assert.equal(firstConfirm.signal.aborted, true);
  assert.equal(wA.destroyed, true);
  assert.equal(windows2.length, 2);
  const wB = windows2[1]!;
  assert.equal(wB.destroyed, false);
  // Closing replacement window manually on Windows would quit (resettingRenderer already cleared after construction).
  assert.equal(ctrl2.shouldQuitOnWindowAllClosed(), true);

  // Stale dialog resolving later is a complete no-op.
  firstConfirm.resolve(true);
  await Promise.resolve();
  assert.equal(quits2, 0);

  // 2nd invalidation arrives while wB is still awaiting loadURL -> wB destroyed IMMEDIATELY, wC created after load settles!
  ctrl2.handleSessionInvalidated();
  assert.equal(wB.destroyed, true);
  assert.equal(windows2.length, 2); // creation coalesced until load settles
  loads2.shift()!();
  await new Promise((r) => setImmediate(r));
  assert.equal(windows2.length, 3);
  const wC = windows2[2]!;
  assert.equal(wC.destroyed, false);
  // New window reload does NOT inherit stale Cmd+Q quit intent!
  ctrl2.handleWillPreventUnload(wC, () => {});
  assert.equal(confirms2.length, 0);

  // 5. SIGTERM enters terminal state immediately, destroys live window without modal, and quits.
  ctrl2.handleSigterm();
  assert.equal(wC.destroyed, true);
  assert.equal(quits2, 1);
  let termPrevented = false;
  ctrl2.handleWillPreventUnload(wC, () => { termPrevented = true; });
  assert.equal(termPrevented, true);

  // 6. will-quit unregisters bridge cleanly without triggering respawn even though unregisterBridge calls handleSessionInvalidated.
  const windows3: FakeWin[] = [];
  let unreg3 = 0;
  let disp3 = 0;
  let created3 = 0;
  const ctrl3 = createManagedWebLifecycleController<FakeWin>({
    platform: 'win32',
    getWindows: () => windows3.filter((w) => !w.destroyed),
    isWindowDestroyed: (w) => w.destroyed,
    destroyWindow: (w) => { w.destroyed = true; },
    createWindow: async (onConstructed) => { created3 += 1; onConstructed(); },
    confirmUnload: async () => false,
    quitApp: () => {},
    unregisterBridge: () => { unreg3 += 1; ctrl3.handleSessionInvalidated(); },
    disposeChromeHost: () => { disp3 += 1; },
  });
  windows3.push({ id: 1, destroyed: false });
  ctrl3.markWillQuit();
  assert.equal(unreg3, 1);
  assert.equal(disp3, 1);
  assert.equal(created3, 0);
  assert.equal(unregistered, 0);
  assert.equal(chromeDisposed, 0);
  assert.equal(unreg2, 0);
  assert.equal(disp2, 0);
});
