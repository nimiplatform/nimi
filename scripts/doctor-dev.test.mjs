import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import path from 'node:path';
import test from 'node:test';

import {
  findLegacyCarrierRows,
  runDevDoctor,
  validateFixedRuntimeService,
  validateLocalDevelopmentAuthoritySummary,
  validateLocalDevelopmentPresence,
} from './doctor-dev.mjs';

const nowUnixMs = Date.parse('2026-07-16T08:00:00.000Z');
const validPresence = {
  schemaVersion: 1,
  desktopAppId: 'nimi.desktop',
  desktopPid: 100,
  endpoint: 'http://127.0.0.1:43210',
  startedAt: '2026-07-16T07:59:00.000Z',
  lastHeartbeatAt: '2026-07-16T07:59:55.000Z',
};
const validAuthoritySummary = {
  schemaVersion: 1,
  desktopAppId: 'nimi.desktop',
  desktopPid: 100,
  capturedAt: '2026-07-16T07:59:56.000Z',
  developerMode: {
    availability: 'available',
    state: 'enabled',
    reasonCode: 'action-executed',
  },
  projectAuthorization: {
    availability: 'available',
    activeCount: 2,
    dormantCount: 3,
    deniedCount: 5,
    revokedCount: 7,
    reasonCode: 'action-executed',
  },
  grantSummary: {
    availability: 'available',
    pendingCount: 11,
    grantedCount: 13,
    deniedCount: 17,
    expiredCount: 19,
    revokedCount: 23,
    supersededCount: 29,
    reasonCode: 'action-executed',
  },
};

test('presence validation accepts only the exact fresh loopback descriptor', () => {
  assert.equal(validateLocalDevelopmentPresence(validPresence, nowUnixMs).state, 'ok');
  assert.equal(validateLocalDevelopmentPresence({ ...validPresence, token: 'forbidden' }, nowUnixMs).state, 'error');
  assert.equal(validateLocalDevelopmentPresence({ ...validPresence, endpoint: 'http://localhost:43210' }, nowUnixMs).state, 'error');
  assert.equal(validateLocalDevelopmentPresence({
    ...validPresence,
    lastHeartbeatAt: '2026-07-16T07:59:40.000Z',
  }, nowUnixMs).reason, 'desktop-presence-stale');
});

test('authority summary validation accepts only fresh, PID-bound, bounded fields', () => {
  const result = validateLocalDevelopmentAuthoritySummary(
    validAuthoritySummary,
    validPresence.desktopPid,
    nowUnixMs,
  );
  assert.equal(result.state, 'ok');
  assert.deepEqual(result.tier2, [
    {
      id: 'developer-mode',
      state: 'ok',
      reason: 'developer-mode-enabled',
      developerMode: 'enabled',
    },
    {
      id: 'project-authorization',
      state: 'ok',
      reason: 'bounded-project-authorization-summary-available',
      activeCount: 2,
      dormantCount: 3,
      deniedCount: 5,
      revokedCount: 7,
    },
    {
      id: 'grant-summary',
      state: 'ok',
      reason: 'bounded-grant-summary-available',
      pendingCount: 11,
      grantedCount: 13,
      deniedCount: 17,
      expiredCount: 19,
      revokedCount: 23,
      supersededCount: 29,
    },
  ]);

  assert.equal(validateLocalDevelopmentAuthoritySummary(
    { ...validAuthoritySummary, token: 'forbidden' },
    100,
    nowUnixMs,
  ).reason, 'desktop-authority-summary-shape-invalid');
  assert.equal(validateLocalDevelopmentAuthoritySummary(
    { ...validAuthoritySummary, capturedAt: '2026-07-16T07:59:40.000Z' },
    100,
    nowUnixMs,
  ).reason, 'desktop-authority-summary-stale');
  assert.equal(validateLocalDevelopmentAuthoritySummary(
    { ...validAuthoritySummary, capturedAt: 0 },
    100,
    nowUnixMs,
  ).reason, 'desktop-authority-summary-shape-invalid');
  assert.equal(validateLocalDevelopmentAuthoritySummary(
    validAuthoritySummary,
    101,
    nowUnixMs,
  ).reason, 'desktop-authority-summary-pid-mismatch');

  const unknownReason = structuredClone(validAuthoritySummary);
  unknownReason.developerMode = {
    availability: 'unavailable',
    state: 'unavailable',
    reasonCode: 'runtime-service-unavailable',
  };
  assert.equal(validateLocalDevelopmentAuthoritySummary(
    unknownReason,
    100,
    nowUnixMs,
  ).reason, 'desktop-authority-summary-shape-invalid');

  const unavailableWithCount = structuredClone(validAuthoritySummary);
  unavailableWithCount.grantSummary.availability = 'unavailable';
  unavailableWithCount.grantSummary.reasonCode = 'principal-unauthorized';
  assert.equal(validateLocalDevelopmentAuthoritySummary(
    unavailableWithCount,
    100,
    nowUnixMs,
  ).reason, 'desktop-authority-summary-shape-invalid');
});

