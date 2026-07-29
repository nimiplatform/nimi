import { randomBytes } from 'node:crypto';
import { watch, type FSWatcher } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

import {
  createNimiElectronLocalDevelopmentControl,
  type NimiElectronLocalDevelopmentAuthorization,
  type NimiElectronLocalDevelopmentControl,
  type NimiElectronLocalDevelopmentEvaluation,
} from '@nimiplatform/kit/shell/electron/main';
import {
  createDesktopElectronLocalDevelopmentProjectionPublisher,
  type DesktopElectronLocalDevelopmentProjectionPublisher,
} from './local-development-authority-summary.js';
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
  localDevelopmentToolEnvironment,
  resolveLocalDevelopmentPackageScriptInvocation,
  terminateLocalDevelopmentProcessTree as terminateTree,
  type LocalDevelopmentPackageScript,
  waitForLocalDevelopmentRenderer as waitForRenderer,
} from './local-development-host-process.js';
import {
  exactLocalDevelopmentObject as exact,
  exactNestedLocalDevelopmentPayload as exactNestedPayload,
  localDevelopmentDecision as localDecision,
  localDevelopmentSelector as selector,
  localDevelopmentText as text,
  readLocalDevelopmentJsonBody as readJsonBody,
  writeLocalDevelopmentJson as json,
} from './local-development-host-protocol.js';

const COMMANDS = new Set([
  'local_development_pending_approvals',
  'local_development_decide',
  'local_development_authorizations_list',
  'local_development_runs_list',
  'local_development_authorization_revoke',
]);
const HEALTH_MS = 2_000;
const REBUILD_DEBOUNCE_MS = 450;

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
  readonly supervisorRunId: string;
  authorizationId?: string;
  pendingEndRunAuthorizationId?: string;
  buildChild?: ChildProcessWithoutNullStreams;
  renderer?: ChildProcessWithoutNullStreams;
  watcher?: FSWatcher;
  healthTimer?: ReturnType<typeof setInterval>;
  rebuildTimer?: ReturnType<typeof setTimeout>;
  stopped: boolean;
  tearingDown: boolean;
  supervising: boolean;
  rebuilding: boolean;
  rebuildRequested: boolean;
};

type PendingApproval = {
  readonly evaluationId: string;
  readonly evaluationExpiresAtUnixMs: number;
  readonly run: RunContext;
  readonly projection: RendererApproval;
};

type RendererApproval = {
  readonly requestId: string;
  readonly appId: string;
  readonly displayName: string;
  readonly canonicalProjectRoot: string;
  readonly shell: 'electron';
  readonly accountId: string;
  readonly permissionRequirements: readonly { readonly permissionId: string; readonly reason: string }[];
  readonly approvalState: string;
};

