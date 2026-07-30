import { resolveNimiElectronProtectedLocalBindingPackage } from './local-app-host.js';
import { loadNimiElectronProtectedLocalPackage } from './protected-local-binding-loader.js';
import {
  parseNimiElectronLocalDevelopmentAuthoritySummary,
  type NimiElectronLocalDevelopmentAuthoritySummary,
} from './local-development-authority-summary.js';
import { NimiElectronShellHostError } from './types.js';

type NativeJsonOutcome =
  | { readonly status: 'ok'; readonly value: unknown }
  | { readonly status: 'error'; readonly reasonCode: unknown; readonly retryable: unknown };

const NATIVE_CONTROL_DEADLINE_MS = 20_000;

export type NimiElectronLocalDevelopmentShell = 'electron' | 'tauri';
export type NimiElectronLocalDevelopmentDecision = 'deny' | 'allow-run-once' | 'allow-project';

export type NimiElectronLocalDevelopmentPermissionRequirement = {
  readonly permissionId: string;
  readonly reason: string;
};

export type NimiElectronLocalDevelopmentProject = {
  readonly appId: string;
  readonly displayName: string;
  readonly canonicalProjectRoot: string;
  readonly canonicalManifestPath: string;
  readonly shell: NimiElectronLocalDevelopmentShell;
  readonly accountId: string;
  readonly permissionRequirements: readonly NimiElectronLocalDevelopmentPermissionRequirement[];
  /** Main-process private integrity material. Never project to a renderer. */
  readonly permissionRequirementFingerprint: string;
};

export type NimiElectronLocalDevelopmentAuthorization = {
  /** Main-process private Runtime identifier. Never project to a renderer. */
  readonly authorizationId: string;
  readonly project: NimiElectronLocalDevelopmentProject;
  readonly state: 'confirmation-required' | 'active' | 'reapproval-required' | 'denied' | 'revoked';
  readonly persistence: NimiElectronLocalDevelopmentDecision;
  readonly authorizationGeneration: number;
  readonly approvedAtUnixMs: number;
  readonly updatedAtUnixMs: number;
};

export type NimiElectronLocalDevelopmentEvaluation = {
  /** Main-process private Runtime identifier. Never project to a renderer. */
  readonly evaluationId: string | null;
  readonly project: NimiElectronLocalDevelopmentProject;
  readonly state: NimiElectronLocalDevelopmentAuthorization['state'];
  readonly confirmationRequired: boolean;
  readonly authorization: NimiElectronLocalDevelopmentAuthorization | null;
  readonly evaluationExpiresAtUnixMs: number | null;
};

export type NimiElectronLocalDevelopmentBinding = {
  readonly desktopGetLocalDevelopmentAuthoritySummary: () => Promise<NativeJsonOutcome>;
  readonly desktopEvaluateLocalDevelopmentProject: (input: Readonly<Record<string, unknown>>) => Promise<NativeJsonOutcome>;
  readonly desktopDecideLocalDevelopmentProject: (input: Readonly<Record<string, unknown>>) => Promise<NativeJsonOutcome>;
  readonly desktopListLocalDevelopmentAuthorizations: () => Promise<NativeJsonOutcome>;
  readonly desktopRevokeLocalDevelopmentAuthorization: (input: Readonly<Record<string, unknown>>) => Promise<NativeJsonOutcome>;
  readonly desktopLaunchLocalDevelopmentHost: (input: Readonly<Record<string, unknown>>) => Promise<NativeJsonOutcome>;
  readonly desktopLocalDevelopmentHostRunning: (input: Readonly<Record<string, unknown>>) => Promise<NativeJsonOutcome>;
  readonly desktopTerminateLocalDevelopmentHost: (input: Readonly<Record<string, unknown>>) => Promise<NativeJsonOutcome>;
  readonly desktopEndLocalDevelopmentRun: (input: Readonly<Record<string, unknown>>) => Promise<NativeJsonOutcome>;
};

export type NimiElectronLocalDevelopmentControl = {
  readonly getAuthoritySummary: () => Promise<NimiElectronLocalDevelopmentAuthoritySummary>;
  readonly evaluate: (input: {
    readonly expectedAppId: string;
    readonly projectRoot: string;
    readonly shell: NimiElectronLocalDevelopmentShell;
    readonly supervisorRunId: string;
  }) => Promise<NimiElectronLocalDevelopmentEvaluation>;
  readonly decide: (input: {
    readonly evaluationId: string;
    readonly decision: NimiElectronLocalDevelopmentDecision;
    readonly riskDisclosureAcknowledged: boolean;
  }) => Promise<NimiElectronLocalDevelopmentAuthorization>;
  readonly listAuthorizations: () => Promise<readonly NimiElectronLocalDevelopmentAuthorization[]>;
  readonly revokeAuthorization: (authorizationId: string) => Promise<NimiElectronLocalDevelopmentAuthorization>;
  readonly launch: (input: {
    readonly authorizationId: string;
    readonly supervisorRunId: string;
    readonly shell: NimiElectronLocalDevelopmentShell;
    readonly hostExecutablePath: string;
    readonly rendererOrigin: string;
    readonly hostArguments: readonly string[];
    readonly workingDirectory: string;
  }) => Promise<{ readonly processId: number; readonly bindDeadlineUnixMs: number }>;
  readonly hostRunning: (supervisorRunId: string) => Promise<boolean>;
  readonly terminateHost: (supervisorRunId: string) => Promise<void>;
  readonly endRun: (authorizationId: string, supervisorRunId: string) => Promise<void>;
};

