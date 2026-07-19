#!/usr/bin/env node

import { lstat, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { spawnCommand } from './lib/command-runner.mjs';
import {
  assessWorkspaceSurfaceFreshness,
  captureWorkspaceSurfaceSnapshot,
  readWorkspaceSurfaceStamp,
} from './lib/dev-workspace-surfaces.mjs';
import {
  findBlockingElectronCarriers,
  normalizedProcessRows,
} from './lib/electron-carrier-processes.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRESENCE_MAX_AGE_MS = 12_000;
const AUTHORITY_SUMMARY_MAX_AGE_MS = 12_000;
const AUTHORITY_SUMMARY_UNAVAILABLE_REASONS = new Set([
  'principal-unauthorized',
  'local-app-operation-unavailable',
]);

export function validateLocalDevelopmentPresence(value, nowUnixMs = Date.now()) {
  const expectedKeys = [
    'desktopAppId', 'desktopPid', 'endpoint', 'lastHeartbeatAt', 'schemaVersion', 'startedAt',
  ];
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join('|') !== expectedKeys.sort().join('|')) {
    return { state: 'error', reason: 'desktop-presence-shape-invalid' };
  }
  const endpoint = safeLoopbackEndpoint(value.endpoint);
  const startedAtUnixMs = Date.parse(value.startedAt);
  const lastHeartbeatAtUnixMs = Date.parse(value.lastHeartbeatAt);
  if (value.schemaVersion !== 1
    || value.desktopAppId !== 'nimi.desktop'
    || !Number.isSafeInteger(value.desktopPid)
    || value.desktopPid <= 0
    || !endpoint
    || !Number.isFinite(startedAtUnixMs)
    || !Number.isFinite(lastHeartbeatAtUnixMs)
    || startedAtUnixMs > lastHeartbeatAtUnixMs
    || lastHeartbeatAtUnixMs > nowUnixMs + 2_000) {
    return { state: 'error', reason: 'desktop-presence-shape-invalid' };
  }
  const ageMs = nowUnixMs - lastHeartbeatAtUnixMs;
  if (ageMs > PRESENCE_MAX_AGE_MS) {
    return { state: 'error', reason: 'desktop-presence-stale', desktopPid: value.desktopPid, ageMs };
  }
  return {
    state: 'ok',
    reason: 'desktop-presence-fresh',
    desktopPid: value.desktopPid,
    endpoint,
    ageMs: Math.max(0, ageMs),
  };
}

export function validateLocalDevelopmentAuthoritySummary(
  value,
  activeDesktopPid,
  nowUnixMs = Date.now(),
) {
  const topLevelKeys = [
    'capturedAt',
    'desktopAppId',
    'desktopPid',
    'developerMode',
    'projectAuthorization',
    'schemaVersion',
  ];
  if (!hasExactKeys(value, topLevelKeys)
    || value.schemaVersion !== 1
    || value.desktopAppId !== 'nimi.desktop'
    || !Number.isSafeInteger(value.desktopPid)
    || value.desktopPid <= 0
    || !Number.isSafeInteger(activeDesktopPid)
    || activeDesktopPid <= 0) {
    return { state: 'error', reason: 'desktop-authority-summary-shape-invalid' };
  }
  if (value.desktopPid !== activeDesktopPid) {
    return { state: 'error', reason: 'desktop-authority-summary-pid-mismatch' };
  }
  if (typeof value.capturedAt !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value.capturedAt)) {
    return { state: 'error', reason: 'desktop-authority-summary-shape-invalid' };
  }
  const capturedAtUnixMs = Date.parse(value.capturedAt);
  if (!Number.isFinite(capturedAtUnixMs) || capturedAtUnixMs > nowUnixMs + 2_000) {
    return { state: 'error', reason: 'desktop-authority-summary-shape-invalid' };
  }
  const ageMs = nowUnixMs - capturedAtUnixMs;
  if (ageMs > AUTHORITY_SUMMARY_MAX_AGE_MS) {
    return { state: 'error', reason: 'desktop-authority-summary-stale', ageMs };
  }

  const developerMode = validateDeveloperModeSummary(value.developerMode);
  const projectAuthorization = validateCountSummary(
    value.projectAuthorization,
    ['activeCount', 'deniedCount', 'revokedCount'],
  );
  if (!developerMode || !projectAuthorization) {
    return { state: 'error', reason: 'desktop-authority-summary-shape-invalid' };
  }

  return {
    state: 'ok',
    reason: 'desktop-authority-summary-fresh',
    desktopPid: value.desktopPid,
    ageMs: Math.max(0, ageMs),
    tier2: [
      {
        id: 'developer-mode',
        state: developerMode.availability === 'available' ? 'ok' : 'unavailable',
        reason: developerMode.availability === 'available'
          ? `developer-mode-${developerMode.state}`
          : developerMode.reasonCode,
        developerMode: developerMode.state,
      },
      {
        id: 'project-authorization',
        state: projectAuthorization.availability === 'available' ? 'ok' : 'unavailable',
        reason: projectAuthorization.availability === 'available'
          ? 'bounded-project-authorization-summary-available'
          : projectAuthorization.reasonCode,
        ...projectAuthorization.counts,
      },
    ],
  };
}

