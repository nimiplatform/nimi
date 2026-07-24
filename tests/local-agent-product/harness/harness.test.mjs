import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assessAccessibilityAudit,
  assessObservedProcessBudget,
  beginObservedProcess,
  createObservedProcessLedger,
  inspectNetworkAuthorityMaterial,
  isRuntimeObservedProcessMismatch,
  isRuntimeRestartUiTransition,
  isTypedProjectRevocationDenial,
  resolveHostRustToolchainHomes,
  waitForObservedProcessConnection,
} from './dev-kernel-contract.mjs';
import { startProcess } from './cross-app-driver.mjs';
import {
  decodeDesktopRuntimeUnaryResponse,
  probeRealRealmBrowserLoginAuthority,
  setWindowBounds,
} from './dev-kernel-cross-app-driver.mjs';
import { waitForCdpEndpointRelease } from './dev-kernel-host-driver.mjs';
import {
  classifyRememberedInitialAuthorityPosture,
  selectRememberedProjectAuthorizations,
} from './dev-kernel-local-development-driver.mjs';
import { resolvePortableProcessInvocation } from './process-command.mjs';
const devKernelCrossAppDriverSource = [
  'dev-kernel-cross-app-driver.mjs',
  'dev-kernel-host-driver.mjs',
  'dev-kernel-first-run-driver.mjs',
  'dev-kernel-local-development-driver.mjs',
  'dev-kernel-result-driver.mjs',
].map((file) => fs.readFileSync(path.join(import.meta.dirname, file), 'utf8')).join('\n');
const firstRunConnectivitySource = fs.readFileSync(
  path.join(import.meta.dirname, 'run-first-run-connectivity.mjs'),
  'utf8',
);
const browserAuthDriverSource = [
  'dev-kernel-browser-auth-driver.mjs',
  'dev-kernel-browser-auth-chrome.mjs',
].map((file) => fs.readFileSync(path.join(import.meta.dirname, file), 'utf8')).join('\n');

test('portable process invocation executes the pnpm CLI through Node without a Windows shell', () => {
  assert.deepEqual(
    resolvePortableProcessInvocation('pnpm', ['test'], {
      platform: 'win32',
      pnpmCliPath: 'C:\\tools\\pnpm.cjs',
    }),
    { command: process.execPath, args: ['C:\\tools\\pnpm.cjs', 'test'] },
  );
  assert.deepEqual(
    resolvePortableProcessInvocation('pnpm', ['test'], { platform: 'linux' }),
    { command: 'pnpm', args: ['test'] },
  );
  assert.deepEqual(
    resolvePortableProcessInvocation('go', ['test'], { platform: 'win32' }),
    { command: 'go', args: ['test'] },
  );
});

