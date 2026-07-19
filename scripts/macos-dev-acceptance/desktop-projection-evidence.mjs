import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';

const PROJECTIONS = Object.freeze({
  localDevelopmentPresence: Object.freeze({
    relativePath: path.join('.nimi', 'run', 'desktop', 'local-development', 'presence.v1.json'),
    exactKeys: Object.freeze([
      'desktopAppId',
      'desktopPid',
      'endpoint',
      'lastHeartbeatAt',
      'schemaVersion',
      'startedAt',
    ]),
    pidKey: 'desktopPid',
    endpoint: true,
  }),
  localDevelopmentAuthoritySummary: Object.freeze({
    relativePath: path.join('.nimi', 'run', 'desktop', 'local-development', 'authority-summary.v1.json'),
    exactKeys: Object.freeze([
      'capturedAt',
      'desktopAppId',
      'desktopPid',
      'developerMode',
      'projectAuthorization',
      'schemaVersion',
    ]),
    pidKey: 'desktopPid',
    endpoint: false,
  }),
  desktopOpenIntentPresence: Object.freeze({
    relativePath: path.join('.nimi', 'run', 'desktop', 'open-intent', 'presence.v1.json'),
    exactKeys: Object.freeze([
      'bridgeId',
      'desktopAppId',
      'endpoint',
      'lastHeartbeatAt',
      'pid',
      'schemaVersion',
      'startedAt',
      'token',
    ]),
    pidKey: 'pid',
    endpoint: true,
    secretToken: true,
  }),
});

export async function captureDesktopProjectionSet(input = {}) {
  const homeDirectory = requireHomeDirectory(input.homeDirectory);
  const rows = Object.fromEntries(await Promise.all(Object.entries(PROJECTIONS).map(async ([name, contract]) => [
    name,
    await inspectProjection(path.join(homeDirectory, contract.relativePath), contract),
  ])));
  const pids = Object.values(rows).map((row) => row.desktopPid);
  const expectedDesktopPid = input.expectedDesktopPid;
  const oneLiveDesktopProcess = pids.every((pid) => pid === pids[0])
    && pids[0] > 0
    && processIsLive(pids[0])
    && (expectedDesktopPid === undefined || pids[0] === expectedDesktopPid);
  return Object.freeze({
    schemaVersion: 'nimi.desktop-projection-evidence/v1',
    rows,
    oneLiveDesktopProcess,
    passed: oneLiveDesktopProcess && Object.values(rows).every((row) => row.passed),
  });
}

export async function captureDesktopProjectionAbsence(input = {}) {
  const homeDirectory = requireHomeDirectory(input.homeDirectory);
  const rows = Object.fromEntries(await Promise.all(Object.entries(PROJECTIONS).map(async ([name, contract]) => {
    const projectionPath = path.join(homeDirectory, contract.relativePath);
    const metadata = await lstat(projectionPath).catch((error) => {
      if (error?.code === 'ENOENT') return undefined;
      throw error;
    });
    return [name, Object.freeze({ path: projectionPath, absent: metadata === undefined })];
  })));
  return Object.freeze({
    schemaVersion: 'nimi.desktop-projection-absence/v1',
    rows,
    passed: Object.values(rows).every((row) => row.absent),
  });
}

