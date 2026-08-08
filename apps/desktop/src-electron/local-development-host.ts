import { randomBytes } from 'node:crypto';
import { watch, type FSWatcher } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import path from 'node:path';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';

import {
  createNimiElectronLocalDevelopmentControl,
  type NimiElectronLocalDevelopmentControl,
  type NimiElectronLocalDevelopmentRegistration,
} from '@nimiplatform/kit/shell/electron/main';
import {
  createDesktopElectronLocalDevelopmentPresencePublisher,
  type DesktopElectronLocalDevelopmentPresencePublisher,
} from './local-development-presence.js';
import {
  canonicalElectronMain,
  ElectronLocalDevelopmentPlanError,
  resolveElectronLocalDevelopmentPlan,
  type ElectronLocalDevelopmentPlan,
} from './local-development-plan.js';
import {
  resolveLocalDevelopmentElectronHostArguments,
  resolveLocalAppUserDataArguments,
} from './local-development-host-arguments.js';
import {
  assertLocalDevelopmentRendererOriginAvailable,
  spawnLocalDevelopmentPackageScript,
  terminateLocalDevelopmentProcessTree as terminateTree,
  type LocalDevelopmentPackageScript,
  waitForLocalDevelopmentRenderer as waitForRenderer,
} from './local-development-host-process.js';
import {
  exactLocalDevelopmentObject as exact,
  exactNestedLocalDevelopmentPayload as exactNestedPayload,
  localDevelopmentCdpPort as cdpPort,
  localDevelopmentSelector as selector,
  localDevelopmentText as text,
  readLocalDevelopmentJsonBody as readJsonBody,
  writeLocalDevelopmentJson as json,
} from './local-development-host-protocol.js';

const COMMANDS = new Set([
  'local_development_registrations_list',
  'local_development_runs_list',
  'local_development_registration_remove',
]);
const HEALTH_MS = 2_000;
const LAUNCHER_LEASE_MS = 10_000;
const REBUILD_DEBOUNCE_MS = 450;
const RESTARTABLE_RUN_STATES = new Set([
  'failed',
  'project-changed',
  'registration-unavailable',
  'registration-removed',
  'stopped',
]);

type RunStatus = {
  readonly schemaVersion: 1;
  readonly runId: string;
  state: string;
  readonly appId: string;
  readonly displayName: string;
  readonly canonicalProjectRoot: string;
  readonly shell: 'electron';
  readonly rendererOrigin: string;
  message: string;
  reasonCode?: string;
  retryable: boolean;
  hostGeneration: number;
  logSequence: number;
  logs: Array<{ readonly sequence: number; readonly stream: string; readonly message: string }>;
};

type RunContext = {
  readonly status: RunStatus;
  readonly plan: ElectronLocalDevelopmentPlan;
  readonly cdpPort?: number;
  readonly supervisorRunId: string;
  registrationHandle?: string;
  pendingEndRunRegistrationHandle?: string;
  buildChild?: ChildProcessWithoutNullStreams;
  renderer?: ChildProcessWithoutNullStreams;
  watcher?: FSWatcher;
  healthTimer?: ReturnType<typeof setInterval>;
  launcherLeaseTimer?: ReturnType<typeof setTimeout>;
  rebuildTimer?: ReturnType<typeof setTimeout>;
  stopped: boolean;
  stoppedCleanupComplete: boolean;
  tearingDown: boolean;
  supervising: boolean;
  rebuilding: boolean;
  rebuildRequested: boolean;
  refreshingRegistration: boolean;
  recoveringRuntimeTransport: boolean;
};

type RendererRegistration = {
  readonly selector: string;
  readonly appId: string;
  readonly displayName: string;
  readonly canonicalProjectRoot: string;
  readonly shell: 'electron';
  readonly appAccess: readonly string[];
  readonly sourceGeneration: number;
  readonly declarationGeneration: number;
  readonly registeredAtUnixMs: number;
  readonly updatedAtUnixMs: number;
};

export type DesktopElectronLocalDevelopmentHost = {
  readonly commandHandlers: Readonly<Record<string, (context: {
    readonly command: string;
    readonly payload: Readonly<Record<string, unknown>>;
  }) => Promise<unknown>>>;
  readonly shutdown: () => Promise<void>;
};

