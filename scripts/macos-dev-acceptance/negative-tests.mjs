import { execFileSync, spawnSync } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { chmod, cp, lstat, mkdir, open, realpath } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

import { REPO_ROOT } from './acceptance-contract.mjs';
import { connectObservedApplication, invokeBridge } from './browser-evidence.mjs';
import { AcceptanceProcessSupervisor, runBoundedCommand } from './process-supervisor.mjs';

const DESKTOP_APP = '/Applications/Nimi Dev.app';
const HOST_APP = `${DESKTOP_APP}/Contents/Frameworks/Nimi Local App Host Dev.app`;
const HOST_EXECUTABLE = `${HOST_APP}/Contents/MacOS/Nimi Local App Host Dev`;
const SIGNING_KEYCHAIN = '/Library/Application Support/Nimi/RuntimeDev/custody/local-development-signing.keychain-db';
const DESKTOP_SOCKET = '/private/var/run/nimi-dev/runtime-desktop.sock';
const LOCAL_APP_SOCKET = '/private/var/run/nimi-dev/runtime-local-app.sock';

export async function runMacOSNegativeTests(input) {
  const root = path.join(input.evidenceRoot, 'negative-fixtures');
  await mkdir(root, { mode: 0o700 });
  const [desktopSocket, localAppSocket, signedWrongRole, keychain, signingKeychain] = await Promise.all([
    ordinarySocketDenied(DESKTOP_SOCKET),
    ordinarySocketDenied(LOCAL_APP_SOCKET),
    signedWrongRoleDenied(LOCAL_APP_SOCKET, path.join(root, 'logs')),
    keychainNegativeProbe(root),
    signingKeychainNegativeRead(),
  ]);
  const carrier = await carrierNegatives(root, input);
  return Object.freeze({
    schemaVersion: 'nimi.macos-dev-chain-negative-tests/v1',
    capturedAt: new Date().toISOString(),
    desktopSocket,
    localAppSocket,
    signedWrongRole,
    keychain,
    signingKeychain,
    carrier,
    passed: desktopSocket.denied && localAppSocket.denied && signedWrongRole.denied && keychain.passed
      && signingKeychain.denied && carrier.passed,
  });
}

async function signedWrongRoleDenied(socketPath, logRoot) {
  const identity = fixedCommand('/usr/bin/codesign', ['--display', '--requirements', '-', '--verbose=4', '/usr/bin/nc']);
  if (identity.status !== 0) throw new Error(`Cannot inspect signed wrong-role probe: ${identity.stderr}`);
  const result = await runBoundedCommand({
    label: 'signed-wrong-role-nc',
    command: '/usr/bin/nc',
    args: ['-U', socketPath],
    cwd: REPO_ROOT,
    env: { LANG: 'en_US.UTF-8', PATH: '/usr/bin:/bin:/usr/sbin:/sbin', TMPDIR: '/private/tmp' },
    logRoot,
    timeoutMs: 8_000,
  });
  return Object.freeze({
    executable: '/usr/bin/nc',
    codeIdentity: `${identity.stdout}\n${identity.stderr}`.slice(-4000),
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    bytesReceived: Buffer.byteLength(result.stdout),
    diagnostic: result.stderr.slice(-2000),
    connectedThroughSocketVNode: result.exitCode === 0,
    denied: !result.timedOut && result.exitCode === 0 && Buffer.byteLength(result.stdout) === 0,
  });
}

export async function ordinarySocketDenied(socketPath) {
  const metadata = await lstat(socketPath);
  const canonical = await realpath(socketPath);
  if (!metadata.isSocket() || metadata.isSymbolicLink() || canonical !== socketPath) {
    throw new Error(`protected socket metadata is unsafe: ${socketPath}`);
  }
  return new Promise((resolve) => {
    const received = [];
    let connected = false;
    let finished = false;
    const socket = net.createConnection({ path: socketPath });
    const finish = (reason) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      resolve(Object.freeze({
        socketPath,
        connectedAtFilesystemLayer: connected,
        bytesReceived: Buffer.concat(received).length,
        terminalEvent: reason,
        denied: connected && Buffer.concat(received).length === 0 && ['close', 'end', 'reset'].includes(reason),
        owner: metadata.uid,
        group: metadata.gid,
        mode: metadata.mode & 0o777,
      }));
    };
    socket.setTimeout(4_000, () => finish('timeout'));
    socket.once('connect', () => { connected = true; });
    socket.on('data', (chunk) => received.push(Buffer.from(chunk)));
    socket.once('end', () => finish('end'));
    socket.once('close', () => finish('close'));
    socket.once('error', (error) => finish(error?.code === 'ECONNRESET' ? 'reset' : `error:${error?.code ?? 'unknown'}`));
  });
}