test('fixed service validation fails closed on any missing protected-service invariant', () => {
  const status = {
    status: 'present', state: 'running', serviceAccountMatches: true, binaryPathMatches: true,
    serviceSidMatches: true, restrictedSid: true, desktopPipePresent: true, localAppPipePresent: true,
    runtimeBinaryMatchesCandidate: true, runtimeBuildRecordMatchesCandidate: true,
    checkpointCandidatePostureVerified: true, signatureStatus: 'Valid', runtimeCandidateId: 'candidate-a',
  };
  assert.equal(validateFixedRuntimeService(status).state, 'ok');
  assert.equal(validateFixedRuntimeService({ ...status, localAppPipePresent: false }).state, 'error');
});

test('carrier detection excludes only the active Desktop process tree', () => {
  const repo = path.resolve('D:/nimi-realm/nimi');
  const carrier = path.join(repo, '.nimi/local/electron-desktop-runtime/42/Nimi Desktop Runtime.exe');
  const rows = [
    { ProcessId: 100, ParentProcessId: 1, Name: 'Nimi Desktop Runtime.exe', ExecutablePath: carrier },
    { ProcessId: 101, ParentProcessId: 100, Name: 'Nimi Desktop Runtime.exe', ExecutablePath: carrier },
    { ProcessId: 200, ParentProcessId: 1, Name: 'electron.exe', ExecutablePath: path.join(repo, 'tools/electron.exe') },
  ];
  assert.deepEqual(findLegacyCarrierRows(rows, repo, 100).map((row) => row.processId), [200]);
  assert.deepEqual(findLegacyCarrierRows(rows, repo, 0).map((row) => row.processId), [100, 101, 200]);
});

test('doctor consumes the admitted bounded Tier-2 projection', async () => {
  const report = await runDevDoctor({
    nowUnixMs,
    probeHttp: async () => ({ state: 'ok', reason: 'http-reachable', statusCode: 200 }),
    queryService: async () => ({ status: 'absent' }),
    readPresence: async () => validateLocalDevelopmentPresence(validPresence, nowUnixMs),
    readAuthoritySummary: async () => ({ state: 'ok', value: validAuthoritySummary }),
    queryProcesses: async () => [],
  });
  assert.equal(report.ok, false);
  assert.equal(report.tier1.find((row) => row.id === 'fixed-runtime-service')?.state, 'error');
  assert.deepEqual(report.tier2.map((row) => row.state), ['ok', 'ok', 'ok']);
  assert.equal(report.tier2.find((row) => row.id === 'project-authorization')?.activeCount, 2);
  assert.equal(report.tier2.find((row) => row.id === 'grant-summary')?.grantedCount, 13);
});

test('doctor keeps Tier-2 explicitly unavailable when the projection cannot be read', async () => {
  const report = await runDevDoctor({
    nowUnixMs,
    probeHttp: async () => ({ state: 'ok', reason: 'http-reachable', statusCode: 200 }),
    queryService: async () => ({ status: 'absent' }),
    readPresence: async () => validateLocalDevelopmentPresence(validPresence, nowUnixMs),
    readAuthoritySummary: async () => ({
      state: 'error', reason: 'desktop-authority-summary-missing',
    }),
    queryProcesses: async () => [],
  });
  assert.deepEqual(report.tier2.map((row) => ({ state: row.state, reason: row.reason })), [
    { state: 'unavailable', reason: 'desktop-authority-summary-missing' },
    { state: 'unavailable', reason: 'desktop-authority-summary-missing' },
    { state: 'unavailable', reason: 'desktop-authority-summary-missing' },
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
    nowUnixMs,
    probeHttp: async () => {
      try {
        const response = await fetch(probeUrl, {
          method: 'GET',
          redirect: 'manual',
          signal: AbortSignal.timeout(2_500),
        });
        return response.status < 500
          ? { state: 'ok', reason: 'http-reachable', statusCode: response.status }
          : { state: 'error', reason: 'http-unhealthy', statusCode: response.status };
      } catch {
        return { state: 'error', reason: 'http-unreachable' };
      }
    },
    queryService: () => {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3_100);
      return { status: 'absent' };
    },
    readPresence: async () => validateLocalDevelopmentPresence(validPresence, nowUnixMs),
    readAuthoritySummary: async () => ({ state: 'ok', value: validAuthoritySummary }),
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