export async function createDesktopElectronLocalDevelopmentHost(input: {
  readonly homeDirectory: string;
  readonly control?: NimiElectronLocalDevelopmentControl;
}): Promise<DesktopElectronLocalDevelopmentHost> {
  const host = new ElectronLocalDevelopmentHost(
    input.control ?? createNimiElectronLocalDevelopmentControl(),
    path.resolve(input.homeDirectory),
  );
  await host.start();
  return {
    commandHandlers: Object.fromEntries([...COMMANDS].map((command) => [
      command,
      (context: { readonly command: string; readonly payload: Readonly<Record<string, unknown>> }) => (
        host.invoke(context.command, context.payload)
      ),
    ])),
    shutdown: () => host.shutdown(),
  };
}

export class ElectronLocalDevelopmentHost {
  private readonly runs = new Map<string, RunContext>();
  private readonly registrationSelectors = new Map<string, string>();
  private server: Server | undefined;
  private endpoint = '';
  private shutdownPromise: Promise<void> | undefined;
  private shutdownComplete = false;
  private readonly presencePublisher: DesktopElectronLocalDevelopmentPresencePublisher;

  constructor(
    private readonly control: NimiElectronLocalDevelopmentControl,
    private readonly homeDirectory: string,
    private readonly launcherLeaseMs = LAUNCHER_LEASE_MS,
  ) {
    this.presencePublisher = createDesktopElectronLocalDevelopmentPresencePublisher({ homeDirectory });
  }

