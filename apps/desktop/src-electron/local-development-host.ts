import { randomBytes } from 'node:crypto';
import { watch, type FSWatcher } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

import {
  createNimiElectronLocalDevelopmentControl,
  type NimiElectronLocalDevelopmentAuthorization,
  type NimiElectronLocalDevelopmentControl,
  type NimiElectronLocalDevelopmentDecision,
  type NimiElectronLocalDevelopmentEvaluation,
} from '@nimiplatform/kit/shell/electron/main';
import {
  canonicalElectronMain,
  ElectronLocalDevelopmentPlanError,
  resolveElectronLocalDevelopmentPlan,
  type ElectronLocalDevelopmentPlan,
} from './local-development-plan.js';

const COMMANDS = new Set([
  'local_development_pending_approvals',
  'local_development_decide',
  'local_development_authorizations_list',
  'local_development_runs_list',
  'local_development_authorization_revoke',
]);
const MAX_REQUEST_BYTES = 32 * 1024;
const HEARTBEAT_MS = 3_000;
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
  buildChild?: ChildProcessWithoutNullStreams;
  renderer?: ChildProcessWithoutNullStreams;
  watcher?: FSWatcher;
  healthTimer?: ReturnType<typeof setInterval>;
  rebuildTimer?: ReturnType<typeof setTimeout>;
  stopped: boolean;
  supervising: boolean;
  rebuilding: boolean;
  rebuildRequested: boolean;
};

type PendingApproval = {
  readonly target: { readonly kind: 'evaluation'; readonly id: string }
    | { readonly kind: 'reactivation'; readonly id: string };
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
  readonly requestedCapabilities: readonly string[];
  readonly approvalState: string;
};

