import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  parseAcceptanceArguments,
  REQUIRED_EVIDENCE_FILES,
  REPO_ROOT,
  resolveRealmRoot,
} from './macos-dev-acceptance/acceptance-contract.mjs';
import {
  captureDesktopProjectionAbsence,
  captureDesktopProjectionSet,
} from './macos-dev-acceptance/desktop-projection-evidence.mjs';

const expectedEvidence = Object.freeze([
  'environment.json',
  'commits-and-worktree.json',
  'signing-and-entitlements.json',
  'launchd-and-sockets.json',
  'desktop-desktop.png',
  'desktop-390.png',
  'zhiyu-desktop.png',
  'zhiyu-390.png',
  'dom-accessibility-summary.json',
  'console-page-network-errors.json',
  'runtime-realm-session-evidence.json',
  'process-tree-before.json',
  'process-tree-after.json',
  'restart-session-rotation.json',
  'negative-tests.json',
  'acceptance-summary.json',
]);
const exampleRealmRoot = '/Users/example/nimi-realm';
const fixtureUID = 501;

test('acceptance arguments admit only one exact canonical absolute Realm root', () => {
  assert.deepEqual(parseAcceptanceArguments([]), { realmRoot: undefined });
  assert.deepEqual(parseAcceptanceArguments(['--realm-root', exampleRealmRoot]), {
    realmRoot: exampleRealmRoot,
  });
  assert.deepEqual(parseAcceptanceArguments([`--realm-root=${exampleRealmRoot}`]), {
    realmRoot: exampleRealmRoot,
  });
  assert.deepEqual(parseAcceptanceArguments(['--', '--realm-root', exampleRealmRoot]), {
    realmRoot: exampleRealmRoot,
  });
  for (const invalid of [
    ['--realm-root', 'relative/path'],
    ['--realm-root', '/Users/example/../nimi-realm'],
    ['--realm-root', '/one', '--realm-root=/two'],
    ['--unknown'],
    ['--realm-root'],
    ['--', '--', '--realm-root', exampleRealmRoot],
  ]) {
    assert.throws(
      () => parseAcceptanceArguments(invalid),
      (error) => error.reasonCode === 'macos-dev-acceptance-argument-invalid',
    );
  }
});

test('explicit and discovered Realm roots require the full repository marker conjunction', async () => {
  const expected = path.dirname(REPO_ROOT);
  assert.equal(await resolveRealmRoot(expected), expected);
  assert.equal(await resolveRealmRoot(), expected);
  await assert.rejects(
    resolveRealmRoot('/private/tmp'),
    () => true,
  );
});

test('published acceptance evidence contract contains every required real-App artifact exactly once', () => {
  assert.deepEqual(REQUIRED_EVIDENCE_FILES, expectedEvidence);
  assert.equal(new Set(REQUIRED_EVIDENCE_FILES).size, REQUIRED_EVIDENCE_FILES.length);
});

test('runner fails closed before evidence creation and uses real UI, session, restart, revoke, and shutdown paths', async () => {
  const runner = await readFile(path.join(REPO_ROOT, 'scripts', 'run-macos-dev-chain-acceptance.mjs'), 'utf8');
  const statusIndex = runner.indexOf("runMacOSDevRuntimeService({ mode: 'status' })");
  const contextIndex = runner.indexOf('createAcceptanceContext(realmRoot)');
  assert.ok(statusIndex >= 0 && contextIndex > statusIndex);
  assert.match(runner, /beginNormalRealmLogin/u);
  assert.match(runner, /requireAnonymousRuntimeAccount/u);
  assert.match(runner, /setDeveloperModeThroughUI/u);
  assert.match(runner, /approvePendingLocalAppThroughUI/u);
  assert.match(runner, /revokeActiveLocalAppThroughUI/u);
  assert.match(runner, /exerciseRuntimeRestart/u);
  assert.match(runner, /allowProjectContinuity/u);
  assert.match(runner, /persistence === 'allow-project'/u);
  assert.match(runner, /captureDesktopProjectionSet/u);
  assert.match(runner, /captureDesktopProjectionAbsence/u);
  assert.match(runner, /shutdownDesktopAndVerify/u);
  assert.match(runner, /sleepWakeCheckpoint/u);
  assert.match(runner, /fastUserSwitchCheckpoint/u);
  assert.match(runner, /captureSigningEvidence/u);
  assert.match(runner, /snapshotObservedApplication/u);
  assert.match(runner, /inspectRendererSecurity/u);
  assert.match(runner, /macOSProductionAdmission: false/u);
  assert.match(runner, /tauriAdmission: false/u);
  assert.doesNotMatch(runner, /NIMI_(?:ACCESS|RUNTIME|REALM)_TOKEN/u);
  assert.doesNotMatch(runner, /(?:INSERT|UPDATE|DELETE)\s+(?:INTO|FROM)?\s*(?:users|sessions|accounts)/iu);
});

