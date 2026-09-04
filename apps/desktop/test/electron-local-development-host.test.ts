import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import type {
  NimiElectronLocalDevelopmentControl,
  NimiElectronLocalDevelopmentRegistration,
} from '@nimiplatform/kit/shell/electron/main';
import {
  captureLocalDevelopmentElectronSourceFingerprint,
  ElectronLocalDevelopmentHost,
  isLocalDevelopmentRuntimeTransportFailure,
  localDevelopmentFailureMessage,
  resolveLocalDevelopmentRegistrationFailureState,
  sameLocalDevelopmentProject,
  waitForDevToolsActivePort,
} from '../src-electron/local-development-host.js';
import {
  readElectronAIConfigAllowedRoutes,
  type ElectronLocalDevelopmentPlan,
} from '../src-electron/local-development-plan.js';
import { resolveLocalDevelopmentElectronHostLaunch } from '../src-electron/local-development-host-arguments.js';
import { localDevelopmentCdpPort } from '../src-electron/local-development-host-protocol.js';

const HANDLE = '11'.repeat(32);
const SUPERVISOR = '22'.repeat(32);

function registration(
  overrides: Partial<NimiElectronLocalDevelopmentRegistration> = {},
): NimiElectronLocalDevelopmentRegistration {
  return {
    registrationHandle: HANDLE,
    project: {
      appId: 'example.local-app',
      displayName: 'Example Local App',
      canonicalProjectRoot: '/projects/example',
      canonicalManifestPath: path.resolve(import.meta.dirname, '../../lab/nimi.app.yaml'),
      shell: 'electron',
      appAccess: ['realm.data', 'future.unknown'],
      sourceGeneration: 3,
      declarationGeneration: 4,
    },
    registeredAtUnixMs: 1_721_000_000_000,
    updatedAtUnixMs: 1_722_000_000_000,
    ...overrides,
  };
}

function control(overrides: Partial<NimiElectronLocalDevelopmentControl> = {}): NimiElectronLocalDevelopmentControl {
  return {
    register: async () => registration(),
    listRegistrations: async () => [registration()],
    removeRegistration: async () => undefined,
    launch: async () => ({ processId: 10, bindDeadlineUnixMs: Date.now() + 10_000 }),
    hostRunning: async () => false,
    terminateHost: async () => undefined,
    endRun: async () => undefined,
    ...overrides,
  };
}

function plan(): ElectronLocalDevelopmentPlan {
  return {
    appId: 'example.local-app',
    displayName: 'Example Local App',
    aiConfigAllowedRoutes: ['local', 'cloud'],
    projectRoot: '/projects/example',
    rendererOrigin: 'http://127.0.0.1:1420',
    electronExecutable: '/runtime/electron',
    mainEntry: '/projects/example/dist/main.js',
  };
}

function activeRun() {
  return {
    intentSequence: 1,
    plan: plan(),
    supervisorRunId: SUPERVISOR,
    desktopManaged: false,
    registrationOwnerHandle: HANDLE as string | undefined,
    registrationHandle: HANDLE as string | undefined,
    pendingEndRunRegistrationHandle: undefined as string | undefined,
    stopped: false,
    stoppedCleanupComplete: false,
    tearingDown: false,
    supervising: false,
    rebuilding: false,
    rebuildRequested: false,
    refreshingRegistration: false,
    refreshRegistrationPromise: undefined as Promise<void> | undefined,
    recoveringRuntimeTransport: false,
    electronSourceFingerprint: undefined as string | undefined,
    renderer: undefined as object | undefined,
    watcher: undefined as { close: () => void } | undefined,
    healthTimer: undefined as ReturnType<typeof setInterval> | undefined,
    stopPromise: undefined as Promise<void> | undefined,
    teardownPromise: undefined as Promise<void> | undefined,
    status: {
      schemaVersion: 1,
      runId: 'dev-run-example',
      state: 'running',
      appId: 'example.local-app',
      displayName: 'Example Local App',
      canonicalProjectRoot: '/projects/example',
      shell: 'electron' as const,
      rendererOrigin: 'http://127.0.0.1:1420',
      message: 'Supervised electron host is running',
      reasonCode: undefined as string | undefined,
      retryable: false,
      hostGeneration: 1,
      logSequence: 0,
      logs: [] as Array<{ sequence: number; stream: string; message: string }>,
    },
  };
}

