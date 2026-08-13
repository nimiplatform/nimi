import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type {
  NimiElectronLocalDevelopmentControl,
  NimiElectronLocalDevelopmentRegistration,
} from '@nimiplatform/kit/shell/electron/main';
import {
  ElectronLocalDevelopmentHost,
  isLocalDevelopmentRuntimeTransportFailure,
  localDevelopmentFailureMessage,
  resolveLocalDevelopmentHostRelaunchDecision,
  resolveLocalDevelopmentRegistrationFailureState,
  sameLocalDevelopmentProject,
} from '../src-electron/local-development-host.js';
import type { ElectronLocalDevelopmentPlan } from '../src-electron/local-development-plan.js';
import { resolveLocalDevelopmentElectronHostArguments } from '../src-electron/local-development-host-arguments.js';

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
      canonicalManifestPath: '/projects/example/nimi.app.yaml',
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
    projectRoot: '/projects/example',
    rendererOrigin: 'http://127.0.0.1:1420',
    electronExecutable: '/runtime/electron',
    mainEntry: '/projects/example/dist/main.js',
  };
}

function activeRun() {
  return {
    plan: plan(),
    supervisorRunId: SUPERVISOR,
    registrationHandle: HANDLE as string | undefined,
    pendingEndRunRegistrationHandle: undefined as string | undefined,
    stopped: false,
    stoppedCleanupComplete: false,
    tearingDown: false,
    supervising: false,
    rebuilding: false,
    rebuildRequested: false,
    refreshingRegistration: false,
    recoveringRuntimeTransport: false,
    hostRelaunchWindow: [] as number[],
    hostRelaunchEligibleAtUnixMs: 0,
    renderer: undefined as object | undefined,
    watcher: undefined as { close: () => void } | undefined,
    healthTimer: undefined as ReturnType<typeof setInterval> | undefined,
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
  it('projects registration selectors without exposing management handles', async () => {
    const host = new ElectronLocalDevelopmentHost(control(), '/tmp');
    const rows = await host.invoke('local_development_registrations_list', {}) as Array<Record<string, unknown>>;

    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.appId, 'example.local-app');
    assert.deepEqual(rows[0]?.appAccess, ['realm.data', 'future.unknown']);
    assert.equal(rows[0]?.sourceGeneration, 3);
    assert.equal(rows[0]?.declarationGeneration, 4);
    assert.match(String(rows[0]?.selector), /^dev-project-/u);
    assert.equal(JSON.stringify(rows).includes(HANDLE), false);
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

  it('bounds host relaunch attempts with exponential backoff and a rolling window', () => {
    const first = resolveLocalDevelopmentHostRelaunchDecision({
      nowUnixMs: 100_000,
      relaunchWindow: [],
      eligibleAtUnixMs: 0,
    });
    assert.equal(first.action, 'relaunch');
    if (first.action !== 'relaunch') return;
    assert.deepEqual(first.relaunchWindow, [100_000]);
    assert.equal(first.eligibleAtUnixMs, 104_000);

    assert.deepEqual(resolveLocalDevelopmentHostRelaunchDecision({
      nowUnixMs: 102_000,
      relaunchWindow: first.relaunchWindow,
      eligibleAtUnixMs: first.eligibleAtUnixMs,
    }), { action: 'wait' });

    let relaunchWindow = first.relaunchWindow;
    let eligibleAtUnixMs = first.eligibleAtUnixMs;
    let nowUnixMs = first.eligibleAtUnixMs;
    const delays: number[] = [];
    for (;;) {
      const next = resolveLocalDevelopmentHostRelaunchDecision({ nowUnixMs, relaunchWindow, eligibleAtUnixMs });
      if (next.action !== 'relaunch') {
        assert.equal(next.action, 'crash-loop');
        break;
      }
      delays.push(next.eligibleAtUnixMs - nowUnixMs);
      relaunchWindow = next.relaunchWindow;
      eligibleAtUnixMs = next.eligibleAtUnixMs;
      nowUnixMs = next.eligibleAtUnixMs;
    }
    assert.deepEqual(delays, [8_000, 16_000, 32_000, 60_000]);
    assert.equal(relaunchWindow.length, 5);

    const aged = resolveLocalDevelopmentHostRelaunchDecision({
      nowUnixMs: nowUnixMs + 600_000,
      relaunchWindow,
      eligibleAtUnixMs,
    });
    assert.equal(aged.action, 'relaunch');
    if (aged.action !== 'relaunch') return;
    assert.equal(aged.relaunchWindow.length, 1);
  });

  it('waits for host relaunch eligibility before replacing the host again', async () => {
    const host = new ElectronLocalDevelopmentHost(control(), '/tmp');
    let replacements = 0;
    Reflect.set(host, 'replaceHost', async () => { replacements += 1; });
    const run = activeRun();
    run.renderer = {};
    const healthHost = host as unknown as {
      refreshRegistration(context: typeof run): Promise<void>;
    };

    await healthHost.refreshRegistration(run);
    assert.equal(replacements, 1);
    assert.equal(run.hostRelaunchWindow.length, 1);
    assert.ok(run.hostRelaunchEligibleAtUnixMs > Date.now());

    await healthHost.refreshRegistration(run);
    assert.equal(replacements, 1);
    assert.equal(run.stopped, false);
    assert.equal(run.status.state, 'restarting');
    assert.equal(run.status.retryable, true);
  });

  it('ends a crash-looping run without removing its persistent registration', async () => {
    const terminated: string[] = [];
    const ended: Array<readonly [string, string]> = [];
    let removed = 0;
    const host = new ElectronLocalDevelopmentHost(control({
      terminateHost: async (supervisorRunId) => { terminated.push(supervisorRunId); },
      endRun: async (registrationHandle, supervisorRunId) => {
        ended.push([registrationHandle, supervisorRunId]);
      },
      removeRegistration: async () => { removed += 1; },
    }), '/tmp');
    const run = activeRun();
    const now = Date.now();
    run.hostRelaunchWindow = [now - 5_000, now - 4_000, now - 3_000, now - 2_000, now - 1_000];
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
      assert.equal(run.registrationHandle, undefined);
      assert.equal(run.pendingEndRunRegistrationHandle, undefined);
      assert.equal(run.watcher, undefined);
      assert.equal(watcherClosed, 1);
      assert.equal(run.healthTimer, undefined);
      assert.equal(run.stopped, true);
      assert.equal(run.stoppedCleanupComplete, true);
      assert.equal(run.status.state, 'failed');
      assert.equal(run.status.reasonCode, 'local-development-host-crash-loop');
      assert.equal(run.status.retryable, false);
      assert.equal(run.status.hostGeneration, 1);
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
    assert.ok(resolveLocalDevelopmentElectronHostArguments(base).includes(
      '--nimi-local-app-main=/projects/example/dist/main.js',
    ));
    assert.ok(resolveLocalDevelopmentElectronHostArguments({ ...base, sourceLocalDevelopment: true }).includes(
      '/projects/example/dist/main.js',
    ));
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
