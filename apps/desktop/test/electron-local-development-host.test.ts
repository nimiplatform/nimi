import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { lstat, mkdtemp, mkdir, readFile, realpath, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type {
  NimiElectronLocalDevelopmentAuthorization,
  NimiElectronLocalDevelopmentControl,
  NimiElectronLocalDevelopmentEvaluation,
} from '@nimiplatform/kit/shell/electron/main';
import {
  createDesktopElectronLocalDevelopmentHost,
  resolveLocalDevelopmentAuthorityFailureState,
  sameLocalDevelopmentProject,
} from '../src-electron/local-development-host';
import {
  resolveLocalDevelopmentElectronHostArguments,
  resolveLocalAppUserDataArguments,
} from '../src-electron/local-development-host-arguments';
import {
  resolveLocalDevelopmentPackageScriptInvocation,
} from '../src-electron/local-development-host-process';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const projectRoot = path.join(repoRoot, 'apps', 'zhiyu');
const macosLocalAppHost = '/Applications/Nimi.app/Contents/Frameworks/Nimi Local App Host.app/Contents/MacOS/Nimi Local App Host';
const evaluationId = '11'.repeat(32);
const authorizationId = '22'.repeat(32);

test('local-development shutdown is reentrant-safe without force-closing the HTTP server', async () => {
  const source = await readFile(path.join(repoRoot, 'apps', 'desktop', 'src-electron', 'local-development-host.ts'), 'utf8');
  assert.doesNotMatch(source, /closeAllConnections\(\)/u);
  assert.match(source, /this\.shutdownPromise \?\?= this\.performShutdown\(\)/u);
  assert.match(source, /server\.closeIdleConnections\(\)/u);
  assert.match(source, /local-development-supervisor-http-shutdown-timeout/u);
});

function authoritySummary() {
  return {
    developerMode: {
      availability: 'available' as const,
      state: 'enabled' as const,
      unavailableReason: null,
    },
    projectAuthorization: {
      availability: 'available' as const,
      activeCount: 1,
      deniedCount: 0,
      revokedCount: 0,
      unavailableReason: null,
    },
  };
}

function project(shell: 'electron' | 'tauri' = 'electron') {
  return {
    appId: 'nimi.zhiyu',
    displayName: 'Zhiyu Development',
    canonicalProjectRoot: projectRoot,
    canonicalManifestPath: path.join(projectRoot, 'nimi.app.yaml'),
    shell,
    accountId: 'account-a',
    permissionRequirements: [],
    permissionRequirementFingerprint: '33'.repeat(32),
  };
}

function authorization(
  state: NimiElectronLocalDevelopmentAuthorization['state'],
  shell: 'electron' | 'tauri' = 'electron',
  id = authorizationId,
): NimiElectronLocalDevelopmentAuthorization {
  return {
    authorizationId: id,
    project: project(shell),
    state,
    persistence: 'allow-project',
    authorizationGeneration: 1,
    approvedAtUnixMs: Date.now() - 1_000,
    updatedAtUnixMs: Date.now(),
  };
}

test('Electron local-development host keeps Runtime identifiers behind approval and project selectors', {
  skip: process.platform !== 'win32' && !existsSync(macosLocalAppHost),
}, async () => {
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'nimi-electron-local-development-')));
  const evaluation: NimiElectronLocalDevelopmentEvaluation = {
    evaluationId,
    project: project(),
    state: 'confirmation-required',
    confirmationRequired: true,
    authorization: null,
    evaluationExpiresAtUnixMs: Date.now() + 30_000,
  };
  const control: NimiElectronLocalDevelopmentControl = {
    getAuthoritySummary: async () => authoritySummary(),
    evaluate: async () => evaluation,
    decide: async () => authorization('denied'),
    listAuthorizations: async () => [
      authorization('active'),
      authorization('revoked', 'tauri', '44'.repeat(32)),
    ],
    revokeAuthorization: async () => authorization('revoked'),
    launch: async () => ({ processId: 42, bindDeadlineUnixMs: Date.now() + 5_000 }),
    hostRunning: async () => false,
    terminateHost: async () => {},
    endRun: async () => {},
  };
  const host = await createDesktopElectronLocalDevelopmentHost({
    homeDirectory: home,
    focusMainWindow: async () => {},
    control,
  });
  try {
    const descriptor = JSON.parse(await readFile(path.join(
      home, '.nimi', 'run', 'desktop', 'local-development', 'presence.v1.json',
    ), 'utf8')) as { endpoint: string };
    const response = await fetch(`${descriptor.endpoint}/v1/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schemaVersion: 1, appId: 'nimi.zhiyu', projectRoot, shell: 'electron' }),
    });
    const started = await response.json() as {
      status: string;
      reasonCode?: string;
      run?: { runId: string; state: string };
    };
    assert.equal(started.status, 'ok', JSON.stringify(started));
    assert.ok(started.run);
    assert.equal(started.run.state, 'pending-approval');

    const pending = await host.commandHandlers.local_development_pending_approvals!({
      command: 'local_development_pending_approvals',
      payload: {},
    }) as Array<Record<string, unknown>>;
    assert.equal(pending.length, 1);
    assert.equal(pending[0]?.approvalState, 'confirmation-required');
    assert.doesNotMatch(JSON.stringify(pending), new RegExp(evaluationId, 'u'));
    assert.doesNotMatch(JSON.stringify(pending), /permissionRequirementFingerprint|authorizationId|supervisorRunId/u);

    const denied = await host.commandHandlers.local_development_decide!({
      command: 'local_development_decide',
      payload: {
        payload: {
          requestId: pending[0]?.requestId,
          decision: 'deny',
          riskDisclosureAcknowledged: true,
        },
      },
    }) as { state: string };
    assert.equal(denied.state, 'denied');

    const authorizations = await host.commandHandlers.local_development_authorizations_list!({
      command: 'local_development_authorizations_list',
      payload: {},
    }) as Array<Record<string, unknown>>;
    assert.equal(authorizations[0]?.state, 'active');
    assert.equal(authorizations[0]?.shell, 'electron');
    assert.equal(authorizations[1]?.shell, 'tauri');
    assert.match(String(authorizations[0]?.selector), /^dev-project-/u);
    assert.doesNotMatch(JSON.stringify(authorizations), new RegExp(authorizationId, 'u'));
    assert.doesNotMatch(JSON.stringify(authorizations), /permissionRequirementFingerprint/u);
  } finally {
    await Promise.all([host.shutdown(), host.shutdown()]);
    await rm(home, { recursive: true, force: true });
  }
});

for (const scenario of ['locally-expired', 'runtime-expiry-race'] as const) {
  test(`Electron local-development refreshes ${scenario} approval without reusing the user decision`, {
    skip: process.platform !== 'win32' && !existsSync(macosLocalAppHost),
  }, async () => {
    const home = await realpath(await mkdtemp(path.join(os.tmpdir(), `nimi-electron-local-development-${scenario}-`)));
    let evaluationCount = 0;
    let decisionCount = 0;
    let launchCount = 0;
    let focusCount = 0;
    const evaluations: readonly NimiElectronLocalDevelopmentEvaluation[] = [
      {
        evaluationId,
        project: project(),
        state: 'confirmation-required',
        confirmationRequired: true,
        authorization: null,
        evaluationExpiresAtUnixMs: scenario === 'locally-expired'
          ? Date.now() - 1
          : Date.now() + 30_000,
      },
      {
        evaluationId: '55'.repeat(32),
        project: project(),
        state: 'confirmation-required',
        confirmationRequired: true,
        authorization: null,
        evaluationExpiresAtUnixMs: Date.now() + 60_000,
      },
    ];
    const control: NimiElectronLocalDevelopmentControl = {
      getAuthoritySummary: async () => authoritySummary(),
      evaluate: async () => evaluations[Math.min(evaluationCount++, evaluations.length - 1)]!,
      decide: async () => {
        decisionCount += 1;
        throw Object.assign(new Error('local-development-authorization-required'), {
          reasonCode: 'local-development-authorization-required',
          retryable: false,
        });
      },
      listAuthorizations: async () => [],
      revokeAuthorization: async () => { throw new Error('not-called'); },
      launch: async () => {
        launchCount += 1;
        return { processId: 42, bindDeadlineUnixMs: Date.now() + 5_000 };
      },
      hostRunning: async () => false,
      terminateHost: async () => {},
      endRun: async () => {},
    };
    const host = await createDesktopElectronLocalDevelopmentHost({
      homeDirectory: home,
      focusMainWindow: async () => { focusCount += 1; },
      control,
    });
    try {
      const descriptor = JSON.parse(await readFile(path.join(
        home, '.nimi', 'run', 'desktop', 'local-development', 'presence.v1.json',
      ), 'utf8')) as { endpoint: string };
      const response = await fetch(`${descriptor.endpoint}/v1/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schemaVersion: 1, appId: 'nimi.zhiyu', projectRoot, shell: 'electron' }),
      });
      const started = await response.json() as { status: string; run?: { state: string } };
      assert.equal(started.status, 'ok', JSON.stringify(started));
      assert.equal(started.run?.state, 'pending-approval');
      const firstPending = await host.commandHandlers.local_development_pending_approvals!({
        command: 'local_development_pending_approvals',
        payload: {},
      }) as Array<{ requestId: string }>;
      assert.equal(firstPending.length, 1);

      const refreshed = await host.commandHandlers.local_development_decide!({
        command: 'local_development_decide',
        payload: {
          payload: {
            requestId: firstPending[0]?.requestId,
            decision: 'allow-project',
            riskDisclosureAcknowledged: true,
          },
        },
      }) as { state: string };
      assert.equal(refreshed.state, 'pending-approval');
      const nextPending = await host.commandHandlers.local_development_pending_approvals!({
        command: 'local_development_pending_approvals',
        payload: {},
      }) as Array<{ requestId: string }>;
      assert.equal(nextPending.length, 1);
      assert.notEqual(nextPending[0]?.requestId, firstPending[0]?.requestId);
      assert.equal(evaluationCount, 2);
      assert.equal(decisionCount, scenario === 'runtime-expiry-race' ? 1 : 0);
      assert.equal(launchCount, 0);
      assert.equal(focusCount, 2);
    } finally {
      await host.shutdown();
      await rm(home, { recursive: true, force: true });
    }
  });
}

