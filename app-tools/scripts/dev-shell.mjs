#!/usr/bin/env node

import { lstat, readFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { parse as parseYaml } from 'yaml';

const DESCRIPTOR_RELATIVE_PATH = ['.nimi', 'run', 'desktop', 'local-development', 'presence.v1.json'];
const MAX_HEARTBEAT_AGE_MS = 10_000;
const REQUEST_TIMEOUT_MS = 5_000;
const STATUS_POLL_MS = 350;
const TERMINAL_STATES = new Set([
  'denied',
  'failed',
  'project-changed',
  'revoked',
  'stopped',
]);

export async function runDevShell(cwd, options = {}) {
  const shell = normalizeShell(options.shell || 'electron');
  const cdpPort = normalizeCdpPort(options.cdpPort);
  assertLocalDevelopmentPlatform(process.platform, shell);
  const projectRoot = await canonicalProjectRoot(cwd, options.dir);
  const appId = await readAppId(projectRoot);
  const descriptorPath = options.descriptorPath
    ? path.resolve(options.descriptorPath)
    : path.join(homedir(), ...DESCRIPTOR_RELATIVE_PATH);
  const descriptor = await readPresenceDescriptor(descriptorPath, options.now?.() ?? Date.now());
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new DevShellError('local-development-launcher-unavailable', 'This Node.js runtime does not provide fetch.');
  }

  const startIntent = {
    schemaVersion: 1,
    appId,
    projectRoot,
    shell,
    ...(cdpPort === undefined ? {} : { cdpPort }),
  };
  const start = await postJson(fetchImpl, descriptor.endpoint, '/v1/start', startIntent);
  const initial = parseBridgeRun(start);
  if (!initial.runId) {
    throw bridgeError(start, initial);
  }
  const output = options.output ?? process.stdout;
  const errorOutput = options.errorOutput ?? process.stderr;
  const signal = options.signal;
  let lastState = '';
  let lastLogSequence = 0;
  let cancelling = false;

  const cancel = async () => {
    if (cancelling) return;
    cancelling = true;
    try {
      await postJson(fetchImpl, descriptor.endpoint, '/v1/cancel', {
        schemaVersion: 1,
        runId: initial.runId,
      });
    } catch {
      // Desktop owns final process cleanup. Signal handling never invents success.
    }
  };
  const removeSignalHandlers = installSignalHandlers(cancel, options.installSignalHandlers !== false);

  try {
    let current = initial;
    for (;;) {
      printStatusTransition(output, current, lastState);
      if (current.state !== lastState) lastState = current.state;
      lastLogSequence = printNewLogs(output, current, lastLogSequence);
      if (TERMINAL_STATES.has(current.state)) {
        if (current.state === 'stopped' && cancelling) return current;
        throw new DevShellError(
          current.reasonCode || `local-development-${current.state}`,
          current.message || `Nimi local development ended in state ${current.state}.`,
        );
      }
      if (signal?.aborted) {
        await cancel();
        return current;
      }
      await delay(STATUS_POLL_MS, signal);
      const response = await postJson(fetchImpl, descriptor.endpoint, '/v1/status', {
        schemaVersion: 1,
        runId: initial.runId,
      });
      current = parseBridgeRun(response);
    }
  } catch (error) {
    if (signal?.aborted) {
      await cancel();
      return initial;
    }
    const message = error instanceof Error ? error.message : String(error);
    errorOutput.write(`[nimi-app dev] ${message}\n`);
    throw error;
  } finally {
    removeSignalHandlers();
  }
}

export function assertLocalDevelopmentPlatform(platform, shell) {
  if (shell !== 'electron') {
    throw new DevShellError(
      'local-development-platform-unsupported',
      'Nimi local development accepts only the Desktop-supervised Electron carrier.',
    );
  }
  if (platform === 'win32' || platform === 'darwin') return;
  throw new DevShellError(
    'local-development-platform-unsupported',
    'Nimi protected local development is not admitted on this platform.',
  );
}

export class DevShellError extends Error {
  constructor(reasonCode, message) {
    super(message);
    this.name = 'DevShellError';
    this.reasonCode = reasonCode;
  }
}