test('dev-kernel Desktop journey invokes the final Electron standard shell carrier', () => {
  assert.match(devKernelCrossAppDriverSource, /window\.__NIMI_ELECTRON_RUNTIME__/);
  assert.match(devKernelCrossAppDriverSource, /NIMI_STANDARD_SHELL_COMMANDS\['runtime-lifecycle\.status'\]/);
  assert.doesNotMatch(devKernelCrossAppDriverSource, /window\.__TAURI_INTERNALS__/);
  assert.doesNotMatch(devKernelCrossAppDriverSource, /['"]runtime_bridge_status['"]/);
});

test('Runtime unary decoder accepts a canonical empty protobuf but rejects a missing carrier field', () => {
  const codec = {
    decodeResponse(bytes) {
      assert.equal(bytes.byteLength, 0);
      return { jobs: [] };
    },
  };
  assert.deepEqual(
    decodeDesktopRuntimeUnaryResponse(codec, { responseBytesBase64: '' }, '/runtime/ListJobs'),
    { jobs: [] },
  );
  assert.throws(
    () => decodeDesktopRuntimeUnaryResponse(codec, {}, '/runtime/ListJobs'),
    /returned no response bytes field/u,
  );
});

test('window resize falls back to an exact emulated viewport when Electron enforces its native minimum', async () => {
  let emulatedViewport = null;
  const connection = {
    context: {
      async newCDPSession() {
        return {
          async send(method) {
            return method === 'Browser.getWindowForTarget' ? { windowId: 7 } : {};
          },
        };
      },
    },
    page: {
      async evaluate() {
        return emulatedViewport ?? {
          innerWidth: 1100,
          innerHeight: 760,
          clientWidth: 1090,
          clientHeight: 760,
        };
      },
      async setViewportSize(next) {
        emulatedViewport = {
          innerWidth: next.width,
          innerHeight: next.height,
          clientWidth: next.width - 10,
          clientHeight: next.height,
        };
      },
    },
  };

  assert.equal(await setWindowBounds(connection, 390, 780), 'cdp-viewport-fallback');
  assert.deepEqual(emulatedViewport, {
    innerWidth: 390,
    innerHeight: 780,
    clientWidth: 380,
    clientHeight: 780,
  });
});

test('dev-kernel Electron journeys isolate real Chrome auth inside the trial root', () => {
  for (const source of [devKernelCrossAppDriverSource, firstRunConnectivitySource]) {
    assert.match(source, /NIMI_DESKTOP_ELECTRON_OPEN_EXTERNAL_CAPTURE_FILE: browserCaptureFile/u);
    assert.match(source, /browserAuthSafeChildEnvironment\(process\.env\)/u);
    assert.match(source, /NIMI_LOCAL_AGENT_PRODUCT_DESKTOP_USER_DATA_ROOT/);
  }
  assert.match(browserAuthDriverSource, /launchPersistentContext\(profileRoot,[\s\S]*channel: 'chrome'/u);
  assert.match(browserAuthDriverSource, /requireTrialDescendant[\s\S]*browser-auth-private/u);
  assert.match(browserAuthDriverSource, /page\.locator\('input'\)[\s\S]*replaceAll\(credential\.email/u);
  assert.doesNotMatch(browserAuthDriverSource, /request\.postData|allHeaders|authorization.*header/iu);
  assert.doesNotMatch(browserAuthDriverSource, /dev-kernel-browser-auth-failed[^\n]+cause/iu);
});

test('real Realm login preflight requires a web login continuation and rejects automatic callback', async () => {
  let mode = 'web-login';
  let origin = '';
  const server = http.createServer((request, response) => {
    const authorization = new URL(request.url || '/', origin);
    if (mode === 'automatic-callback') {
      response.writeHead(302, { location: authorization.searchParams.get('redirect_uri') || '/' });
    } else {
      const login = new URL('http://localhost:3000/login');
      login.searchParams.set('oauth_next', authorization.toString());
      response.writeHead(302, { location: login.toString() });
    }
    response.end();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    origin = `http://127.0.0.1:${address.port}`;
    const positive = await probeRealRealmBrowserLoginAuthority(origin, 'http://localhost:3000');
    assert.equal(positive.automaticLoopbackCallbackObserved, false);
    assert.equal(positive.oauthNextOrigin, origin);
    mode = 'automatic-callback';
    await assert.rejects(
      () => probeRealRealmBrowserLoginAuthority(origin, 'http://localhost:3000'),
      /invalid browser-login continuation/u,
    );
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('CDP endpoint release waits for the prior supervised host to stop serving', async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"Browser":"old-host"}');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  let released = false;
  const release = waitForCdpEndpointRelease(address.port, 'test host', 2_000).then(() => {
    released = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 75));
  assert.equal(released, false);
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await release;
  assert.equal(released, true);
});

test('process capture persists full logs while bounding in-memory diagnostics', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-process-capture-'));
  try {
    const stdoutPath = path.join(root, 'stdout.log');
    const stderrPath = path.join(root, 'stderr.log');
    const handle = startProcess(process.execPath, [
      '-e',
      "process.stdout.write('A'.repeat(256)); process.stderr.write('B'.repeat(192));",
    ], { stdoutPath, stderrPath, maxCapturedBytes: 64 });
    const result = await handle.completed;
    assert.equal(result.code, 0);
    assert.equal(result.stdout, 'A'.repeat(64));
    assert.equal(result.stderr, 'B'.repeat(64));
    assert.equal(result.stdoutTruncated, true);
    assert.equal(result.stderrTruncated, true);
    assert.equal(fs.readFileSync(stdoutPath, 'utf8'), 'A'.repeat(256));
    assert.equal(fs.readFileSync(stderrPath, 'utf8'), 'B'.repeat(192));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('host Rust toolchain roots remain outside product HOME isolation and fail closed on ambiguity', () => {
  const hostHome = path.join(os.tmpdir(), 'nimi-host-home');
  assert.deepEqual(resolveHostRustToolchainHomes({ env: {}, hostHome }), {
    rustupHome: path.resolve(hostHome, '.rustup'),
    cargoHome: path.resolve(hostHome, '.cargo'),
  });
  assert.deepEqual(resolveHostRustToolchainHomes({
    env: { RUSTUP_HOME: path.join(hostHome, 'rustup'), CARGO_HOME: path.join(hostHome, 'cargo') },
  }), {
    rustupHome: path.resolve(hostHome, 'rustup'),
    cargoHome: path.resolve(hostHome, 'cargo'),
  });
  assert.throws(
    () => resolveHostRustToolchainHomes({ env: { RUSTUP_HOME: 'relative', CARGO_HOME: 'also-relative' } }),
    /absolute paths/,
  );
  assert.throws(
    () => resolveHostRustToolchainHomes({
      env: { RUSTUP_HOME: hostHome, CARGO_HOME: hostHome },
    }),
    /must remain distinct/,
  );
});

test('process-mismatch checkpoint distinguishes stale supervised and raw uncarried denial', () => {
  assert.equal(isRuntimeObservedProcessMismatch({ lastError: { reasonCode: 'process-replaced' } }), true);
  assert.equal(isRuntimeObservedProcessMismatch({ probeKind: 'raw-uncarried', lastError: { reasonCode: 'runtime-service-untrusted' } }), true);
  assert.equal(isRuntimeObservedProcessMismatch({ lastError: { reasonCode: 'runtime-service-untrusted' } }), false);
  assert.equal(isRuntimeObservedProcessMismatch({
    probeKind: 'raw-uncarried',
    fixedServiceStable: true,
    fixedServiceProcessId: 42,
    runtimeCandidateId: `dev-kernel-runtime-${'a'.repeat(32)}`,
    lastError: { reasonCode: 'runtime-service-unavailable' },
  }), true);
  assert.equal(isRuntimeObservedProcessMismatch({ probeKind: 'raw-uncarried', lastError: { reasonCode: 'runtime-service-unavailable' } }), false);
  assert.equal(isRuntimeObservedProcessMismatch({ probeKind: 'raw-uncarried', lastError: { reasonCode: 'process-replaced' } }), false);
  assert.equal(isRuntimeObservedProcessMismatch({ lastError: { reasonCode: 'protected-carrier-required' } }), false);
  assert.equal(isRuntimeObservedProcessMismatch(null), false);
});

test('remembered initial authority posture requires a bound session and unavailable reserved permission', () => {
  assert.equal(classifyRememberedInitialAuthorityPosture({
    session: { sessionBound: true },
    permission: { permissionId: 'agents.interact', posture: 'unavailable', canRequest: false },
  }), 'session-bound-reserved-unavailable');
  for (const evidence of [
    { session: { sessionBound: false }, permission: { permissionId: 'agents.interact', posture: 'unavailable', canRequest: false } },
    { session: { sessionBound: true }, permission: { permissionId: 'agents.interact', posture: 'denied', canRequest: false } },
    { session: { sessionBound: true }, permission: { permissionId: 'agents.interact', posture: 'unavailable', canRequest: true } },
    { session: { sessionBound: true }, permission: { permissionId: 'knowledge.read', posture: 'unavailable', canRequest: false } },
    { state: 'runtime-unavailable', lastError: { reasonCode: 'runtime-service-unavailable' } },
  ]) {
    assert.equal(classifyRememberedInitialAuthorityPosture(evidence), null);
  }
});

test('project authorization selection uses the public Electron decision literal', () => {
  const target = {
    selector: 'remembered-new',
    appId: 'nimi.zhiyu',
    accountId: 'account-primary',
    persistence: 'allow-project',
    state: 'active',
    updatedAtUnixMs: 200,
  };
  const selected = selectRememberedProjectAuthorizations([
    { ...target, selector: 'remembered-old', updatedAtUnixMs: 100 },
    target,
    { ...target, selector: 'semantic-name-is-not-the-projection', persistence: 'remember_project' },
    { ...target, selector: 'run-once', persistence: 'allow-run-once' },
    { ...target, selector: 'wrong-account', accountId: 'account-secondary' },
  ], { accountId: 'account-primary', state: 'active' });
  assert.deepEqual(selected.map((row) => row.selector), ['remembered-new', 'remembered-old']);
});

test('project revoke checkpoint requires an attempted refresh and an invalidated session', () => {
  const valid = {
    attempted: true,
    denial: {
      state: 'access-lost',
      session: { sessionBound: false, reasonCode: 'project-revoked' },
    },
  };
  assert.equal(isTypedProjectRevocationDenial(valid), true);
  assert.equal(isTypedProjectRevocationDenial({ ...valid, attempted: false }), false);
  assert.equal(isTypedProjectRevocationDenial({ processTerminated: true, runs: [{ state: 'revoked' }] }), false);
  assert.equal(isTypedProjectRevocationDenial({
    ...valid,
    denial: { ...valid.denial, session: { sessionBound: false, reasonCode: 'account-changed' } },
  }), false);
});

test('fixed-service restart checkpoint requires visible unavailable then recovered UI states', () => {
  const valid = {
    before: { processId: 101 },
    after: { processId: 202 },
    unavailableUi: { state: 'runtime-unavailable', reasonCode: 'runtime-service-unavailable' },
    recoveredUi: { state: 'session-bound', sessionBound: true, permissionPosture: 'unavailable' },
  };
  assert.equal(isRuntimeRestartUiTransition(valid), true);
  assert.equal(isRuntimeRestartUiTransition({ ...valid, unavailableUi: null }), false);
  assert.equal(isRuntimeRestartUiTransition({ ...valid, recoveredUi: { state: 'runtime-unavailable', sessionBound: false, permissionPosture: '' } }), false);
  assert.equal(isRuntimeRestartUiTransition({ ...valid, after: { processId: 101 } }), false);
});

test('renderer observation starts before the process and detects network authority material', async () => {
  const order = [];
  let resolveConnection;
  const launch = beginObservedProcess({
    connect: () => {
      order.push('observer-started');
      return new Promise((resolve) => { resolveConnection = resolve; });
    },
    start: () => {
      order.push('process-started');
      return { pid: 42 };
    },
  });
  assert.deepEqual(order, ['observer-started', 'process-started']);
  assert.deepEqual(launch.handle, { pid: 42 });
  resolveConnection({ page: 'renderer' });
  assert.deepEqual(await launch.connectionPromise, { page: 'renderer' });

  assert.deepEqual(inspectNetworkAuthorityMaterial({ url: 'https://example.test/safe', headers: {} }), {
    authorizationHeaderObserved: false,
    secretTextObserved: false,
  });
  assert.equal(inspectNetworkAuthorityMaterial({ headers: { Authorization: 'Bearer private-value' } }).authorizationHeaderObserved, true);
  assert.equal(inspectNetworkAuthorityMaterial({ url: 'https://example.test/?access_token=private-value' }).secretTextObserved, true);
  assert.equal(inspectNetworkAuthorityMaterial({ postData: 'refresh_token=private-value' }).secretTextObserved, true);
});

test('renderer observation fails immediately with persisted launcher diagnostics when the process exits', async () => {
  const handle = {
    child: { exitCode: 17, signalCode: null },
    completed: Promise.resolve({ code: 17, signal: null }),
    snapshot: () => ({
      code: 17,
      signal: null,
      stdoutPath: 'desktop.stdout.log',
      stderrPath: 'desktop.stderr.log',
      stdout: '',
      stderr: 'rustc host unavailable',
    }),
  };
  await assert.rejects(
    waitForObservedProcessConnection({
      connectionPromise: new Promise(() => {}),
      handle,
      label: 'Desktop',
    }),
    /Desktop.*desktop\.stderr\.log.*rustc host unavailable/,
  );
});

test('dev-kernel process starts are derived from an observed deduplicated ledger and bounded by maxima', () => {
  const ledger = createObservedProcessLedger();
  ledger.observe('provider', `fixture:${process.pid}`);
  ledger.observe('realm', `fixture:${process.pid}`);
  ledger.observe('runtime', 'pid:101');
  ledger.observe('runtime', 'pid:101');
  ledger.observe('runtime', 'pid:202');
  ledger.observe('desktop', 'pid:303');
  for (const identity of ['pid:401', 'pid:402', 'pid:403', 'generation:2', 'pid:404', 'pid:405']) {
    ledger.observe('zhiyu', identity, { kind: identity.startsWith('generation:') ? 'supervised-process-replacement' : 'process-start' });
  }
  const snapshot = ledger.snapshot();
  assert.deepEqual(snapshot.processStarts, { provider: 1, realm: 1, runtime: 2, desktop: 1, zhiyu: 6 });
  assert.deepEqual(
    assessObservedProcessBudget(
      snapshot.processStarts,
      { provider: 1, realm: 1, runtime: 3, desktop: 1, zhiyu: 6 },
      { provider: 1, realm: 1, runtime: 2, desktop: 1, zhiyu: 6 },
    ),
    { ok: true, overages: [], missing: [] },
  );
  assert.equal(assessObservedProcessBudget(
    { ...snapshot.processStarts, runtime: 4 },
    { provider: 1, realm: 1, runtime: 3, desktop: 1, zhiyu: 6 },
  ).ok, false);
});

test('accessibility acceptance requires an exposed document, named controls, language, and real inputs', () => {
  const audit = {
    dom: { lang: 'zh-CN', visibleButtons: 2, inputs: 1 },
    accessibility: [
      { role: 'RootWebArea', name: 'Nimi', ignored: false },
      { role: 'button', name: '重试', ignored: false },
      { role: 'textbox', name: '消息', ignored: false },
    ],
  };
  assert.equal(assessAccessibilityAudit(audit, { requiresInput: true }).ok, true);
  assert.deepEqual(
    assessAccessibilityAudit({
      dom: { lang: '', visibleButtons: 1, inputs: 0 },
      accessibility: [{ role: 'button', name: '', ignored: false }],
    }, { requiresInput: true }).findings,
    ['missing-exposed-document-root', 'unnamed-interactive-controls:1', 'document-language-missing', 'input-control-missing'],
  );
});
