import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chmod, lstat, mkdtemp, mkdir, readFile, realpath, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type {
  NimiElectronLocalDevelopmentAuthorization,
  NimiElectronLocalDevelopmentControl,
  NimiElectronLocalDevelopmentEvaluation,
} from '@nimiplatform/kit/shell/electron/main';
import {
  ElectronLocalDevelopmentHost,
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

function activeRun() {
  return {
    plan: {
      appId: 'nimi.zhiyu',
      displayName: 'Zhiyu Development',
      projectRoot,
      rendererOrigin: 'http://127.0.0.1:1420',
      electronExecutable: '/Applications/Nimi.app/Contents/MacOS/Nimi',
      mainEntry: path.join(projectRoot, 'dist-electron', 'main.js'),
    },
    supervisorRunId: '44'.repeat(32),
    authorizationId,
    pendingEndRunAuthorizationId: undefined as string | undefined,
    stopped: false,
    tearingDown: false,
    supervising: false,
    rebuilding: false,
    rebuildRequested: false,
    watcher: undefined as { close: () => void } | undefined,
    healthTimer: undefined as ReturnType<typeof setInterval> | undefined,
    status: {
      schemaVersion: 1,
      runId: 'dev-run-test',
      state: 'running',
      appId: 'nimi.zhiyu',
      displayName: 'Zhiyu Development',
      canonicalProjectRoot: projectRoot,
      shell: 'electron',
      rendererOrigin: 'http://127.0.0.1:1420',
      message: 'Supervised electron host is running',
      reasonCode: undefined as string | undefined,
      retryable: false,
      hostGeneration: 1,
      logSequence: 0,
      logs: [],
    },
  };
}

async function invokeHostMethod(host: object, name: string, ...args: unknown[]): Promise<void> {
  const method = Reflect.get(host, name);
  assert.equal(typeof method, 'function');
  await Reflect.apply(method, host, args);
}

test('Electron local-development authority refresh failure terminates the host and clears local authority', async () => {
  const terminateCalls: string[] = [];
  const endRunCalls: Array<readonly [string, string]> = [];
  const control = {
    getAuthoritySummary: async () => authoritySummary(),
    evaluate: async () => { throw new Error('runtime-restarted'); },
    decide: async () => { throw new Error('not-called'); },
    listAuthorizations: async () => [],
    revokeAuthorization: async () => { throw new Error('not-called'); },
    launch: async () => { throw new Error('not-called'); },
    hostRunning: async () => false,
    terminateHost: async (supervisorRunId: string) => { terminateCalls.push(supervisorRunId); },
    endRun: async (id: string, supervisorRunId: string) => { endRunCalls.push([id, supervisorRunId]); },
  } satisfies NimiElectronLocalDevelopmentControl;
  const host = new ElectronLocalDevelopmentHost(control, os.tmpdir(), async () => {});
  const run = activeRun();
  let watcherClosed = 0;
  run.watcher = { close: () => { watcherClosed += 1; } };
  try {
    await invokeHostMethod(host, 'refreshAuthority', run);
    assert.deepEqual(terminateCalls, [run.supervisorRunId]);
    assert.deepEqual(endRunCalls, []);
    assert.equal(run.authorizationId, undefined);
    assert.equal(run.watcher, undefined);
    assert.equal(watcherClosed, 1);
    assert.equal(run.stopped, false);
    assert.equal(run.status.state, 'runtime-unavailable');
    assert.equal(run.status.reasonCode, 'runtime-restarted');
    assert.equal(run.status.retryable, true);
    assert.ok(run.healthTimer);
  } finally {
    if (run.healthTimer) clearInterval(run.healthTimer);
  }
});

test('Electron local-development reapproval tears down current run processes before requesting another decision', async () => {
  const terminateCalls: string[] = [];
  const endRunCalls: Array<readonly [string, string]> = [];
  const evaluation: NimiElectronLocalDevelopmentEvaluation = {
    evaluationId,
    project: project(),
    state: 'reapproval-required',
    confirmationRequired: true,
    authorization: null,
    evaluationExpiresAtUnixMs: Date.now() + 30_000,
  };
  const control = {
    getAuthoritySummary: async () => authoritySummary(),
    evaluate: async () => evaluation,
    decide: async () => { throw new Error('not-called'); },
    listAuthorizations: async () => [],
    revokeAuthorization: async () => { throw new Error('not-called'); },
    launch: async () => { throw new Error('not-called'); },
    hostRunning: async () => false,
    terminateHost: async (supervisorRunId: string) => { terminateCalls.push(supervisorRunId); },
    endRun: async (id: string, supervisorRunId: string) => { endRunCalls.push([id, supervisorRunId]); },
  } satisfies NimiElectronLocalDevelopmentControl;
  const host = new ElectronLocalDevelopmentHost(control, os.tmpdir(), async () => {});
  const run = activeRun();
  let watcherClosed = 0;
  run.watcher = { close: () => { watcherClosed += 1; } };
  run.healthTimer = setInterval(() => {}, 60_000);
  try {
    await invokeHostMethod(host, 'refreshAuthority', run);
    assert.deepEqual(terminateCalls, [run.supervisorRunId]);
    assert.deepEqual(endRunCalls, []);
    assert.equal(run.authorizationId, undefined);
    assert.equal(run.watcher, undefined);
    assert.equal(watcherClosed, 1);
    assert.equal(run.healthTimer, undefined);
    assert.equal(run.stopped, false);
    assert.equal(run.status.state, 'pending-approval');
    const pending = Reflect.get(host, 'pending') as Map<string, unknown>;
    assert.equal(pending.size, 1);
  } finally {
    if (run.healthTimer) clearInterval(run.healthTimer);
  }
});

test('Electron local-development renderer exit tears down its host and ends the active run', async () => {
  const terminateCalls: string[] = [];
  const endRunCalls: Array<readonly [string, string]> = [];
  const control = {
    getAuthoritySummary: async () => authoritySummary(),
    evaluate: async () => { throw new Error('not-called'); },
    decide: async () => { throw new Error('not-called'); },
    listAuthorizations: async () => [],
    revokeAuthorization: async () => { throw new Error('not-called'); },
    launch: async () => { throw new Error('not-called'); },
    hostRunning: async () => false,
    terminateHost: async (supervisorRunId: string) => { terminateCalls.push(supervisorRunId); },
    endRun: async (id: string, supervisorRunId: string) => { endRunCalls.push([id, supervisorRunId]); },
  } satisfies NimiElectronLocalDevelopmentControl;
  const host = new ElectronLocalDevelopmentHost(control, os.tmpdir(), async () => {});
  const run = activeRun();
  let watcherClosed = 0;
  run.watcher = { close: () => { watcherClosed += 1; } };
  run.healthTimer = setInterval(() => {}, 60_000);
  try {
    await invokeHostMethod(host, 'handleUnexpectedRendererExit', run, 17);
    assert.deepEqual(terminateCalls, [run.supervisorRunId]);
    assert.deepEqual(endRunCalls, [[authorizationId, run.supervisorRunId]]);
    assert.equal(run.authorizationId, undefined);
    assert.equal(run.watcher, undefined);
    assert.equal(watcherClosed, 1);
    assert.equal(run.healthTimer, undefined);
    assert.equal(run.stopped, true);
    assert.equal(run.status.state, 'failed');
    assert.equal(run.status.message, 'local-development-dev-server-exited-17');
    assert.equal(run.status.reasonCode, 'local-development-dev-server-uncontrolled');
    assert.equal(run.status.retryable, false);
  } finally {
    if (run.healthTimer) clearInterval(run.healthTimer);
  }
});

test('Electron local-development revoke makes the run terminal before intentional process exit', async () => {
  let endRunCalls = 0;
  const control = {
    getAuthoritySummary: async () => authoritySummary(),
    evaluate: async () => { throw new Error('not-called'); },
    decide: async () => { throw new Error('not-called'); },
    listAuthorizations: async () => [],
    revokeAuthorization: async () => authorization('revoked'),
    launch: async () => { throw new Error('not-called'); },
    hostRunning: async () => false,
    terminateHost: async () => {},
    endRun: async () => {
      endRunCalls += 1;
      throw new Error('revoked-run-cannot-end-again');
    },
  } satisfies NimiElectronLocalDevelopmentControl;
  const host = new ElectronLocalDevelopmentHost(control, os.tmpdir(), async () => {});
  const run = activeRun();
  const cleanupStoppedStates: boolean[] = [];
  const runs = Reflect.get(host, 'runs') as Map<string, typeof run>;
  const authorizationSelectors = Reflect.get(host, 'authorizationSelectors') as Map<string, string>;
  runs.set(run.status.runId, run);
  authorizationSelectors.set('dev-project-revoke-test', authorizationId);
  Reflect.set(host, 'stopRunProcesses', async (candidate: typeof run) => {
    cleanupStoppedStates.push(candidate.stopped);
    await invokeHostMethod(host, 'handleUnexpectedRendererExit', candidate, 1);
  });

  await invokeHostMethod(host, 'revoke', { selector: 'dev-project-revoke-test' });

  assert.deepEqual(cleanupStoppedStates, [true]);
  assert.equal(endRunCalls, 0);
  assert.equal(run.stopped, true);
  assert.equal(run.status.state, 'revoked');
  assert.equal(run.status.reasonCode, 'local-development-session-revoked');
});

test('Electron local-development shutdown retains failed cleanup targets for retry', async () => {
  let watcherCloseCalls = 0;
  let endRunCalls = 0;
  const control = {
    getAuthoritySummary: async () => authoritySummary(),
    evaluate: async () => { throw new Error('not-called'); },
    decide: async () => { throw new Error('not-called'); },
    listAuthorizations: async () => [],
    revokeAuthorization: async () => { throw new Error('not-called'); },
    launch: async () => { throw new Error('not-called'); },
    hostRunning: async () => false,
    terminateHost: async () => {},
    endRun: async () => {
      endRunCalls += 1;
      if (endRunCalls === 1) throw new Error('end-run-temporary-failure');
    },
  } satisfies NimiElectronLocalDevelopmentControl;
  const host = new ElectronLocalDevelopmentHost(control, os.tmpdir(), async () => {});
  const run = activeRun();
  run.watcher = {
    close: () => {
      watcherCloseCalls += 1;
      if (watcherCloseCalls === 1) throw new Error('watcher-close-temporary-failure');
    },
  };
  const runs = Reflect.get(host, 'runs') as Map<string, typeof run>;
  runs.set(run.status.runId, run);

  await assert.rejects(
    host.shutdown(),
    /local-development-supervisor-shutdown-failed/u,
  );
  assert.equal(run.authorizationId, undefined);
  assert.equal(run.pendingEndRunAuthorizationId, authorizationId);
  assert.ok(run.watcher);
  assert.equal(endRunCalls, 1);
  assert.equal(watcherCloseCalls, 1);

  await host.shutdown();
  assert.equal(run.pendingEndRunAuthorizationId, undefined);
  assert.equal(run.watcher, undefined);
  assert.equal(endRunCalls, 2);
  assert.equal(watcherCloseCalls, 2);

  await host.shutdown();
  assert.equal(endRunCalls, 2);
  assert.equal(watcherCloseCalls, 2);
});

test('Electron local-development coalesces duplicate starts for the same active project run', {
  skip: process.platform !== 'win32' && !existsSync(macosLocalAppHost),
}, async () => {
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'nimi-electron-local-development-duplicate-')));
  let evaluationCount = 0;
  let focusCount = 0;
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
    evaluate: async () => {
      evaluationCount += 1;
      return evaluation;
    },
    decide: async () => { throw new Error('not-called'); },
    listAuthorizations: async () => [],
    revokeAuthorization: async () => { throw new Error('not-called'); },
    launch: async () => { throw new Error('not-called'); },
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
    const start = async (cdpPort?: number) => {
      const response = await fetch(`${descriptor.endpoint}/v1/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schemaVersion: 1,
          appId: 'nimi.zhiyu',
          projectRoot,
          shell: 'electron',
          ...(cdpPort === undefined ? {} : { cdpPort }),
        }),
      });
      return response.json() as Promise<{
        status: string;
        reasonCode?: string;
        run?: { runId: string; state: string };
      }>;
    };
    const first = await start(9334);
    const duplicate = await start(9334);
    const conflicting = await start(9335);
    assert.equal(first.status, 'ok', JSON.stringify(first));
    assert.equal(duplicate.status, 'ok', JSON.stringify(duplicate));
    assert.equal(conflicting.status, 'error', JSON.stringify(conflicting));
    assert.equal(conflicting.reasonCode, 'local-development-cdp-configuration-conflict');
    assert.equal(first.run?.state, 'pending-approval');
    assert.equal(duplicate.run?.runId, first.run?.runId);
    assert.equal(evaluationCount, 1);
    assert.equal(focusCount, 1);

    const pending = await host.commandHandlers.local_development_pending_approvals!({
      command: 'local_development_pending_approvals',
      payload: {},
    }) as Array<Record<string, unknown>>;
    const runs = await host.commandHandlers.local_development_runs_list!({
      command: 'local_development_runs_list',
      payload: {},
    }) as Array<Record<string, unknown>>;
    assert.equal(pending.length, 1);
    assert.equal(runs.length, 1);

    const cancelled = await fetch(`${descriptor.endpoint}/v1/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schemaVersion: 1,
        runId: first.run?.runId,
      }),
    }).then((response) => response.json()) as {
      status: string;
      run?: { state: string };
    };
    assert.equal(cancelled.status, 'ok', JSON.stringify(cancelled));
    assert.equal(cancelled.run?.state, 'stopped');
    const pendingAfterCancel = await host.commandHandlers.local_development_pending_approvals!({
      command: 'local_development_pending_approvals',
      payload: {},
    }) as Array<Record<string, unknown>>;
    assert.equal(pendingAfterCancel.length, 0);
  } finally {
    await host.shutdown();
    await rm(home, { recursive: true, force: true });
  }
});

