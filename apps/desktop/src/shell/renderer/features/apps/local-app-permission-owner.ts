import type {
  NimiDesktopPermissionOwnerRuntimeClient,
  NimiRuntimeAccountCaller,
} from '@nimiplatform/sdk/runtime';
import { LocalAppPermissionOwnerPosture } from '@nimiplatform/sdk/runtime/generated';
import { createNimiError, ReasonCode } from '@nimiplatform/sdk/types';

const AGENTS_INTERACT_PERMISSION = 'agents.interact';

export type DesktopLocalAppPermissionPosture =
  | 'prompt'
  | 'pending'
  | 'granted'
  | 'denied'
  | 'unavailable';

export type DesktopLocalAppPermissionRequest = {
  readonly requestKey: string;
  readonly displayAppId: string;
  readonly reason: string;
  readonly ownerRevision: string;
};

export type DesktopLocalAppPermissionCoveredAgent = {
  readonly agentKey: string;
  readonly displayName: string;
};

export type DesktopLocalAppPermissionProjection = {
  readonly requestKey: string;
  readonly displayAppId: string;
  readonly posture: DesktopLocalAppPermissionPosture;
  readonly coveredAgents: readonly DesktopLocalAppPermissionCoveredAgent[];
  readonly ownerRevision: string;
};

export type DesktopLocalAppPermissionOwnerPort = {
  listPending(): Promise<readonly DesktopLocalAppPermissionRequest[]>;
  subscribePending(input: {
    readonly onRequests: (requests: readonly DesktopLocalAppPermissionRequest[]) => void;
    readonly onError: (error: unknown) => void;
  }): Promise<() => void>;
  approve(input: {
    readonly requestKey: string;
    readonly expectedOwnerRevision: string;
  }): Promise<DesktopLocalAppPermissionProjection>;
  deny(input: {
    readonly requestKey: string;
    readonly expectedOwnerRevision: string;
  }): Promise<DesktopLocalAppPermissionProjection>;
  revoke(input: {
    readonly requestKey: string;
  }): Promise<DesktopLocalAppPermissionProjection>;
  getProjection(requestKey: string): Promise<DesktopLocalAppPermissionProjection>;
  listProjections(): Promise<readonly DesktopLocalAppPermissionProjection[]>;
};

type OwnerDependencies = {
  readonly runtime: () => Omit<NimiDesktopPermissionOwnerRuntimeClient, 'subscribeLocalAppPermissionRequests'>;
  readonly caller: () => NimiRuntimeAccountCaller;
};

export function createDesktopLocalAppPermissionOwnerPort(
  dependencies: OwnerDependencies,
): DesktopLocalAppPermissionOwnerPort {
  const caller = () => dependencies.caller();

  async function getProjection(requestKey: string): Promise<DesktopLocalAppPermissionProjection> {
    const response = await dependencies.runtime().getLocalAppPermissionOwnerProjection({
      caller: caller(),
      localAppPrincipalId: requireKey(requestKey, 'requestKey'),
    });
    assertAccepted(response.accepted, response.reasonCode);
    const permission = response.permissions.find((row) => row.permissionId === AGENTS_INTERACT_PERMISSION);
    if (!permission) {
      return Object.freeze({
        requestKey,
        displayAppId: '',
        posture: 'prompt' as const,
        coveredAgents: [],
        ownerRevision: '0',
      });
    }
    return projectOwnerPermission(permission);
  }

  async function decide(input: {
    readonly requestKey: string;
    readonly expectedOwnerRevision: string;
    readonly approved: boolean;
  }): Promise<DesktopLocalAppPermissionProjection> {
    const response = await dependencies.runtime().decideLocalAppPermission({
      caller: caller(),
      localAppPrincipalId: requireKey(input.requestKey, 'requestKey'),
      permissionId: AGENTS_INTERACT_PERMISSION,
      approved: input.approved,
      expectedOwnerRevision: requireRevision(input.expectedOwnerRevision),
    });
    assertAccepted(response.accepted, response.reasonCode);
    return getProjection(input.requestKey);
  }

  return Object.freeze({
    async listPending() {
      const response = await dependencies.runtime().listLocalAppPermissionRequests({ caller: caller() });
      assertAccepted(response.accepted, response.reasonCode);
      return projectPending(response.requests);
    },
    async subscribePending({ onRequests, onError }) {
      let cancelled = false;
      let polling = false;
      const poll = async () => {
        if (cancelled || polling) return;
        polling = true;
        try {
          const response = await dependencies.runtime().listLocalAppPermissionRequests({ caller: caller() });
          assertAccepted(response.accepted, response.reasonCode);
          if (!cancelled) onRequests(projectPending(response.requests));
        } catch (error) {
          if (!cancelled) onError(error);
        } finally {
          polling = false;
        }
      };
      await poll();
      const interval = window.setInterval(() => { void poll(); }, 2_000);
      return () => {
        cancelled = true;
        window.clearInterval(interval);
      };
    },
    approve: (input) => decide({ ...input, approved: true }),
    deny: (input) => decide({ ...input, approved: false }),
    async revoke(input) {
      const response = await dependencies.runtime().revokeLocalAppPermission({
        caller: caller(),
        localAppPrincipalId: requireKey(input.requestKey, 'requestKey'),
        permissionId: AGENTS_INTERACT_PERMISSION,
      });
      assertAccepted(response.accepted, response.reasonCode);
      return getProjection(input.requestKey);
    },
    getProjection,
    async listProjections() {
      const response = await dependencies.runtime().listLocalAppPermissionOwnerProjections({ caller: caller() });
      assertAccepted(response.accepted, response.reasonCode);
      return response.permissions
        .filter((permission) => permission.permissionId === AGENTS_INTERACT_PERMISSION)
        .map(projectOwnerPermission);
    },
  });
}

