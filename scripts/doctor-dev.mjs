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
import { resolveWindowsPowerShell7 } from './lib/windows-powershell.mjs';
import { readDevelopmentRealm, parseRealmArguments } from './lib/development-realm.mjs';
import { probeSourceRuntime } from './lib/desktop-dev-dependencies.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRESENCE_MAX_AGE_MS = 12_000;

export function validateLocalDevelopmentPresence(value, nowUnixMs = Date.now()) {
  const expectedKeys = [
    'callerToken', 'desktopAppId', 'desktopPid', 'endpoint', 'lastHeartbeatAt', 'schemaVersion', 'startedAt',
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
    || typeof value.callerToken !== 'string'
    || !/^[0-9a-f]{64}$/u.test(value.callerToken)
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
    && status?.signatureStatus === 'Valid'
    && /^runtime-[0-9a-f]{32}$/u.test(status?.runtimeCandidateId ?? '');
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
  const selectedRealm = readDevelopmentRealm(repoRoot, input.realm, input.env);
  const host = input.host ?? 'source';
  if (!['installed', 'source'].includes(host)) throw new Error('Host must be installed or source.');
  const platform = input.platform ?? process.platform;
  const nowUnixMs = input.nowUnixMs ?? Date.now();
  const probeHttp = input.probeHttp ?? probeHttpEndpoint;
  const queryProcesses = input.queryProcesses ?? (() => queryProcessRows(platform));
  const readPresence = input.readPresence ?? readPresenceDescriptor;
  const processRowsPromise = queryProcesses();
  const serviceResultPromise = input.queryService
    ? input.queryService()
    : host === 'source'
      ? probeSourceRuntime(repoRoot, selectedRealm.name).then((value) => ({ state: value.state === 'ready' ? 'ok' : 'error', reason: `source-runtime-${value.state}` })).catch((error) => ({ state: 'error', reason: error.message }))
      : platform === 'darwin'
        ? queryMacFixedRuntimeService(selectedRealm.name)
        : queryWindowsFixedRuntimeService(platform);
  const [serviceResult, processRows, realm, web, presenceResult] = await Promise.all([
    serviceResultPromise,
    processRowsPromise,
    probeHttp(selectedRealm.apiOrigin),
    probeHttp(selectedRealm.webOrigin),
    readPresence(nowUnixMs),
  ]);
  const service = host === 'installed' && platform !== 'darwin'
    ? validateFixedRuntimeService(serviceResult)
    : serviceResult;
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
    { id: host === 'source' ? 'source-runtime' : 'fixed-runtime-service', ...service },
    { id: 'desktop-presence', ...presenceResult },
    {
      id: 'legacy-carriers',
      state: !Array.isArray(processRows) ? 'not-observed' : legacyCarriers.length === 0 ? 'ok' : 'error',
      reason: !Array.isArray(processRows) ? 'process-inventory-unavailable' : legacyCarriers.length === 0 ? 'no-legacy-carriers' : 'legacy-carriers-running',
      processIds: legacyCarriers.map((row) => row.processId),
    },
    { id: 'sdk-kit-dist', ...workspaceSurfaces },
  ];
  return {
    schemaVersion: 'nimi.dev-doctor/v1',
    host,
    realm: { name: selectedRealm.name, origin: selectedRealm.apiOrigin },
    checkedAt: new Date(nowUnixMs).toISOString(),
    ok: tier1.every((row) => row.state === 'ok'),
    tier1,
    tier2: [
      ...unobservedLocalDevelopmentFacts(),
      ...(platform === 'darwin' ? [{
        id: 'protected-runtime-health',
        state: 'not-observed',
        reason: 'process-and-socket-observation-does-not-prove-native-peer-trust-or-runtime-readiness',
      }] : []),
    ],
  };
}