test('Electron local-development coalesces duplicate starts while Runtime project evaluation is retryable', {
  skip: process.platform !== 'win32' && !existsSync(macosLocalAppHost),
}, async () => {
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'nimi-electron-local-development-retry-')));
  let evaluationCount = 0;
  const control: NimiElectronLocalDevelopmentControl = {
    getAuthoritySummary: async () => authoritySummary(),
    evaluate: async () => {
      evaluationCount += 1;
      throw Object.assign(new Error('local-development-project-changed'), {
        reasonCode: 'local-development-project-changed',
        retryable: true,
      });
    },
    decide: async () => { throw new Error('not-called'); },
    listAuthorizations: async () => [],
    revokeAuthorization: async () => { throw new Error('not-called'); },
    launch: async () => { throw new Error('not-called'); },
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
    const start = async (cdpPort: number) => {
      const response = await fetch(`${descriptor.endpoint}/v1/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schemaVersion: 1,
          appId: 'nimi.zhiyu',
          projectRoot,
          shell: 'electron',
          cdpPort,
        }),
      });
      return response.json() as Promise<{
        status: string;
        reasonCode?: string;
        run?: { runId: string; state: string; retryable: boolean };
      }>;
    };

    const first = await start(9334);
    const duplicate = await start(9334);
    const conflicting = await start(9335);
    assert.equal(first.status, 'ok', JSON.stringify(first));
    assert.equal(first.run?.state, 'authorization-required');
    assert.equal(first.run?.retryable, true);
    assert.equal(duplicate.status, 'ok', JSON.stringify(duplicate));
    assert.equal(duplicate.run?.runId, first.run?.runId);
    assert.equal(conflicting.status, 'error', JSON.stringify(conflicting));
    assert.equal(conflicting.reasonCode, 'local-development-cdp-configuration-conflict');
    assert.equal(evaluationCount, 1);

    const pending = await host.commandHandlers.local_development_pending_approvals!({
      command: 'local_development_pending_approvals',
      payload: {},
    }) as Array<Record<string, unknown>>;
    const runs = await host.commandHandlers.local_development_runs_list!({
      command: 'local_development_runs_list',
      payload: {},
    }) as Array<Record<string, unknown>>;
    assert.equal(pending.length, 0);
    assert.equal(runs.length, 1);
  } finally {
    await host.shutdown();
    await rm(home, { recursive: true, force: true });
  }
});

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
  const currentAuthorization = authorization('active');
  const timestampTiedRevokedHistory = {
    ...authorization('revoked', 'electron', '55'.repeat(32)),
    updatedAtUnixMs: currentAuthorization.updatedAtUnixMs,
  };
  const control: NimiElectronLocalDevelopmentControl = {
    getAuthoritySummary: async () => authoritySummary(),
    evaluate: async () => evaluation,
    decide: async () => authorization('denied'),
    listAuthorizations: async () => [
      timestampTiedRevokedHistory,
      currentAuthorization,
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
    assert.equal(authorizations.length, 1);
    assert.equal(authorizations[0]?.state, 'active');
    assert.equal(authorizations[0]?.shell, 'electron');
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

test('Desktop-supervised Electron CDP is explicit, loopback-only, and precedes the app entry', () => {
  const mainEntry = 'D:\\nimi-apps\\tester\\dist-electron\\main.js';
  assert.deepEqual(resolveLocalDevelopmentElectronHostArguments({
    mainEntry,
    rendererOrigin: 'http://127.0.0.1:1468',
    userDataArguments: ['--user-data-dir=D:\\profiles\\tester'],
    cdpPort: 9334,
    platform: 'win32',
  }), [
    '--user-data-dir=D:\\profiles\\tester',
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=9334',
    mainEntry,
    '--nimi-dev-renderer-url=http://127.0.0.1:1468',
  ]);
  assert.throws(
    () => resolveLocalDevelopmentElectronHostArguments({
      mainEntry,
      rendererOrigin: 'http://127.0.0.1:1468',
      userDataArguments: [],
      cdpPort: 80,
      platform: 'win32',
    }),
    /local-development-cdp-port-invalid/u,
  );
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
    await chmod(home, 0o750);
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