test('runner redacts bearer, token fields, and JWTs before persisted process logs', async () => {
  const runner = await readFile(path.join(REPO_ROOT, 'scripts', 'run-macos-dev-chain-acceptance.mjs'), 'utf8');
  assert.match(runner, /transformOutput: redactSensitiveOutput/u);
  assert.match(runner, /authorization:\\s\*bearer/u);
  assert.match(runner, /access_token\|refresh_token\|sessionProof\|token\|otp\|verificationCode/u);
  assert.match(runner, /\[REDACTED_JWT\]/u);
  assert.match(runner, /if \(!process\.stderr\.isTTY\) return/u);
});

test('Desktop projection evidence validates all live projections without persisting the open-intent token', async () => {
  const homeDirectory = await mkdtemp(path.join(os.tmpdir(), 'nimi-desktop-projection-'));
  const localDevelopmentRoot = path.join(homeDirectory, '.nimi', 'run', 'desktop', 'local-development');
  const openIntentRoot = path.join(homeDirectory, '.nimi', 'run', 'desktop', 'open-intent');
  const capturedAt = new Date().toISOString();
  const secret = 'abcdefghijklmnopqrstuvwxyzABCDEFGH123456789'; // pragma: allowlist secret
  try {
    await mkdir(localDevelopmentRoot, { recursive: true });
    await mkdir(openIntentRoot, { recursive: true });
    await privateJson(path.join(localDevelopmentRoot, 'presence.v1.json'), {
      schemaVersion: 1,
      desktopAppId: 'nimi.desktop',
      desktopPid: process.pid,
      endpoint: 'http://127.0.0.1:49111',
      startedAt: capturedAt,
      lastHeartbeatAt: capturedAt,
    });
    await privateJson(path.join(localDevelopmentRoot, 'authority-summary.v1.json'), {
      schemaVersion: 1,
      desktopAppId: 'nimi.desktop',
      desktopPid: process.pid,
      capturedAt,
      developerMode: { availability: 'available', state: 'enabled', reasonCode: 'action-executed' },
      projectAuthorization: {
        availability: 'available',
        activeCount: 1,
        deniedCount: 0,
        revokedCount: 0,
        reasonCode: 'action-executed',
      },
    });
    await privateJson(path.join(openIntentRoot, 'presence.v1.json'), {
      schemaVersion: 1,
      desktopAppId: 'nimi.desktop',
      bridgeId: 'desktop-open-bridge-abcdefghijklmnopqrstuvwx',
      pid: process.pid,
      endpoint: 'http://127.0.0.1:49112',
      token: secret,
      startedAt: capturedAt,
      lastHeartbeatAt: capturedAt,
    });
    const evidence = await captureDesktopProjectionSet({
      homeDirectory,
      expectedDesktopPid: process.pid,
      expectedUID: fixtureUID,
      lstat: privateProjectionMetadata,
    });
    assert.equal(evidence.passed, true);
    assert.equal(evidence.rows.desktopOpenIntentPresence.token.length, 43);
    assert.equal(JSON.stringify(evidence).includes(secret), false);
    await rm(path.join(homeDirectory, '.nimi'), { recursive: true });
    assert.equal((await captureDesktopProjectionAbsence({ homeDirectory })).passed, true);
  } finally {
    await rm(homeDirectory, { recursive: true, force: true });
  }
});

async function privateJson(file, value) {
  await writeFile(file, `${JSON.stringify(value)}\n`, { mode: 0o600 });
}

async function privateProjectionMetadata(file) {
  const metadata = await lstat(file);
  return Object.freeze({
    isFile: () => metadata.isFile(),
    isSymbolicLink: () => metadata.isSymbolicLink(),
    uid: fixtureUID,
    gid: 20,
    mode: (metadata.mode & ~0o777) | 0o600,
  });
}