test('macOS local-development host fails closed when the exact installed carrier is absent', {
  skip: process.platform !== 'darwin' || existsSync(macosLocalAppHost),
}, async () => {
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'nimi-electron-local-development-macos-')));
  const control = {
    getAuthoritySummary: async () => authoritySummary(),
    evaluate: async () => { throw new Error('not-called'); },
    decide: async () => { throw new Error('not-called'); },
    listAuthorizations: async () => [],
    revokeAuthorization: async () => { throw new Error('not-called'); },
    launch: async () => { throw new Error('not-called'); },
    hostRunning: async () => false,
    terminateHost: async () => {},
    endRun: async () => {},
  } satisfies NimiElectronLocalDevelopmentControl;
  const host = await createDesktopElectronLocalDevelopmentHost({
    homeDirectory: home,
    focusMainWindow: async () => {},
    control,
  });
  try {
    const descriptor = JSON.parse(await readFile(path.join(
      home, '.nimi', 'run', 'desktop', 'local-development', 'presence.v1.json',
    ), 'utf8')) as { endpoint: string };
    const response = await fetch(`${descriptor.endpoint}/v1/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schemaVersion: 1, appId: 'nimi.zhiyu', projectRoot, shell: 'electron' }),
    });
    assert.deepEqual(await response.json(), {
      status: 'error',
      reasonCode: 'local-development-project-changed',
      actionHint: 'use_official_nimi_app_dev_launcher',
    });
  } finally {
    await host.shutdown();
    await rm(home, { recursive: true, force: true });
  }
});

test('Electron local-development package scripts use a fixed Windows shell allowlist', () => {
  assert.deepEqual(resolveLocalDevelopmentPackageScriptInvocation('build:electron', 'win32'), {
    command: 'corepack.cmd pnpm run build:electron',
    args: [],
    shell: true,
  });
  assert.deepEqual(resolveLocalDevelopmentPackageScriptInvocation('dev:renderer', 'linux'), {
    command: 'corepack',
    args: ['pnpm', 'run', 'dev:renderer'],
    shell: false,
  });
  assert.throws(
    () => resolveLocalDevelopmentPackageScriptInvocation('arbitrary' as never, 'win32'),
    /local-development-supervisor-required/u,
  );
});

test('Electron local-development keeps exact Runtime transport failures recoverable', () => {
  for (const reasonCode of [
    'process-replaced',
    'runtime-restarted',
    'runtime-service-repair-required',
    'runtime-service-unavailable',
    'runtime-service-untrusted',
  ]) {
    assert.equal(
      resolveLocalDevelopmentAuthorityFailureState(reasonCode),
      'runtime-unavailable',
    );
  }
  assert.equal(
    resolveLocalDevelopmentAuthorityFailureState('local-development-authorization-required'),
    'authorization-required',
  );
});

test('Windows Electron launch uses the canonical app entry as the positional application argument', () => {
  const mainEntry = 'D:\\nimi-apps\\parentos\\dist-electron\\main.js';
  const arguments_ = resolveLocalDevelopmentElectronHostArguments({
    mainEntry,
    rendererOrigin: 'http://127.0.0.1:1426',
    userDataArguments: ['--user-data-dir=D:\\profiles\\parentos'],
    platform: 'win32',
  });
  assert.deepEqual(arguments_, [
    '--user-data-dir=D:\\profiles\\parentos',
    mainEntry,
    '--nimi-dev-renderer-url=http://127.0.0.1:1426',
  ]);
  assert.equal(arguments_.some((value) => value.startsWith('--nimi-local-app-main=')), false);
});

test('macOS protected local-app carrier retains its exact main-entry switch contract', () => {
  const mainEntry = '/Applications/project/dist-electron/main.js';
  assert.deepEqual(resolveLocalDevelopmentElectronHostArguments({
    mainEntry,
    rendererOrigin: 'http://127.0.0.1:1472',
    userDataArguments: ['--user-data-dir=/Users/test/Library/Application Support/Nimi/Local App Hosts/v1/profile'],
    platform: 'darwin',
  }), [
    '--user-data-dir=/Users/test/Library/Application Support/Nimi/Local App Hosts/v1/profile',
    `--nimi-local-app-main=${mainEntry}`,
    '--nimi-dev-renderer-url=http://127.0.0.1:1472',
  ]);
});

test('Windows local-app Chromium data is opaque and authorization-partitioned', {
  skip: process.platform !== 'win32',
}, async () => {
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'nimi-local-app-user-data-win-')));
  try {
    const first = await resolveLocalAppUserDataArguments({
      authorizationId,
      homeDirectory: home,
      platform: 'win32',
    });
    const repeated = await resolveLocalAppUserDataArguments({
      authorizationId,
      homeDirectory: home,
      platform: 'win32',
    });
    const changed = await resolveLocalAppUserDataArguments({
      authorizationId: '44'.repeat(32),
      homeDirectory: home,
      platform: 'win32',
    });
    assert.deepEqual(repeated, first);
    assert.notDeepEqual(changed, first);
    assert.match(first[0]!, /AppData\\Local\\Nimi\\Local App Hosts\\v1\\[a-f0-9]{64}$/u);
    assert.doesNotMatch(first[0]!, new RegExp(authorizationId, 'u'));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('Windows local-app Chromium data rejects a junction in the partition ancestry', {
  skip: process.platform !== 'win32',
}, async () => {
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'nimi-local-app-user-data-win-link-')));
  const target = await realpath(await mkdtemp(path.join(os.tmpdir(), 'nimi-local-app-user-data-win-target-')));
  try {
    await mkdir(path.join(home, 'AppData'));
    await symlink(target, path.join(home, 'AppData', 'Local'), 'junction');
    await assert.rejects(resolveLocalAppUserDataArguments({
      authorizationId,
      homeDirectory: home,
      platform: 'win32',
    }), /local-development-user-data-partition-untrusted/u);
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  }
});

test('macOS local-app Chromium data is opaque, private, and authorization-partitioned', {
  skip: process.platform !== 'darwin',
}, async () => {
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'nimi-local-app-user-data-')));
  try {
    const first = await resolveLocalAppUserDataArguments({
      authorizationId,
      homeDirectory: home,
      platform: 'darwin',
      uid: process.getuid?.() ?? 0,
    });
    const repeated = await resolveLocalAppUserDataArguments({
      authorizationId,
      homeDirectory: home,
      platform: 'darwin',
      uid: process.getuid?.() ?? 0,
    });
    const changed = await resolveLocalAppUserDataArguments({
      authorizationId: '44'.repeat(32),
      homeDirectory: home,
      platform: 'darwin',
      uid: process.getuid?.() ?? 0,
    });
    assert.deepEqual(repeated, first);
    assert.notDeepEqual(changed, first);
    assert.doesNotMatch(first[0]!, new RegExp(authorizationId, 'u'));
    const profileRoot = first[0]!.slice('--user-data-dir='.length);
    const metadata = await lstat(profileRoot);
    assert.equal(metadata.isDirectory(), true);
    assert.equal(metadata.mode & 0o777, 0o700);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('macOS local-app Chromium data rejects a symlinked profile ancestor', {
  skip: process.platform !== 'darwin',
}, async () => {
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'nimi-local-app-user-data-link-')));
  const target = await realpath(await mkdtemp(path.join(os.tmpdir(), 'nimi-local-app-user-data-target-')));
  try {
    await mkdir(path.join(home, 'Library'), { mode: 0o700 });
    await symlink(target, path.join(home, 'Library', 'Application Support'));
    await assert.rejects(
      resolveLocalAppUserDataArguments({
        authorizationId,
        homeDirectory: home,
        platform: 'darwin',
        uid: process.getuid?.() ?? 0,
      }),
      /local-development-user-data-partition-untrusted/u,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  }
});

test('Electron local-development project equality accepts the Windows extended-length canonical path', {
  skip: process.platform !== 'win32',
}, () => {
  const slash = '\\';
  const evaluation: NimiElectronLocalDevelopmentEvaluation = {
    evaluationId,
    project: {
      ...project(),
      canonicalProjectRoot: `${slash}${slash}?${slash}${projectRoot}`,
    },
    state: 'confirmation-required',
    confirmationRequired: true,
    authorization: null,
    evaluationExpiresAtUnixMs: Date.now() + 30_000,
  };
  const plan = {
    appId: 'nimi.zhiyu',
    displayName: 'Zhiyu Development',
    projectRoot,
    rendererOrigin: 'http://127.0.0.1:1472',
    electronExecutable: path.join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe'),
    mainEntry: path.join(projectRoot, 'dist-electron', 'main.js'),
  };

  assert.equal(sameLocalDevelopmentProject(evaluation, plan), true);
  assert.equal(sameLocalDevelopmentProject({
    ...evaluation,
    project: { ...evaluation.project, appId: 'nimi.other' },
  }, plan), false);
});

test('Electron local-development HTTP bridge rejects browser-originated intents', async () => {
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'nimi-electron-local-development-origin-')));
  const control = {
    getAuthoritySummary: async () => authoritySummary(),
    evaluate: async () => { throw new Error('not-called'); },
    decide: async () => { throw new Error('not-called'); },
    listAuthorizations: async () => [],
    revokeAuthorization: async () => { throw new Error('not-called'); },
    launch: async () => { throw new Error('not-called'); },
    hostRunning: async () => false,
    terminateHost: async () => {},
    endRun: async () => {},
  } satisfies NimiElectronLocalDevelopmentControl;
  const host = await createDesktopElectronLocalDevelopmentHost({
    homeDirectory: home,
    focusMainWindow: async () => {},
    control,
  });
  try {
    const descriptor = JSON.parse(await readFile(path.join(
      home, '.nimi', 'run', 'desktop', 'local-development', 'presence.v1.json',
    ), 'utf8')) as { endpoint: string };
    const response = await fetch(`${descriptor.endpoint}/v1/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:1472' },
      body: JSON.stringify({ schemaVersion: 1, appId: 'nimi.zhiyu', projectRoot, shell: 'electron' }),
    });
    assert.deepEqual(await response.json(), {
      status: 'error',
      reasonCode: 'local-development-intent-invalid',
      actionHint: 'use_official_nimi_app_dev_launcher',
    });
  } finally {
    await host.shutdown();
    await rm(home, { recursive: true, force: true });
  }
});