type RendererAuthorization = {
  readonly selector: string;
  readonly appId: string;
  readonly displayName: string;
  readonly canonicalProjectRoot: string;
  readonly shell: 'electron';
  readonly accountId: string;
  readonly permissionRequirements: readonly { readonly permissionId: string; readonly reason: string }[];
  readonly persistence: string;
  readonly state: string;
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
  readonly focusMainWindow: () => Promise<void>;
  readonly control?: NimiElectronLocalDevelopmentControl;
}): Promise<DesktopElectronLocalDevelopmentHost> {
  const host = new ElectronLocalDevelopmentHost(
    input.control ?? createNimiElectronLocalDevelopmentControl(),
    path.resolve(input.homeDirectory),
    input.focusMainWindow,
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
  private readonly pending = new Map<string, PendingApproval>();
  private readonly authorizationSelectors = new Map<string, string>();
  private server: Server | undefined;
  private endpoint = '';
  private shutdownPromise: Promise<void> | undefined;
  private shutdownComplete = false;
  private readonly projectionPublisher: DesktopElectronLocalDevelopmentProjectionPublisher;

  constructor(
    private readonly control: NimiElectronLocalDevelopmentControl,
    private readonly homeDirectory: string,
    private readonly focusMainWindow: () => Promise<void>,
  ) {
    this.projectionPublisher = createDesktopElectronLocalDevelopmentProjectionPublisher({
      homeDirectory,
      control,
    });
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
      await this.projectionPublisher.start(this.endpoint);
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
    if (command === 'local_development_pending_approvals') {
      return [...this.pending.values()].map((row) => row.projection);
    }
    if (command === 'local_development_runs_list') {
      return [...this.runs.values()].map((run) => projectRun(run.status));
    }
    if (command === 'local_development_authorizations_list') return this.listAuthorizations();
    const nested = exactNestedPayload(payload);
    if (command === 'local_development_decide') return this.decide(nested);
    return this.revoke(nested);
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
      await this.projectionPublisher.shutdown();
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
        const value = exact(body, ['appId', 'projectRoot', 'schemaVersion', 'shell']);
        if (value.schemaVersion !== 1) throw new Error('local-development-intent-invalid');
        const run = await this.startIntent(text(value.appId), text(value.projectRoot), text(value.shell));
        return json(response, { status: 'ok', run });
      }
      if (request.url === '/v1/status' || request.url === '/v1/cancel') {
        const value = exact(body, ['runId', 'schemaVersion']);
        if (value.schemaVersion !== 1) throw new Error('local-development-intent-invalid');
        const run = this.runs.get(selector(value.runId, 'dev-run'));
        if (!run) throw new Error('local-development-run-not-found');
        if (request.url === '/v1/cancel') await this.stopRun(run, 'stopped');
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

  private async startIntent(appId: string, projectRoot: string, shell: string): Promise<RunStatus> {
    let plan: ElectronLocalDevelopmentPlan;
    try {
      plan = await resolveElectronLocalDevelopmentPlan(projectRoot, appId, shell);
    } catch (error) {
      if (error instanceof ElectronLocalDevelopmentPlanError) throw error;
      throw new Error('local-development-project-changed', { cause: error });
    }
    const runId = randomSelector('dev-run');
    const run: RunContext = {
      plan,
      supervisorRunId: randomIdentifier(),
      stopped: false,
      tearingDown: false,
      supervising: false,
      rebuilding: false,
      rebuildRequested: false,
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
    await this.resolveAuthority(run);
    return run.status;
  }

  private async resolveAuthority(run: RunContext): Promise<void> {
    if (run.stopped) return;
    let evaluation: NimiElectronLocalDevelopmentEvaluation;
    try {
      evaluation = await this.control.evaluate({
        expectedAppId: run.plan.appId,
        projectRoot: run.plan.projectRoot,
        shell: 'electron',
        supervisorRunId: run.supervisorRunId,
      });
    } catch (error) {
      const code = reason(error);
      setRunState(run, resolveLocalDevelopmentAuthorityFailureState(code), code, code, true);
      this.ensureHealthTimer(run);
      return;
    }
    if (!sameLocalDevelopmentProject(evaluation, run.plan)) {
      setRunState(run, 'project-changed', 'local-development-project-changed', 'local-development-project-changed', false);
      return;
    }
    if (evaluation.confirmationRequired) {
      await this.queueApproval(run, evaluation);
      return;
    }
    const authorization = evaluation.authorization;
    if (!authorization || authorization.state !== 'active') {
      setRunState(run, 'authorization-required', 'local-development-authorization-required', 'local-development-authorization-required', false);
      return;
    }
    run.authorizationId = authorization.authorizationId;
    this.startSupervisor(run);
  }

  private async queueApproval(run: RunContext, evaluation: NimiElectronLocalDevelopmentEvaluation): Promise<void> {
    if (!evaluation.evaluationId
      || !Number.isSafeInteger(evaluation.evaluationExpiresAtUnixMs)
      || evaluation.evaluationExpiresAtUnixMs === null
      || evaluation.evaluationExpiresAtUnixMs <= 0) {
      throw new Error('runtime-service-untrusted');
    }
    for (const [requestId, row] of this.pending) {
      if (row.run === run) this.pending.delete(requestId);
    }
    const requestId = randomSelector('dev-approval');
    this.pending.set(requestId, {
      evaluationId: evaluation.evaluationId,
      evaluationExpiresAtUnixMs: evaluation.evaluationExpiresAtUnixMs,
      run,
      projection: {
        requestId,
        appId: evaluation.project.appId,
        displayName: evaluation.project.displayName,
        canonicalProjectRoot: evaluation.project.canonicalProjectRoot,
        shell: 'electron',
        accountId: evaluation.project.accountId,
        permissionRequirements: evaluation.project.permissionRequirements.map((requirement) => ({ ...requirement })),
        approvalState: evaluation.state,
      },
    });
    setRunState(run, 'pending-approval', 'Waiting for approval in Nimi', undefined, false);
    await this.focusMainWindow();
  }

  private async decide(payload: Readonly<Record<string, unknown>>): Promise<RunStatus> {
    if (Object.keys(payload).sort().join('|') !== 'decision|requestId|riskDisclosureAcknowledged'
      || typeof payload.riskDisclosureAcknowledged !== 'boolean') {
      throw new Error('local-development-approval-decision-invalid');
    }
    const requestId = selector(payload.requestId, 'dev-approval');
    const selected = this.pending.get(requestId);
    if (!selected) throw new Error('local-development-approval-request-not-found');
    const decision = localDecision(payload.decision);
    this.pending.delete(requestId);
    if (Date.now() >= selected.evaluationExpiresAtUnixMs) {
      await this.resolveAuthority(selected.run);
      return selected.run.status;
    }
    let authorization: NimiElectronLocalDevelopmentAuthorization;
    try {
      authorization = await this.control.decide({
        evaluationId: selected.evaluationId,
        decision,
        riskDisclosureAcknowledged: payload.riskDisclosureAcknowledged,
      });
    } catch (error) {
      const code = reason(error);
      if (requiresFreshLocalDevelopmentEvaluation(code)) {
        await this.resolveAuthority(selected.run);
        return selected.run.status;
      }
      const state = resolveLocalDevelopmentAuthorityFailureState(code);
      setRunState(selected.run, state, code, code, state === 'runtime-unavailable');
      if (state === 'runtime-unavailable') this.ensureHealthTimer(selected.run);
      return selected.run.status;
    }
    if (decision === 'deny') {
      setRunState(selected.run, 'denied', 'Development access was denied', 'local-development-approval-denied', false);
      return selected.run.status;
    }
    if (authorization.state !== 'active') {
      setRunState(selected.run, 'authorization-required', 'local-development-authorization-required', 'local-development-authorization-required', false);
      return selected.run.status;
    }
    selected.run.authorizationId = authorization.authorizationId;
    this.startSupervisor(selected.run);
    return selected.run.status;
  }

  private async listAuthorizations(): Promise<RendererAuthorization[]> {
    const rows = await this.control.listAuthorizations();
    return rows.filter((authorization) => authorization.project.shell === 'electron').map((authorization) => {
      let selectorValue = [...this.authorizationSelectors].find(([, id]) => id === authorization.authorizationId)?.[0];
      selectorValue ??= randomSelector('dev-project');
      this.authorizationSelectors.set(selectorValue, authorization.authorizationId);
      return projectAuthorization(selectorValue, authorization);
    });
  }

  private async revoke(payload: Readonly<Record<string, unknown>>): Promise<RendererAuthorization> {
    if (Object.keys(payload).join('|') !== 'selector') throw new Error('local-development-authorization-not-found');
    const selectorValue = selector(payload.selector, 'dev-project');
    const authorizationId = this.authorizationSelectors.get(selectorValue);
    if (!authorizationId) throw new Error('local-development-authorization-not-found');
    const authorization = await this.control.revokeAuthorization(authorizationId);
    for (const run of this.runs.values()) {
      if (run.authorizationId === authorizationId) {
        setRunState(run, 'revoked', 'Development authorization was revoked', 'local-development-session-revoked', false);
        await this.stopRunProcesses(run);
      }
    }
    return projectAuthorization(selectorValue, authorization);
  }

  private startSupervisor(run: RunContext): void {
    if (run.supervising || run.stopped) return;
    run.supervising = true;
    void this.supervise(run).finally(() => {
      run.supervising = false;
    });
  }

  private async supervise(run: RunContext): Promise<void> {
    try {
      setRunState(run, 'building', 'Building Electron main and preload', undefined, false);
      await this.runPackageScript(run, 'build:electron');
      if (run.stopped) return;
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
        if (run.stopped || run.renderer !== renderer) return;
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
    if (!run.authorizationId) throw new Error('local-development-authorization-required');
    const mainEntry = await canonicalElectronMain(run.plan);
    const userDataArguments = await resolveLocalAppUserDataArguments({
      authorizationId: run.authorizationId,
      homeDirectory: this.homeDirectory,
    });
    setRunState(run, 'starting', 'Starting the supervised Electron host', undefined, false);
    const outcome = await this.control.launch({
      authorizationId: run.authorizationId,
      supervisorRunId: run.supervisorRunId,
      shell: 'electron',
      hostExecutablePath: run.plan.electronExecutable,
      rendererOrigin: run.plan.rendererOrigin,
      hostArguments: resolveLocalDevelopmentElectronHostArguments({
        mainEntry,
        rendererOrigin: run.plan.rendererOrigin,
        userDataArguments,
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
    run.healthTimer ??= setInterval(() => void this.refreshAuthority(run), HEALTH_MS);
  }

  private async refreshAuthority(run: RunContext): Promise<void> {
    if (run.stopped || run.tearingDown || run.rebuilding || run.status.state === 'pending-approval') return;
    try {
      const evaluation = await this.control.evaluate({
        expectedAppId: run.plan.appId,
        projectRoot: run.plan.projectRoot,
        shell: 'electron',
        supervisorRunId: run.supervisorRunId,
      });
      if (evaluation.confirmationRequired) {
        await this.control.terminateHost(run.supervisorRunId);
        run.authorizationId = undefined;
        await this.queueApproval(run, evaluation);
        return;
      }
      if (!evaluation.authorization || evaluation.authorization.state !== 'active') {
        await this.control.terminateHost(run.supervisorRunId);
        setRunState(run, 'authorization-required', 'local-development-authorization-required', 'local-development-authorization-required', true);
        return;
      }
      run.authorizationId = evaluation.authorization.authorizationId;
      const running = await this.control.hostRunning(run.supervisorRunId);
      if (!running && run.status.hostGeneration > 0) await this.replaceHost(run);
      if (!run.supervising && !run.renderer) this.startSupervisor(run);
    } catch (error) {
      const code = reason(error);
      await this.failClosedRun(run, {
        state: resolveLocalDevelopmentAuthorityFailureState(code),
        message: code,
        reasonCode: code,
        retryable: true,
        endAuthorization: false,
        resumeAuthorityRefresh: true,
      });
    }
  }

  private async handleUnexpectedRendererExit(run: RunContext, code: number | null): Promise<void> {
    await this.failClosedRun(run, {
      state: 'failed',
      message: `local-development-dev-server-exited-${code ?? -1}`,
      reasonCode: 'local-development-dev-server-uncontrolled',
      retryable: false,
      endAuthorization: true,
      resumeAuthorityRefresh: false,
    });
  }

  private async failClosedRun(run: RunContext, outcome: {
    readonly state: string;
    readonly message: string;
    readonly reasonCode: string;
    readonly retryable: boolean;
    readonly endAuthorization: boolean;
    readonly resumeAuthorityRefresh: boolean;
  }): Promise<void> {
    if (run.stopped || run.tearingDown) return;
    run.tearingDown = true;
    if (!outcome.resumeAuthorityRefresh) run.stopped = true;
    try {
      await this.teardownRun(run, outcome.endAuthorization);
      setRunState(run, outcome.state, outcome.message, outcome.reasonCode, outcome.retryable);
    } catch {
      run.stopped = true;
      setRunState(run, 'cleanup-failed', 'local-development-process-cleanup-failed', 'local-development-process-cleanup-failed', false);
    } finally {
      run.tearingDown = false;
      if (outcome.resumeAuthorityRefresh && !run.stopped) this.ensureHealthTimer(run);
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
    const invocation = resolveLocalDevelopmentPackageScriptInvocation(script);
    const child = spawn(invocation.command, invocation.args, {
      cwd: run.plan.projectRoot,
      env: localDevelopmentToolEnvironment(),
      shell: invocation.shell,
      detached: true,
      windowsHide: true,
      stdio: 'pipe',
    });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => appendLog(run, `${script}:stdout`, chunk));
    child.stderr.on('data', (chunk: string) => appendLog(run, `${script}:stderr`, chunk));
    return child;
  }

  private async stopRun(run: RunContext, state: string): Promise<void> {
    run.stopped = true;
    try {
      await this.teardownRun(run, true);
    } catch (error) {
      setRunState(run, 'cleanup-failed', 'local-development-process-cleanup-failed', 'local-development-process-cleanup-failed', false);
      throw error;
    }
    setRunState(run, state, 'Development run stopped', undefined, false);
  }

  private async teardownRun(run: RunContext, endAuthorization: boolean): Promise<void> {
    if (endAuthorization && run.authorizationId) {
      run.pendingEndRunAuthorizationId ??= run.authorizationId;
    }
    run.authorizationId = undefined;
    const failures: unknown[] = [];
    try {
      await this.stopRunProcesses(run);
    } catch (error) {
      failures.push(error);
    }
    const pendingEndRunAuthorizationId = run.pendingEndRunAuthorizationId;
    if (pendingEndRunAuthorizationId) {
      try {
        await this.control.endRun(pendingEndRunAuthorizationId, run.supervisorRunId);
        if (run.pendingEndRunAuthorizationId === pendingEndRunAuthorizationId) {
          run.pendingEndRunAuthorizationId = undefined;
        }
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'local-development-process-cleanup-failed');
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

function projectAuthorization(selectorValue: string, authorization: NimiElectronLocalDevelopmentAuthorization): RendererAuthorization {
  if (authorization.project.shell !== 'electron') {
    throw new Error('local-development-authority-shell-unsupported');
  }
  return {
    selector: selectorValue,
    appId: authorization.project.appId,
    displayName: authorization.project.displayName,
    canonicalProjectRoot: authorization.project.canonicalProjectRoot,
    shell: authorization.project.shell,
    accountId: authorization.project.accountId,
    permissionRequirements: authorization.project.permissionRequirements.map((requirement) => ({ ...requirement })),
    persistence: authorization.persistence,
    state: authorization.state,
    updatedAtUnixMs: authorization.updatedAtUnixMs,
  };
}

export function sameLocalDevelopmentProject(
  evaluation: NimiElectronLocalDevelopmentEvaluation,
  plan: ElectronLocalDevelopmentPlan,
): boolean {
  return evaluation.project.appId === plan.appId
    && comparableCanonicalProjectPath(evaluation.project.canonicalProjectRoot)
      === comparableCanonicalProjectPath(plan.projectRoot)
    && evaluation.project.shell === 'electron';
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
export function resolveLocalDevelopmentAuthorityFailureState(
  reasonCode: string,
): 'runtime-unavailable' | 'authorization-required' {
  return [
    'process-replaced',
    'runtime-restarted',
    'runtime-service-repair-required',
    'runtime-service-unavailable',
    'runtime-service-untrusted',
  ].includes(reasonCode)
    ? 'runtime-unavailable'
    : 'authorization-required';
}

function requiresFreshLocalDevelopmentEvaluation(reasonCode: string): boolean {
  return reasonCode === 'local-development-authorization-required'
    || reasonCode === 'local-development-reapproval-required';
}