class ElectronLocalDevelopmentControl implements NimiElectronLocalDevelopmentControl {
  constructor(private readonly binding: NimiElectronLocalDevelopmentBinding) {}

  async getAuthoritySummary() {
    const value = await invokeNative(
      () => this.binding.desktopGetLocalDevelopmentAuthoritySummary(),
      'get_local_development_authority_summary',
    );
    try {
      return parseNimiElectronLocalDevelopmentAuthoritySummary(value);
    } catch {
      throw controlError(
        'runtime-service-untrusted',
        false,
        'get_local_development_authority_summary',
      );
    }
  }

  async evaluate(input: Parameters<NimiElectronLocalDevelopmentControl['evaluate']>[0]) {
    return parseEvaluation(await invokeNative(
      () => this.binding.desktopEvaluateLocalDevelopmentProject({
        expectedAppId: boundedText(input.expectedAppId),
        projectRoot: boundedText(input.projectRoot),
        shell: shell(input.shell),
        supervisorRunId: identifier(input.supervisorRunId),
      }),
      'evaluate_local_development_project',
    ));
  }

  async decide(input: Parameters<NimiElectronLocalDevelopmentControl['decide']>[0]) {
    return parseAuthorization(await invokeNative(
      () => this.binding.desktopDecideLocalDevelopmentProject({
        evaluationId: identifier(input.evaluationId),
        decision: decision(input.decision),
        riskDisclosureAcknowledged: Boolean(input.riskDisclosureAcknowledged),
      }),
      'decide_local_development_project',
    ));
  }

  async listAuthorizations() {
    const value = await invokeNative(
      () => this.binding.desktopListLocalDevelopmentAuthorizations(),
      'list_local_development_authorizations',
    );
    if (!Array.isArray(value)) throw controlError('runtime-service-untrusted', false, 'list_local_development_authorizations');
    return value.map(parseAuthorization);
  }

  async revokeAuthorization(authorizationId: string) {
    return parseAuthorization(await invokeNative(
      () => this.binding.desktopRevokeLocalDevelopmentAuthorization({ authorizationId: identifier(authorizationId) }),
      'revoke_local_development_authorization',
    ));
  }

  async launch(input: Parameters<NimiElectronLocalDevelopmentControl['launch']>[0]) {
    const value = exact(await invokeNative(
      () => this.binding.desktopLaunchLocalDevelopmentHost({
        authorizationId: identifier(input.authorizationId),
        supervisorRunId: identifier(input.supervisorRunId),
        shell: shell(input.shell),
        hostExecutablePath: boundedText(input.hostExecutablePath),
        rendererOrigin: boundedText(input.rendererOrigin),
        hostArguments: input.hostArguments.map(boundedText),
        workingDirectory: boundedText(input.workingDirectory),
      }),
      'launch_local_development_host',
    ), ['bindDeadlineUnixMs', 'processId']);
    const processId = integer(value.processId, 1);
    const bindDeadlineUnixMs = integer(value.bindDeadlineUnixMs, Date.now() + 1);
    return { processId, bindDeadlineUnixMs };
  }

  async hostRunning(supervisorRunId: string) {
    const value = exact(await invokeNative(
      () => this.binding.desktopLocalDevelopmentHostRunning({ supervisorRunId: identifier(supervisorRunId) }),
      'local_development_host_running',
    ), ['running']);
    if (typeof value.running !== 'boolean') throw controlError('runtime-service-untrusted', false, 'local_development_host_running');
    return value.running;
  }

  async terminateHost(supervisorRunId: string) {
    const value = exact(await invokeNative(
      () => this.binding.desktopTerminateLocalDevelopmentHost({ supervisorRunId: identifier(supervisorRunId) }),
      'terminate_local_development_host',
    ), ['terminated']);
    if (value.terminated !== true) throw controlError('runtime-service-untrusted', false, 'terminate_local_development_host');
  }

