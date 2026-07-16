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
const TIER_2_PLACEHOLDER = 'bounded projection 未准入';

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
  const serviceResultPromise = queryService();
  const processRowsPromise = queryProcesses();
  const [serviceResult, processRows, realm, web, presenceResult] = await Promise.all([
    serviceResultPromise,
    processRowsPromise,
    probeHttp('http://127.0.0.1:3002'),
    probeHttp('http://127.0.0.1:3000'),
    readPresence(nowUnixMs),
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
  const tier2 = ['developer-mode', 'project-authorization', 'grant-summary'].map((id) => ({
    id,
    state: 'unavailable',
    reason: TIER_2_PLACEHOLDER,
  }));
  return {
    schemaVersion: 'nimi.dev-doctor/v1',
    checkedAt: new Date(nowUnixMs).toISOString(),
    ok: tier1.every((row) => row.state === 'ok'),
    tier1,
    tier2,
  };
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
    process.stdout.write(`[unavailable] ${row.id}: ${row.reason}\n`);
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