function hasExactKeys(value, expectedKeys) {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).sort().join('|') === [...expectedKeys].sort().join('|');
}

function validateDeveloperModeSummary(value) {
  if (!hasExactKeys(value, ['availability', 'reasonCode', 'state'])) return null;
  if (value.availability === 'available'
    && value.reasonCode === 'action-executed'
    && (value.state === 'enabled' || value.state === 'disabled')) {
    return value;
  }
  if (value.availability === 'unavailable'
    && value.state === 'unavailable'
    && AUTHORITY_SUMMARY_UNAVAILABLE_REASONS.has(value.reasonCode)) {
    return value;
  }
  return null;
}

function validateCountSummary(value, countKeys) {
  if (!hasExactKeys(value, ['availability', 'reasonCode', ...countKeys])) return null;
  const counts = Object.fromEntries(countKeys.map((key) => [key, value[key]]));
  if (!Object.values(counts).every((count) => Number.isSafeInteger(count) && count >= 0)) {
    return null;
  }
  if (value.availability === 'available' && value.reasonCode === 'action-executed') {
    return { availability: value.availability, reasonCode: value.reasonCode, counts };
  }
  if (value.availability === 'unavailable'
    && AUTHORITY_SUMMARY_UNAVAILABLE_REASONS.has(value.reasonCode)
    && Object.values(counts).every((count) => count === 0)) {
    return { availability: value.availability, reasonCode: value.reasonCode, counts };
  }
  return null;
}

export function validateFixedRuntimeService(status) {
  const healthy = status?.status === 'present'
    && status?.state === 'running'
    && status?.serviceAccountMatches === true
    && status?.binaryPathMatches === true
    && status?.serviceSidMatches === true
    && status?.restrictedSid === true
    && status?.desktopPipePresent === true
    && status?.localAppPipePresent === true
    && status?.runtimeBinaryMatchesCandidate === true
    && status?.runtimeBuildRecordMatchesCandidate === true
    && status?.checkpointCandidatePostureVerified === true
    && status?.signatureStatus === 'Valid'
    && typeof status?.runtimeCandidateId === 'string'
    && status.runtimeCandidateId.length > 0;
  return healthy
    ? { state: 'ok', reason: 'fixed-runtime-service-healthy', candidateId: status.runtimeCandidateId }
    : { state: 'error', reason: 'fixed-runtime-service-unhealthy' };
}