describe('Desktop Electron local-development registration host', () => {
  it('accepts the internal automatic CDP selector without admitting privileged fixed ports', () => {
    assert.equal(localDevelopmentCdpPort(0), 0);
    assert.equal(localDevelopmentCdpPort(19483), 19483);
    assert.throws(() => localDevelopmentCdpPort(80), /local-development-cdp-port-invalid/u);
  });

  it('defaults route presentation to both and rejects an invalid declared set', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'nimi-ai-config-routes-test-'));
    const manifestPath = path.join(projectRoot, 'nimi.app.yaml');
    try {
      await writeFile(manifestPath, 'app_id: example.local-app\n', 'utf8');
      assert.deepEqual(await readElectronAIConfigAllowedRoutes(manifestPath), ['local', 'cloud']);
      await writeFile(manifestPath, 'ai_config_ui:\n  allowed_routes:\n    - local\n    - local\n', 'utf8');
      await assert.rejects(
        readElectronAIConfigAllowedRoutes(manifestPath),
        /local-development-project-changed/u,
      );
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('projects registration selectors without exposing management handles', async () => {
    const host = new ElectronLocalDevelopmentHost(control(), '/tmp');
    const rows = await host.invoke('local_development_registrations_list', {}) as Array<Record<string, unknown>>;

    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.appId, 'example.local-app');
    assert.deepEqual(rows[0]?.appAccess, ['realm.data', 'future.unknown']);
    assert.deepEqual(rows[0]?.aiConfigAllowedRoutes, ['local', 'cloud']);
    assert.equal(rows[0]?.sourceGeneration, 3);
    assert.equal(rows[0]?.declarationGeneration, 4);
    assert.match(String(rows[0]?.selector), /^dev-project-/u);
    assert.equal(JSON.stringify(rows).includes(HANDLE), false);
  });

  it('isolates stale registrations whose submitted manifest no longer exists', async () => {
    const valid = registration();
    const stale = registration({
      registrationHandle: '33'.repeat(32),
      project: {
        ...valid.project,
        appId: 'stale.local-app',
        canonicalProjectRoot: path.resolve('missing-local-app'),
        canonicalManifestPath: path.resolve('missing-local-app', 'nimi.app.yaml'),
      },
    });
    const host = new ElectronLocalDevelopmentHost(control({
      listRegistrations: async () => [stale, valid],
    }), '/tmp');

    const rows = await host.invoke('local_development_registrations_list', {}) as Array<Record<string, unknown>>;
    assert.deepEqual(rows.map((row) => row.appId), ['example.local-app']);
  });

  it('removes by renderer selector and never accepts the private handle directly', async () => {
    const removed: string[] = [];
    const host = new ElectronLocalDevelopmentHost(control({
      removeRegistration: async (handle) => { removed.push(handle); },
    }), '/tmp');
    const [row] = await host.invoke('local_development_registrations_list', {}) as Array<{ selector: string }>;

    assert.deepEqual(await host.invoke('local_development_registration_remove', {
      payload: { selector: row!.selector },
    }), { selector: row!.selector, removed: true });
    assert.deepEqual(removed, [HANDLE]);

    await assert.rejects(
      host.invoke('local_development_registration_remove', { payload: { selector: HANDLE } }),
      /local-development-selector-invalid/u,
    );
  });

  it('preserves the registration when removal cannot finish Host cleanup', async () => {
    let cleanupFails = true;
    const removed: string[] = [];
    const host = new ElectronLocalDevelopmentHost(control({
      terminateHost: async () => {
        if (cleanupFails) throw new Error('terminate failed');
      },
      removeRegistration: async (handle) => { removed.push(handle); },
    }), '/tmp');
    const run = activeRun();
    run.registrationHandle = undefined;
    run.stopped = true;
    run.stoppedCleanupComplete = false;
    run.status.state = 'cleanup-failed';
    const internal = host as unknown as {
      runs: Map<string, ReturnType<typeof activeRun>>;
      registrationSelectors: Map<string, string>;
      resolveRegistration(context: typeof run): Promise<void>;
      startSupervisor(context: typeof run): void;
    };
    internal.registrationSelectors.set('dev-project-example', HANDLE);
    internal.runs.set(run.status.runId, run);

    await assert.rejects(
      host.invoke('local_development_registration_remove', {
        payload: { selector: 'dev-project-example' },
      }),
      /local-development-process-cleanup-failed/u,
    );
    assert.deepEqual(removed, []);
    assert.equal(internal.registrationSelectors.get('dev-project-example'), HANDLE);

    const freshRun = activeRun();
    freshRun.intentSequence = 2;
    freshRun.status.runId = 'dev-run-after-remove-failure';
    freshRun.status.state = 'preparing';
    freshRun.status.hostGeneration = 0;
    freshRun.registrationOwnerHandle = undefined;
    freshRun.registrationHandle = undefined;
    let supervisorStarts = 0;
    internal.runs.set(freshRun.status.runId, freshRun);
    internal.startSupervisor = () => { supervisorStarts += 1; };
    await internal.resolveRegistration(freshRun);
    assert.equal(supervisorStarts, 1);
    assert.equal(freshRun.registrationHandle, HANDLE);

    cleanupFails = false;
    assert.deepEqual(await host.invoke('local_development_registration_remove', {
      payload: { selector: 'dev-project-example' },
    }), { selector: 'dev-project-example', removed: true });
    assert.deepEqual(removed, [HANDLE]);
    assert.equal(internal.registrationSelectors.has('dev-project-example'), false);
    assert.equal(run.stoppedCleanupComplete, true);
    assert.equal(freshRun.stoppedCleanupComplete, true);
  });

  it('starts a listed project as a Desktop-managed supervised run', async () => {
    const host = new ElectronLocalDevelopmentHost(control(), '/tmp');
    const [row] = await host.invoke('local_development_registrations_list', {}) as Array<{ selector: string }>;
    let captured: readonly unknown[] = [];
    const commandHost = host as unknown as {
      startIntent: (...args: readonly unknown[]) => Promise<ReturnType<typeof activeRun>['status']>;
    };
    commandHost.startIntent = async (...args) => {
      captured = args;
      return activeRun().status;
    };

    const result = await host.invoke('local_development_registration_start', {
      payload: { selector: row!.selector },
    }) as Record<string, unknown>;

    assert.deepEqual(captured, ['example.local-app', '/projects/example', 'electron', undefined, true, HANDLE]);
    assert.equal(result.state, 'running');
    assert.equal(result.appId, 'example.local-app');
  });

  it('starts Zhiyu only when exactly one canonical local-development registration resolves', async () => {
    const base = registration();
    const zhiyu = registration({
      project: { ...base.project, appId: 'nimi.zhiyu', displayName: 'Zhiyu' },
    });
    const host = new ElectronLocalDevelopmentHost(control({ listRegistrations: async () => [zhiyu] }), '/tmp');
    let starts = 0;
    const internal = host as unknown as {
      startIntent: (...args: readonly unknown[]) => Promise<ReturnType<typeof activeRun>['status']>;
    };
    internal.startIntent = async (...args) => {
      starts += 1;
      assert.deepEqual(args, ['nimi.zhiyu', '/projects/example', 'electron', undefined, true, HANDLE]);
      return { ...activeRun().status, appId: 'nimi.zhiyu' };
    };
    assert.equal(await host.startExactZhiyu(), true);
    assert.equal(starts, 1);

    const duplicate = registration({
      registrationHandle: '44'.repeat(32),
      project: { ...base.project, appId: 'nimi.zhiyu', displayName: 'Zhiyu duplicate' },
    });
    const ambiguous = new ElectronLocalDevelopmentHost(control({
      listRegistrations: async () => [zhiyu, duplicate],
    }), '/tmp');
    assert.equal(await ambiguous.startExactZhiyu(), false);
  });

  it('starts an existing registration by exact handle without registering a new Subject', async () => {
    const existing = registration();
    let registerCalls = 0;
    let starts = 0;
    const host = new ElectronLocalDevelopmentHost(control({
      register: async () => {
        registerCalls += 1;
        throw new Error('existing registration must not be reminted');
      },
      listRegistrations: async () => [existing],
    }), '/tmp');
    const internal = host as unknown as {
      startIntent: (...args: readonly unknown[]) => Promise<ReturnType<typeof activeRun>['status']>;
    };
    internal.startIntent = async (...args) => {
      starts += 1;
      assert.deepEqual(args, [
        'example.local-app',
        '/projects/example',
        'electron',
        undefined,
        true,
        HANDLE,
      ]);
      return activeRun().status;
    };
    const [row] = await host.invoke('local_development_registrations_list', {}) as Array<{ selector: string }>;

    await host.invoke('local_development_registration_start', { payload: { selector: row!.selector } });

    assert.equal(registerCalls, 0);
    assert.equal(starts, 1);
  });

  it('does not remint after an ambiguous fresh-registration response loss', async () => {
    let registerCalls = 0;
    const host = new ElectronLocalDevelopmentHost(control({
      register: async () => {
        registerCalls += 1;
        throw Object.assign(new Error('runtime response unavailable'), {
          reasonCode: 'runtime-service-unavailable',
        });
      },
    }), '/tmp');
    const run = activeRun();
    run.registrationHandle = undefined;
    run.status.state = 'preparing';
    const internal = host as unknown as {
      resolveRegistration(context: typeof run): Promise<void>;
      refreshRegistration(context: typeof run): Promise<void>;
    };

    await internal.resolveRegistration(run);
    await internal.refreshRegistration(run);

    assert.equal(registerCalls, 1);
    assert.equal(run.registrationHandle, undefined);
    assert.equal(run.status.state, 'registration-unavailable');
    assert.equal(run.status.retryable, false);
  });

  it('ends a registration that resolves after its preparing run was canceled', async () => {
    let resolveRegister!: (value: NimiElectronLocalDevelopmentRegistration) => void;
    let markRegisterStarted!: () => void;
    const registerResult = new Promise<NimiElectronLocalDevelopmentRegistration>((resolve) => {
      resolveRegister = resolve;
    });
    const registerStarted = new Promise<void>((resolve) => {
      markRegisterStarted = resolve;
    });
    const ended: Array<readonly [string, string]> = [];
    const host = new ElectronLocalDevelopmentHost(control({
      register: async () => {
        markRegisterStarted();
        return registerResult;
      },
      endRun: async (registrationHandle, supervisorRunId) => {
        ended.push([registrationHandle, supervisorRunId]);
      },
    }), '/tmp');
    const run = activeRun();
    run.registrationOwnerHandle = undefined;
    run.registrationHandle = undefined;
    run.status.state = 'preparing';
    run.status.hostGeneration = 0;
    const internal = host as unknown as {
      resolveRegistration(context: typeof run): Promise<void>;
      stopRun(context: typeof run, state: string): Promise<void>;
    };

    const resolving = internal.resolveRegistration(run);
    await registerStarted;
    await internal.stopRun(run, 'stopped');
    resolveRegister(registration());
    await resolving;

    assert.equal(run.registrationOwnerHandle, HANDLE);
    assert.equal(run.registrationHandle, undefined);
    assert.equal(run.pendingEndRunRegistrationHandle, undefined);
    assert.equal(run.stoppedCleanupComplete, true);
    assert.deepEqual(ended, [[HANDLE, SUPERVISOR]]);
  });

  it('does not launch a registration removed before its fresh response returns', async () => {
    let resolveRegister!: (value: NimiElectronLocalDevelopmentRegistration) => void;
    let markRegisterStarted!: () => void;
    const registerResult = new Promise<NimiElectronLocalDevelopmentRegistration>((resolve) => {
      resolveRegister = resolve;
    });
    const registerStarted = new Promise<void>((resolve) => {
      markRegisterStarted = resolve;
    });
    const removed: string[] = [];
    const ended: Array<readonly [string, string]> = [];
    const host = new ElectronLocalDevelopmentHost(control({
      register: async () => {
        markRegisterStarted();
        return registerResult;
      },
      removeRegistration: async (handle) => { removed.push(handle); },
      endRun: async (registrationHandle, supervisorRunId) => {
        ended.push([registrationHandle, supervisorRunId]);
      },
    }), '/tmp');
    const run = activeRun();
    run.registrationOwnerHandle = undefined;
    run.registrationHandle = undefined;
    run.status.state = 'preparing';
    run.status.hostGeneration = 0;
    let supervisorStarts = 0;
    const internal = host as unknown as {
      runs: Map<string, ReturnType<typeof activeRun>>;
      registrationSelectors: Map<string, string>;
      resolveRegistration(context: typeof run): Promise<void>;
      startSupervisor(context: typeof run): void;
    };
    internal.runs.set(run.status.runId, run);
    internal.registrationSelectors.set('dev-project-example', HANDLE);
    internal.startSupervisor = () => { supervisorStarts += 1; };

    const resolving = internal.resolveRegistration(run);
    await registerStarted;
    assert.deepEqual(await host.invoke('local_development_registration_remove', {
      payload: { selector: 'dev-project-example' },
    }), { selector: 'dev-project-example', removed: true });
    resolveRegister(registration());
    await resolving;

    assert.deepEqual(removed, [HANDLE]);
    assert.deepEqual(ended, [[HANDLE, SUPERVISOR]]);
    assert.equal(supervisorStarts, 0);
    assert.equal(run.registrationHandle, undefined);
    assert.equal(run.stoppedCleanupComplete, true);
  });

  it('keeps the old-response cutoff when an exact Launch fails after Remove', async () => {
    let resolveRegister!: (value: NimiElectronLocalDevelopmentRegistration) => void;
    let markRegisterStarted!: () => void;
    const registerResult = new Promise<NimiElectronLocalDevelopmentRegistration>((resolve) => {
      resolveRegister = resolve;
    });
    const registerStarted = new Promise<void>((resolve) => {
      markRegisterStarted = resolve;
    });
    let endRunCalls = 0;
    const host = new ElectronLocalDevelopmentHost(control({
      register: async () => {
        markRegisterStarted();
        return registerResult;
      },
      listRegistrations: async () => { throw new Error('list failed'); },
      removeRegistration: async () => { throw new Error('remove failed'); },
      endRun: async () => { endRunCalls += 1; },
    }), '/tmp');
    const run = activeRun();
    run.registrationOwnerHandle = undefined;
    run.registrationHandle = undefined;
    run.status.state = 'preparing';
    run.status.hostGeneration = 0;
    let supervisorStarts = 0;
    const internal = host as unknown as {
      runs: Map<string, ReturnType<typeof activeRun>>;
      registrationSelectors: Map<string, string>;
      resolveRegistration(context: typeof run): Promise<void>;
      startSupervisor(context: typeof run): void;
    };
    internal.runs.set(run.status.runId, run);
    internal.registrationSelectors.set('dev-project-example', HANDLE);
    internal.startSupervisor = () => { supervisorStarts += 1; };

    const resolving = internal.resolveRegistration(run);
    await registerStarted;
    await assert.rejects(
      host.invoke('local_development_registration_remove', {
        payload: { selector: 'dev-project-example' },
      }),
      /remove failed/u,
    );
    await assert.rejects(
      host.invoke('local_development_registration_start', {
        payload: { selector: 'dev-project-example' },
      }),
      /list failed/u,
    );
    resolveRegister(registration());
    await resolving;

    assert.equal(supervisorStarts, 0);
    assert.equal(endRunCalls, 1);
    assert.equal(run.registrationHandle, undefined);
    assert.equal(run.stoppedCleanupComplete, true);
  });

  it('keeps the removal high-water mark after a newer changed-plan intent succeeds', async () => {
    const registerResolvers: Array<(value: NimiElectronLocalDevelopmentRegistration) => void> = [];
    const started: string[] = [];
    let endRunCalls = 0;
    const host = new ElectronLocalDevelopmentHost(control({
      register: async () => new Promise<NimiElectronLocalDevelopmentRegistration>((resolve) => {
        registerResolvers.push(resolve);
      }),
      removeRegistration: async () => { throw new Error('remove failed'); },
      endRun: async () => { endRunCalls += 1; },
    }), '/tmp');
    const oldRun = activeRun();
    oldRun.plan = { ...oldRun.plan, rendererOrigin: 'http://127.0.0.1:1421' };
    oldRun.status.runId = 'dev-run-old-plan';
    oldRun.status.state = 'preparing';
    oldRun.registrationOwnerHandle = undefined;
    oldRun.registrationHandle = undefined;
    const newRun = activeRun();
    newRun.intentSequence = 2;
    newRun.status.runId = 'dev-run-new-plan';
    newRun.status.state = 'preparing';
    newRun.registrationOwnerHandle = undefined;
    newRun.registrationHandle = undefined;
    const internal = host as unknown as {
      runs: Map<string, ReturnType<typeof activeRun>>;
      registrationSelectors: Map<string, string>;
      resolveRegistration(context: typeof oldRun): Promise<void>;
      startSupervisor(context: typeof oldRun): void;
    };
    internal.runs.set(oldRun.status.runId, oldRun);
    internal.runs.set(newRun.status.runId, newRun);
    internal.registrationSelectors.set('dev-project-example', HANDLE);
    internal.startSupervisor = (run) => { started.push(run.status.runId); };

    const oldResolving = internal.resolveRegistration(oldRun);
    await assert.rejects(
      host.invoke('local_development_registration_remove', {
        payload: { selector: 'dev-project-example' },
      }),
      /remove failed/u,
    );
    const newResolving = internal.resolveRegistration(newRun);
    assert.equal(registerResolvers.length, 2);

    registerResolvers[1]!(registration());
    await newResolving;
    registerResolvers[0]!(registration());
    await oldResolving;

    assert.deepEqual(started, ['dev-run-new-plan']);
    assert.equal(newRun.registrationHandle, HANDLE);
    assert.equal(oldRun.registrationHandle, undefined);
    assert.equal(oldRun.stoppedCleanupComplete, true);
    assert.equal(endRunCalls, 1);
  });

  it('projects only the latest run for an exact registration selector', async () => {
    const host = new ElectronLocalDevelopmentHost(control(), '/tmp');
    const oldRun = activeRun();
    oldRun.status.runId = 'dev-run-old';
    oldRun.status.state = 'launcher-disconnected';
    oldRun.stopped = true;
    oldRun.stoppedCleanupComplete = true;
    const currentRun = activeRun();
    currentRun.status.runId = 'dev-run-current';
    const internal = host as unknown as {
      runs: Map<string, ReturnType<typeof activeRun>>;
      registrationSelectors: Map<string, string>;
    };
    internal.registrationSelectors.set('dev-project-example', HANDLE);
    internal.runs.set(oldRun.status.runId, oldRun);
    internal.runs.set(currentRun.status.runId, currentRun);

    const runs = await host.invoke('local_development_runs_list', {}) as Array<Record<string, unknown>>;

    assert.equal(runs.length, 1);
    assert.equal(runs[0]?.selector, 'dev-project-example');
    assert.equal(runs[0]?.appId, 'example.local-app');
    assert.equal(runs[0]?.state, 'running');
  });

  it('keeps same-app registrations distinct and stops only the selected run', async () => {
    const secondHandle = '44'.repeat(32);
    const secondSupervisor = '55'.repeat(32);
    const first = registration();
    const second = registration({ registrationHandle: secondHandle });
    const terminated: string[] = [];
    const ended: Array<readonly [string, string]> = [];
    const host = new ElectronLocalDevelopmentHost(control({
      listRegistrations: async () => [first, second],
      terminateHost: async (supervisorRunId) => { terminated.push(supervisorRunId); },
      endRun: async (registrationHandle, supervisorRunId) => {
        ended.push([registrationHandle, supervisorRunId]);
      },
    }), '/tmp');
    const registrations = await host.invoke(
      'local_development_registrations_list',
      {},
    ) as Array<{ selector: string }>;
    assert.equal(registrations.length, 2);

    const firstRun = activeRun();
    firstRun.status.runId = 'dev-run-first';
    const secondRun = activeRun();
    secondRun.status.runId = 'dev-run-second';
    secondRun.supervisorRunId = secondSupervisor;
    secondRun.registrationOwnerHandle = secondHandle;
    secondRun.registrationHandle = secondHandle;
    const internal = host as unknown as {
      runs: Map<string, ReturnType<typeof activeRun>>;
    };
    internal.runs.set(firstRun.status.runId, firstRun);
    internal.runs.set(secondRun.status.runId, secondRun);

    const projected = await host.invoke(
      'local_development_runs_list',
      {},
    ) as Array<{ selector: string }>;
    assert.deepEqual(
      new Set(projected.map((run) => run.selector)),
      new Set(registrations.map((row) => row.selector)),
    );

    await host.invoke('local_development_run_stop', {
      payload: { selector: registrations[0]!.selector },
    });

    assert.equal(firstRun.stopped, true);
    assert.equal(secondRun.stopped, false);
    assert.deepEqual(terminated, [SUPERVISOR]);
    assert.deepEqual(ended, [[HANDLE, SUPERVISOR]]);
  });

  it('treats a repeated selector stop as idempotent after real teardown', async () => {
    let terminateCalls = 0;
    let endRunCalls = 0;
    const host = new ElectronLocalDevelopmentHost(control({
      terminateHost: async () => { terminateCalls += 1; },
      endRun: async () => { endRunCalls += 1; },
    }), '/tmp');
    const stoppedRun = activeRun();
    const internal = host as unknown as {
      runs: Map<string, ReturnType<typeof activeRun>>;
      registrationSelectors: Map<string, string>;
    };
    internal.registrationSelectors.set('dev-project-example', HANDLE);
    internal.runs.set(stoppedRun.status.runId, stoppedRun);

    assert.deepEqual(await host.invoke('local_development_run_stop', {
      payload: { selector: 'dev-project-example' },
    }), { selector: 'dev-project-example', stopped: true });
    assert.equal(stoppedRun.registrationHandle, undefined);
    assert.equal(stoppedRun.stoppedCleanupComplete, true);
    assert.deepEqual(await host.invoke('local_development_run_stop', {
      payload: { selector: 'dev-project-example' },
    }), { selector: 'dev-project-example', stopped: true });
    assert.equal(terminateCalls, 1);
    assert.equal(endRunCalls, 1);
    await assert.rejects(
      host.invoke('local_development_run_stop', { payload: { selector: 'dev-project-missing' } }),
      /local-development-run-not-found/u,
    );
  });

  it('joins overlapping selector stops onto one teardown', async () => {
    let terminateCalls = 0;
    let endRunCalls = 0;
    let releaseTerminate!: () => void;
    let markTerminateStarted!: () => void;
    const terminateGate = new Promise<void>((resolve) => {
      releaseTerminate = resolve;
    });
    const terminateStarted = new Promise<void>((resolve) => {
      markTerminateStarted = resolve;
    });
    const host = new ElectronLocalDevelopmentHost(control({
      terminateHost: async () => {
        terminateCalls += 1;
        markTerminateStarted();
        await terminateGate;
      },
      endRun: async () => { endRunCalls += 1; },
    }), '/tmp');
    const run = activeRun();
    const internal = host as unknown as {
      runs: Map<string, ReturnType<typeof activeRun>>;
      registrationSelectors: Map<string, string>;
    };
    internal.registrationSelectors.set('dev-project-example', HANDLE);
    internal.runs.set(run.status.runId, run);

    const first = host.invoke('local_development_run_stop', {
      payload: { selector: 'dev-project-example' },
    });
    await terminateStarted;
    const second = host.invoke('local_development_run_stop', {
      payload: { selector: 'dev-project-example' },
    });
    releaseTerminate();

    assert.deepEqual(await Promise.all([first, second]), [
      { selector: 'dev-project-example', stopped: true },
      { selector: 'dev-project-example', stopped: true },
    ]);
    assert.equal(terminateCalls, 1);
    assert.equal(endRunCalls, 1);
    assert.equal(run.stoppedCleanupComplete, true);
  });

  it('serializes an explicit Stop after an in-flight fail-closed teardown', async () => {
    let terminateCalls = 0;
    let concurrentTerminateCalls = 0;
    let maxConcurrentTerminateCalls = 0;
    let endRunCalls = 0;
    let releaseFirstTerminate!: () => void;
    let markFirstTerminateStarted!: () => void;
    const firstTerminateGate = new Promise<void>((resolve) => {
      releaseFirstTerminate = resolve;
    });
    const firstTerminateStarted = new Promise<void>((resolve) => {
      markFirstTerminateStarted = resolve;
    });
    const host = new ElectronLocalDevelopmentHost(control({
      terminateHost: async () => {
        terminateCalls += 1;
        concurrentTerminateCalls += 1;
        maxConcurrentTerminateCalls = Math.max(maxConcurrentTerminateCalls, concurrentTerminateCalls);
        if (terminateCalls === 1) {
          markFirstTerminateStarted();
          await firstTerminateGate;
        }
        concurrentTerminateCalls -= 1;
      },
      endRun: async () => { endRunCalls += 1; },
    }), '/tmp');
    const run = activeRun();
    const internal = host as unknown as {
      failClosedRun(context: typeof run, outcome: {
        state: string;
        message: string;
        reasonCode: string;
        retryable: boolean;
        endRun: boolean;
        resumeRegistrationRefresh: boolean;
      }): Promise<void>;
      stopRun(context: typeof run, state: string): Promise<void>;
    };

    const failingClosed = internal.failClosedRun(run, {
      state: 'runtime-unavailable',
      message: 'runtime unavailable',
      reasonCode: 'runtime-service-unavailable',
      retryable: true,
      endRun: false,
      resumeRegistrationRefresh: true,
    });
    await firstTerminateStarted;
    const stopping = internal.stopRun(run, 'stopped');
    releaseFirstTerminate();
    await Promise.all([failingClosed, stopping]);

    assert.equal(terminateCalls, 2);
    assert.equal(maxConcurrentTerminateCalls, 1);
    assert.equal(endRunCalls, 1);
    assert.equal(run.status.state, 'stopped');
    assert.equal(run.stoppedCleanupComplete, true);
  });

  it('physically rejects retired decision commands', async () => {
    const host = new ElectronLocalDevelopmentHost(control(), '/tmp');
    await assert.rejects(
      host.invoke('local_development_decide', { payload: {} }),
      /local-development-command-unavailable/u,
    );
  });

  it('compares the Runtime-resolved registration to the exact launch project', () => {
    assert.equal(sameLocalDevelopmentProject(registration(), plan()), true);
    assert.equal(sameLocalDevelopmentProject(registration({
      project: { ...registration().project, appId: 'other.app' },
    }), plan()), false);
  });

  it('separates transport failures from registration failures', () => {
    assert.equal(resolveLocalDevelopmentRegistrationFailureState('runtime-service-unavailable'), 'runtime-unavailable');
    assert.equal(resolveLocalDevelopmentRegistrationFailureState('local-app-developer-mode-disabled'), 'registration-unavailable');
    assert.equal(isLocalDevelopmentRuntimeTransportFailure('runtime-service-untrusted'), true);
    assert.equal(isLocalDevelopmentRuntimeTransportFailure('runtime-service-error-unclassified'), true);
    assert.equal(isLocalDevelopmentRuntimeTransportFailure('local-development-project-changed'), false);
    assert.match(
      localDevelopmentFailureMessage('runtime-service-untrusted'),
      /source-local-development.*do not request privilege elevation/iu,
    );
    assert.equal(
      localDevelopmentFailureMessage('local-development-project-changed'),
      'local-development-project-changed',
    );
  });

  it('preserves the same Host across Runtime transport loss and restores running after rebind', async () => {
    let transportAvailable = false;
    let terminateCalls = 0;
    const appControl = control({
      listRegistrations: async () => {
        if (!transportAvailable) {
          throw Object.assign(new Error('runtime-service-unavailable'), {
            reasonCode: 'runtime-service-unavailable',
          });
        }
        return [registration()];
      },
      hostRunning: async () => true,
      terminateHost: async () => { terminateCalls += 1; },
    });
    const host = new ElectronLocalDevelopmentHost(appControl, '/tmp');
    const run = {
      plan: plan(),
      supervisorRunId: SUPERVISOR,
      registrationHandle: HANDLE,
      stopped: false,
      tearingDown: false,
      supervising: false,
      rebuilding: false,
      rebuildRequested: false,
      refreshingRegistration: false,
      recoveringRuntimeTransport: false,
      renderer: {},
      status: {
        schemaVersion: 1,
        runId: 'dev-run-example',
        state: 'running',
        appId: 'example.local-app',
        displayName: 'Example Local App',
        canonicalProjectRoot: '/projects/example',
        shell: 'electron',
        rendererOrigin: 'http://127.0.0.1:1420',
        message: 'Supervised electron host is running',
        retryable: false,
        hostGeneration: 1,
        logSequence: 0,
        logs: [],
      },
    };
    const healthHost = host as unknown as {
      refreshRegistration(context: typeof run): Promise<void>;
    };

    await healthHost.refreshRegistration(run);
    assert.equal(run.status.state, 'runtime-unavailable');
    assert.match(run.status.message, /source-local-development.*do not request privilege elevation/iu);
    assert.equal(run.recoveringRuntimeTransport, true);
    assert.equal(run.registrationHandle, HANDLE);
    assert.equal(terminateCalls, 0);

    transportAvailable = true;
    await healthHost.refreshRegistration(run);
    assert.equal(run.status.state, 'running');
    assert.equal(run.recoveringRuntimeTransport, false);
    assert.equal(run.status.hostGeneration, 1);
    assert.equal(terminateCalls, 0);
  });

  it('ends the run when its Host exits during Runtime transport recovery', async () => {
    let transportAvailable = false;
    let terminateCalls = 0;
    let endRunCalls = 0;
    const host = new ElectronLocalDevelopmentHost(control({
      listRegistrations: async () => {
        if (!transportAvailable) {
          throw Object.assign(new Error('runtime-service-unavailable'), {
            reasonCode: 'runtime-service-unavailable',
          });
        }
        return [registration()];
      },
      hostRunning: async () => false,
      terminateHost: async () => { terminateCalls += 1; },
      endRun: async () => { endRunCalls += 1; },
    }), '/tmp');
    const run = activeRun();
    run.renderer = {};
    const healthHost = host as unknown as {
      refreshRegistration(context: typeof run): Promise<void>;
    };

    await healthHost.refreshRegistration(run);
    assert.equal(run.status.state, 'runtime-unavailable');
    assert.equal(run.recoveringRuntimeTransport, true);

    transportAvailable = true;
    await healthHost.refreshRegistration(run);

    assert.equal(run.recoveringRuntimeTransport, false);
    assert.equal(run.stopped, true);
    assert.equal(run.stoppedCleanupComplete, true);
    assert.equal(run.status.state, 'stopped');
    assert.equal(run.renderer, undefined);
    assert.equal(terminateCalls, 1);
    assert.equal(endRunCalls, 1);
  });

  it('starts one full supervisor after recovery when renderer cleanup removed the prior Host', async () => {
    const host = new ElectronLocalDevelopmentHost(control({
      hostRunning: async () => false,
    }), '/tmp');
    const run = activeRun();
    let supervisorStarts = 0;
    let hostReplacements = 0;
    Reflect.set(host, 'startSupervisor', () => { supervisorStarts += 1; });
    Reflect.set(host, 'replaceHost', async () => { hostReplacements += 1; });
    const healthHost = host as unknown as {
      refreshRegistration(context: typeof run): Promise<void>;
    };

    await healthHost.refreshRegistration(run);

    assert.equal(supervisorStarts, 1);
    assert.equal(hostReplacements, 0);
  });

  it('waits for an in-flight health refresh before rebuilding the Host', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'nimi-rebuild-test-'));
    try {
      const sourceRoot = path.join(projectRoot, 'src-electron');
      await mkdir(sourceRoot);
      await writeFile(path.join(sourceRoot, 'main.ts'), 'export const generation = 2;\n', 'utf8');
      const host = new ElectronLocalDevelopmentHost(control(), '/tmp');
      const run = activeRun();
      run.plan = { ...run.plan, projectRoot };
      run.renderer = {};
      run.electronSourceFingerprint = 'previous-source';
      const order: string[] = [];
      let completeRefresh!: () => void;
      run.refreshRegistrationPromise = new Promise<void>((resolve) => { completeRefresh = resolve; });
      Reflect.set(host, 'runPackageScript', async () => { order.push('build'); });
      Reflect.set(host, 'replaceHost', async () => { order.push('replace'); });
      const rebuildHost = host as unknown as {
        rebuild(context: typeof run): Promise<void>;
      };

      const rebuilding = rebuildHost.rebuild(run);
      await Promise.resolve();
      assert.deepEqual(order, []);

      completeRefresh();
      await rebuilding;
      assert.deepEqual(order, ['build', 'replace']);
      assert.equal(run.status.state, 'restarting');
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('restarts the full supervisor when health recovery removed the renderer before rebuilding', async () => {
    const host = new ElectronLocalDevelopmentHost(control(), '/tmp');
    const run = activeRun();
    run.renderer = {};
    let supervisorStarts = 0;
    let packageBuilds = 0;
    let completeRefresh!: () => void;
    run.refreshRegistrationPromise = new Promise<void>((resolve) => { completeRefresh = resolve; });
    Reflect.set(host, 'startSupervisor', () => { supervisorStarts += 1; });
    Reflect.set(host, 'runPackageScript', async () => { packageBuilds += 1; });
    const rebuildHost = host as unknown as {
      rebuild(context: typeof run): Promise<void>;
    };

    const rebuilding = rebuildHost.rebuild(run);
    run.renderer = undefined;
    completeRefresh();
    await rebuilding;

    assert.equal(supervisorStarts, 1);
    assert.equal(packageBuilds, 0);
  });

  it('revokes the previous Runtime run lease before launching a replacement Host', async () => {
    const order: string[] = [];
    const host = new ElectronLocalDevelopmentHost(control({
      terminateHost: async () => { order.push('terminate'); },
      endRun: async () => { order.push('end-run'); },
    }), '/tmp');
    Reflect.set(host, 'launchHost', async () => { order.push('launch'); });
    const run = activeRun();
    const replacementHost = host as unknown as {
      replaceHost(context: typeof run): Promise<void>;
    };

    await replacementHost.replaceHost(run);

    assert.deepEqual(order, ['end-run', 'terminate', 'launch']);
    assert.equal(run.registrationHandle, HANDLE);
  });

  it('fingerprints src-electron content without treating timestamp changes as edits', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'nimi-source-watch-test-'));
    try {
      const sourceRoot = path.join(projectRoot, 'src-electron');
      const mainPath = path.join(sourceRoot, 'main.ts');
      await mkdir(sourceRoot);
      await writeFile(mainPath, 'export const generation = 1;\n', 'utf8');
      const initial = await captureLocalDevelopmentElectronSourceFingerprint(sourceRoot);

      const touchedAt = new Date(Date.now() + 2_000);
      await utimes(mainPath, touchedAt, touchedAt);
      assert.equal(await captureLocalDevelopmentElectronSourceFingerprint(sourceRoot), initial);

      await writeFile(mainPath, 'export const generation = 2;\n', 'utf8');
      assert.notEqual(await captureLocalDevelopmentElectronSourceFingerprint(sourceRoot), initial);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('ends the run when its supervised Host exits instead of launching a replacement', async () => {
    const terminated: string[] = [];
    const ended: Array<readonly [string, string]> = [];
    let removed = 0;
    let replacements = 0;
    const host = new ElectronLocalDevelopmentHost(control({
      terminateHost: async (supervisorRunId) => { terminated.push(supervisorRunId); },
      endRun: async (registrationHandle, supervisorRunId) => {
        ended.push([registrationHandle, supervisorRunId]);
      },
      removeRegistration: async () => { removed += 1; },
    }), '/tmp');
    Reflect.set(host, 'replaceHost', async () => { replacements += 1; });
    const run = activeRun();
    run.renderer = {};
    let watcherClosed = 0;
    run.watcher = { close: () => { watcherClosed += 1; } };
    run.healthTimer = setInterval(() => {}, 60_000);
    const healthHost = host as unknown as {
      refreshRegistration(context: typeof run): Promise<void>;
    };

    try {
      await healthHost.refreshRegistration(run);
      assert.deepEqual(terminated, [SUPERVISOR]);
      assert.deepEqual(ended, [[HANDLE, SUPERVISOR]]);
      assert.equal(removed, 0);
      assert.equal(replacements, 0);
      assert.equal(run.registrationHandle, undefined);
      assert.equal(run.pendingEndRunRegistrationHandle, undefined);
      assert.equal(run.renderer, undefined);
      assert.equal(run.watcher, undefined);
      assert.equal(watcherClosed, 1);
      assert.equal(run.healthTimer, undefined);
      assert.equal(run.stopped, true);
      assert.equal(run.stoppedCleanupComplete, true);
      assert.equal(run.status.state, 'stopped');
      assert.equal(run.status.reasonCode, undefined);
      assert.equal(run.status.retryable, false);
      assert.equal(run.status.hostGeneration, 1);
      assert.match(run.status.logs.at(-1)?.message ?? '', /host exited; ending the development run/u);
    } finally {
      if (run.healthTimer) clearInterval(run.healthTimer);
    }
  });

  it('retries the idempotent endRun once after a stale Runtime transport failure', async () => {
    let calls = 0;
    const host = new ElectronLocalDevelopmentHost(control({
      endRun: async () => {
        calls += 1;
        if (calls === 1) {
          throw Object.assign(new Error('runtime-service-unavailable'), {
            reasonCode: 'runtime-service-unavailable',
          });
        }
      },
    }), '/tmp');
    const cleanupHost = host as unknown as {
      endRunWithTransportRetry(registrationHandle: string, supervisorRunId: string): Promise<void>;
    };

    await cleanupHost.endRunWithTransportRetry(HANDLE, SUPERVISOR);
    assert.equal(calls, 2);
  });

  it('ends the run when the launcher stops renewing its lease', async () => {
    let terminated = 0;
    let ended = 0;
    const host = new ElectronLocalDevelopmentHost(control({
      terminateHost: async () => { terminated += 1; },
      endRun: async () => { ended += 1; },
    }), '/tmp', 25);
    const run = {
      plan: plan(),
      supervisorRunId: SUPERVISOR,
      registrationHandle: HANDLE,
      stopped: false,
      tearingDown: false,
      supervising: false,
      rebuilding: false,
      rebuildRequested: false,
      refreshingRegistration: false,
      recoveringRuntimeTransport: false,
      status: {
        schemaVersion: 1,
        runId: 'dev-run-example',
        state: 'running',
        appId: 'example.local-app',
        displayName: 'Example Local App',
        canonicalProjectRoot: '/projects/example',
        shell: 'electron',
        rendererOrigin: 'http://127.0.0.1:1420',
        message: 'Supervised electron host is running',
        retryable: false,
        hostGeneration: 1,
        logSequence: 0,
        logs: [],
      },
    };
    const leaseHost = host as unknown as {
      touchLauncherLease(context: typeof run): void;
      stopRun(context: typeof run, state: string): Promise<void>;
    };

    leaseHost.touchLauncherLease(run);
    await new Promise((resolve) => setTimeout(resolve, 75));

    assert.equal(run.stopped, true);
    assert.equal(run.status.state, 'launcher-disconnected');
    assert.equal(terminated, 1);
    assert.equal(ended, 1);

    await leaseHost.stopRun(run, 'stopped');
    assert.equal(terminated, 1);
    assert.equal(ended, 1);
  });

  it('uses a positional source Electron entry only for source local development', () => {
    const base = {
      mainEntry: '/projects/example/dist/main.js',
      rendererOrigin: 'http://127.0.0.1:1420',
      userDataArguments: ['--user-data-dir=/tmp/example'],
      platform: 'darwin' as const,
    };
    assert.ok(resolveLocalDevelopmentElectronHostLaunch(base).arguments.includes(
      '--nimi-local-app-main=/projects/example/dist/main.js',
    ));
    assert.ok(resolveLocalDevelopmentElectronHostLaunch({ ...base, sourceLocalDevelopment: true }).arguments.includes(
      '/projects/example/dist/main.js',
    ));
    assert.deepEqual(resolveLocalDevelopmentElectronHostLaunch({ ...base, cdpPort: 0 }), {
      arguments: [
        '--user-data-dir=/tmp/example',
        '--remote-debugging-address=127.0.0.1',
        '--remote-debugging-port=0',
        '--nimi-local-app-main=/projects/example/dist/main.js',
        '--nimi-dev-renderer-url=http://127.0.0.1:1420',
      ],
      userDataDirectory: '/tmp/example',
    });
  });

  it('discovers Chromium auto CDP output from the isolated Host profile', async () => {
    const profileRoot = await mkdtemp(path.join(os.tmpdir(), 'nimi-cdp-profile-test-'));
    try {
      const discovered = waitForDevToolsActivePort(profileRoot, () => false);
      await writeFile(
        path.join(profileRoot, 'DevToolsActivePort'),
        '19483\n/devtools/browser/example\n',
        'utf8',
      );
      assert.equal(await discovered, 19483);
    } finally {
      await rm(profileRoot, { recursive: true, force: true });
    }
  });

  it('keeps supervisor identifiers independent from registration handles', async () => {
    const seen: string[] = [];
    const appControl = control({
      register: async ({ supervisorRunId }) => {
        seen.push(supervisorRunId);
        return registration();
      },
    });
    await appControl.register({
      expectedAppId: 'example.local-app',
      projectRoot: '/projects/example',
      shell: 'electron',
      supervisorRunId: SUPERVISOR,
    });
    assert.deepEqual(seen, [SUPERVISOR]);
    assert.notEqual(SUPERVISOR, HANDLE);
  });
});