type RendererAuthorization = {
  readonly selector: string;
  readonly appId: string;
  readonly displayName: string;
  readonly canonicalProjectRoot: string;
  readonly shell: 'electron' | 'tauri';
  readonly accountId: string;
  readonly requestedCapabilities: readonly string[];
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

class ElectronLocalDevelopmentHost {
  private readonly runs = new Map<string, RunContext>();
  private readonly pending = new Map<string, PendingApproval>();
  private readonly authorizationSelectors = new Map<string, string>();
  private server: Server | undefined;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private readonly startedAt = new Date().toISOString();
  private endpoint = '';
  private readonly descriptorPath: string;

  constructor(
    private readonly control: NimiElectronLocalDevelopmentControl,
    homeDirectory: string,
    private readonly focusMainWindow: () => Promise<void>,
  ) {
    this.descriptorPath = path.join(
      homeDirectory, '.nimi', 'run', 'desktop', 'local-development', 'presence.v1.json',
    );
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
    await this.writePresence();
    this.heartbeat = setInterval(() => void this.writePresence().catch(() => undefined), HEARTBEAT_MS);
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

  async shutdown(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    await Promise.all([...this.runs.values()].map((run) => this.stopRun(run, 'stopped')));
    await new Promise<void>((resolve) => this.server?.close(() => resolve()) ?? resolve());
    this.server = undefined;
    await rm(this.descriptorPath, { force: true }).catch(() => undefined);
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
      setRunState(run, code === 'runtime-service-unavailable' ? 'runtime-unavailable' : 'authorization-required', code, code, true);
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
    const target = evaluation.evaluationId
      ? { kind: 'evaluation' as const, id: evaluation.evaluationId }
      : evaluation.authorization?.state === 'dormant'
        ? { kind: 'reactivation' as const, id: evaluation.authorization.authorizationId }
        : undefined;
    if (!target) throw new Error('runtime-service-untrusted');
    for (const [requestId, row] of this.pending) {
      if (row.run === run) this.pending.delete(requestId);
    }
    const requestId = randomSelector('dev-approval');
    this.pending.set(requestId, {
      target,
      run,
      projection: {
        requestId,
        appId: evaluation.project.appId,
        displayName: evaluation.project.displayName,
        canonicalProjectRoot: evaluation.project.canonicalProjectRoot,
        shell: 'electron',
        accountId: evaluation.project.accountId,
        requestedCapabilities: [...evaluation.project.requestedCapabilities],
        approvalState: evaluation.state,
      },
    });
    setRunState(run, 'pending-approval', 'Waiting for approval in Nimi Desktop', undefined, false);
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
    let authorization: NimiElectronLocalDevelopmentAuthorization;
    try {
      authorization = selected.target.kind === 'evaluation'
        ? await this.control.decide({
          evaluationId: selected.target.id,
          decision,
          riskDisclosureAcknowledged: payload.riskDisclosureAcknowledged,
        })
        : await this.control.reactivate({
          authorizationId: selected.target.id,
          riskDisclosureAcknowledged: payload.riskDisclosureAcknowledged,
        });
    } catch (error) {
      setRunState(selected.run, 'failed', reason(error), reason(error), false);
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
    return rows.map((authorization) => {
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
      run.renderer.once('exit', (code) => {
        if (!run.stopped) setRunState(run, 'failed', `local-development-dev-server-exited-${code ?? -1}`, 'local-development-dev-server-uncontrolled', false);
      });
    } catch (error) {
      if (!run.stopped) setRunState(run, 'failed', reason(error), reason(error), false);
      await this.stopRunProcesses(run);
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
        await this.launchHost(run);
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
    setRunState(run, 'starting', 'Starting the supervised Electron host', undefined, false);
    const outcome = await this.control.launch({
      authorizationId: run.authorizationId,
      supervisorRunId: run.supervisorRunId,
      shell: 'electron',
      hostExecutablePath: run.plan.electronExecutable,
      rendererOrigin: run.plan.rendererOrigin,
      hostArguments: [...observationArguments(), mainEntry, `--nimi-dev-renderer-url=${run.plan.rendererOrigin}`],
      workingDirectory: run.plan.projectRoot,
    });
    run.status.hostGeneration += 1;
    setRunState(run, 'running', 'Supervised electron host is running', undefined, false);
    appendLog(run, 'supervisor', `host generation ${run.status.hostGeneration} started (pid ${outcome.processId})`);
  }

  private ensureHealthTimer(run: RunContext): void {
    run.healthTimer ??= setInterval(() => void this.refreshAuthority(run), HEALTH_MS);
  }

  private async refreshAuthority(run: RunContext): Promise<void> {
    if (run.stopped || run.status.state === 'pending-approval') return;
    try {
      const evaluation = await this.control.evaluate({
        expectedAppId: run.plan.appId,
        projectRoot: run.plan.projectRoot,
        shell: 'electron',
        supervisorRunId: run.supervisorRunId,
      });
      if (evaluation.confirmationRequired) {
        await this.control.terminateHost(run.supervisorRunId).catch(() => undefined);
        run.authorizationId = undefined;
        await this.queueApproval(run, evaluation);
        return;
      }
      if (!evaluation.authorization || evaluation.authorization.state !== 'active') {
        await this.control.terminateHost(run.supervisorRunId).catch(() => undefined);
        setRunState(run, 'authorization-required', 'local-development-authorization-required', 'local-development-authorization-required', true);
        return;
      }
      run.authorizationId = evaluation.authorization.authorizationId;
      const running = await this.control.hostRunning(run.supervisorRunId);
      if (!running && run.status.hostGeneration > 0) await this.launchHost(run);
      if (!run.supervising && !run.renderer) this.startSupervisor(run);
    } catch (error) {
      const code = reason(error);
      setRunState(run, code === 'runtime-service-unavailable' ? 'runtime-unavailable' : 'authorization-required', code, code, true);
    }
  }

  private async runPackageScript(run: RunContext, script: string): Promise<void> {
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

  private spawnPackageScript(run: RunContext, script: string): ChildProcessWithoutNullStreams {
    const child = spawn('corepack.cmd', ['pnpm', 'run', script], {
      cwd: run.plan.projectRoot,
      env: process.env,
      shell: false,
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
    await this.stopRunProcesses(run);
    if (run.authorizationId) {
      await this.control.endRun(run.authorizationId, run.supervisorRunId).catch(() => undefined);
    }
    setRunState(run, state, 'Development run stopped', undefined, false);
  }

  private async stopRunProcesses(run: RunContext): Promise<void> {
    if (run.rebuildTimer) clearTimeout(run.rebuildTimer);
    if (run.healthTimer) clearInterval(run.healthTimer);
    run.rebuildTimer = undefined;
    run.healthTimer = undefined;
    run.rebuildRequested = false;
    run.watcher?.close();
    run.watcher = undefined;
    if (run.buildChild && run.buildChild.exitCode === null && run.buildChild.pid) {
      await terminateTree(run.buildChild.pid);
    }
    run.buildChild = undefined;
    if (run.renderer && run.renderer.exitCode === null && run.renderer.pid) {
      await terminateTree(run.renderer.pid);
    }
    run.renderer = undefined;
    await this.control.terminateHost(run.supervisorRunId).catch(() => undefined);
  }

  private async writePresence(): Promise<void> {
    const directory = path.dirname(this.descriptorPath);
    await mkdir(directory, { recursive: true });
    const temp = path.join(directory, `.presence.${process.pid}.${randomBytes(8).toString('hex')}.tmp`);
    const document = JSON.stringify({
      schemaVersion: 1,
      desktopAppId: 'nimi.desktop',
      desktopPid: process.pid,
      endpoint: this.endpoint,
      startedAt: this.startedAt,
      lastHeartbeatAt: new Date().toISOString(),
    });
    await writeFile(temp, document, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await rm(this.descriptorPath, { force: true });
    await rename(temp, this.descriptorPath);
  }
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
  return {
    selector: selectorValue,
    appId: authorization.project.appId,
    displayName: authorization.project.displayName,
    canonicalProjectRoot: authorization.project.canonicalProjectRoot,
    shell: authorization.project.shell,
    accountId: authorization.project.accountId,
    requestedCapabilities: [...authorization.project.requestedCapabilities],
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
  return path.resolve(normalized).toLowerCase();
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

function observationArguments(): string[] {
  const port = Number(process.env.NIMI_LOCAL_AGENT_PRODUCT_ZHIYU_CDP_PORT || 0);
  const root = String(process.env.NIMI_LOCAL_AGENT_PRODUCT_ZHIYU_USER_DATA_ROOT || '').trim();
  const agent = String(process.env.NIMI_LOCAL_AGENT_PRODUCT_AGENT_ID || '').trim();
  if (!port && !root && !agent) return [];
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || !path.isAbsolute(root)
    || !/^local-agent:runtime-[0-9a-f]{32}$/u.test(agent)) {
    throw new Error('local-development-observation-config-invalid');
  }
  return [
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${path.resolve(root)}`,
    `--nimi-dev-agent-id=${agent}`,
  ];
}

async function waitForRenderer(origin: string, child: ChildProcessWithoutNullStreams, stopped: () => boolean): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (stopped()) return;
    if (child.exitCode !== null) throw new Error(`local-development-dev-server-exited-${child.exitCode}`);
    try {
      const response = await fetch(origin, { redirect: 'error', signal: AbortSignal.timeout(2_000) });
      if (response.status < 500) {
        await delay(250);
        if (child.exitCode !== null) throw new Error(`local-development-dev-server-exited-${child.exitCode}`);
        return;
      }
    } catch {
      // Continue until the bounded readiness deadline.
    }
    await delay(350);
  }
  throw new Error('local-development-dev-server-unavailable');
}

async function terminateTree(processId: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const child = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), [
      '/pid', String(processId), '/t', '/f',
    ], { windowsHide: true, stdio: 'ignore' });
    child.once('exit', () => resolve());
    child.once('error', () => resolve());
  });
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_REQUEST_BYTES) throw new Error('local-development-intent-invalid');
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function json(response: ServerResponse, body: unknown): void {
  response.statusCode = 200;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}

function exactNestedPayload(payload: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  if (Object.keys(payload).join('|') !== 'payload') throw new Error('local-development-command-payload-invalid');
  return exact(payload.payload, Object.keys(record(payload.payload)));
}

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const row = record(value);
  if (Object.keys(row).sort().join('|') !== [...keys].sort().join('|')) throw new Error('local-development-intent-invalid');
  return row;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('local-development-intent-invalid');
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096 || value.trim() !== value) {
    throw new Error('local-development-intent-invalid');
  }
  return value;
}

function selector(value: unknown, prefix: string): string {
  const selected = text(value);
  if (!selected.startsWith(`${prefix}-`) || selected.length > 160 || !/^[A-Za-z0-9_-]+$/u.test(selected)) {
    throw new Error('local-development-selector-invalid');
  }
  return selected;
}

function localDecision(value: unknown): NimiElectronLocalDevelopmentDecision {
  if (value !== 'deny' && value !== 'allow-run-once' && value !== 'allow-remember-project') {
    throw new Error('local-development-approval-decision-invalid');
  }
  return value;
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

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
