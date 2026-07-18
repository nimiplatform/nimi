// Application scope remains an SDK composition concept for app-owned config
// and catalog helpers. It is not a permission selector or authority claim.
export type NimiAppScopeKind = 'app';

export interface NimiAppScopeRef {
  readonly kind: NimiAppScopeKind;
  readonly ownerId: string;
  readonly surfaceId?: string;
}

export const KNOWN_PERMISSION_IDS = [
  'agents.interact',
  'artifacts.open',
  'account.profile.read',
  'memory.read',
  'memory.write',
  'knowledge.read',
  'knowledge.write',
  'notifications.send',
  'notifications.receive',
  'files.open',
  'files.save',
  'realm.library.read',
  'realm.library.manage',
  'realm.publish',
  'ai.background',
  'shared_resources.open',
] as const;

export type PermissionID = (typeof KNOWN_PERMISSION_IDS)[number];

// The positive request set is intentionally empty until one complete
// catalog+selector+owner+SDK+Kit+Desktop+audit+revoke slice is admitted.
export const ADMITTED_PERMISSION_IDS: readonly PermissionID[] = [];

export const PERMISSION_POSTURES = [
  'prompt',
  'pending',
  'granted',
  'denied',
  'unavailable',
] as const;

export type PermissionPosture = (typeof PERMISSION_POSTURES)[number];

export interface PermissionRequestInput {
  readonly permissionId: PermissionID;
  readonly reason: string;
}

export interface PermissionStatus {
  readonly permissionId: PermissionID;
  readonly posture: PermissionPosture;
  readonly canRequest: boolean;
  readonly detail?: string;
}

export interface PermissionPostureEvent {
  readonly status: PermissionStatus;
  readonly eventId?: string;
}

export interface PermissionTransport {
  status(permissionId: PermissionID): Promise<PermissionStatus>;
  request(input: PermissionRequestInput): Promise<PermissionStatus>;
  subscribe(permissionId: PermissionID, callback: (event: PermissionPostureEvent) => void): () => void;
}

export function isKnownPermissionID(value: unknown): value is PermissionID {
  return typeof value === 'string' && KNOWN_PERMISSION_IDS.includes(value as PermissionID);
}

export function isAdmittedPermissionID(value: unknown): value is PermissionID {
  return isKnownPermissionID(value) && ADMITTED_PERMISSION_IDS.includes(value);
}

export function isPermissionPosture(value: unknown): value is PermissionPosture {
  return typeof value === 'string' && PERMISSION_POSTURES.includes(value as PermissionPosture);
}
