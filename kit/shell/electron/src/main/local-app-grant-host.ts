import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

import { resolveNimiElectronProtectedLocalBindingPackage } from './local-app-host.js';
import { asRecord } from './paths.js';
import { NimiElectronShellHostError } from './types.js';

type LocalAppGrantCommand =
  | 'local_app_grant_pending_list'
  | 'local_app_grant_decide'
  | 'local_app_grant_list'
  | 'local_app_grant_revoke';

type NativeJsonOutcome =
  | { readonly status: 'ok'; readonly value: unknown }
  | { readonly status: 'error'; readonly reasonCode: unknown; readonly retryable: unknown };

type NativePendingGrant = {
  readonly requestId: string;
  readonly presenceChallengeId: string;
  readonly pendingGrantId: string;
  readonly operationId: string;
  readonly resourceRef: string;
  readonly expiresAtUnixMs: number;
};

type NativeGrantProjection = {
  readonly state: 'granted' | 'denied' | 'revoked';
  readonly grantId: string;
  readonly operationId: string;
  readonly resourceRef: string;
};

type PendingProjection = {
  readonly selector: string;
  readonly operationId: string;
  readonly resourceRef: string;
  readonly state: 'pending';
  readonly reasonCode: 'local-app-presence-required';
  readonly retryable: false;
  readonly expiresAtUnixMs: number;
};

type ManagementProjection = {
  readonly selector: string;
  readonly operationId: string;
  readonly resourceRef: string;
  readonly state: 'granted' | 'denied' | 'revoked';
  readonly reasonCode: 'action-executed' | 'local-app-grant-required' | 'local-app-grant-revoked';
  readonly retryable: false;
};

type PendingGrant = {
  readonly requestId: string;
  readonly presenceChallengeId: string;
  readonly pendingGrantId: string;
  readonly projection: PendingProjection;
};

type GrantedGrant = {
  readonly grantId: string;
  readonly projection: ManagementProjection;
};

export type NimiElectronLocalAppGrantBinding = {
  readonly desktopPendingLocalAppGrant: () => Promise<NativeJsonOutcome>;
  readonly desktopDecideLocalAppGrant: (input: {
    readonly requestId: string;
    readonly presenceChallengeId: string;
    readonly approved: boolean;
  }) => Promise<NativeJsonOutcome>;
  readonly desktopRevokeLocalAppGrant: (input: { readonly grantId: string }) => Promise<NativeJsonOutcome>;
};

export type NimiElectronLocalAppGrantHost = {
  readonly invoke: (command: LocalAppGrantCommand, payload: Readonly<Record<string, unknown>>) => Promise<unknown>;
};

class ElectronLocalAppGrantHost implements NimiElectronLocalAppGrantHost {
  private readonly pending = new Map<string, PendingGrant>();
  private readonly grants = new Map<string, GrantedGrant>();

  constructor(private readonly binding: NimiElectronLocalAppGrantBinding) {}

  async invoke(command: LocalAppGrantCommand, payload: Readonly<Record<string, unknown>>): Promise<unknown> {
    if (command === 'local_app_grant_pending_list') return this.listPending(command);
    if (command === 'local_app_grant_list') return [...this.grants.values()].map((row) => row.projection);
    const nested = asRecord(payload.payload, `${command} payload must be an object`);
    if (command === 'local_app_grant_decide') return this.decide(nested, command);
    return this.revoke(nested, command);
  }

  private async listPending(command: LocalAppGrantCommand): Promise<PendingProjection[]> {
    const value = await invokeBinding(() => this.binding.desktopPendingLocalAppGrant(), command);
    if (value !== null) {
      const native = parsePending(value, command);
      const duplicate = [...this.pending.values()].some((row) => (
        row.requestId === native.requestId && row.pendingGrantId === native.pendingGrantId
      ));
      if (!duplicate) {
        const selector = randomSelector('grant-approval');
        this.pending.set(selector, {
          requestId: native.requestId,
          presenceChallengeId: native.presenceChallengeId,
          pendingGrantId: native.pendingGrantId,
          projection: {
            selector,
            operationId: native.operationId,
            resourceRef: native.resourceRef,
            state: 'pending',
            reasonCode: 'local-app-presence-required',
            retryable: false,
            expiresAtUnixMs: native.expiresAtUnixMs,
          },
        });
      }
    }
    const now = Date.now();
    for (const [selector, row] of this.pending) {
      if (row.projection.expiresAtUnixMs <= now) this.pending.delete(selector);
    }
    return [...this.pending.values()].map((row) => row.projection);
  }