  async endRun(authorizationId: string, supervisorRunId: string) {
    const value = exact(await invokeNative(
      () => this.binding.desktopEndLocalDevelopmentRun({
        authorizationId: identifier(authorizationId),
        supervisorRunId: identifier(supervisorRunId),
      }),
      'end_local_development_run',
    ), ['ended']);
    if (value.ended !== true) throw controlError('runtime-service-untrusted', false, 'end_local_development_run');
  }
}

class LazyElectronLocalDevelopmentControl implements NimiElectronLocalDevelopmentControl {
  private control: NimiElectronLocalDevelopmentControl | undefined;

  private resolve(): NimiElectronLocalDevelopmentControl {
    this.control ??= new ElectronLocalDevelopmentControl(loadPlatformBinding());
    return this.control;
  }

  getAuthoritySummary: NimiElectronLocalDevelopmentControl['getAuthoritySummary'] = () => this.resolve().getAuthoritySummary();
  evaluate: NimiElectronLocalDevelopmentControl['evaluate'] = (input) => this.resolve().evaluate(input);
  decide: NimiElectronLocalDevelopmentControl['decide'] = (input) => this.resolve().decide(input);
  listAuthorizations: NimiElectronLocalDevelopmentControl['listAuthorizations'] = () => this.resolve().listAuthorizations();
  revokeAuthorization: NimiElectronLocalDevelopmentControl['revokeAuthorization'] = (id) => this.resolve().revokeAuthorization(id);
  launch: NimiElectronLocalDevelopmentControl['launch'] = (input) => this.resolve().launch(input);
  hostRunning: NimiElectronLocalDevelopmentControl['hostRunning'] = (id) => this.resolve().hostRunning(id);
  terminateHost: NimiElectronLocalDevelopmentControl['terminateHost'] = (id) => this.resolve().terminateHost(id);
  endRun: NimiElectronLocalDevelopmentControl['endRun'] = (authorizationId, runId) => this.resolve().endRun(authorizationId, runId);
}

export function createNimiElectronLocalDevelopmentControl(): NimiElectronLocalDevelopmentControl {
  return new LazyElectronLocalDevelopmentControl();
}

/** @internal Focused contract-test seam. */
export function createNimiElectronLocalDevelopmentControlForBinding(
  binding: NimiElectronLocalDevelopmentBinding,
): NimiElectronLocalDevelopmentControl {
  return new ElectronLocalDevelopmentControl(validateBinding(binding));
}

async function invokeNative(invoke: () => Promise<NativeJsonOutcome>, operation: string): Promise<unknown> {
  let outcome: NativeJsonOutcome;
  let timer: NodeJS.Timeout | undefined;
  try {
    outcome = await Promise.race([
      invoke(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('protected-native-control-timeout')), NATIVE_CONTROL_DEADLINE_MS);
      }),
    ]);
  } catch {
    throw controlError('runtime-service-untrusted', false, operation);
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (outcome?.status === 'error') {
    if (typeof outcome.reasonCode !== 'string'
      || !/^[A-Za-z][A-Za-z0-9_-]{0,127}$/u.test(outcome.reasonCode)
      || typeof outcome.retryable !== 'boolean') {
      throw controlError('runtime-service-untrusted', false, operation);
    }
    throw controlError(outcome.reasonCode, outcome.retryable, operation);
  }
  if (outcome?.status !== 'ok') throw controlError('runtime-service-untrusted', false, operation);
  return outcome.value;
}

function parseEvaluation(value: unknown): NimiElectronLocalDevelopmentEvaluation {
  const row = exact(value, [
    'authorization', 'confirmationRequired', 'evaluationExpiresAtUnixMs', 'evaluationId', 'project', 'state',
  ]);
  if (typeof row.confirmationRequired !== 'boolean') invalid();
  const evaluationId = row.evaluationId === null ? null : identifier(row.evaluationId);
  const authorization = row.authorization === null ? null : parseAuthorization(row.authorization);
  const evaluationExpiresAtUnixMs = row.evaluationExpiresAtUnixMs === null
    ? null
    : integer(row.evaluationExpiresAtUnixMs, 1);
  return {
    evaluationId,
    project: parseProject(row.project),
    state: authorizationState(row.state),
    confirmationRequired: row.confirmationRequired,
    authorization,
    evaluationExpiresAtUnixMs,
  };
}

function parseAuthorization(value: unknown): NimiElectronLocalDevelopmentAuthorization {
  const row = exact(value, [
    'approvedAtUnixMs', 'authorizationGeneration', 'authorizationId', 'persistence', 'project', 'state', 'updatedAtUnixMs',
  ]);
  return {
    authorizationId: identifier(row.authorizationId),
    project: parseProject(row.project),
    state: authorizationState(row.state),
    persistence: decision(row.persistence),
    authorizationGeneration: integer(row.authorizationGeneration, 1),
    approvedAtUnixMs: integer(row.approvedAtUnixMs, 1),
    updatedAtUnixMs: integer(row.updatedAtUnixMs, 1),
  };
}

