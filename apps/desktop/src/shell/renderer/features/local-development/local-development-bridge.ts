import {
  hasElectronInvoke,
  hasShellHostInvoke,
  hasTauriInvoke,
  listenTauri,
} from '@nimiplatform/kit/shell/renderer/bridge';
import { invokeChecked } from '../../bridge/runtime-bridge/invoke';
import type {
  LocalDevelopmentApproval,
  LocalDevelopmentAuthorization,
  LocalDevelopmentDecision,
  LocalDevelopmentPermissionRequirement,
  LocalDevelopmentRun,
} from './local-development-types.js';

export type {
  LocalDevelopmentApproval,
  LocalDevelopmentAuthorization,
  LocalDevelopmentDecision,
  LocalDevelopmentPermissionRequirement,
  LocalDevelopmentRun,
} from './local-development-types.js';

const APPROVAL_EVENT = 'local-development://approval-requested';

export function localDevelopmentBridgeAvailable(): boolean {
  return hasShellHostInvoke();
}

export async function listPendingLocalDevelopmentApprovals(): Promise<LocalDevelopmentApproval[]> {
  return invokeChecked(
    'local_development_pending_approvals',
    {},
    (value) => requireArray(value).map(parseApproval),
  );
}

export async function decideLocalDevelopmentApproval(
  requestId: string,
  decision: LocalDevelopmentDecision,
  riskDisclosureAcknowledged: boolean,
): Promise<void> {
  await invokeChecked(
    'local_development_decide',
    { payload: { requestId, decision, riskDisclosureAcknowledged } },
    (value) => {
      const record = requireRecord(value);
      requireText(record.state, 'state');
      requireText(record.runId, 'runId');
    },
  );
}