describe('Desktop local-development project README', () => {
  it('returns the bounded README content for a registered project', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'nimi-readme-test-'));
    try {
      await writeFile(path.join(projectRoot, 'nimi.app.yaml'), 'ai_config_ui:\n  allowed_routes:\n    - local\n', 'utf8');
      await writeFile(path.join(projectRoot, 'README.md'), '# Example App\n\nHello from the project.\n', 'utf8');
      const appControl = control({
        listRegistrations: async () => [registration({
          project: {
            appId: 'example.local-app',
            displayName: 'Example Local App',
            canonicalProjectRoot: projectRoot,
            canonicalManifestPath: path.join(projectRoot, 'nimi.app.yaml'),
            shell: 'electron',
            appAccess: [],
            sourceGeneration: 3,
            declarationGeneration: 4,
          },
        })],
      });
      const host = new ElectronLocalDevelopmentHost(appControl, '/tmp');
      const [row] = await host.invoke('local_development_registrations_list', {}) as Array<{ selector: string; aiConfigAllowedRoutes: readonly string[] }>;
      assert.deepEqual(row?.aiConfigAllowedRoutes, ['local']);
      const result = await host.invoke('local_development_project_readme', {
        payload: { selector: row!.selector },
      }) as { selector: string; content: string | null; fileName: string | null };
      assert.equal(result.selector, row!.selector);
      assert.equal(result.fileName, 'README.md');
      assert.ok(result.content?.includes('Hello from the project.'));
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('returns null content when no conventional README exists', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'nimi-readme-test-'));
    try {
      await writeFile(path.join(projectRoot, 'nimi.app.yaml'), 'app_id: example.local-app\n', 'utf8');
      const appControl = control({
        listRegistrations: async () => [registration({
          project: {
            appId: 'example.local-app',
            displayName: 'Example Local App',
            canonicalProjectRoot: projectRoot,
            canonicalManifestPath: path.join(projectRoot, 'nimi.app.yaml'),
            shell: 'electron',
            appAccess: [],
            sourceGeneration: 3,
            declarationGeneration: 4,
          },
        })],
      });
      const host = new ElectronLocalDevelopmentHost(appControl, '/tmp');
      const [row] = await host.invoke('local_development_registrations_list', {}) as Array<{ selector: string }>;
      const result = await host.invoke('local_development_project_readme', {
        payload: { selector: row!.selector },
      }) as { selector: string; content: string | null; fileName: string | null };
      assert.deepEqual(result, { selector: row!.selector, content: null, fileName: null });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('fails closed for an unknown readme selector', async () => {
    const host = new ElectronLocalDevelopmentHost(control(), '/tmp');
    await assert.rejects(
      host.invoke('local_development_project_readme', { payload: { selector: 'dev-project-unknown' } }),
      /local-development-registration-not-found/u,
    );
  });
});

