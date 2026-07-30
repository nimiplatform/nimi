import {
  RESERVED_PERMISSION_IDS,
  type NimiLocalAppAgent,
  type PermissionID,
  type PermissionPosture,
  type PermissionStatus,
} from './permission-types.js';

export const NIMI_AGENT_CAPABILITY_GROUPS = [
  'interact',
  'configure',
  'memory',
  'voice',
  'delegate',
] as const;

export type NimiAgentCapabilityGroup = (typeof NIMI_AGENT_CAPABILITY_GROUPS)[number];
export type NimiAgentCapabilityPostureReason =
  | 'reserved_not_admitted'
  | 'unknown'
  | 'not_granted'
  | 'request_pending'
  | 'grant_denied'
  | 'grant_revoked'
  | null;

export interface NimiAgentCapabilityPostureEntry {
  readonly permissionId: PermissionID;
  readonly posture: PermissionPosture;
  readonly reason: NimiAgentCapabilityPostureReason;
  readonly agents: readonly NimiLocalAppAgent[];
}

export type NimiAgentCapabilityPosture = Readonly<
  Record<NimiAgentCapabilityGroup, NimiAgentCapabilityPostureEntry>
>;

export interface NimiPermissionStatusReader {
  status(permissionId: PermissionID): Promise<PermissionStatus>;
}

const PERMISSIONS: Readonly<Record<NimiAgentCapabilityGroup, PermissionID>> = Object.freeze({
  interact: 'agents.interact',
  configure: 'agents.configure',
  memory: 'memory.read',
  voice: 'agents.voice',
  delegate: 'agents.delegate',
});

export async function materializeNimiAgentCapabilityPosture(
  reader: NimiPermissionStatusReader,
): Promise<NimiAgentCapabilityPosture> {
  const entries = await Promise.all(NIMI_AGENT_CAPABILITY_GROUPS.map(async (group) => {
    const permissionId = PERMISSIONS[group];
    const status = await reader.status(permissionId);
    return [group, Object.freeze({
      permissionId,
      posture: status.posture,
      reason: postureReason(status),
      agents: status.agents,
    })] as const;
  }));
  return Object.freeze(Object.fromEntries(entries)) as NimiAgentCapabilityPosture;
}

function postureReason(status: PermissionStatus): NimiAgentCapabilityPostureReason {
  switch (status.posture) {
    case 'granted': return null;
    case 'pending': return 'request_pending';
    case 'denied': return 'grant_denied';
    case 'revoked': return 'grant_revoked';
    case 'prompt': return 'not_granted';
    case 'unavailable': {
      if (RESERVED_PERMISSION_IDS.includes(status.permissionId as never)) return 'reserved_not_admitted';
      const detail = String(status.detail || '').trim().replace(/-/gu, '_').toUpperCase();
      if (detail === 'LOCAL_APP_PERMISSION_UNKNOWN' || detail === '669') return 'unknown';
      return 'not_granted';
    }
  }
}