function unobservedLocalDevelopmentFacts() {
  return [
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
  ];
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

async function queryWindowsFixedRuntimeService(platform) {
  if (platform !== 'win32') return { status: 'unsupported' };
  const installerPath = path.join(
    repoRoot,
    'dist',
    'windows-runtime-service-installer',
    'install-nimi-runtime.ps1',
  );
  const result = await collectCommandResult(resolveWindowsPowerShell7(), [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    installerPath,
    '-Mode',
    'Status',
    '-Json',
  ], {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  if (result.error || result.status !== 0) return { status: 'error' };
  return parseEmbeddedJson(result.stdout);
}

async function queryMacFixedRuntimeService(realm) {
  const daemon = realm === 'local'
    ? 'apps/desktop/macos/generated/ai.nimi.runtime.dev.plist'
    : 'apps/desktop/macos/LaunchDaemons/ai.nimi.runtime.plist';
  const options = { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] };
  const profile = await collectCommandResult('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '--', daemon], options);
  if (profile.error || profile.status !== 0) {
    return { state: 'not-observed', reason: 'fixed-runtime-service-profile-unavailable' };
  }
  const plist = JSON.parse(profile.stdout);
  const job = await collectCommandResult('/bin/launchctl', ['print', `system/${plist.Label}`], options);
  return inspectMacFixedRuntimeService(job, plist);
}

// The on-demand daemon can be ready for launch without a Runtime process.
// Protected peer trust and Runtime readiness are established by Home.
export async function inspectMacFixedRuntimeService(job, plist, readSocket = lstat) {
  if (job.status === 113) return { state: 'error', reason: 'fixed-runtime-service-not-registered' };
  if (job.error || job.status !== 0) return { state: 'not-observed', reason: 'fixed-runtime-service-query-unavailable' };

  const { stdout } = job;
  const program = /^\t(?:program|program identifier) = (.*?)(?: \(mode: \d+\))?$/mu.exec(stdout)?.[1];
  const user = /^\tusername = (.+)$/mu.exec(stdout)?.[1];
  const group = /^\tgroup = (.+)$/mu.exec(stdout)?.[1];
  if (program !== (plist.BundleProgram ?? plist.ProgramArguments[0]) || user !== plist.UserName || group !== plist.GroupName) {
    return { state: 'error', reason: 'fixed-runtime-service-profile-mismatch' };
  }

  const registeredPaths = new Set(Array.from(stdout.matchAll(/^\t{3}path = (.+)$/gmu), (match) => match[1]));
  const sockets = await Promise.all(Object.values(plist.Sockets).map(async ({ SockPathName }) =>
    registeredPaths.has(SockPathName) && (await readSocket(SockPathName).catch(() => null))?.isSocket()));
  if (!sockets.every(Boolean)) return { state: 'error', reason: 'fixed-runtime-service-sockets-missing' };

  const launchdState = /^\tstate = (.+)$/mu.exec(stdout)?.[1];
  if (launchdState === 'running') return { state: 'ok', reason: 'fixed-runtime-service-running' };
  if (launchdState === 'not running') return { state: 'ok', reason: 'fixed-runtime-service-on-demand' };
  return { state: 'error', reason: 'fixed-runtime-service-not-ready' };
}

export function parseMacProcessRows(output) {
  const rows = [];
  for (const line of String(output).split('\n').filter((value) => value.trim())) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/u.exec(line);
    if (!match) return null;
    rows.push({
      processId: Number(match[1]), parentProcessId: Number(match[2]),
      name: path.basename(match[3]), executablePath: match[3],
    });
  }
  return rows.length > 0 ? rows : null;
}

// This is an observation of the source development topology. Native admission
// and Runtime readiness remain with their owners, not this diagnostic command.
export async function inspectMacSourceRuntime(rows, root, querySockets = queryMacProcessSockets) {
  if (!Array.isArray(rows)) return { state: 'not-observed', reason: 'process-inventory-unavailable' };
  const processes = normalizedProcessRows(rows);
  const candidates = processes.filter((row) => row.name === 'nimi-runtime'
    && row.executablePath.startsWith(`${path.posix.resolve(root)}/`)
    && processes.some((parent) => parent.processId === row.parentProcessId
      && parent.name === 'nimi-source-runtime-supervisor'));
  if (candidates.length !== 1) return {
    state: 'error',
    reason: candidates.length === 0 ? 'source-runtime-not-observed' : 'source-runtime-process-ambiguous',
  };
  const processId = candidates[0].processId;
  const sockets = await querySockets(processId);
  if (!Array.isArray(sockets)) return { state: 'not-observed', reason: 'runtime-sockets-unavailable', processId };
  const present = ['runtime-desktop.sock', 'runtime-local-app.sock']
    .every((name) => sockets.some((socket) => path.posix.basename(socket) === name));
  return {
    state: present ? 'ok' : 'error',
    reason: present ? 'source-runtime-process-and-sockets-observed' : 'source-runtime-sockets-missing',
    processId,
  };
}

async function queryMacProcessSockets(processId) {
  const result = await collectCommandResult('/usr/sbin/lsof', ['-nP', '-a', '-p', String(processId), '-U', '-Fn'], {
    cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) return null;
  return result.stdout.split('\n').filter((line) => line.startsWith('n')).map((line) => line.slice(1));
}

async function queryProcessRows(platform = process.platform) {
  if (platform === 'darwin') {
    const result = await collectCommandResult('/bin/ps', ['-axo', 'pid=,ppid=,comm='], {
      cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'],
    });
    return result.error || result.status !== 0 ? null : parseMacProcessRows(result.stdout);
  }
  if (platform !== 'win32') return null;
  const command = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress';
  const result = await collectCommandResult('powershell.exe', ['-NoProfile', '-Command', command], {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  if (result.error || result.status !== 0) return null;
  try {
    return JSON.parse(String(result.stdout || '[]'));
  } catch {
    return null;
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
    process.stdout.write(`[${row.state}] ${row.id}: ${row.reason}\n`);
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
  const { realm, rest } = parseRealmArguments(process.argv.slice(2));
  const hostIndex = rest.indexOf('--host');
  const host = hostIndex === -1 ? 'source' : rest[hostIndex + 1];
  if (!['source', 'installed'].includes(host)) throw new Error('--host requires installed or source.');
  const report = await runDevDoctor({ realm, host });
  if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else printHumanReport(report);
  if (!report.ok) process.exitCode = 1;
}
