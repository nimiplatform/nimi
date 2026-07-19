import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { lstat, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DESKTOP_APP = '/Applications/Nimi Dev.app';
const DESKTOP_EXECUTABLE = `${DESKTOP_APP}/Contents/MacOS/Nimi Dev`;
const HOST_APP = `${DESKTOP_APP}/Contents/Frameworks/Nimi Local App Host Dev.app`;
const HOST_EXECUTABLE = `${HOST_APP}/Contents/MacOS/Nimi Local App Host Dev`;
const RUNTIME_EXECUTABLE = '/Library/Application Support/Nimi/RuntimeDev/active/bin/nimi-runtime';
const LAUNCH_DAEMON = '/Library/LaunchDaemons/ai.nimi.runtime.dev.plist';
const SOCKETS = [
  '/private/var/run/nimi-dev/runtime-desktop.sock',
  '/private/var/run/nimi-dev/runtime-local-app.sock',
];

export async function captureSigningEvidence(runtimeStatus) {
  const roles = {};
  for (const [role, target, executable, deep] of [
    ['runtime', RUNTIME_EXECUTABLE, RUNTIME_EXECUTABLE, false],
    ['desktop', DESKTOP_APP, DESKTOP_EXECUTABLE, true],
    ['localAppHost', HOST_APP, HOST_EXECUTABLE, true],
  ]) {
    roles[role] = await codeEvidence(target, executable, deep);
  }
  const gatekeeper = fixedCommand('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=4', DESKTOP_APP]);
  return Object.freeze({
    schemaVersion: 'nimi.macos-dev-chain-signing/v1',
    capturedAt: new Date().toISOString(),
    profile: 'macos_local_development_v1',
    identityClass: 'local_ca',
    roles,
    helperStatusProjection: runtimeStatus,
    gatekeeper: {
      exitCode: gatekeeper.status,
      output: `${gatekeeper.stdout}\n${gatekeeper.stderr}`.trim().slice(0, 8000),
      expectedNonNotarizedRejection: gatekeeper.status !== 0,
      productGatePassed: false,
    },
    productionAdmission: false,
    notarization: 'not_present_expected_for_non_product_profile',
    passed: Object.values(roles).every((row) => row.verifyPassed && row.arm64Native
      && row.hardenedRuntime && row.teamIdentifierAbsent && row.designatedRequirement.length > 0)
      && gatekeeper.status !== 0,
  });
}

export async function captureLaunchdAndSocketEvidence(runtimeStatus) {
  const launchd = fixedCommand('/bin/launchctl', ['print', 'system/ai.nimi.runtime.dev']);
  const daemonMetadata = await pathMetadata(LAUNCH_DAEMON, 'file');
  const sockets = [];
  for (const socket of SOCKETS) sockets.push(await pathMetadata(socket, 'socket'));
  const runtimePid = Number(runtimeStatus?.runtimePID || runtimeStatus?.runtimePid || runtimeStatus?.processId || 0);
  const runtimeProcess = runtimePid > 0 ? processIdentity(runtimePid) : null;
  return Object.freeze({
    schemaVersion: 'nimi.macos-dev-chain-launchd/v1',
    capturedAt: new Date().toISOString(),
    label: 'ai.nimi.runtime.dev',
    launchd: {
      exitCode: launchd.status,
      projection: `${launchd.stdout}\n${launchd.stderr}`.slice(0, 30_000),
    },
    daemonMetadata,
    sockets,
    runtimeProcess,
    status: runtimeStatus,
    passed: launchd.status === 0 && daemonMetadata.owner === 0 && daemonMetadata.group === 0
      && daemonMetadata.mode === 0o644
      && sockets.every((row) => row.kind === 'socket' && row.owner === 0 && row.group === 20 && row.mode === 0o660)
      && runtimeStatus?.runtimeProcessTrusted === true,
  });
}

export async function captureRealmConnectivity() {
  const api = await fetchEvidence('http://127.0.0.1:3002/api/auth/jwks', (body) => Array.isArray(body?.keys) && body.keys.length > 0);
  const web = await fetchEvidence('http://127.0.0.1:3000/', () => true);
  const realtime = await fetchEvidence(
    'http://127.0.0.1:3003/socket.io/?EIO=4&transport=polling',
    (body) => typeof body === 'string' && /^0\{"sid":"[^"]+"/u.test(body),
  );
  return Object.freeze({
    api,
    web,
    realtime,
    passed: api.passed && web.passed && realtime.passed,
  });
}

export async function inspectZhiyuSQLite(userDataRoot) {
  const databasePath = path.join(userDataRoot, 'app-owned', 'v1', 'zhiyu.sqlite3');
  const metadata = await stat(databasePath);
  const query = "SELECT (SELECT value FROM app_meta WHERE key='app_id') || '|' || (SELECT value FROM app_meta WHERE key='boot_count') || '|' || (SELECT user_version FROM pragma_user_version);";
  const result = fixedCommand('/usr/bin/sqlite3', ['-readonly', databasePath, query]);
  if (result.status !== 0) throw new Error(`Zhiyu app-owned SQLite inspection failed: ${result.stderr}`);
  const [appId, bootCount, schemaVersion] = result.stdout.trim().split('|');
  return Object.freeze({
    databasePath,
    appId,
    bootCount: Number(bootCount),
    schemaVersion: Number(schemaVersion),
    mode: metadata.mode & 0o777,
    uid: metadata.uid,
    sizeBytes: metadata.size,
    passed: appId === 'nimi.zhiyu' && Number(bootCount) >= 1 && Number(schemaVersion) >= 1
      && metadata.uid === process.getuid?.() && (metadata.mode & 0o077) === 0,
  });
}

