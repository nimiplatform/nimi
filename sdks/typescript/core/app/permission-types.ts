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

// agents.interact is the first complete public permission slice. Runtime's
// publication row remains the final fail-closed gate during staged rollout.
export const ADMITTED_PERMISSION_IDS: readonly PermissionID[] = ['agents.interact'];

export const PERMISSION_POSTURES = [
  'prompt',
  'pending',
  'granted',
  'denied',
  'unavailable',
] as const;

export type PermissionPosture = (typeof PERMISSION_POSTURES)[number];

declare const localAppAgentHandleBrand: unique symbol;

/** Opaque Runtime-materialized handle for one Agent covered by an account grant. */
export type NimiLocalAppAgentHandle = string & {
  readonly [localAppAgentHandleBrand]: 'runtime-materialized-local-app-agent-handle';
};

/** Bounded display metadata for one Agent currently covered by the account grant. */
export interface NimiLocalAppAgent {
  readonly agentHandle: NimiLocalAppAgentHandle;
  readonly displayName: string;
}

export interface PermissionRequestInput {
  readonly permissionId: PermissionID;
  readonly reason: string;
}

export interface PermissionStatus {
  readonly permissionId: PermissionID;
  readonly posture: PermissionPosture;
  readonly canRequest: boolean;
  readonly agents: readonly NimiLocalAppAgent[];
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