export async function subscribeLocalDevelopmentApprovals(
  onApproval: (approval: LocalDevelopmentApproval) => void,
): Promise<() => void> {
  if (hasTauriInvoke()) {
    return listenTauri(APPROVAL_EVENT, (event) => {
      onApproval(parseApproval(event.payload));
    });
  }
  if (!hasElectronInvoke()) throw new Error('local-development-protected-carrier-required');
  let disposed = false;
  let inFlight = false;
  const observed = new Set<string>();
  const poll = async () => {
    if (disposed || inFlight) return;
    inFlight = true;
    try {
      for (const approval of await listPendingLocalDevelopmentApprovals()) {
        if (!observed.has(approval.requestId)) {
          observed.add(approval.requestId);
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

export async function listLocalDevelopmentAuthorizations(): Promise<LocalDevelopmentAuthorization[]> {
  return invokeChecked(
    'local_development_authorizations_list',
    {},
    (value) => requireArray(value).map(parseAuthorization),
  );
}

export async function listLocalDevelopmentRuns(): Promise<LocalDevelopmentRun[]> {
  return invokeChecked(
    'local_development_runs_list',
    {},
    (value) => requireArray(value).map(parseRun),
  );
}

export async function revokeLocalDevelopmentAuthorization(
  selector: string,
): Promise<LocalDevelopmentAuthorization> {
  return invokeChecked(
    'local_development_authorization_revoke',
    { payload: { selector } },
    parseAuthorization,
  );
}

function parseApproval(value: unknown): LocalDevelopmentApproval {
  const record = requireExactRecord(value, [
    'accountId',
    'appId',
    'approvalState',
    'canonicalProjectRoot',
    'displayName',
    'requestId',
    'permissionRequirements',
    'shell',
  ]);
  return {
    requestId: requireSelector(record.requestId, 'dev-approval'),
    appId: requireText(record.appId, 'appId'),
    displayName: requireText(record.displayName, 'displayName'),
    canonicalProjectRoot: requireText(record.canonicalProjectRoot, 'canonicalProjectRoot'),
    shell: requireShell(record.shell),
    accountId: requireText(record.accountId, 'accountId'),
    permissionRequirements: requirePermissionRequirements(record.permissionRequirements),
    approvalState: requireText(record.approvalState, 'approvalState'),
  };
}

function parseAuthorization(value: unknown): LocalDevelopmentAuthorization {
  const record = requireExactRecord(value, [
    'accountId',
    'appId',
    'canonicalProjectRoot',
    'displayName',
    'persistence',
    'permissionRequirements',
    'selector',
    'shell',
    'state',
    'updatedAtUnixMs',
  ]);
  const updatedAtUnixMs = Number(record.updatedAtUnixMs);
  if (!Number.isSafeInteger(updatedAtUnixMs) || updatedAtUnixMs <= 0) {
    throw new Error('Local development authorization has an invalid timestamp.');
  }
  return {
    selector: requireSelector(record.selector, 'dev-project'),
    appId: requireText(record.appId, 'appId'),
    displayName: requireText(record.displayName, 'displayName'),
    canonicalProjectRoot: requireText(record.canonicalProjectRoot, 'canonicalProjectRoot'),
    shell: requireShell(record.shell),
    accountId: requireText(record.accountId, 'accountId'),
    permissionRequirements: requirePermissionRequirements(record.permissionRequirements),
    persistence: requireText(record.persistence, 'persistence'),
    state: requireText(record.state, 'state'),
    updatedAtUnixMs,
  };
}

function parseRun(value: unknown): LocalDevelopmentRun {
  const loose = requireRecord(value);
  const keys = [
    'appId',
    'canonicalProjectRoot',
    'displayName',
    'hostGeneration',
    'message',
    ...(loose.reasonCode === undefined ? [] : ['reasonCode']),
    'retryable',
    'shell',
    'state',
  ];
  const record = requireExactRecord(value, keys);
  const hostGeneration = Number(record.hostGeneration);
  if (!Number.isSafeInteger(hostGeneration) || hostGeneration < 0 || typeof record.retryable !== 'boolean') {
    throw new Error('Local development run status is invalid.');
  }
  return {
    appId: requireText(record.appId, 'appId'),
    displayName: requireText(record.displayName, 'displayName'),
    canonicalProjectRoot: requireText(record.canonicalProjectRoot, 'canonicalProjectRoot'),
    shell: requireShell(record.shell),
    state: requireText(record.state, 'state'),
    message: requireText(record.message, 'message'),
    ...(record.reasonCode === undefined ? {} : { reasonCode: requireText(record.reasonCode, 'reasonCode') }),
    retryable: record.retryable,
    hostGeneration,
  };
}

function requireShell(value: unknown): 'electron' | 'tauri' {
  if (value !== 'electron' && value !== 'tauri') {
    throw new Error('Local development shell is invalid.');
  }
  return value;
}

function requirePermissionRequirements(value: unknown): LocalDevelopmentPermissionRequirement[] {
  if (!Array.isArray(value)) throw new Error('Local development permission requirements are invalid.');
  const requirements = value.map((entry) => {
    const record = requireExactRecord(entry, ['permissionId', 'reason']);
    const permissionId = requireText(record.permissionId, 'permissionId');
    const reason = requireText(record.reason, 'permission reason');
    if (new TextEncoder().encode(reason).byteLength > 240) {
      throw new Error('Local development permission reason is too long.');
    }
    return { permissionId, reason };
  });
  if (new Set(requirements.map(({ permissionId }) => permissionId)).size !== requirements.length) {
    throw new Error('Local development permission requirements are invalid.');
  }
  return requirements;
}

function requireSelector(value: unknown, prefix: string): string {
  const text = requireText(value, prefix);
  if (!text.startsWith(`${prefix}-`) || text.length > 160 || !/^[a-zA-Z0-9_-]+$/.test(text)) {
    throw new Error(`Local development ${prefix} selector is invalid.`);
  }
  return text;
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value || value.trim() !== value) {
    throw new Error(`Local development ${field} is invalid.`);
  }
  return value;
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Local development response is invalid.');
  }
  return value as Record<string, unknown>;
}

function requireExactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const record = requireRecord(value);
  if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify([...keys].sort())) {
    throw new Error('Local development response contains forbidden fields.');
  }
  return record;
}

function requireArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Local development response must be an array.');
  return value;
}