async function inspectProjection(projectionPath, contract) {
  const metadata = await lstat(projectionPath);
  const value = requireRecord(JSON.parse(await readFile(projectionPath, 'utf8')));
  const exactKeys = Object.keys(value).sort().join('|') === [...contract.exactKeys].sort().join('|');
  const desktopPid = Number(value[contract.pidKey]);
  const base = {
    path: projectionPath,
    regularFile: metadata.isFile(),
    symbolicLink: metadata.isSymbolicLink(),
    owner: metadata.uid,
    group: metadata.gid,
    mode: metadata.mode & 0o777,
    exactKeys,
    schemaVersion: value.schemaVersion,
    desktopAppId: value.desktopAppId,
    desktopPid,
  };
  const endpoint = contract.endpoint ? inspectLoopbackEndpoint(value.endpoint) : undefined;
  const heartbeat = inspectHeartbeat(value.lastHeartbeatAt ?? value.capturedAt);
  const token = contract.secretToken ? Object.freeze({
    present: typeof value.token === 'string' && value.token.length > 0,
    length: typeof value.token === 'string' ? value.token.length : 0,
    redacted: true,
  }) : undefined;
  const bridgeIdValid = contract.secretToken
    ? /^desktop-open-bridge-[A-Za-z0-9_-]{20,}$/u.test(String(value.bridgeId || ''))
    : true;
  const authorityShapeValid = contract.endpoint ? true : validAuthoritySummary(value);
  const passed = base.regularFile
    && !base.symbolicLink
    && base.owner === process.getuid?.()
    && base.mode === 0o600
    && exactKeys
    && value.schemaVersion === 1
    && value.desktopAppId === 'nimi.desktop'
    && Number.isSafeInteger(desktopPid)
    && desktopPid > 0
    && heartbeat.valid
    && heartbeat.fresh
    && (!endpoint || endpoint.passed)
    && (!token || (token.present && token.length === 43))
    && bridgeIdValid
    && authorityShapeValid;
  return Object.freeze({
    ...base,
    heartbeat,
    ...(endpoint ? { endpoint } : {}),
    ...(token ? { token } : {}),
    ...(contract.secretToken ? { bridgeIdValid } : {}),
    ...(contract.endpoint ? {} : { authorityShapeValid }),
    passed,
  });
}

function inspectLoopbackEndpoint(value) {
  try {
    const endpoint = new URL(String(value));
    const port = Number(endpoint.port);
    const passed = endpoint.protocol === 'http:'
      && endpoint.hostname === '127.0.0.1'
      && endpoint.username === ''
      && endpoint.password === ''
      && endpoint.pathname === '/'
      && endpoint.search === ''
      && endpoint.hash === ''
      && Number.isSafeInteger(port)
      && port > 0
      && port <= 65_535;
    return Object.freeze({
      protocol: endpoint.protocol,
      hostname: endpoint.hostname,
      port,
      path: endpoint.pathname,
      passed,
    });
  } catch {
    return Object.freeze({ protocol: '', hostname: '', port: 0, path: '', passed: false });
  }
}

function inspectHeartbeat(value) {
  const capturedAtMs = Date.parse(String(value || ''));
  const ageMs = Date.now() - capturedAtMs;
  return Object.freeze({
    valid: Number.isFinite(capturedAtMs),
    ageMs: Number.isFinite(ageMs) ? ageMs : null,
    fresh: Number.isFinite(ageMs) && ageMs >= -5_000 && ageMs <= 15_000,
  });
}

function validAuthoritySummary(value) {
  const developerMode = requireRecordOrUndefined(value.developerMode);
  const projectAuthorization = requireRecordOrUndefined(value.projectAuthorization);
  return developerMode !== undefined
    && projectAuthorization !== undefined
    && ['available', 'unavailable'].includes(developerMode.availability)
    && ['enabled', 'disabled', 'unavailable'].includes(developerMode.state)
    && ['available', 'unavailable'].includes(projectAuthorization.availability)
    && ['activeCount', 'deniedCount', 'revokedCount'].every((key) => (
      Number.isSafeInteger(projectAuthorization[key]) && projectAuthorization[key] >= 0
    ));
}

function processIsLive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function requireHomeDirectory(value) {
  const candidate = value ?? process.env.HOME;
  if (typeof candidate !== 'string' || candidate.length === 0) {
    throw new Error('desktop-projection-home-directory-invalid');
  }
  const resolved = path.resolve(candidate);
  if (!path.isAbsolute(resolved) || resolved === path.parse(resolved).root) {
    throw new Error('desktop-projection-home-directory-invalid');
  }
  return resolved;
}

function requireRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('desktop-projection-invalid');
  }
  return value;
}

function requireRecordOrUndefined(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}