async function keychainNegativeProbe(root) {
  const source = path.join(REPO_ROOT, 'apps', 'desktop', 'macos', 'acceptance-probes', 'KeychainNegativeProbe.swift');
  const executable = path.join(root, 'keychain-negative-probe');
  const build = spawnSync('/usr/bin/xcrun', [
    'swiftc', '-O', '-target', 'arm64-apple-macos13.0', '-framework', 'Security', source, '-o', executable,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (build.error || build.status !== 0) throw new Error(`Keychain negative probe build failed: ${build.stderr || build.error?.message}`);
  await chmod(executable, 0o700);
  const identity = fixedCommand('/usr/bin/codesign', ['--display', '--verbose=4', executable]);
  const identityOutput = `${identity.stdout}\n${identity.stderr}`;
  const localCAIdentityAbsent = identity.status !== 0 || !/Authority=Nimi Local Development/u.test(identityOutput);
  const result = spawnSync(executable, [], {
    encoding: 'utf8',
    env: { HOME: process.env.HOME, LANG: 'en_US.UTF-8', PATH: '/usr/bin:/bin:/usr/sbin:/sbin', TMPDIR: '/private/tmp' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let report;
  try {
    report = JSON.parse(String(result.stdout || '').trim());
  } catch {
    throw new Error(`Keychain negative probe returned invalid JSON: ${String(result.stderr || '').slice(0, 1000)}`);
  }
  if (result.status !== 0 || report?.schemaVersion !== 'nimi.macos-keychain-negative-probe/v1'
    || report.passed !== true || !localCAIdentityAbsent) {
    throw new Error('Ordinary untrusted Keychain probe obtained protected secret data or inherited a trusted identity');
  }
  return Object.freeze({
    ...report,
    codeIdentity: identityOutput.slice(-4000),
    localCAIdentityAbsent,
  });
}

async function signingKeychainNegativeRead() {
  const metadata = await lstat(SIGNING_KEYCHAIN);
  let denied = false;
  let errorCode = '';
  try {
    const handle = await open(SIGNING_KEYCHAIN, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    await handle.close();
  } catch (error) {
    errorCode = error?.code ?? '';
    denied = ['EACCES', 'EPERM'].includes(errorCode);
  }
  return Object.freeze({
    path: SIGNING_KEYCHAIN,
    owner: metadata.uid,
    group: metadata.gid,
    mode: metadata.mode & 0o777,
    regularFile: metadata.isFile(),
    readErrorCode: errorCode,
    denied: denied && metadata.uid === 0 && metadata.gid === 0 && (metadata.mode & 0o777) === 0o600,
  });
}

async function carrierNegatives(root, input) {
  const copiedApp = path.join(root, 'Copied Local App Host Dev.app');
  await cp(HOST_APP, copiedApp, { recursive: true, verbatimSymlinks: true });
  const copiedExecutable = path.join(copiedApp, 'Contents', 'MacOS', 'Nimi Local App Host Dev');
  const copyVerify = fixedCommand('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=4', copiedApp]);
  const copiedLaunch = await runBoundedCommand({
    label: 'copied-host',
    command: copiedExecutable,
    args: [],
    cwd: input.zhiyuRoot,
    env: safeHostEnvironment(),
    logRoot: path.join(root, 'logs'),
    timeoutMs: 10_000,
  });

  const modifiedApp = path.join(root, 'Modified Local App Host Dev.app');
  await cp(HOST_APP, modifiedApp, { recursive: true, verbatimSymlinks: true });
  const modifiedExecutable = path.join(modifiedApp, 'Contents', 'MacOS', 'Nimi Local App Host Dev');
  const modifiedHandle = await open(modifiedExecutable, fsConstants.O_WRONLY | fsConstants.O_APPEND | fsConstants.O_NOFOLLOW);
  await modifiedHandle.write(Buffer.from([0]));
  await modifiedHandle.close();
  const modifiedVerify = fixedCommand('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=4', modifiedApp]);

  const adHocApp = path.join(root, 'Ad Hoc Local App Host Dev.app');
  await cp(HOST_APP, adHocApp, { recursive: true, verbatimSymlinks: true });
  const adHocSign = fixedCommand('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', adHocApp]);
  const adHocIdentity = fixedCommand('/usr/bin/codesign', ['--display', '--verbose=4', adHocApp]);
  const adHocLaunch = await runBoundedCommand({
    label: 'ad-hoc-host',
    command: path.join(adHocApp, 'Contents', 'MacOS', 'Nimi Local App Host Dev'),
    args: [],
    cwd: input.zhiyuRoot,
    env: safeHostEnvironment(),
    logRoot: path.join(root, 'logs'),
    timeoutMs: 10_000,
  });

  const unsignedApp = path.join(root, 'Unsigned Local App Host Dev.app');
  await cp(HOST_APP, unsignedApp, { recursive: true, verbatimSymlinks: true });
  const unsignedExecutable = path.join(unsignedApp, 'Contents', 'MacOS', 'Nimi Local App Host Dev');
  const removeSignature = fixedCommand('/usr/bin/codesign', ['--remove-signature', unsignedApp]);
  const unsignedVerify = fixedCommand('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=4', unsignedApp]);
  const unsignedLaunch = spawnSync(unsignedExecutable, [], {
    cwd: input.zhiyuRoot,
    encoding: 'utf8',
    env: safeHostEnvironment(),
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10_000,
  });

  const acceptanceRoot = path.join(root, 'unsupervised-acceptance');
  const userData = path.join(acceptanceRoot, 'zhiyu-user-data');
  await mkdir(userData, { recursive: true, mode: 0o700 });
  const unsupervisedPort = input.unsupervisedCDPPort;
  const unsupervisedSupervisor = new AcceptanceProcessSupervisor(path.join(root, 'logs'));
  const unsupervisedProcess = await unsupervisedSupervisor.start({
    label: 'unsupervised-host',
    command: HOST_EXECUTABLE,
    args: [
      '--remote-debugging-address=127.0.0.1',
      `--remote-debugging-port=${unsupervisedPort}`,
      `--user-data-dir=${userData}`,
      `--nimi-acceptance-root=${acceptanceRoot}`,
      `--nimi-local-app-main=${path.join(input.zhiyuRoot, 'dist-electron', 'main.js')}`,
      '--nimi-dev-renderer-url=http://127.0.0.1:1472',
    ],
    cwd: input.zhiyuRoot,
    env: safeHostEnvironment(),
  });
  let unsupervisedSession;
  let unsupervisedProblems;
  try {
    const observed = await connectObservedApplication(unsupervisedPort, 'unsupervised-host', 30_000);
    try {
      unsupervisedSession = await invokeBridge(observed.page, 'nimi.shell.localApp.sessionStatus', {});
      unsupervisedProblems = observed.problems;
    } finally {
      await observed.browser.close();
    }
  } finally {
    await unsupervisedSupervisor.stopAll();
  }

  const expectedHostRequirement = designatedRequirement(HOST_EXECUTABLE);
  const desktopRequirement = designatedRequirement(`${DESKTOP_APP}/Contents/MacOS/Nimi Dev`);
  return Object.freeze({
    copied: {
      originalSignatureValidBeforeLaunch: copyVerify.status === 0,
      exitCode: copiedLaunch.exitCode,
      output: `${copiedLaunch.stdout}\n${copiedLaunch.stderr}`.slice(-2000),
      denied: copiedLaunch.exitCode === 78 && /local-app-host-launch-untrusted/u.test(`${copiedLaunch.stdout}\n${copiedLaunch.stderr}`),
    },
    modified: {
      codesignStatus: modifiedVerify.status,
      diagnostic: modifiedVerify.stderr.slice(-2000),
      denied: modifiedVerify.status !== 0,
    },
    adHoc: {
      signingStatus: adHocSign.status,
      identity: `${adHocIdentity.stdout}\n${adHocIdentity.stderr}`.slice(-3000),
      exitCode: adHocLaunch.exitCode,
      output: `${adHocLaunch.stdout}\n${adHocLaunch.stderr}`.slice(-2000),
      deniedByExpectedLocalCAIdentity: adHocSign.status === 0
        && !/Authority=Nimi Local Development/u.test(`${adHocIdentity.stdout}\n${adHocIdentity.stderr}`)
        && adHocLaunch.exitCode === 78
        && /local-app-host-launch-untrusted/u.test(`${adHocLaunch.stdout}\n${adHocLaunch.stderr}`),
      posture: 'negative_fixture_only_never_positive_signing_evidence',
    },
    unsigned: {
      removeSignatureStatus: removeSignature.status,
      codesignStatus: unsignedVerify.status,
      launchStatus: unsignedLaunch.status ?? null,
      launchSignal: unsignedLaunch.signal ?? null,
      launchError: unsignedLaunch.error?.message ?? '',
      output: `${unsignedLaunch.stdout || ''}\n${unsignedLaunch.stderr || ''}`.slice(-2000),
      denied: removeSignature.status === 0 && unsignedVerify.status !== 0
        && (unsignedLaunch.status !== 0 || Boolean(unsignedLaunch.signal) || Boolean(unsignedLaunch.error)),
    },
    wrongRole: {
      hostDesignatedRequirement: expectedHostRequirement,
      desktopDesignatedRequirement: desktopRequirement,
      requirementsDistinct: expectedHostRequirement !== desktopRequirement,
      hostPathSelectionIsCompileTimeFixed: HOST_EXECUTABLE,
    },
    unsupervised: {
      processId: unsupervisedProcess.child.pid ?? null,
      session: unsupervisedSession,
      problems: unsupervisedProblems,
      output: `${unsupervisedProcess.stdout}\n${unsupervisedProcess.stderr}`.slice(-3000),
      denied: unsupervisedSession?.ok === false
        && ['local-development-supervisor-required', 'runtime-service-untrusted', 'protected-carrier-required']
          .includes(unsupervisedSession.error?.reasonCode || unsupervisedSession.error?.message),
    },
    passed: copyVerify.status === 0
      && copiedLaunch.exitCode === 78
      && /local-app-host-launch-untrusted/u.test(`${copiedLaunch.stdout}\n${copiedLaunch.stderr}`)
      && modifiedVerify.status !== 0
      && removeSignature.status === 0
      && unsignedVerify.status !== 0
      && (unsignedLaunch.status !== 0 || Boolean(unsignedLaunch.signal) || Boolean(unsignedLaunch.error))
      && adHocSign.status === 0
      && adHocLaunch.exitCode === 78
      && !/Authority=Nimi Local Development/u.test(`${adHocIdentity.stdout}\n${adHocIdentity.stderr}`)
      && expectedHostRequirement !== desktopRequirement
      && unsupervisedSession?.ok === false
      && ['local-development-supervisor-required', 'runtime-service-untrusted', 'protected-carrier-required']
        .includes(unsupervisedSession.error?.reasonCode || unsupervisedSession.error?.message),
  });
}

function designatedRequirement(executable) {
  const result = fixedCommand('/usr/bin/codesign', ['--display', '--requirements', '-', executable]);
  if (result.status !== 0) throw new Error(`Cannot inspect designated requirement: ${result.stderr}`);
  return `${result.stdout}\n${result.stderr}`.trim();
}

function fixedCommand(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { status: result.status ?? -1, stdout: String(result.stdout || ''), stderr: String(result.stderr || '') };
}

function safeHostEnvironment() {
  return {
    HOME: process.env.HOME,
    LANG: 'en_US.UTF-8',
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    TMPDIR: '/private/tmp',
  };
}