  private async decide(payload: Readonly<Record<string, unknown>>, command: LocalAppGrantCommand): Promise<ManagementProjection> {
    const selector = requiredSelector(payload.selector, 'grant-approval', command);
    if (typeof payload.approved !== 'boolean' || Object.keys(payload).sort().join('|') !== 'approved|selector') {
      throw grantError('runtime-service-untrusted', false, command);
    }
    const pending = this.pending.get(selector);
    if (!pending) throw grantError('local-app-grant-request-not-found', false, command);
    this.pending.delete(selector);
    let native: NativeGrantProjection;
    try {
      native = parseGrant(await invokeBinding(() => this.binding.desktopDecideLocalAppGrant({
        requestId: pending.requestId,
        presenceChallengeId: pending.presenceChallengeId,
        approved: payload.approved as boolean,
      }), command), command);
    } catch (error) {
      this.pending.set(selector, pending);
      throw error;
    }
    const approved = payload.approved as boolean;
    if ((approved && native.state !== 'granted') || (!approved && native.state !== 'denied')) {
      throw grantError('runtime-service-untrusted', false, command);
    }
    const controlSelector = randomSelector('grant-control');
    const projection: ManagementProjection = {
      selector: controlSelector,
      operationId: native.operationId,
      resourceRef: native.resourceRef,
      state: approved ? 'granted' : 'denied',
      reasonCode: approved ? 'action-executed' : 'local-app-grant-required',
      retryable: false,
    };
    if (approved) this.grants.set(controlSelector, { grantId: native.grantId, projection });
    return projection;
  }

  private async revoke(payload: Readonly<Record<string, unknown>>, command: LocalAppGrantCommand): Promise<ManagementProjection> {
    const selector = requiredSelector(payload.selector, 'grant-control', command);
    if (Object.keys(payload).sort().join('|') !== 'selector') {
      throw grantError('runtime-service-untrusted', false, command);
    }
    const granted = this.grants.get(selector);
    if (!granted) throw grantError('local-app-grant-not-found', false, command);
    const native = parseGrant(await invokeBinding(
      () => this.binding.desktopRevokeLocalAppGrant({ grantId: granted.grantId }),
      command,
    ), command);
    if (native.state !== 'revoked' || native.grantId !== granted.grantId) {
      throw grantError('runtime-service-untrusted', false, command);
    }
    this.grants.delete(selector);
    return {
      ...granted.projection,
      state: 'revoked',
      reasonCode: 'local-app-grant-revoked',
    };
  }
}

class LazyElectronLocalAppGrantHost implements NimiElectronLocalAppGrantHost {
  private host: NimiElectronLocalAppGrantHost | undefined;

  invoke(command: LocalAppGrantCommand, payload: Readonly<Record<string, unknown>>): Promise<unknown> {
    this.host ??= new ElectronLocalAppGrantHost(loadPlatformBinding());
    return this.host.invoke(command, payload);
  }
}

export function createNimiElectronLocalAppGrantHost(): NimiElectronLocalAppGrantHost {
  return new LazyElectronLocalAppGrantHost();
}

/** @internal Focused contract-test seam; not re-exported from the public main entrypoint. */
export function createNimiElectronLocalAppGrantHostForBinding(
  binding: NimiElectronLocalAppGrantBinding,
): NimiElectronLocalAppGrantHost {
  return new ElectronLocalAppGrantHost(validateBinding(binding));
}

export function isElectronLocalAppGrantCommand(command: string): command is LocalAppGrantCommand {
  return command === 'local_app_grant_pending_list'
    || command === 'local_app_grant_decide'
    || command === 'local_app_grant_list'
    || command === 'local_app_grant_revoke';
}

async function invokeBinding(
  invoke: () => Promise<NativeJsonOutcome>,
  command: LocalAppGrantCommand,
): Promise<unknown> {
  let outcome: NativeJsonOutcome;
  try {
    outcome = await invoke();
  } catch {
    throw grantError('runtime-service-untrusted', false, command);
  }
  if (outcome?.status === 'error') {
    if (typeof outcome.reasonCode !== 'string'
      || !isBoundedReasonCode(outcome.reasonCode)
      || typeof outcome.retryable !== 'boolean') {
      throw grantError('runtime-service-untrusted', false, command);
    }
    throw grantError(outcome.reasonCode, outcome.retryable, command);
  }
  if (outcome?.status !== 'ok') throw grantError('runtime-service-untrusted', false, command);
  return outcome.value;
}