  async start(): Promise<void> {
    this.server = createServer((request, response) => void this.handleHttp(request, response));
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', () => resolve());
    });
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('local-development-supervisor-required');
    this.endpoint = `http://127.0.0.1:${address.port}`;
    try {
      await this.presencePublisher.start(this.endpoint);
    } catch (error) {
      const server = this.server;
      this.server = undefined;
      this.endpoint = '';
      if (server) await closeHttpServer(server);
      throw error;
    }
  }

  async invoke(command: string, payload: Readonly<Record<string, unknown>>): Promise<unknown> {
    if (!COMMANDS.has(command)) throw new Error('local-development-command-unavailable');
    if (command === 'local_development_runs_list') {
      return [...this.runs.values()].map((run) => projectRun(run.status));
    }
    if (command === 'local_development_registrations_list') return this.listRegistrations();
    return this.removeRegistration(exactNestedPayload(payload));
  }

  shutdown(): Promise<void> {
    if (this.shutdownComplete) return Promise.resolve();
    if (this.shutdownPromise) return this.shutdownPromise;
    const attempt = this.performShutdown()
      .then(() => {
        this.shutdownComplete = true;
      })
      .finally(() => {
        if (this.shutdownPromise === attempt) {
          this.shutdownPromise = undefined;
        }
      });
    this.shutdownPromise = attempt;
    return attempt;
  }

  private async performShutdown(): Promise<void> {
    const failures: unknown[] = [];
    const stopped = await Promise.allSettled([...this.runs.values()].map((run) => this.stopRun(run, 'stopped')));
    for (const result of stopped) {
      if (result.status === 'rejected') failures.push(result.reason);
    }
    try {
      if (this.server) await closeHttpServer(this.server);
    } catch (error) {
      failures.push(error);
    }
    this.server = undefined;
    try {
      await this.presencePublisher.shutdown();
    } catch (error) {
      failures.push(error);
    }
    if (failures.length > 0) throw new AggregateError(failures, 'local-development-supervisor-shutdown-failed');
  }

  private async handleHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      if (request.method !== 'POST'
        || request.headers.origin !== undefined
        || request.headers.referer !== undefined
        || !String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
        return json(response, { status: 'error', reasonCode: 'local-development-intent-invalid', actionHint: 'use_official_nimi_app_dev_launcher' });
      }
      const body = await readJsonBody(request);
      if (request.url === '/v1/start') {
        const hasCdpPort = Object.prototype.hasOwnProperty.call(body, 'cdpPort');
        const value = exact(
          body,
          hasCdpPort
            ? ['appId', 'cdpPort', 'projectRoot', 'schemaVersion', 'shell']
            : ['appId', 'projectRoot', 'schemaVersion', 'shell'],
        );
        if (value.schemaVersion !== 1) throw new Error('local-development-intent-invalid');
        const run = await this.startIntent(
          text(value.appId),
          text(value.projectRoot),
          text(value.shell),
          hasCdpPort ? cdpPort(value.cdpPort) : undefined,
        );
        return json(response, { status: 'ok', run });
      }
      if (request.url === '/v1/status' || request.url === '/v1/cancel') {
        const value = exact(body, ['runId', 'schemaVersion']);
        if (value.schemaVersion !== 1) throw new Error('local-development-intent-invalid');
        const run = this.runs.get(selector(value.runId, 'dev-run'));
        if (!run) throw new Error('local-development-run-not-found');
        if (request.url === '/v1/cancel') await this.stopRun(run, 'stopped');
        else this.touchLauncherLease(run);
        return json(response, { status: 'ok', run: run.status });
      }
      json(response, { status: 'error', reasonCode: 'local-development-intent-invalid', actionHint: 'use_official_nimi_app_dev_launcher' });
    } catch (error) {
      json(response, {
        status: 'error',
        reasonCode: reason(error),
        actionHint: 'use_official_nimi_app_dev_launcher',
      });
    }
  }

  private async startIntent(
    appId: string,
    projectRoot: string,
    shell: string,
    requestedCdpPort?: number,
  ): Promise<RunStatus> {
    let plan: ElectronLocalDevelopmentPlan;
    try {
      plan = await resolveElectronLocalDevelopmentPlan(projectRoot, appId, shell);
    } catch (error) {
      if (error instanceof ElectronLocalDevelopmentPlanError) throw error;
      throw new Error('local-development-project-changed', { cause: error });
    }
    const activeRuns = [...this.runs.values()].filter((candidate) => (
      !candidate.stopped
      && (
        candidate.status.retryable
        || !RESTARTABLE_RUN_STATES.has(candidate.status.state)
      )
    ));
    const existing = activeRuns.find((candidate) => sameLocalDevelopmentPlan(candidate.plan, plan));
    if (existing) {
      if (existing.cdpPort !== requestedCdpPort) {
        throw new Error('local-development-cdp-configuration-conflict');
      }
      this.touchLauncherLease(existing);
      return existing.status;
    }
    if (requestedCdpPort !== undefined
      && activeRuns.some((candidate) => candidate.cdpPort === requestedCdpPort)) {
      throw new Error('local-development-cdp-port-in-use');
    }
    const runId = randomSelector('dev-run');
    const run: RunContext = {
      plan,
      cdpPort: requestedCdpPort,
      supervisorRunId: randomIdentifier(),
      stopped: false,
      stoppedCleanupComplete: false,
      tearingDown: false,
      supervising: false,
      rebuilding: false,
      rebuildRequested: false,
      refreshingRegistration: false,
      recoveringRuntimeTransport: false,
      status: {
        schemaVersion: 1,
        runId,
        state: 'preparing',
        appId: plan.appId,
        displayName: plan.displayName,
        canonicalProjectRoot: plan.projectRoot,
        shell: 'electron',
        rendererOrigin: plan.rendererOrigin,
        message: 'Validating project with Nimi Runtime',
        retryable: false,
        hostGeneration: 0,
        logSequence: 0,
        logs: [],
      },
    };
    this.runs.set(runId, run);
    this.touchLauncherLease(run);
    // Registration can legitimately outlive the launcher's short loopback
    // request timeout while Runtime is rebinding. Return the preparing run
    // immediately and let the existing status polling carry that transition.
    void this.resolveRegistration(run).catch((error) => {
      if (run.stopped) return;
      const code = reason(error);
      setRunState(run, resolveLocalDevelopmentRegistrationFailureState(code), code, code, true);
      this.ensureHealthTimer(run);
    });
    return run.status;
  }

  private async resolveRegistration(run: RunContext): Promise<void> {
    if (run.stopped) return;
    let registration: NimiElectronLocalDevelopmentRegistration;
    try {
      registration = await this.control.register({
        expectedAppId: run.plan.appId,
        projectRoot: run.plan.projectRoot,
        shell: 'electron',
        supervisorRunId: run.supervisorRunId,
      });
    } catch (error) {
      const code = reason(error);
      setRunState(run, resolveLocalDevelopmentRegistrationFailureState(code), code, code, true);
      this.ensureHealthTimer(run);
      return;
    }
    if (!sameLocalDevelopmentProject(registration, run.plan)) {
      setRunState(run, 'project-changed', 'local-development-project-changed', 'local-development-project-changed', false);
      return;
    }
    run.registrationHandle = registration.registrationHandle;
    this.startSupervisor(run);
  }

  private async listRegistrations(): Promise<RendererRegistration[]> {
    const rows = (await this.control.listRegistrations())
      .filter((registration) => registration.project.shell === 'electron');
    const currentHandles = new Set(rows.map((registration) => registration.registrationHandle));
    for (const [selectorValue, handle] of this.registrationSelectors) {
      if (!currentHandles.has(handle)) this.registrationSelectors.delete(selectorValue);
    }
    return rows.map((registration) => {
      let selectorValue = [...this.registrationSelectors]
        .find(([, handle]) => handle === registration.registrationHandle)?.[0];
      selectorValue ??= randomSelector('dev-project');
      this.registrationSelectors.set(selectorValue, registration.registrationHandle);
      return projectRegistration(selectorValue, registration);
    });
  }

  private async removeRegistration(payload: Readonly<Record<string, unknown>>): Promise<{ readonly selector: string; readonly removed: true }> {
    if (Object.keys(payload).join('|') !== 'selector') throw new Error('local-development-registration-not-found');
    const selectorValue = selector(payload.selector, 'dev-project');
    const registrationHandle = this.registrationSelectors.get(selectorValue);
    if (!registrationHandle) throw new Error('local-development-registration-not-found');
    for (const run of this.runs.values()) {
      if (run.registrationHandle === registrationHandle && !run.stopped) {
        await this.stopRun(run, 'registration-removed');
      }
    }
    await this.control.removeRegistration(registrationHandle);
    this.registrationSelectors.delete(selectorValue);
    return { selector: selectorValue, removed: true };
  }

  private startSupervisor(run: RunContext): void {
    if (run.supervising || run.stopped) return;
    run.supervising = true;
    void this.supervise(run).finally(() => {
      run.supervising = false;
    });
  }

  private touchLauncherLease(run: RunContext): void {
    if (run.stopped) return;
    if (run.launcherLeaseTimer) clearTimeout(run.launcherLeaseTimer);
    run.launcherLeaseTimer = setTimeout(() => {
      run.launcherLeaseTimer = undefined;
      if (run.stopped) return;
      void this.stopRun(run, 'launcher-disconnected').catch(() => undefined);
    }, this.launcherLeaseMs);
  }

  private clearLauncherLease(run: RunContext): void {
    if (run.launcherLeaseTimer) clearTimeout(run.launcherLeaseTimer);
    run.launcherLeaseTimer = undefined;
  }

  private async supervise(run: RunContext): Promise<void> {
    try {
      setRunState(run, 'building', 'Building Electron main and preload', undefined, false);
      await this.runPackageScript(run, 'build:electron');
      if (run.stopped) return;
      await assertLocalDevelopmentRendererOriginAvailable(run.plan.rendererOrigin);
      run.renderer = this.spawnPackageScript(run, 'dev:renderer');
      await waitForRenderer(run.plan.rendererOrigin, run.renderer, () => run.stopped);
      await this.launchHost(run);
      if (run.stopped) return;
      run.watcher = watch(path.join(run.plan.projectRoot, 'src-electron'), { recursive: true }, () => {
        if (run.stopped) return;
        run.rebuildRequested = true;
        if (run.rebuildTimer) clearTimeout(run.rebuildTimer);
        run.rebuildTimer = setTimeout(() => {
          run.rebuildTimer = undefined;
          void this.rebuild(run);
        }, REBUILD_DEBOUNCE_MS);
      });
      this.ensureHealthTimer(run);
      const renderer = run.renderer;
      renderer.once('exit', (code) => {
        if (run.stopped || run.tearingDown || run.renderer !== renderer) return;
        run.renderer = undefined;
        void this.handleUnexpectedRendererExit(run, code);
      });
    } catch (error) {
      if (!run.stopped) setRunState(run, 'failed', reason(error), reason(error), false);
      try {
        await this.stopRunProcesses(run);
      } catch {
        if (!run.stopped) setRunState(run, 'cleanup-failed', 'local-development-process-cleanup-failed', 'local-development-process-cleanup-failed', false);
      }
    }
  }

  private async rebuild(run: RunContext): Promise<void> {
    if (run.stopped || run.rebuilding) return;
    run.rebuilding = true;
    try {
      do {
        run.rebuildRequested = false;
        setRunState(run, 'restarting', 'Rebuilding Electron main and preload', undefined, true);
        await this.runPackageScript(run, 'build:electron');
        if (run.stopped) return;
        await this.replaceHost(run);
      } while (run.rebuildRequested && !run.stopped);
    } catch (error) {
      if (!run.stopped) {
        setRunState(run, 'build-failed', reason(error), 'local-development-build-failed', true);
      }
    } finally {
      run.rebuilding = false;
    }
  }

  private async launchHost(run: RunContext): Promise<void> {
    if (!run.registrationHandle) throw new Error('local-development-registration-not-found');
    const mainEntry = await canonicalElectronMain(run.plan);
    const userDataArguments = await resolveLocalAppUserDataArguments({
      registrationHandle: run.registrationHandle,
      homeDirectory: this.homeDirectory,
    });
    setRunState(run, 'starting', 'Starting the supervised Electron host', undefined, false);
    const outcome = await this.control.launch({
      registrationHandle: run.registrationHandle,
      supervisorRunId: run.supervisorRunId,
      shell: 'electron',
      hostExecutablePath: run.plan.electronExecutable,
      rendererOrigin: run.plan.rendererOrigin,
      hostArguments: resolveLocalDevelopmentElectronHostArguments({
        mainEntry,
        rendererOrigin: run.plan.rendererOrigin,
        userDataArguments,
        cdpPort: run.cdpPort,
        sourceLocalDevelopment: (
          process.platform === 'darwin'
          && process.env.NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT === '1'
        ) || (
          process.platform === 'win32'
          && process.env.NIMI_WINDOWS_SOURCE_LOCAL_DEVELOPMENT === '1'
        ),
      }),
      workingDirectory: run.plan.projectRoot,
    });
    run.status.hostGeneration += 1;
    setRunState(run, 'running', 'Supervised electron host is running', undefined, false);
    appendLog(run, 'supervisor', `host generation ${run.status.hostGeneration} started (pid ${outcome.processId})`);
  }

  private async replaceHost(run: RunContext): Promise<void> {
    await this.control.terminateHost(run.supervisorRunId);
    if (!run.stopped) await this.launchHost(run);
  }

  private ensureHealthTimer(run: RunContext): void {
    run.healthTimer ??= setInterval(() => {
      if (run.refreshingRegistration) return;
      run.refreshingRegistration = true;
      void this.refreshRegistration(run).finally(() => {
        run.refreshingRegistration = false;
      });
    }, HEALTH_MS);
  }

  private async refreshRegistration(run: RunContext): Promise<void> {
    if (run.stopped || run.tearingDown || run.rebuilding) return;
    if (!run.registrationHandle) {
      await this.resolveRegistration(run);
      return;
    }
    try {
      const registrations = await this.control.listRegistrations();
      const registration = registrations.find((candidate) => (
        candidate.registrationHandle === run.registrationHandle
      ));
      if (!registration) {
        await this.failClosedRun(run, {
          state: 'registration-removed',
          message: 'local-development-registration-not-found',
          reasonCode: 'local-development-registration-not-found',
          retryable: false,
          endRun: false,
          resumeRegistrationRefresh: false,
        });
        return;
      }
      if (!sameLocalDevelopmentProject(registration, run.plan)) {
        await this.failClosedRun(run, {
          state: 'project-changed',
          message: 'local-development-project-changed',
          reasonCode: 'local-development-project-changed',
          retryable: false,
          endRun: true,
          resumeRegistrationRefresh: false,
        });
        return;
      }
      const running = await this.control.hostRunning(run.supervisorRunId);
      if (run.recoveringRuntimeTransport) {
        if (!running) return;
        run.recoveringRuntimeTransport = false;
        setRunState(run, 'running', 'Supervised electron host is running', undefined, false);
      }
      if (!running && run.status.hostGeneration > 0) await this.replaceHost(run);
      if (!run.supervising && !run.renderer) this.startSupervisor(run);
    } catch (error) {
      const code = reason(error);
      if (isLocalDevelopmentRuntimeTransportFailure(code)) {
        run.recoveringRuntimeTransport = true;
        setRunState(run, 'runtime-unavailable', code, code, true);
        return;
      }
      await this.failClosedRun(run, {
        state: resolveLocalDevelopmentRegistrationFailureState(code),
        message: code,
        reasonCode: code,
        retryable: true,
        endRun: false,
        resumeRegistrationRefresh: true,
      });
    }
  }

  private async handleUnexpectedRendererExit(run: RunContext, code: number | null): Promise<void> {
    await this.failClosedRun(run, {
      state: 'failed',
      message: `local-development-dev-server-exited-${code ?? -1}`,
      reasonCode: 'local-development-dev-server-uncontrolled',
      retryable: false,
      endRun: true,
      resumeRegistrationRefresh: false,
    });
  }

  private async failClosedRun(run: RunContext, outcome: {
    readonly state: string;
    readonly message: string;
    readonly reasonCode: string;
    readonly retryable: boolean;
    readonly endRun: boolean;
    readonly resumeRegistrationRefresh: boolean;
  }): Promise<void> {
    if (run.stopped || run.tearingDown) return;
    run.tearingDown = true;
    if (!outcome.resumeRegistrationRefresh) {
      run.stopped = true;
      run.stoppedCleanupComplete = false;
      this.clearLauncherLease(run);
    }
    try {
      await this.teardownRun(run, outcome.endRun);
      if (!outcome.resumeRegistrationRefresh) run.stoppedCleanupComplete = true;
      setRunState(run, outcome.state, outcome.message, outcome.reasonCode, outcome.retryable);
    } catch {
      run.stopped = true;
      run.stoppedCleanupComplete = false;
      setRunState(run, 'cleanup-failed', 'local-development-process-cleanup-failed', 'local-development-process-cleanup-failed', false);
    } finally {
      run.tearingDown = false;
      if (outcome.resumeRegistrationRefresh && !run.stopped) this.ensureHealthTimer(run);
    }
  }

  private async runPackageScript(run: RunContext, script: LocalDevelopmentPackageScript): Promise<void> {
    const child = this.spawnPackageScript(run, script);
    run.buildChild = child;
    let code: number | null;
    try {
      code = await new Promise<number | null>((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', resolve);
      });
    } finally {
      if (run.buildChild === child) run.buildChild = undefined;
    }
    if (run.stopped) return;
    if (code !== 0) throw new Error(`local-development-build-failed-${code ?? -1}`);
  }

  private spawnPackageScript(run: RunContext, script: LocalDevelopmentPackageScript): ChildProcessWithoutNullStreams {
    const child = spawnLocalDevelopmentPackageScript(script, run.plan.projectRoot);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => appendLog(run, `${script}:stdout`, chunk));
    child.stderr.on('data', (chunk: string) => appendLog(run, `${script}:stderr`, chunk));
    return child;
  }

  private async stopRun(run: RunContext, state: string): Promise<void> {
    if (run.stopped && run.stoppedCleanupComplete) return;
    run.stopped = true;
    run.stoppedCleanupComplete = false;
    this.clearLauncherLease(run);
    try {
      await this.teardownRun(run, true);
    } catch (error) {
      setRunState(run, 'cleanup-failed', 'local-development-process-cleanup-failed', 'local-development-process-cleanup-failed', false);
      throw error;
    }
    run.stoppedCleanupComplete = true;
    setRunState(run, state, 'Development run stopped', undefined, false);
  }

  private async teardownRun(run: RunContext, endRun: boolean): Promise<void> {
    if (endRun && run.registrationHandle) {
      run.pendingEndRunRegistrationHandle ??= run.registrationHandle;
      run.registrationHandle = undefined;
    }
    const failures: unknown[] = [];
    try {
      await this.stopRunProcesses(run);
    } catch (error) {
      failures.push(error);
    }
    const pendingEndRunRegistrationHandle = run.pendingEndRunRegistrationHandle;
    if (pendingEndRunRegistrationHandle) {
      try {
        await this.endRunWithTransportRetry(pendingEndRunRegistrationHandle, run.supervisorRunId);
        if (run.pendingEndRunRegistrationHandle === pendingEndRunRegistrationHandle) {
          run.pendingEndRunRegistrationHandle = undefined;
        }
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'local-development-process-cleanup-failed');
    }
  }

  private async endRunWithTransportRetry(registrationHandle: string, supervisorRunId: string): Promise<void> {
    try {
      await this.control.endRun(registrationHandle, supervisorRunId);
    } catch (error) {
      if (!isLocalDevelopmentRuntimeTransportFailure(reason(error))) throw error;
      await this.control.endRun(registrationHandle, supervisorRunId);
    }
  }

  private async stopRunProcesses(run: RunContext): Promise<void> {
    const failures: unknown[] = [];
    if (run.rebuildTimer) clearTimeout(run.rebuildTimer);
    if (run.healthTimer) clearInterval(run.healthTimer);
    run.rebuildTimer = undefined;
    run.healthTimer = undefined;
    run.rebuildRequested = false;
    try {
      run.watcher?.close();
      run.watcher = undefined;
    } catch (error) {
      failures.push(error);
    }
    const buildChild = run.buildChild;
    if (buildChild && buildChild.exitCode === null && buildChild.pid) {
      try {
        await terminateTree(buildChild);
        if (run.buildChild === buildChild) run.buildChild = undefined;
      } catch (error) {
        failures.push(error);
      }
    } else if (run.buildChild === buildChild) {
      run.buildChild = undefined;
    }
    const renderer = run.renderer;
    if (renderer && renderer.exitCode === null && renderer.pid) {
      try {
        await terminateTree(renderer);
        if (run.renderer === renderer) run.renderer = undefined;
      } catch (error) {
        failures.push(error);
      }
    } else if (run.renderer === renderer) {
      run.renderer = undefined;
    }
    try {
      await this.control.terminateHost(run.supervisorRunId);
    } catch (error) {
      failures.push(error);
    }
    if (failures.length > 0) throw new AggregateError(failures, 'local-development-process-cleanup-failed');
  }

}