export function findLegacyCarrierRows(rows, repo, activeDesktopPid = 0) {
  const normalized = normalizedProcessRows(rows);
  const activeTree = new Set(activeDesktopPid > 0 ? [activeDesktopPid] : []);
  let changed;
  do {
    changed = false;
    for (const row of normalized) {
      if (!activeTree.has(row.processId) && activeTree.has(row.parentProcessId)) {
        activeTree.add(row.processId);
        changed = true;
      }
    }
  } while (changed);
  return findBlockingElectronCarriers(normalized, repo)
    .filter((row) => !activeTree.has(row.processId));
}

export async function runDevDoctor(input = {}) {
  const nowUnixMs = input.nowUnixMs ?? Date.now();
  const probeHttp = input.probeHttp ?? probeHttpEndpoint;
  const queryService = input.queryService ?? queryFixedRuntimeService;
  const queryProcesses = input.queryProcesses ?? queryProcessRows;
  const readPresence = input.readPresence ?? readPresenceDescriptor;
  const readAuthoritySummary = input.readAuthoritySummary ?? readAuthoritySummaryDescriptor;
  const serviceResultPromise = queryService();
  const processRowsPromise = queryProcesses();
  const [serviceResult, processRows, realm, web, presenceResult, authoritySummaryRead] = await Promise.all([
    serviceResultPromise,
    processRowsPromise,
    probeHttp('http://127.0.0.1:3002'),
    probeHttp('http://127.0.0.1:3000'),
    readPresence(nowUnixMs),
    readAuthoritySummary(),
  ]);
  const service = validateFixedRuntimeService(serviceResult);
  const activeDesktopPid = presenceResult.state === 'ok' ? presenceResult.desktopPid : 0;
  const legacyCarriers = findLegacyCarrierRows(processRows, repoRoot, activeDesktopPid);
  const stamp = await readWorkspaceSurfaceStamp(repoRoot);
  const surfaceStates = {};
  for (const surface of ['sdk', 'kit']) {
    surfaceStates[surface] = assessWorkspaceSurfaceFreshness(
      stamp,
      surface,
      await captureWorkspaceSurfaceSnapshot(repoRoot, surface),
    );
  }
  const workspaceSurfaces = Object.values(surfaceStates).every((row) => row.state === 'fresh')
    ? { state: 'ok', reason: 'sdk-kit-dist-fresh', surfaces: surfaceStates }
    : { state: 'error', reason: 'sdk-kit-dist-stale', surfaces: surfaceStates };
  const tier1 = [
    { id: 'realm', ...realm },
    { id: 'web', ...web },
    { id: 'fixed-runtime-service', ...service },
    { id: 'desktop-presence', ...presenceResult },
    {
      id: 'legacy-carriers',
      state: legacyCarriers.length === 0 ? 'ok' : 'error',
      reason: legacyCarriers.length === 0 ? 'no-legacy-carriers' : 'legacy-carriers-running',
      processIds: legacyCarriers.map((row) => row.processId),
    },
    { id: 'sdk-kit-dist', ...workspaceSurfaces },
  ];
  const authoritySummary = presenceResult.state === 'ok' && authoritySummaryRead.state === 'ok'
    ? validateLocalDevelopmentAuthoritySummary(
      authoritySummaryRead.value,
      presenceResult.desktopPid,
      nowUnixMs,
    )
    : {
      state: 'error',
      reason: presenceResult.state === 'ok'
        ? authoritySummaryRead.reason
        : 'desktop-presence-required-for-authority-summary',
    };
  const tier2 = authoritySummary.state === 'ok'
    ? authoritySummary.tier2
    : unavailableTier2(authoritySummary.reason);
  return {
    schemaVersion: 'nimi.dev-doctor/v1',
    checkedAt: new Date(nowUnixMs).toISOString(),
    ok: tier1.every((row) => row.state === 'ok'),
    tier1,
    tier2,
  };
}

function unavailableTier2(reason) {
  return ['developer-mode', 'project-authorization', 'grant-summary'].map((id) => ({
    id,
    state: 'unavailable',
    reason,
  }));
}

