import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { developmentRealmEnvironment, resolveDevelopmentRealm } from './lib/development-realm.mjs';

import {
  findLegacyCarrierRows,
  inspectMacFixedRuntimeService,
  parseMacProcessRows,
  runDevDoctor,
  validateFixedRuntimeService,
  validateLocalDevelopmentPresence,
} from './doctor-dev.mjs';

const nowUnixMs = Date.parse('2026-07-16T08:00:00.000Z');
const validPresence = {
  schemaVersion: 1,
  desktopAppId: 'nimi.desktop',
  desktopPid: 100,
  endpoint: 'http://127.0.0.1:43210',
  callerToken: 'ab'.repeat(32),
  startedAt: '2026-07-16T07:59:00.000Z',
  lastHeartbeatAt: '2026-07-16T07:59:55.000Z',
};
const localRealm = resolveDevelopmentRealm('local', {});
const localEnv = developmentRealmEnvironment(localRealm);
const localRuntime = { host: 'source', realm: { name: 'local', origin: localRealm.apiOrigin }, runtimePid: 20 };
const noFixedService = async () => ({ state: 'error', reason: 'fixed-runtime-service-not-registered' });

test('doctor rejects ambiguous or unrecognized target options before probing the default environment', () => {
  const cli = fileURLToPath(new URL('./doctor-dev.mjs', import.meta.url));
  for (const options of [['--host', 'source', '--host', 'installed'], ['--relam', 'local']]) {
    const result = spawnSync(process.execPath, [cli, '--', ...options], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Choose one --host|Unknown option/u);
    assert.equal(result.stdout, '');
  }
});

test('presence validation accepts only the exact fresh loopback descriptor', () => {
  assert.equal(validateLocalDevelopmentPresence(validPresence, nowUnixMs).state, 'ok');
  const { callerToken: _callerToken, ...missingCallerToken } = validPresence;
  assert.equal(validateLocalDevelopmentPresence(missingCallerToken, nowUnixMs).state, 'error');
  for (const callerToken of ['', 'ab'.repeat(31), 'AB'.repeat(32), 123]) {
    assert.equal(validateLocalDevelopmentPresence({ ...validPresence, callerToken }, nowUnixMs).state, 'error');
  }
  assert.equal(validateLocalDevelopmentPresence({ ...validPresence, token: 'forbidden' }, nowUnixMs).state, 'error');
  assert.equal(validateLocalDevelopmentPresence({ ...validPresence, endpoint: 'http://localhost:43210' }, nowUnixMs).state, 'error');
  assert.equal(validateLocalDevelopmentPresence({
    ...validPresence,
    lastHeartbeatAt: '2026-07-16T07:59:40.000Z',
  }, nowUnixMs).reason, 'desktop-presence-stale');
});

test('fixed service validation fails closed on any missing protected-service invariant', () => {
  const status = {
    status: 'present', state: 'running', serviceAccountMatches: true, binaryPathMatches: true,
    serviceSidMatches: true, restrictedSid: true, desktopPipePresent: true, localAppPipePresent: true,
    runtimeBinaryMatchesCandidate: true, runtimeBuildRecordMatchesCandidate: true,
    signatureStatus: 'Valid', runtimeCandidateId: 'runtime-0123456789abcdef0123456789abcdef',
  };
  assert.equal(validateFixedRuntimeService(status).state, 'ok');
  assert.equal(validateFixedRuntimeService({ ...status, localAppPipePresent: false }).state, 'error');
});

test('Mac fixed service reports launchd socket activation without inferring native readiness', async () => {
  const desktopSocket = '/private/var/run/nimi/runtime-desktop.sock';
  const appSocket = '/private/var/run/nimi/runtime-local-app.sock';
  const plist = {
    BundleProgram: 'Contents/Library/LaunchServices/nimi-runtime',
    UserName: '_nimiruntime',
    GroupName: '_nimiruntime',
    Sockets: {
      DesktopControl: { SockPathName: desktopSocket },
      LocalAppHost: { SockPathName: appSocket },
    },
  };
  const stdout = [
    'system/ai.nimi.runtime = {',
    '\tstate = not running',
    `\tprogram identifier = ${plist.BundleProgram} (mode: 2)`,
    '\tusername = _nimiruntime',
    '\tgroup = _nimiruntime',
    '\tsockets = {',
    '\t\t"DesktopControl" = {',
    `\t\t\tpath = ${desktopSocket}`,
    '\t\t}',
    '\t\t"LocalAppHost" = {',
    `\t\t\tpath = ${appSocket}`,
    '\t\t}',
    '\t}',
    '}',
  ].join('\n');
  const readSocket = async (socket) => ({ isSocket: () => [desktopSocket, appSocket].includes(socket) });
  const inspect = (output, status = 0) => inspectMacFixedRuntimeService({ status, stdout: output }, plist, readSocket);
  assert.deepEqual(await inspect(stdout), { state: 'ok', reason: 'fixed-runtime-service-on-demand' });
  assert.deepEqual(await inspect(stdout.replace('not running', 'running')), {
    state: 'ok', reason: 'fixed-runtime-service-running',
  });
  assert.equal((await inspect(stdout.replace(appSocket, '/tmp/other.sock'))).reason, 'fixed-runtime-service-sockets-missing');
  assert.equal((await inspectMacFixedRuntimeService({ status: 0, stdout }, plist, async () => ({
    isSocket: () => false,
  }))).reason, 'fixed-runtime-service-sockets-missing');
  assert.equal((await inspect(stdout.replace('username = _nimiruntime', 'username = root'))).reason, 'fixed-runtime-service-profile-mismatch');
  assert.equal((await inspect('', 113)).reason, 'fixed-runtime-service-not-registered');
  assert.equal((await inspect('', 1)).state, 'not-observed');
});

