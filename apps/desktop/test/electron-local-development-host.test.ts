import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
  resolveLocalDevelopmentObservationArguments,
  resolveLocalDevelopmentPackageScriptInvocation,
  sameLocalDevelopmentProject,
} from '../src-electron/local-development-host';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const projectRoot = path.join(repoRoot, 'apps', 'zhiyu');
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
      dormantCount: 0,
      deniedCount: 0,
      revokedCount: 0,
      unavailableReason: null,
    },
    grantSummary: {
      availability: 'available' as const,
      pendingCount: 0,
      grantedCount: 0,
      deniedCount: 0,
      expiredCount: 0,
      revokedCount: 0,
      supersededCount: 0,
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
    requestedCapabilities: ['runtime_agent.conversation.open'],
    capabilityFingerprint: '33'.repeat(32),
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
    persistence: 'allow-remember-project',
    authorizationGeneration: 1,
    approvedAtUnixMs: Date.now() - 1_000,
    updatedAtUnixMs: Date.now(),
  };
}

test('Electron local-development host keeps Runtime identifiers behind approval and project selectors', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'nimi-electron-local-development-'));
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
    reactivate: async () => authorization('active'),
    listAuthorizations: async () => [
      authorization('active'),
      authorization('dormant', 'tauri', '44'.repeat(32)),
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
    const started = await response.json() as { run: { runId: string; state: string } };
    assert.equal(started.run.state, 'pending-approval');

    const pending = await host.commandHandlers.local_development_pending_approvals!({
      command: 'local_development_pending_approvals',
      payload: {},
    }) as Array<Record<string, unknown>>;
    assert.equal(pending.length, 1);
    assert.equal(pending[0]?.approvalState, 'confirmation-required');
    assert.doesNotMatch(JSON.stringify(pending), new RegExp(evaluationId, 'u'));
    assert.doesNotMatch(JSON.stringify(pending), /capabilityFingerprint|authorizationId|supervisorRunId/u);

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
    assert.doesNotMatch(JSON.stringify(authorizations), /capabilityFingerprint/u);
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

test('Electron local-development observation arguments require the explicit checkpoint switch', () => {
  const observation = {
    NIMI_LOCAL_AGENT_PRODUCT_ZHIYU_CDP_PORT: '19472',
    NIMI_LOCAL_AGENT_PRODUCT_ZHIYU_USER_DATA_ROOT: path.join(repoRoot, '.nimi', 'local', 'zhiyu-observation'),
    NIMI_LOCAL_AGENT_PRODUCT_AGENT_ID: `local-agent:runtime-${'1f'.repeat(16)}`,
  };
  assert.deepEqual(resolveLocalDevelopmentObservationArguments(observation), []);
  assert.deepEqual(resolveLocalDevelopmentObservationArguments({
    ...observation,
    NIMI_DEV_KERNEL_CHECKPOINT: '1',
  }), [
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=19472',
    `--user-data-dir=${path.resolve(observation.NIMI_LOCAL_AGENT_PRODUCT_ZHIYU_USER_DATA_ROOT)}`,
    `--nimi-dev-agent-id=${observation.NIMI_LOCAL_AGENT_PRODUCT_AGENT_ID}`,
  ]);
  assert.deepEqual(resolveLocalDevelopmentObservationArguments({
    ...observation,
    NIMI_DEV_KERNEL_CHECKPOINT: '1',
    NIMI_LOCAL_AGENT_PRODUCT_AGENT_ID: '',
  }), [
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=19472',
    `--user-data-dir=${path.resolve(observation.NIMI_LOCAL_AGENT_PRODUCT_ZHIYU_USER_DATA_ROOT)}`,
  ]);
  assert.throws(
    () => resolveLocalDevelopmentObservationArguments({
      ...observation,
      NIMI_DEV_KERNEL_CHECKPOINT: '1',
      NIMI_LOCAL_AGENT_PRODUCT_AGENT_ID: 'local-agent:runtime-invalid',
    }),
    /local-development-observation-config-invalid/u,
  );
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
  const home = await mkdtemp(path.join(os.tmpdir(), 'nimi-electron-local-development-origin-'));
  const control = {
    getAuthoritySummary: async () => authoritySummary(),
    evaluate: async () => { throw new Error('not-called'); },
    decide: async () => { throw new Error('not-called'); },
    reactivate: async () => { throw new Error('not-called'); },
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