describe('Desktop local-development project icon', () => {
  const PNG_BYTES = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  ]);

  function iconControl(projectRoot: string) {
    return control({
      listRegistrations: async () => [registration({
        project: {
          appId: 'example.local-app',
          displayName: 'Example Local App',
          canonicalProjectRoot: projectRoot,
          canonicalManifestPath: path.join(projectRoot, 'nimi.app.yaml'),
          shell: 'electron',
          appAccess: [],
          sourceGeneration: 3,
          declarationGeneration: 4,
        },
      })],
    });
  }

  it('returns the scaffolded tauri icon as a bounded PNG data URL', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'nimi-icon-test-'));
    try {
      await writeFile(path.join(projectRoot, 'nimi.app.yaml'), 'ai_config_ui:\n  allowed_routes:\n    - local\n', 'utf8');
      await mkdir(path.join(projectRoot, 'src-tauri', 'icons'), { recursive: true });
      await writeFile(path.join(projectRoot, 'src-tauri', 'icons', 'icon.png'), PNG_BYTES);
      const host = new ElectronLocalDevelopmentHost(iconControl(projectRoot), '/tmp');
      const [row] = await host.invoke('local_development_registrations_list', {}) as Array<{ selector: string }>;
      const result = await host.invoke('local_development_project_icon', {
        payload: { selector: row!.selector },
      }) as { selector: string; iconDataUrl: string | null };
      assert.equal(result.selector, row!.selector);
      assert.equal(result.iconDataUrl, `data:image/png;base64,${PNG_BYTES.toString('base64')}`);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('falls back to the first-party shell asset convention', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'nimi-icon-test-'));
    try {
      await writeFile(path.join(projectRoot, 'nimi.app.yaml'), 'ai_config_ui:\n  allowed_routes:\n    - local\n', 'utf8');
      await mkdir(path.join(projectRoot, 'src', 'shell', 'assets'), { recursive: true });
      await writeFile(path.join(projectRoot, 'src', 'shell', 'assets', 'app-icon.png'), PNG_BYTES);
      const host = new ElectronLocalDevelopmentHost(iconControl(projectRoot), '/tmp');
      const [row] = await host.invoke('local_development_registrations_list', {}) as Array<{ selector: string }>;
      const result = await host.invoke('local_development_project_icon', {
        payload: { selector: row!.selector },
      }) as { selector: string; iconDataUrl: string | null };
      assert.equal(result.iconDataUrl, `data:image/png;base64,${PNG_BYTES.toString('base64')}`);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('returns null when no conventional icon exists or the candidate is not a PNG', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'nimi-icon-test-'));
    try {
      await writeFile(path.join(projectRoot, 'nimi.app.yaml'), 'ai_config_ui:\n  allowed_routes:\n    - local\n', 'utf8');
      await mkdir(path.join(projectRoot, 'src-tauri', 'icons'), { recursive: true });
      await writeFile(path.join(projectRoot, 'src-tauri', 'icons', 'icon.png'), 'not a png', 'utf8');
      const host = new ElectronLocalDevelopmentHost(iconControl(projectRoot), '/tmp');
      const [row] = await host.invoke('local_development_registrations_list', {}) as Array<{ selector: string }>;
      const result = await host.invoke('local_development_project_icon', {
        payload: { selector: row!.selector },
      }) as { selector: string; iconDataUrl: string | null };
      assert.deepEqual(result, { selector: row!.selector, iconDataUrl: null });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('fails closed for an unknown icon selector', async () => {
    const host = new ElectronLocalDevelopmentHost(control(), '/tmp');
    await assert.rejects(
      host.invoke('local_development_project_icon', { payload: { selector: 'dev-project-unknown' } }),
      /local-development-registration-not-found/u,
    );
  });
});