async function closeHttpServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('local-development-supervisor-http-shutdown-timeout'));
    }, 5_000);
    server.close((error) => {
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    });
    server.closeIdleConnections();
  });
}

function projectRun(status: RunStatus) {
  return {
    appId: status.appId,
    displayName: status.displayName,
    canonicalProjectRoot: status.canonicalProjectRoot,
    shell: status.shell,
    state: status.state,
    message: status.message,
    ...(status.reasonCode ? { reasonCode: status.reasonCode } : {}),
    retryable: status.retryable,
    hostGeneration: status.hostGeneration,
  };
}

function projectRegistration(
  selectorValue: string,
  registration: NimiElectronLocalDevelopmentRegistration,
): RendererRegistration {
  if (registration.project.shell !== 'electron') {
    throw new Error('local-development-registration-shell-unsupported');
  }
  return {
    selector: selectorValue,
    appId: registration.project.appId,
    displayName: registration.project.displayName,
    canonicalProjectRoot: registration.project.canonicalProjectRoot,
    shell: registration.project.shell,
    appAccess: [...registration.project.appAccess],
    sourceGeneration: registration.project.sourceGeneration,
    declarationGeneration: registration.project.declarationGeneration,
    registeredAtUnixMs: registration.registeredAtUnixMs,
    updatedAtUnixMs: registration.updatedAtUnixMs,
  };
}