test('carrier detection excludes only the active Desktop process tree', () => {
  const repo = path.resolve('D:/workspace/nimi');
  const carrier = path.join(repo, '.nimi/local/electron-desktop-runtime/42/Nimi Desktop Runtime.exe');
  const rows = [
    { ProcessId: 100, ParentProcessId: 1, Name: 'Nimi Desktop Runtime.exe', ExecutablePath: carrier },
    { ProcessId: 101, ParentProcessId: 100, Name: 'Nimi Desktop Runtime.exe', ExecutablePath: carrier },
    { ProcessId: 200, ParentProcessId: 1, Name: 'electron.exe', ExecutablePath: path.join(repo, 'tools/electron.exe') },
  ];
  assert.deepEqual(findLegacyCarrierRows(rows, repo, 100).map((row) => row.processId), [200]);
  assert.deepEqual(findLegacyCarrierRows(rows, repo, 0).map((row) => row.processId), [100, 101, 200]);
});

test('doctor does not infer registration or App Access from Desktop presence', async () => {
  const report = await runDevDoctor({
    platform: 'win32',
    nowUnixMs,
    probeHttp: async () => ({ state: 'ok', reason: 'http-reachable', statusCode: 200 }),
    probeSource: async () => ({ state: 'missing' }),
    queryFixedService: noFixedService,
    readPresence: async () => validateLocalDevelopmentPresence(validPresence, nowUnixMs),
    queryProcesses: async () => [],
  });
  assert.equal(report.ok, false);
  assert.equal(report.observed.host, null);
  assert.equal(report.observed.realm, null);
  assert.equal(report.reuse.state, 'unknown');
  assert.equal(report.tier1.find((row) => row.id === 'source-runtime')?.state, 'error');
  assert.deepEqual(report.tier2, [
    {
      id: 'registration',
      state: 'not-observed',
      reason: 'desktop-presence-does-not-project-registration',
    },
    {
      id: 'app-access',
      state: 'not-observed',
      reason: 'desktop-presence-does-not-project-app-access',
    },
  ]);
});

test('doctor http probes survive a blocking service query', async (context) => {
  const server = createServer((_request, response) => {
    response.statusCode = 404;
    response.end();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  }));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const probeUrl = `http://127.0.0.1:${address.port}`;

  const report = await runDevDoctor({
    platform: 'win32',
    nowUnixMs,
    realm: 'local', env: { ...localEnv, NIMI_DEV_REALM_URL: probeUrl, NIMI_DEV_WEB_URL: probeUrl },
    probeSource: async () => {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3_100);
      return { state: 'missing' };
    },
    queryFixedService: noFixedService,
    readPresence: async () => validateLocalDevelopmentPresence(validPresence, nowUnixMs),
    queryProcesses: async () => [],
  });

  assert.deepEqual(
    report.tier1
      .filter((row) => row.id === 'realm' || row.id === 'web')
      .map((row) => ({ state: row.state, reason: row.reason, statusCode: row.statusCode })),
    [
      { state: 'ok', reason: 'http-reachable', statusCode: 404 },
      { state: 'ok', reason: 'http-reachable', statusCode: 404 },
    ],
  );
});

test('Mac process inventory preserves executable paths and excludes the live Home tree', () => {
  const repo = '/Users/example/nimi workspace';
  const executable = `${repo}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`;
  const rows = parseMacProcessRows(` 100 1 ${executable}\n 101 100 ${executable}\n 200 1 ${executable}\n`);
  assert.equal(rows[0].executablePath, executable);
  assert.deepEqual(findLegacyCarrierRows(rows, repo, 100).map((row) => row.processId), [200]);
  assert.equal(parseMacProcessRows(''), null);
  assert.equal(parseMacProcessRows('unavailable'), null);
});