function parsePending(value: unknown, command: LocalAppGrantCommand): NativePendingGrant {
  const record = exactRecord(value, [
    'expiresAtUnixMs', 'operationId', 'pendingGrantId', 'presenceChallengeId', 'requestId', 'resourceRef',
  ], command);
  const expiresAtUnixMs = Number(record.expiresAtUnixMs);
  if (!Number.isSafeInteger(expiresAtUnixMs) || expiresAtUnixMs <= Date.now()) {
    throw grantError('runtime-service-untrusted', false, command);
  }
  return {
    requestId: privateIdentifier(record.requestId, command),
    presenceChallengeId: privateIdentifier(record.presenceChallengeId, command),
    pendingGrantId: privateIdentifier(record.pendingGrantId, command),
    operationId: boundedText(record.operationId, command),
    resourceRef: boundedText(record.resourceRef, command),
    expiresAtUnixMs,
  };
}

function parseGrant(value: unknown, command: LocalAppGrantCommand): NativeGrantProjection {
  const record = exactRecord(value, ['grantId', 'operationId', 'resourceRef', 'state'], command);
  if (!['granted', 'denied', 'revoked'].includes(String(record.state))) {
    throw grantError('runtime-service-untrusted', false, command);
  }
  return {
    state: record.state as NativeGrantProjection['state'],
    grantId: privateIdentifier(record.grantId, command),
    operationId: boundedText(record.operationId, command),
    resourceRef: boundedText(record.resourceRef, command),
  };
}

function exactRecord(value: unknown, keys: readonly string[], command: LocalAppGrantCommand): Record<string, unknown> {
  if (!isPlainRecord(value) || Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) {
    throw grantError('runtime-service-untrusted', false, command);
  }
  return value;
}

function privateIdentifier(value: unknown, command: LocalAppGrantCommand): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) {
    throw grantError('runtime-service-untrusted', false, command);
  }
  return value;
}

function boundedText(value: unknown, command: LocalAppGrantCommand): string {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0 || value.length > 512) {
    throw grantError('runtime-service-untrusted', false, command);
  }
  return value;
}

function requiredSelector(value: unknown, prefix: 'grant-approval' | 'grant-control', command: LocalAppGrantCommand): string {
  const selector = boundedText(value, command);
  if (!selector.startsWith(`${prefix}-`) || selector.length > 160 || !/^[A-Za-z0-9_-]+$/u.test(selector)) {
    throw grantError('local-app-grant-selector-invalid', false, command);
  }
  return selector;
}

function randomSelector(prefix: 'grant-approval' | 'grant-control'): string {
  return `${prefix}-${randomBytes(18).toString('base64url')}`;
}

function loadPlatformBinding(): NimiElectronLocalAppGrantBinding {
  try {
    const packageName = resolveNimiElectronProtectedLocalBindingPackage(process.platform, process.arch);
    return validateBinding(createRequire(import.meta.url)(packageName) as unknown);
  } catch (error) {
    if (error instanceof NimiElectronShellHostError) throw error;
    throw grantError('protected-carrier-required', false, 'local_app_grant_pending_list');
  }
}

function validateBinding(value: unknown): NimiElectronLocalAppGrantBinding {
  if (!isPlainRecord(value)
    || typeof value.desktopPendingLocalAppGrant !== 'function'
    || typeof value.desktopDecideLocalAppGrant !== 'function'
    || typeof value.desktopRevokeLocalAppGrant !== 'function') {
    throw grantError('runtime-service-untrusted', false, 'local_app_grant_pending_list');
  }
  return value as NimiElectronLocalAppGrantBinding;
}

function grantError(reasonCode: string, retryable: boolean, command: LocalAppGrantCommand): NimiElectronShellHostError {
  const code = reasonCode === 'protected-carrier-required'
    ? 'protected-carrier-required'
    : reasonCode === 'runtime-service-unavailable'
      ? 'runtime-service-unavailable'
      : reasonCode === 'runtime-service-repair-required'
        ? 'runtime-service-repair-required'
        : reasonCode === 'runtime-service-untrusted'
          ? 'runtime-service-untrusted'
          : 'runtime-permission-denied';
  return new NimiElectronShellHostError({
    code,
    message: reasonCode,
    reasonCode,
    actionHint: retryable ? 'retry_local_app_grant_operation' : 'refresh_local_app_grant_projection',
    source: reasonCode === 'protected-carrier-required' ? 'electron' : 'runtime',
    details: { command, retryable },
  });
}

function isBoundedReasonCode(value: string): boolean {
  return value.length > 0 && value.length <= 128 && /^[A-Za-z][A-Za-z0-9_-]*$/u.test(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