function sameLocalDevelopmentPlan(
  left: ElectronLocalDevelopmentPlan,
  right: ElectronLocalDevelopmentPlan,
): boolean {
  return left.appId === right.appId
    && left.displayName === right.displayName
    && comparableCanonicalProjectPath(left.projectRoot) === comparableCanonicalProjectPath(right.projectRoot)
    && left.rendererOrigin === right.rendererOrigin
    && comparableCanonicalProjectPath(left.electronExecutable) === comparableCanonicalProjectPath(right.electronExecutable)
    && comparableCanonicalProjectPath(left.mainEntry) === comparableCanonicalProjectPath(right.mainEntry);
}

export function sameLocalDevelopmentProject(
  registration: NimiElectronLocalDevelopmentRegistration,
  plan: ElectronLocalDevelopmentPlan,
): boolean {
  return registration.project.appId === plan.appId
    && comparableCanonicalProjectPath(registration.project.canonicalProjectRoot)
      === comparableCanonicalProjectPath(plan.projectRoot)
    && registration.project.shell === 'electron';
}

function comparableCanonicalProjectPath(value: string): string {
  const extendedUncPrefix = '\\\\?\\UNC\\';
  const extendedPrefix = '\\\\?\\';
  let normalized = value;
  if (normalized.startsWith(extendedUncPrefix)) {
    normalized = `\\\\${normalized.slice(extendedUncPrefix.length)}`;
  } else if (normalized.startsWith(extendedPrefix)) {
    normalized = normalized.slice(extendedPrefix.length);
  }
  const resolved = path.resolve(normalized);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function setRunState(run: RunContext, state: string, message: string, reasonCode: string | undefined, retryable: boolean): void {
  run.status.state = state;
  run.status.message = message;
  run.status.retryable = retryable;
  if (reasonCode) run.status.reasonCode = reasonCode;
  else delete run.status.reasonCode;
}

function appendLog(run: RunContext, stream: string, raw: string): void {
  const message = sanitizeLog(raw);
  if (!message) return;
  run.status.logSequence += 1;
  run.status.logs.push({ sequence: run.status.logSequence, stream, message });
  if (run.status.logs.length > 80) run.status.logs.splice(0, run.status.logs.length - 80);
}

function sanitizeLog(raw: string): string {
  const trimmed = raw.trim().slice(0, 2_000);
  if (!trimmed) return '';
  const lower = trimmed.toLowerCase();
  return ['session_proof', 'sessionproof', 'access_token', 'refresh_token', 'authorization: bearer', 'credential']
    .some((needle) => lower.includes(needle))
    ? '[sensitive supervisor output redacted]'
    : trimmed;
}

function randomSelector(prefix: string): string {
  return `${prefix}-${randomBytes(18).toString('base64url')}`;
}

function randomIdentifier(): string {
  const value = randomBytes(32).toString('hex');
  if (/^0+$/u.test(value)) throw new Error('local-development-supervisor-required');
  return value;
}

function reason(error: unknown): string {
  if (error instanceof ElectronLocalDevelopmentPlanError) return error.reasonCode;
  if (error && typeof error === 'object' && 'reasonCode' in error && typeof error.reasonCode === 'string') return error.reasonCode;
  if (error instanceof Error && /^[A-Za-z][A-Za-z0-9_-]{0,127}$/u.test(error.message)) return error.message;
  return 'local-development-supervisor-required';
}
export function resolveLocalDevelopmentRegistrationFailureState(
  reasonCode: string,
): 'runtime-unavailable' | 'registration-unavailable' {
  return isLocalDevelopmentRuntimeTransportFailure(reasonCode)
    ? 'runtime-unavailable'
    : 'registration-unavailable';
}

export function isLocalDevelopmentRuntimeTransportFailure(reasonCode: string): boolean {
  return [
    'process-replaced',
    'runtime-restarted',
    'runtime-service-repair-required',
    'runtime-service-unavailable',
    'runtime-service-untrusted',
  ].includes(reasonCode);
}