function projectOwnerPermission(
  permission: import('@nimiplatform/sdk/runtime/generated').LocalAppPermissionOwnerProjection,
): DesktopLocalAppPermissionProjection {
  requireProjectionShape(permission);
  const posture = ownerPosture(permission.posture);
  const coveredAgents = projectCoveredAgents(permission.coveredAgents, permission.posture);
  return Object.freeze({
    requestKey: requireKey(permission.localAppPrincipalId, 'requestKey'),
    displayAppId: permission.displayAppId,
    posture,
    coveredAgents,
    ownerRevision: permission.ownerRevision,
  });
}

function projectCoveredAgents(
  agents: readonly import('@nimiplatform/sdk/runtime/generated').LocalAppPermissionCoveredAgent[],
  posture: LocalAppPermissionOwnerPosture,
): readonly DesktopLocalAppPermissionCoveredAgent[] {
  if (!Array.isArray(agents)) {
    throw new Error('Desktop permission covered Agents are invalid');
  }
  if (posture !== LocalAppPermissionOwnerPosture.GRANTED && agents.length > 0) {
    throw new Error('Desktop permission covered Agents do not match owner posture');
  }
  const seenAgentKeys = new Set<string>();
  return agents.map((agent) => {
    requireExactFields(agent, ['localAgentId', 'displayName'], 'covered Agent');
    const agentKey = requireCanonicalText(agent.localAgentId, 'covered Agent handle');
    const displayName = requireCanonicalText(agent.displayName, 'covered Agent displayName');
    if (seenAgentKeys.has(agentKey)) {
      throw new Error('Desktop permission covered Agent handle is duplicated');
    }
    seenAgentKeys.add(agentKey);
    return Object.freeze({ agentKey, displayName });
  });
}

function requireProjectionShape(value: unknown): void {
  const requiredFields = [
    'localAppPrincipalId',
    'displayAppId',
    'permissionId',
    'posture',
    'ownerRevision',
    'coveredAgents',
  ] as const;
  const optionalFields = ['requestedAt', 'decidedAt'] as const;
  const record = requireRecord(value, 'owner projection');
  const fields = Object.keys(record);
  if (
    requiredFields.some((field) => !Object.hasOwn(record, field))
    || fields.some((field) => (
      !requiredFields.includes(field as typeof requiredFields[number])
      && !optionalFields.includes(field as typeof optionalFields[number])
    ))
  ) {
    throw new Error('Desktop permission owner projection contains forbidden fields');
  }
}

function requireExactFields(value: unknown, fields: readonly string[], label: string): void {
  const record = requireRecord(value, label);
  const actual = Object.keys(record).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    throw new Error(`Desktop permission ${label} contains forbidden fields`);
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Desktop permission ${label} is invalid`);
  }
  return value as Record<string, unknown>;
}

function requireCanonicalText(value: unknown, field: string): string {
  if (typeof value !== 'string'
    || value.trim() !== value
    || new TextEncoder().encode(value).byteLength === 0
    || new TextEncoder().encode(value).byteLength > 240) {
    throw new Error(`Desktop permission ${field} is invalid`);
  }
  return value;
}

function projectPending(
  requests: readonly import('@nimiplatform/sdk/runtime/generated').LocalAppPermissionPendingRequest[],
): readonly DesktopLocalAppPermissionRequest[] {
  return requests
    .filter((request) => request.permissionId === AGENTS_INTERACT_PERMISSION)
    .map((request) => Object.freeze({
      requestKey: request.localAppPrincipalId,
      displayAppId: request.displayAppId,
      reason: request.reason,
      ownerRevision: request.ownerRevision,
    }));
}

function ownerPosture(posture: LocalAppPermissionOwnerPosture): DesktopLocalAppPermissionPosture {
  switch (posture) {
    case LocalAppPermissionOwnerPosture.PENDING: return 'pending';
    case LocalAppPermissionOwnerPosture.GRANTED: return 'granted';
    case LocalAppPermissionOwnerPosture.DENIED:
    case LocalAppPermissionOwnerPosture.EXPIRED:
    case LocalAppPermissionOwnerPosture.REVOKED: return 'denied';
    default: return 'unavailable';
  }
}

function assertAccepted(accepted: boolean, runtimeReasonCode: number): void {
  if (accepted && runtimeReasonCode === 1) return;
  throw createNimiError({
    message: import.meta.env?.DEV
      ? `Desktop permission management is unavailable (runtime reasonCode: ${runtimeReasonCode}).`
      : 'Desktop permission management is unavailable.',
    reasonCode: ReasonCode.RUNTIME_GRPC_PERMISSION_DENIED,
    actionHint: 'refresh_desktop_permission_management',
    source: 'runtime',
    details: { runtimeReasonCode },
  });
}

function requireKey(value: unknown, field: string): string {
  const text = String(value || '').trim();
  if (!text || text.length > 512 || text.includes('\0')) {
    throw new Error(`Desktop permission ${field} is invalid`);
  }
  return text;
}

function requireRevision(value: string): string {
  if (!/^(0|[1-9][0-9]*)$/u.test(value)) {
    throw new Error('Desktop permission owner revision is invalid');
  }
  return value;
}
