import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  findLegacyCarrierRows,
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
  startedAt: '2026-07-16T07:59:00.000Z',
  lastHeartbeatAt: '2026-07-16T07:59:55.000Z',
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

test('doctor keeps unadmitted Tier-2 projections explicit', async () => {
  const report = await runDevDoctor({
    nowUnixMs,
    probeHttp: async () => ({ state: 'ok', reason: 'http-reachable', statusCode: 200 }),
    queryService: async () => ({ status: 'absent' }),
    readPresence: async () => validateLocalDevelopmentPresence(validPresence, nowUnixMs),
    queryProcesses: async () => [],
  });
  assert.equal(report.ok, false);
  assert.equal(report.tier1.find((row) => row.id === 'fixed-runtime-service')?.state, 'error');
  assert.deepEqual(report.tier2.map((row) => row.reason), [
    'bounded projection 未准入', 'bounded projection 未准入', 'bounded projection 未准入',
  ]);
});
