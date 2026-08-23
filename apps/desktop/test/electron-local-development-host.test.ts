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
} from '../src-electron/local-development-host.js';
import {
  readElectronAIConfigAllowedRoutes,
  type ElectronLocalDevelopmentPlan,
} from '../src-electron/local-development-plan.js';
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
    plan: plan(),
    supervisorRunId: SUPERVISOR,
    desktopManaged: false,
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

    assert.deepEqual(captured, ['example.local-app', '/projects/example', 'electron', undefined, true]);
    assert.equal(result.state, 'running');
    assert.equal(result.appId, 'example.local-app');
  });

  it('projects only the latest run for an App', async () => {
    const host = new ElectronLocalDevelopmentHost(control(), '/tmp');
    const oldRun = activeRun();
    oldRun.status.runId = 'dev-run-old';
    oldRun.status.state = 'launcher-disconnected';
    oldRun.stopped = true;
    oldRun.stoppedCleanupComplete = true;
    const currentRun = activeRun();
    currentRun.status.runId = 'dev-run-current';
    const internal = host as unknown as { runs: Map<string, ReturnType<typeof activeRun>> };
    internal.runs.set(oldRun.status.runId, oldRun);
    internal.runs.set(currentRun.status.runId, currentRun);

    const runs = await host.invoke('local_development_runs_list', {}) as Array<Record<string, unknown>>;

    assert.equal(runs.length, 1);
    assert.equal(runs[0]?.appId, 'example.local-app');
    assert.equal(runs[0]?.state, 'running');
  });

  it('treats stop as idempotent when a known run became terminal after projection', async () => {
    let terminateCalls = 0;
    let endRunCalls = 0;
    const host = new ElectronLocalDevelopmentHost(control({
      terminateHost: async () => { terminateCalls += 1; },
      endRun: async () => { endRunCalls += 1; },
    }), '/tmp');
    const stoppedRun = activeRun();
    stoppedRun.status.state = 'launcher-disconnected';
    stoppedRun.stopped = true;
    stoppedRun.stoppedCleanupComplete = true;
    const internal = host as unknown as { runs: Map<string, ReturnType<typeof activeRun>> };
    internal.runs.set(stoppedRun.status.runId, stoppedRun);

    assert.deepEqual(await host.invoke('local_development_run_stop', {
      payload: { appId: 'example.local-app' },
    }), { appId: 'example.local-app', stopped: true });
    assert.equal(terminateCalls, 0);
    assert.equal(endRunCalls, 0);
    await assert.rejects(
      host.invoke('local_development_run_stop', { payload: { appId: 'missing.local-app' } }),
      /local-development-run-not-found/u,
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