function parseProject(value: unknown): NimiElectronLocalDevelopmentProject {
  const row = exact(value, [
    'accountId', 'appId', 'canonicalManifestPath', 'canonicalProjectRoot', 'displayName',
    'permissionRequirementFingerprint', 'permissionRequirements', 'shell',
  ]);
  if (!Array.isArray(row.permissionRequirements)) invalid();
  const permissionRequirements = row.permissionRequirements.map((value) => {
    const requirement = exact(value, ['permissionId', 'reason']);
    const permissionId = boundedText(requirement.permissionId);
    const reason = boundedText(requirement.reason);
    if (Buffer.byteLength(reason, 'utf8') > 240) invalid();
    return { permissionId, reason };
  });
  if (new Set(permissionRequirements.map(({ permissionId }) => permissionId)).size !== permissionRequirements.length) invalid();
  return {
    appId: boundedText(row.appId),
    displayName: boundedText(row.displayName),
    canonicalProjectRoot: boundedText(row.canonicalProjectRoot),
    canonicalManifestPath: boundedText(row.canonicalManifestPath),
    shell: shell(row.shell),
    accountId: boundedText(row.accountId),
    permissionRequirements,
    permissionRequirementFingerprint: identifier(row.permissionRequirementFingerprint),
  };
}

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) invalid();
  return value;
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) invalid();
  return value;
}

function boundedText(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096 || value.trim() !== value) invalid();
  return value;
}

function integer(value: unknown, minimum: number): number {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < minimum) invalid();
  return numeric;
}

function shell(value: unknown): NimiElectronLocalDevelopmentShell {
  if (value !== 'electron' && value !== 'tauri') invalid();
  return value;
}

function decision(value: unknown): NimiElectronLocalDevelopmentDecision {
  if (value !== 'deny' && value !== 'allow-run-once' && value !== 'allow-project') invalid();
  return value;
}

function authorizationState(value: unknown): NimiElectronLocalDevelopmentAuthorization['state'] {
  if (!['confirmation-required', 'active', 'reapproval-required', 'denied', 'revoked'].includes(String(value))) invalid();
  return value as NimiElectronLocalDevelopmentAuthorization['state'];
}

function validateBinding(value: unknown): NimiElectronLocalDevelopmentBinding {
  const methods = [
    'desktopGetLocalDevelopmentAuthoritySummary',
    'desktopEvaluateLocalDevelopmentProject',
    'desktopDecideLocalDevelopmentProject',
    'desktopListLocalDevelopmentAuthorizations',
    'desktopRevokeLocalDevelopmentAuthorization',
    'desktopLaunchLocalDevelopmentHost',
    'desktopLocalDevelopmentHostRunning',
    'desktopTerminateLocalDevelopmentHost',
    'desktopEndLocalDevelopmentRun',
  ];
  if (!isRecord(value) || methods.some((method) => typeof value[method] !== 'function')) {
    throw controlError('runtime-service-untrusted', false, 'load_local_development_control');
  }
  return value as NimiElectronLocalDevelopmentBinding;
}

function loadPlatformBinding(): NimiElectronLocalDevelopmentBinding {
  try {
    const packageName = resolveNimiElectronProtectedLocalBindingPackage(process.platform, process.arch);
    return validateBinding(loadNimiElectronProtectedLocalPackage(packageName));
  } catch (error) {
    if (error instanceof NimiElectronShellHostError) throw error;
    throw controlError('protected-carrier-required', false, 'load_local_development_control');
  }
}

function controlError(reasonCode: string, retryable: boolean, operation: string): NimiElectronShellHostError {
  const code = reasonCode === 'protected-carrier-required'
    ? 'protected-carrier-required'
    : reasonCode === 'runtime-service-unavailable'
      ? 'runtime-service-unavailable'
      : reasonCode === 'runtime-service-repair-required'
        ? 'runtime-service-repair-required'
        : reasonCode === 'runtime-service-untrusted'
          ? 'runtime-service-untrusted'
          : reasonCode === 'runtime-service-error-unclassified'
            ? 'runtime-service-error-unclassified'
            : 'runtime-permission-denied';
  return new NimiElectronShellHostError({
    code,
    message: reasonCode,
    reasonCode,
    actionHint: retryable ? 'retry_local_development_operation' : 'refresh_local_development_projection',
    source: reasonCode === 'protected-carrier-required' ? 'electron' : 'runtime',
    details: { operation, retryable },
  });
}

function invalid(): never {
  throw controlError('runtime-service-untrusted', false, 'parse_local_development_projection');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
