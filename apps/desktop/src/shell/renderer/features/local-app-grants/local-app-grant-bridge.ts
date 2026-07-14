import {
  hasElectronInvoke,
  hasShellHostInvoke,
  hasTauriInvoke,
  listenTauri,
} from '@nimiplatform/kit/shell/renderer/bridge';
import { invokeChecked } from '@renderer/bridge/runtime-bridge/invoke';

const APPROVAL_EVENT = 'local-app-grant://approval-requested';

export type LocalAppGrantApproval = {
  readonly selector: string;
  readonly operationId: string;
  readonly resourceRef: string;
  readonly state: 'pending';
  readonly reasonCode: string;
  readonly retryable: boolean;
  readonly expiresAtUnixMs: number;
};

export type LocalAppGrantManagement = {
  readonly selector: string;
  readonly operationId: string;
  readonly resourceRef: string;
  readonly state: 'granted' | 'denied' | 'revoked';
  readonly reasonCode: string;
  readonly retryable: boolean;
};

export function localAppGrantBridgeAvailable(): boolean {
  return hasShellHostInvoke();
}

export async function listPendingLocalAppGrants(): Promise<LocalAppGrantApproval[]> {
  return invokeChecked('local_app_grant_pending_list', {}, (value) => array(value).map(parseApproval));
}

export async function subscribePendingLocalAppGrants(
  onApproval: (approval: LocalAppGrantApproval) => void,
): Promise<() => void> {
  if (hasTauriInvoke()) {
    return listenTauri(APPROVAL_EVENT, (event) => onApproval(parseApproval(event.payload)));
  }
  if (!hasElectronInvoke()) {
    throw new Error('local-app-grant-protected-carrier-required');
  }
  let disposed = false;
  let inFlight = false;
  const observed = new Set<string>();
  const poll = async () => {
    if (disposed || inFlight) return;
    inFlight = true;
    try {
      const approvals = await listPendingLocalAppGrants();
      for (const approval of approvals) {
        if (!observed.has(approval.selector)) {
          observed.add(approval.selector);
          onApproval(approval);
        }
      }
    } finally {
      inFlight = false;
    }
  };
  void poll().catch(() => undefined);
  const timer = globalThis.setInterval(() => void poll().catch(() => undefined), 750);
  return () => {
    disposed = true;
    globalThis.clearInterval(timer);
  };
}

export async function decideLocalAppGrant(
  selector: string,
  approved: boolean,
): Promise<LocalAppGrantManagement> {
  return invokeChecked(
    'local_app_grant_decide',
    { payload: { selector: requireSelector(selector, 'grant-approval'), approved } },
    parseManagement,
  );
}

export async function listLocalAppGrants(): Promise<LocalAppGrantManagement[]> {
  return invokeChecked('local_app_grant_list', {}, (value) => array(value).map(parseManagement));
}

export async function revokeLocalAppGrant(selector: string): Promise<LocalAppGrantManagement> {
  return invokeChecked(
    'local_app_grant_revoke',
    { payload: { selector: requireSelector(selector, 'grant-control') } },
    parseManagement,
  );
}

function parseApproval(value: unknown): LocalAppGrantApproval {
  const record = exact(value, [
    'expiresAtUnixMs', 'operationId', 'reasonCode', 'resourceRef', 'retryable', 'selector', 'state',
  ]);
  const expiresAtUnixMs = finiteInteger(record.expiresAtUnixMs, 'expiresAtUnixMs');
  if (record.state !== 'pending' || expiresAtUnixMs <= Date.now()) invalid();
  return {
    selector: requireSelector(record.selector, 'grant-approval'),
    operationId: text(record.operationId, 'operationId'),
    resourceRef: text(record.resourceRef, 'resourceRef'),
    state: 'pending',
    reasonCode: text(record.reasonCode, 'reasonCode'),
    retryable: boolean(record.retryable),
    expiresAtUnixMs,
  };
}

function parseManagement(value: unknown): LocalAppGrantManagement {
  const record = exact(value, [
    'operationId', 'reasonCode', 'resourceRef', 'retryable', 'selector', 'state',
  ]);
  if (!['granted', 'denied', 'revoked'].includes(String(record.state))) invalid();
  const prefix = record.state === 'granted' || record.state === 'revoked'
    ? 'grant-control'
    : 'grant-control';
  return {
    selector: requireSelector(record.selector, prefix),
    operationId: text(record.operationId, 'operationId'),
    resourceRef: text(record.resourceRef, 'resourceRef'),
    state: record.state as LocalAppGrantManagement['state'],
    reasonCode: text(record.reasonCode, 'reasonCode'),
    retryable: boolean(record.retryable),
  };
}

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join('|') !== [...keys].sort().join('|')) invalid();
  for (const forbidden of [
    'accountId', 'grantId', 'localAppPrincipalId', 'localAppRecordId', 'presenceChallengeId',
    'requestId', 'runtimeBootEpoch', 'sessionId', 'token', 'authorization', 'endpoint',
  ]) {
    if (forbidden in record) invalid();
  }
  return record;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) invalid();
  return value;
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0 || value.length > 512) {
    throw new Error(`local-app-grant-${field}-invalid`);
  }
  return value;
}

function requireSelector(value: unknown, prefix: string): string {
  const selector = text(value, 'selector');
  if (!selector.startsWith(`${prefix}-`) || selector.length > 160 || !/^[A-Za-z0-9_-]+$/u.test(selector)) {
    invalid();
  }
  return selector;
}

function finiteInteger(value: unknown, field: string): number {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0) throw new Error(`local-app-grant-${field}-invalid`);
  return numeric;
}

function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') invalid();
  return value;
}

function invalid(): never {
  throw new Error('local-app-grant-projection-invalid');
}