function safeLoopbackEndpoint(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:'
      || url.hostname !== '127.0.0.1'
      || !url.port
      || url.username
      || url.password
      || url.pathname !== '/'
      || url.search
      || url.hash) return null;
    const port = Number(url.port);
    return Number.isInteger(port) && port >= 1024 && port <= 65535 ? url.origin : null;
  } catch {
    return null;
  }
}

async function probeHttpEndpoint(url) {
  try {
    const response = await fetch(url, {
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
}

async function readPresenceDescriptor(nowUnixMs) {
  const presencePath = path.join(
    os.homedir(), '.nimi', 'run', 'desktop', 'local-development', 'presence.v1.json',
  );
  try {
    const fileStat = await lstat(presencePath);
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
      return { state: 'error', reason: 'desktop-presence-file-invalid' };
    }
    return validateLocalDevelopmentPresence(JSON.parse(await readFile(presencePath, 'utf8')), nowUnixMs);
  } catch {
    return { state: 'error', reason: 'desktop-presence-missing' };
  }
}

async function readAuthoritySummaryDescriptor() {
  const summaryPath = path.join(
    os.homedir(), '.nimi', 'run', 'desktop', 'local-development', 'authority-summary.v1.json',
  );
  try {
    const fileStat = await lstat(summaryPath);
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
      return { state: 'error', reason: 'desktop-authority-summary-file-invalid' };
    }
    let value;
    try {
      value = JSON.parse(await readFile(summaryPath, 'utf8'));
    } catch {
      return { state: 'error', reason: 'desktop-authority-summary-shape-invalid' };
    }
    return { state: 'ok', value };
  } catch (error) {
    return {
      state: 'error',
      reason: error?.code === 'ENOENT'
        ? 'desktop-authority-summary-missing'
        : 'desktop-authority-summary-unreadable',
    };
  }
}

async function queryFixedRuntimeService() {
  if (process.platform !== 'win32') return { status: 'unsupported' };
  const pnpmBin = 'pnpm.cmd';
  const result = await collectCommandResult(pnpmBin, ['--silent', 'status:dev-kernel-service-candidate'], {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  if (result.error || result.status !== 0) return { status: 'error' };
  return parseEmbeddedJson(result.stdout);
}

async function queryProcessRows() {
  if (process.platform !== 'win32') return [];
  const command = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress';
  const result = await collectCommandResult('powershell.exe', ['-NoProfile', '-Command', command], {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  if (result.error || result.status !== 0) return [];
  try {
    return JSON.parse(String(result.stdout || '[]'));
  } catch {
    return [];
  }
}

function collectCommandResult(command, args, options) {
  const { encoding = 'utf8', ...spawnOptions } = options;
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnCommand(command, args, spawnOptions);
    } catch (error) {
      resolve({ error, status: null, signal: null, stdout: '', stderr: '' });
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    child.stdout?.setEncoding(encoding);
    child.stderr?.setEncoding(encoding);
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve({ ...result, stdout, stderr });
    };
    child.once('error', (error) => finish({ error, status: null, signal: null }));
    child.once('close', (status, signal) => finish({ status, signal }));
  });
}

function parseEmbeddedJson(output) {
  const text = String(output || '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) return { status: 'error' };
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return { status: 'error' };
  }
}

function printHumanReport(report) {
  for (const row of report.tier1) {
    process.stdout.write(`[${row.state === 'ok' ? 'ok' : 'error'}] ${row.id}: ${row.reason}\n`);
  }
  for (const row of report.tier2) {
    process.stdout.write(`[${row.state}] ${row.id}: ${row.reason}\n`);
  }
  process.stdout.write(`Tier-1: ${report.ok ? 'ready' : 'not-ready'}\n`);
}

function isMainModule() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  const report = await runDevDoctor();
  if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else printHumanReport(report);
  if (!report.ok) process.exitCode = 1;
}