async function canonicalProjectRoot(cwd, requestedDir) {
  const candidate = path.resolve(cwd, String(requestedDir || '.'));
  const canonical = await realpath(candidate).catch(() => null);
  if (!canonical) {
    throw new DevShellError('local-development-project-changed', `Project directory does not exist: ${candidate}`);
  }
  const metadata = await lstat(canonical);
  if (!metadata.isDirectory()) {
    throw new DevShellError('local-development-project-changed', `Project root is not a directory: ${candidate}`);
  }
  return canonical;
}

async function readAppId(projectRoot) {
  let raw;
  try {
    raw = await readFile(path.join(projectRoot, 'nimi.app.yaml'), 'utf8');
  } catch {
    throw new DevShellError('local-development-project-changed', 'nimi.app.yaml is required.');
  }
  let document;
  try {
    document = parseYaml(raw);
  } catch {
    throw new DevShellError('local-development-project-changed', 'nimi.app.yaml is not valid YAML.');
  }
  const appId = typeof document?.app_id === 'string' ? document.app_id : '';
  if (!isExactIdentifier(appId)) {
    throw new DevShellError('local-development-project-changed', 'nimi.app.yaml requires an exact app_id.');
  }
  return appId;
}

async function readPresenceDescriptor(descriptorPath, now) {
  try {
    await assertRegularFileWithoutSymlinkAncestry(descriptorPath);
    const raw = JSON.parse(await readFile(descriptorPath, 'utf8'));
    if (!isPlainObject(raw) || Object.keys(raw).sort().join(',') !== [
      'desktopAppId',
      'desktopPid',
      'endpoint',
      'lastHeartbeatAt',
      'schemaVersion',
      'startedAt',
    ].sort().join(',')) {
      throw new Error('shape');
    }
    if (raw.schemaVersion !== 1 || raw.desktopAppId !== 'nimi.desktop') throw new Error('identity');
    if (!Number.isSafeInteger(raw.desktopPid) || raw.desktopPid <= 0) throw new Error('pid');
    const heartbeat = Date.parse(requireText(raw.lastHeartbeatAt));
    if (!Number.isFinite(heartbeat) || now - heartbeat > MAX_HEARTBEAT_AGE_MS || heartbeat - now > 5_000) {
      throw new Error('heartbeat');
    }
    return { endpoint: normalizeLoopbackEndpoint(raw.endpoint) };
  } catch {
    throw new DevShellError(
      'local-development-desktop-not-running',
      'Nimi Desktop is not running. Open Nimi Desktop, sign in, and run this command again.',
    );
  }
}

async function assertRegularFileWithoutSymlinkAncestry(filePath) {
  const resolved = path.resolve(filePath);
  const parsed = path.parse(resolved);
  let current = parsed.root;
  for (const segment of path.relative(parsed.root, resolved).split(path.sep)) {
    if (!segment) continue;
    current = path.join(current, segment);
    const metadata = await lstat(current);
    if (metadata.isSymbolicLink()) throw new Error('symlink');
  }
  const metadata = await lstat(resolved);
  if (!metadata.isFile()) throw new Error('not-file');
}