test('Mac doctor recognizes authenticated Home presence without exposing its caller token', async () => {
  const executable = `${path.resolve('.')}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`;
  const report = await runDevDoctor({
    platform: 'darwin', nowUnixMs, realm: 'local', env: localEnv,
    probeHttp: async () => ({ state: 'ok', reason: 'http-reachable', statusCode: 200 }),
    probeSource: async () => ({ state: 'ready', observed: localRuntime }),
    queryProcesses: async () => parseMacProcessRows(`100 1 ${executable}\n101 100 ${executable}\n200 1 ${executable}\n`),
    readPresence: async () => validateLocalDevelopmentPresence(validPresence, nowUnixMs),
  });
  assert.equal(report.tier1.find((row) => row.id === 'desktop-presence').state, 'ok');
  assert.deepEqual(report.observed, localRuntime);
  assert.equal(report.reuse.state, 'reusable');
  assert.deepEqual(report.tier1.find((row) => row.id === 'legacy-carriers').processIds, [200]);
  assert.equal(JSON.stringify(report).includes(validPresence.callerToken), false);
  assert.equal(JSON.stringify(report).includes('callerToken'), false);
});

test('Mac doctor reports an unavailable process inventory without claiming no legacy carriers', async () => {
  const report = await runDevDoctor({
    platform: 'darwin', nowUnixMs,
    probeHttp: async () => ({ state: 'ok', reason: 'http-reachable', statusCode: 200 }),
    probeSource: async () => ({ state: 'unavailable', detail: 'process-inventory-unavailable' }),
    queryFixedService: noFixedService,
    queryProcesses: async () => null,
    readPresence: async () => validateLocalDevelopmentPresence(validPresence, nowUnixMs),
  });
  assert.equal(report.ok, false);
  assert.equal(report.tier1.find((row) => row.id === 'source-runtime').state, 'not-observed');
  assert.equal(report.tier1.find((row) => row.id === 'legacy-carriers').state, 'not-observed');
  assert.equal(report.tier2.find((row) => row.id === 'protected-runtime-health').state, 'not-observed');
});

test('an installed request still reports the observed source Realm when the installed service is on demand', async () => {
  const report = await runDevDoctor({
    host: 'installed', realm: 'official', platform: 'darwin',
    probeSource: async () => ({ state: 'conflict', observed: localRuntime, detail: 'Different Realm.' }),
    queryFixedService: async () => ({ state: 'ok', reason: 'fixed-runtime-service-on-demand' }),
    probeHttp: async () => ({ state: 'ok', reason: 'http-reachable' }),
    queryProcesses: async () => [],
    readPresence: async () => validateLocalDevelopmentPresence(validPresence, nowUnixMs),
  });
  assert.ok(!report.tier1.some(row => row.id === 'sdk-kit-dist'));
  assert.equal(report.requested.host, 'installed');
  assert.equal(report.requested.realm.name, 'official');
  assert.equal(report.requested.realm.origin, 'https://realm.nimi.ai');
  assert.deepEqual(report.observed, localRuntime);
  assert.equal(report.reuse.state, 'conflict');
  assert.equal(report.ok, false);
});

test('fixed-service status can identify a running host but cannot establish its Realm', async () => {
  const inputs = {
    realm: 'local', env: localEnv, platform: 'darwin', probeSource: async () => ({ state: 'conflict', detail: 'Another Runtime executable.' }),
    queryFixedService: async () => ({ state: 'ok', reason: 'fixed-runtime-service-running' }),
    probeHttp: async () => ({ state: 'ok', reason: 'http-reachable' }),
    queryProcesses: async () => [],
    readPresence: async () => validateLocalDevelopmentPresence(validPresence, nowUnixMs),
  };
  for (const [host, expected] of [['source', 'conflict'], ['installed', 'unknown']]) {
    const report = await runDevDoctor({ ...inputs, host });
    assert.equal(report.observed.host, 'installed');
    assert.equal(report.observed.realm, null);
    assert.equal(report.reuse.state, expected);
  }
  const idle = await runDevDoctor({ ...inputs, host: 'installed', probeSource: async () => ({ state: 'missing' }),
    queryFixedService: async () => ({ state: 'ok', reason: 'fixed-runtime-service-on-demand' }) });
  assert.equal(idle.observed.host, null);
  assert.equal(idle.reuse.state, 'unknown');

  const otherProfile = await runDevDoctor({ ...inputs, host: 'installed', queryFixedService: async name => ({
    state: 'ok', reason: name === 'official' ? 'fixed-runtime-service-running' : 'fixed-runtime-service-on-demand',
  }) });
  assert.equal(otherProfile.observed.fixedServiceProfile, 'official');
  assert.equal(otherProfile.observed.realm, null);
  assert.equal(otherProfile.reuse.state, 'conflict');
});

test('an incomplete source selection remains unknown even when the requested HTTP endpoints respond', async () => {
  const report = await runDevDoctor({
    realm: 'local', platform: 'darwin', env: localEnv,
    probeSource: async () => ({ state: 'unconfirmed', observed: localRuntime, detail: 'Incomplete source selection.' }),
    probeHttp: async () => ({ state: 'ok', reason: 'http-reachable' }),
    queryProcesses: async () => [],
    readPresence: async () => validateLocalDevelopmentPresence(validPresence, nowUnixMs),
  });
  assert.deepEqual(report.observed, localRuntime);
  assert.equal(report.reuse.state, 'unknown');
  assert.equal(report.ok, false);
});