export async function exerciseViteHMR(page, evidenceRoot, label) {
  const probe = path.join(evidenceRoot, `hmr-${label}.mjs`);
  const globalName = `__NIMI_ACCEPTANCE_HMR_${label.toUpperCase()}__`;
  await writeHMRProbe(probe, globalName, 1);
  const importUrl = `/@fs/${probe}?acceptance=${Date.now()}`;
  const initial = await page.evaluate(async ({ url, key }) => {
    await import(url);
    return globalThis[key];
  }, { url: importUrl, key: globalName });
  await writeHMRProbe(probe, globalName, 2, false);
  const deadline = Date.now() + 20_000;
  let updated = initial;
  while (Date.now() < deadline) {
    updated = await page.evaluate((key) => globalThis[key], globalName);
    if (updated === 2) break;
    await delay(250);
  }
  return Object.freeze({ probe, initial, updated, passed: initial === 1 && updated === 2 });
}

export function processIdentity(pid) {
  const output = fixedOutput('/bin/ps', ['-p', String(pid), '-o', 'pid=,ppid=,uid=,lstart=,command=']);
  const match = output.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\w+\s+\w+\s+\d+\s+\d+:\d+:\d+\s+\d+)\s+(.+)$/u);
  if (!match) throw new Error(`Cannot parse process identity for pid ${pid}`);
  return Object.freeze({ pid: Number(match[1]), ppid: Number(match[2]), uid: Number(match[3]), startedAt: match[4], command: match[5] });
}

async function codeEvidence(target, executable, deep) {
  const canonical = await realpath(target);
  if (canonical !== target) throw new Error(`signed target is not canonical: ${target}`);
  const verify = fixedCommand('/usr/bin/codesign', ['--verify', ...(deep ? ['--deep'] : []), '--strict', '--verbose=4', target]);
  const display = fixedCommand('/usr/bin/codesign', ['--display', '--verbose=4', target]);
  const requirement = fixedCommand('/usr/bin/codesign', ['--display', '--requirements', '-', target]);
  const entitlements = fixedCommand('/usr/bin/codesign', ['--display', '--entitlements', ':-', target]);
  const canonicalExecutable = await realpath(executable);
  if (canonicalExecutable !== executable || !(await lstat(executable)).isFile()) throw new Error(`signed executable is not canonical: ${executable}`);
  const architecture = fixedCommand('/usr/bin/lipo', ['-archs', executable]);
  const bytes = await readFile(executable);
  const output = `${display.stdout}\n${display.stderr}`;
  return Object.freeze({
    target,
    executable,
    verifyPassed: verify.status === 0,
    verifyOutput: `${verify.stdout}\n${verify.stderr}`.trim().slice(0, 8000),
    display: output.trim().slice(0, 12_000),
    designatedRequirement: `${requirement.stdout}\n${requirement.stderr}`.trim().slice(0, 8000),
    entitlements: `${entitlements.stdout}\n${entitlements.stderr}`.trim().slice(0, 20_000),
    architectures: architecture.stdout.trim().split(/\s+/u).filter(Boolean),
    arm64Native: architecture.status === 0 && architecture.stdout.trim().split(/\s+/u).includes('arm64'),
    hardenedRuntime: /flags=.*runtime/iu.test(output),
    teamIdentifierAbsent: /TeamIdentifier=not set/iu.test(output),
    cdHash: output.match(/CDHash=([0-9a-f]+)/iu)?.[1] ?? '',
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
}

async function pathMetadata(target, expectedKind) {
  const metadata = await lstat(target);
  const canonical = await realpath(target);
  const kind = metadata.isSocket() ? 'socket' : metadata.isFile() ? 'file' : metadata.isDirectory() ? 'directory' : 'other';
  if (canonical !== target || metadata.isSymbolicLink() || kind !== expectedKind) throw new Error(`unsafe fixed-path metadata: ${target}`);
  return Object.freeze({ path: target, kind, owner: metadata.uid, group: metadata.gid, mode: metadata.mode & 0o777, inode: metadata.ino });
}

async function fetchEvidence(url, validate) {
  try {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(5_000) });
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    return Object.freeze({ url, status: response.status, passed: response.ok && validate(body), bodyDigest: createHash('sha256').update(text).digest('hex') });
  } catch (error) {
    return Object.freeze({ url, passed: false, error: error instanceof Error ? error.message : String(error) });
  }
}

async function writeHMRProbe(file, key, version, exclusive = true) {
  const source = [
    `globalThis[${JSON.stringify(key)}] = ${version};`,
    'if (import.meta.hot) import.meta.hot.accept();',
    '',
  ].join('\n');
  await writeFile(file, source, { encoding: 'utf8', flag: exclusive ? 'wx' : 'w', mode: 0o600 });
}

function fixedOutput(command, args) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function fixedCommand(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { status: result.status ?? -1, stdout: String(result.stdout || ''), stderr: String(result.stderr || '') };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