async function postJson(fetchImpl, endpoint, route, body) {
  let response;
  try {
    response = await fetchImpl(`${endpoint}${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new DevShellError(
      'local-development-desktop-not-running',
      'The Nimi Desktop development supervisor is unavailable.',
    );
  }
  if (!response || response.status !== 200) {
    throw new DevShellError('local-development-launcher-unavailable', 'Nimi Desktop rejected the development intent transport.');
  }
  try {
    return await response.json();
  } catch {
    throw new DevShellError('local-development-launcher-unavailable', 'Nimi Desktop returned an invalid development response.');
  }
}

function parseBridgeRun(response) {
  if (!isPlainObject(response)) throw new DevShellError('local-development-launcher-unavailable', 'Invalid Desktop response.');
  if (response.status === 'error') {
    throw bridgeError(response, null);
  }
  const run = response.run;
  if (response.status !== 'ok' || !isPlainObject(run) || run.schemaVersion !== 1) {
    throw new DevShellError('local-development-launcher-unavailable', 'Invalid Desktop run status.');
  }
  const expectedKeys = [
    'appId',
    'canonicalProjectRoot',
    'displayName',
    'hostGeneration',
    'logSequence',
    'logs',
    'message',
    'rendererOrigin',
    'retryable',
    'runId',
    'schemaVersion',
    'shell',
    'state',
    ...(run.reasonCode === undefined ? [] : ['reasonCode']),
  ].sort();
  if (Object.keys(run).sort().join(',') !== expectedKeys.join(',')) {
    throw new DevShellError(
      'local-development-launcher-unavailable',
      'Desktop run status contains forbidden fields.',
    );
  }
  const state = requireText(run.state);
  const runId = requireText(run.runId);
  if (!isSelector(runId, 'dev-run') || !isExactIdentifier(run.appId) || run.shell !== 'electron') {
    throw new DevShellError('local-development-launcher-unavailable', 'Desktop run identity validation failed.');
  }
  const logs = Array.isArray(run.logs)
    ? run.logs.map((entry) => parseLog(entry)).filter(Boolean)
    : [];
  return {
    state,
    runId,
    appId: run.appId,
    shell: run.shell,
    message: requireText(run.message),
    reasonCode: typeof run.reasonCode === 'string' ? run.reasonCode : '',
    hostGeneration: Number.isSafeInteger(run.hostGeneration) ? run.hostGeneration : 0,
    logs,
  };
}

function parseLog(value) {
  if (!isPlainObject(value) || !Number.isSafeInteger(value.sequence) || value.sequence <= 0) return null;
  if (typeof value.stream !== 'string' || typeof value.message !== 'string') return null;
  return { sequence: value.sequence, stream: value.stream, message: value.message };
}

function bridgeError(response, run) {
  const reasonCode = typeof response?.reasonCode === 'string'
    ? response.reasonCode
    : run?.reasonCode || 'local-development-launcher-unavailable';
  return new DevShellError(reasonCode, `Nimi Desktop rejected local development (${reasonCode}).`);
}

function printStatusTransition(output, status, previousState) {
  if (status.state === previousState) return;
  const generation = status.hostGeneration > 0 ? ` · host ${status.hostGeneration}` : '';
  output.write(`[nimi-app dev] ${status.state}${generation}: ${status.message}\n`);
}

function printNewLogs(output, status, previousSequence) {
  let sequence = previousSequence;
  for (const entry of status.logs) {
    if (entry.sequence <= previousSequence) continue;
    sequence = Math.max(sequence, entry.sequence);
    if (entry.message) output.write(`[${entry.stream}] ${entry.message}\n`);
  }
  return sequence;
}

function installSignalHandlers(cancel, enabled) {
  if (!enabled) return () => {};
  const handlers = new Map();
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const handler = () => { void cancel(); };
    handlers.set(signal, handler);
    process.on(signal, handler);
  }
  return () => {
    for (const [signal, handler] of handlers) process.off(signal, handler);
  };
}

function normalizeShell(value) {
  if (value !== 'electron') {
    throw new DevShellError(
      'local-development-platform-unsupported',
      '--shell must be electron; Tauri is not an admitted local-development carrier.',
    );
  }
  return value;
}

function normalizeCdpPort(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const raw = typeof value === 'number' ? String(value) : value;
  if (typeof raw !== 'string'
    || raw.trim() !== raw
    || !/^(?:0|[1-9][0-9]*)$/u.test(raw)) {
    throw new DevShellError(
      'local-development-cdp-port-invalid',
      '--cdp-port must be a canonical decimal integer from 1024 through 65535.',
    );
  }
  const port = Number(raw);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
    throw new DevShellError(
      'local-development-cdp-port-invalid',
      '--cdp-port must be a canonical decimal integer from 1024 through 65535.',
    );
  }
  return port;
}

function normalizeLoopbackEndpoint(value) {
  const parsed = new URL(requireText(value));
  const hostname = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== 'http:'
    || !['127.0.0.1', '[::1]', '::1'].includes(hostname)
    || !parsed.port
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || (parsed.pathname !== '/' && parsed.pathname !== '')
  ) {
    throw new Error('endpoint');
  }
  return parsed.origin;
}

function isExactIdentifier(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 160
    && /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$/.test(value);
}

function isSelector(value, prefix) {
  return typeof value === 'string'
    && value.startsWith(`${prefix}-`)
    && value.length <= 160
    && /^[a-zA-Z0-9_-]+$/.test(value);
}

function requireText(value) {
  if (typeof value !== 'string' || !value || value.trim() !== value) throw new Error('text');
  return value;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function delay(ms, signal) {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms));
  return new Promise((resolve, reject) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
