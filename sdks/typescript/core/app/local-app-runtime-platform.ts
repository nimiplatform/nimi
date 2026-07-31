import type { JsonValue } from '../../types';
import type { RealmModel } from '../../realm/generated.js';
import {
  materializeNimiAgentCapabilityPosture,
  type NimiAgentCapabilityPosture,
} from './agent-capability-posture.js';
import {
  createNimiLocalAppAgentConfigureClient,
  type NimiLocalAppAgentConfigureClient,
  type NimiLocalAppAgentConfigureShell,
} from './local-app-runtime-platform-configure.js';
import {
  createNimiLocalAppConversationClient,
  type NimiLocalAppConversationOpenInput,
  type NimiLocalAppConversationOpenResult,
  type NimiLocalAppConversationInterruptResult,
  type NimiLocalAppConversationScopeInput,
  type NimiLocalAppConversationSendInput,
  type NimiLocalAppConversationSendResult,
  type NimiLocalAppConversationShell,
  type NimiLocalAppConversationSnapshot,
  type NimiLocalAppConversationSubscription,
} from './local-app-runtime-platform-conversation.js';
import {
  createNimiAppRuntimeStorageClient,
  type NimiAppRuntimeStorageDocument,
  type NimiAppRuntimeStorageRemoveResult,
} from './local-app-runtime-platform-protected-operations';
import {
  asRecord,
  assertExactKeys,
  assertExactMethodNamespace,
  assertExactProjectionKeys,
  assertSafeProjection,
  localAppError,
  localAppProjectionError,
  normalizeFieldName,
  projectionText,
  requireText,
} from './local-app-runtime-platform-validation';
import {
  isAdmittedPermissionID,
  isKnownPermissionID,
  isPermissionPosture,
  isReservedPermissionID,
  type AdmittedPermissionRequestInput,
  type NimiLocalAppAgent,
  type NimiLocalAppAgentHandle,
  type PermissionID,
  type PermissionPostureEvent,
  type PermissionRequestInput,
  type PermissionStatus,
} from './permission-types.js';

export type {
  NimiLocalAppConversationEvent,
  NimiLocalAppConversationOpenInput,
  NimiLocalAppConversationOpenResult,
  NimiLocalAppConversationInterruptResult,
  NimiLocalAppConversationScopeInput,
  NimiLocalAppConversationSendInput,
  NimiLocalAppConversationSendResult,
  NimiLocalAppConversationShellSubscription,
  NimiLocalAppConversationSnapshot,
  NimiLocalAppConversationSubscription,
  NimiLocalAppAgentHandle,
} from './local-app-runtime-platform-conversation.js';
export type { NimiLocalAppAgent } from './permission-types.js';
export type {
  NimiAppRuntimeStorageDocument,
  NimiAppRuntimeStorageRemoveResult,
} from './local-app-runtime-platform-protected-operations';

export type NimiAppAuthMode = 'local-first-party-app' | 'local-app';

export type NimiAppLocalSessionState =
  | 'session-bound'
  | 'action-required'
  | 'revoked'
  | 'project-changed'
  | 'process-replaced'
  | 'account-changed'
  | 'runtime-restarted';

export type NimiAppLocalSessionProjection = {
  readonly mode: NimiAppAuthMode;
  readonly state: NimiAppLocalSessionState;
  readonly sessionBound: boolean;
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly retryable: boolean;
};

export type NimiAppAuthUnavailable = {
  readonly mode: NimiAppAuthMode;
  readonly state: 'unavailable';
  readonly sessionBound: false;
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly retryable: boolean;
};

export type NimiAppAuthProjection = NimiAppLocalSessionProjection | NimiAppAuthUnavailable;

export type NimiAppPermissionStatusInput = PermissionID;
export type NimiAppPermissionRequestInput = PermissionRequestInput;
export type NimiAppPermissionStatus = PermissionStatus;

export type NimiLocalAppWorldCoreListInput = {
  readonly take?: number;
  readonly visibility?: 'private' | 'unlisted' | 'public' | 'system';
};

/**
 * Host-neutral structural contract implemented directly by Kit's local-app
 * shell surface. It exposes session status, product permission status, and
 * app-private JSON storage. It is not a generic Runtime forwarding client.
 */
export type NimiLocalAppStandardShell = {
  readonly session: {
    readonly status: () => Promise<unknown>;
  };
  readonly permission: {
    readonly status: (input: { readonly permissionId: PermissionID }) => Promise<unknown>;
    readonly request: (input: AdmittedPermissionRequestInput) => Promise<unknown>;
  };
  readonly storage: {
    readonly readJson: (relativePath: string) => Promise<unknown>;
    readonly writeJson: (relativePath: string, value: JsonValue) => Promise<unknown>;
    readonly removeJson: (relativePath: string) => Promise<unknown>;
  };
  readonly realm: {
    readonly worldCore: {
      readonly list: (input?: NimiLocalAppWorldCoreListInput) => Promise<unknown>;
      readonly create: (input: unknown) => Promise<unknown>;
    };
  };
  readonly conversation: NimiLocalAppConversationShell;
  readonly agentConfigure: NimiLocalAppAgentConfigureShell;
};

export type NimiLocalAppClientInput = {
  readonly standardShell: NimiLocalAppStandardShell;
};

export type NimiLocalAppClient = {
  readonly auth: {
    readonly status: () => Promise<NimiAppAuthProjection>;
  };
  readonly permissions: {
    readonly status: (permissionId: NimiAppPermissionStatusInput) => Promise<NimiAppPermissionStatus>;
    readonly request: (input: NimiAppPermissionRequestInput) => Promise<NimiAppPermissionStatus>;
    readonly subscribe: (
      permissionId: NimiAppPermissionStatusInput,
      callback: (event: PermissionPostureEvent) => void,
      onError?: (error: unknown) => void,
    ) => () => void;
    readonly agentCapabilityPosture: () => Promise<NimiAgentCapabilityPosture>;
    readonly subscribeAgentCapabilityPosture: (
      callback: (posture: NimiAgentCapabilityPosture) => void,
      onError?: (error: unknown) => void,
    ) => () => void;
  };
  readonly storage: {
    readonly readJson: (relativePath: string) => Promise<NimiAppRuntimeStorageDocument>;
    readonly writeJson: (
      relativePath: string,
      value: JsonValue,
    ) => Promise<NimiAppRuntimeStorageDocument>;
    readonly removeJson: (relativePath: string) => Promise<NimiAppRuntimeStorageRemoveResult>;
  };
  readonly realm: {
    readonly worldCore: {
      readonly list: (
        input?: NimiLocalAppWorldCoreListInput,
      ) => Promise<readonly RealmModel<'WorldCoreDto'>[]>;
      readonly create: (
        input: RealmModel<'CreateWorldCoreDto'>,
      ) => Promise<RealmModel<'WorldCoreDto'>>;
    };
  };
  readonly agentConfigure: NimiLocalAppAgentConfigureClient;
  readonly conversation: {
    readonly open: (input: NimiLocalAppConversationOpenInput) => Promise<NimiLocalAppConversationOpenResult>;
    readonly send: (input: NimiLocalAppConversationSendInput) => Promise<NimiLocalAppConversationSendResult>;
    readonly interruptTurn: (input: NimiLocalAppConversationScopeInput) => Promise<NimiLocalAppConversationInterruptResult>;
    readonly subscribe: (input: NimiLocalAppConversationScopeInput) => Promise<NimiLocalAppConversationSubscription>;
    readonly snapshot: (input: NimiLocalAppConversationScopeInput) => Promise<NimiLocalAppConversationSnapshot>;
  };
};

export function createNimiLocalAppClient(
  input: NimiLocalAppClientInput,
): NimiLocalAppClient {
  assertExactKeys(input, ['standardShell'], 'SDK local-app client input');
  const standardShell = input.standardShell;
  assertExactKeys(standardShell, ['session', 'permission', 'storage', 'realm', 'conversation', 'agentConfigure'], 'local-app standardShell');
  if (Object.keys(standardShell).length !== 6) {
    return localAppError(
      'Host-injected local-app standardShell namespaces are incomplete.',
      'SDK_LOCAL_APP_CARRIER_REQUIRED',
      'use_host_injected_standard_shell',
    );
  }
  assertExactMethodNamespace(standardShell.session, ['status'], 'session');
  assertExactMethodNamespace(standardShell.permission, ['status', 'request'], 'permission');
  assertExactMethodNamespace(standardShell.storage, ['readJson', 'writeJson', 'removeJson'], 'storage');
  const realm = asRecord(standardShell.realm);
  if (!realm || Object.keys(realm).length !== 1 || !Object.hasOwn(realm, 'worldCore')) {
    return localAppError(
      'Host-injected local-app standardShell realm namespace is invalid.',
      'SDK_LOCAL_APP_CARRIER_REQUIRED',
      'use_host_injected_standard_shell',
    );
  }
  assertExactMethodNamespace(realm.worldCore, ['list', 'create'], 'realm.worldCore');
  assertExactMethodNamespace(standardShell.conversation, ['open', 'send', 'interruptTurn', 'subscribe', 'snapshot'], 'conversation');

  const permissionStatus = async (permissionId: NimiAppPermissionStatusInput): Promise<NimiAppPermissionStatus> => {
    const normalized = requireKnownPermissionID(permissionId);
    return projectPermissionStatus(
      await standardShell.permission.status({ permissionId: normalized }),
      normalized,
    );
  };

  const agentCapabilityPosture = () => materializeNimiAgentCapabilityPosture({ status: permissionStatus });

  return Object.freeze({
    auth: Object.freeze({
      status: async () => projectAuth(await standardShell.session.status()),
    }),
    permissions: Object.freeze({
      status: permissionStatus,
      request: async (requestInput: NimiAppPermissionRequestInput) => {
        assertExactKeys(requestInput, ['permissionId', 'reason'], 'local-app permission request input');
        const permissionId = requireKnownPermissionID(requestInput.permissionId);
        if (isReservedPermissionID(permissionId)) {
          return localAppError(
            `Permission "${permissionId}" is reserved and cannot be requested.`,
            'SDK_PERMISSION_NOT_ADMITTED',
            'wait_for_permission_admission',
          );
        }
        if (!isAdmittedPermissionID(permissionId)) {
          return localAppError(
            `Permission "${permissionId}" is not admitted and cannot be requested.`,
            'SDK_PERMISSION_NOT_ADMITTED',
            'wait_for_permission_admission',
          );
        }
        const reason = requirePermissionReason(requestInput.reason);
        const requestId = createPermissionRequestID();
        return projectPermissionStatus(
          await standardShell.permission.request({ permissionId, reason, requestId }),
          permissionId,
        );
      },
      subscribe: (
        permissionId: NimiAppPermissionStatusInput,
        callback: (event: PermissionPostureEvent) => void,
        onError?: (error: unknown) => void,
      ) => subscribePermissionStatus(
        () => permissionStatus(requireKnownPermissionID(permissionId)),
        callback,
        onError,
      ),
      agentCapabilityPosture,
      subscribeAgentCapabilityPosture: (
        callback: (posture: NimiAgentCapabilityPosture) => void,
        onError?: (error: unknown) => void,
      ) => subscribeAgentPosture(
        agentCapabilityPosture,
        callback,
        onError,
      ),
    }),
    storage: createNimiAppRuntimeStorageClient(standardShell.storage),
    realm: Object.freeze({
      worldCore: createWorldCoreClient(standardShell.realm.worldCore),
    }),
    agentConfigure: createNimiLocalAppAgentConfigureClient(standardShell.agentConfigure),
    conversation: createNimiLocalAppConversationClient(standardShell.conversation),
  });
}

function createWorldCoreClient(
  shell: NimiLocalAppStandardShell['realm']['worldCore'],
): NimiLocalAppClient['realm']['worldCore'] {
  return Object.freeze({
    list: async (
      input: NimiLocalAppWorldCoreListInput = {},
    ): Promise<readonly RealmModel<'WorldCoreDto'>[]> => {
      assertExactKeys(input, ['take', 'visibility'], 'WorldCore list input');
      const normalized: NimiLocalAppWorldCoreListInput = {
        ...(input.take === undefined ? {} : { take: requireWorldCoreTake(input.take) }),
        ...(input.visibility === undefined ? {} : { visibility: requireWorldVisibility(input.visibility) }),
      };
      const value = await shell.list(normalized);
      if (!Array.isArray(value)) localAppProjectionError('WorldCore list');
      return Object.freeze(value.map((entry) => projectWorldCore(entry)));
    },
    create: async (
      input: RealmModel<'CreateWorldCoreDto'>,
    ): Promise<RealmModel<'WorldCoreDto'>> => {
      const record = asRecord(input);
      assertExactKeys(record, ['core', 'id', 'origin', 'visibility'], 'WorldCore create input');
      if (!record || !Object.hasOwn(record, 'core') || !Object.hasOwn(record, 'origin')) {
        return localAppError(
          'WorldCore create input requires core and origin.',
          'SDK_LOCAL_APP_INPUT_INVALID',
          'provide_world_core_create_fields',
        );
      }
      const core = asRecord(record.core);
      const origin = asRecord(record.origin);
      if (!core || !origin) {
        return localAppError(
          'WorldCore create core and origin must be objects.',
          'SDK_LOCAL_APP_INPUT_INVALID',
          'provide_world_core_create_fields',
        );
      }
      assertExactKeys(
        origin,
        ['kind', 'parentCharacterId', 'parentWorldId', 'sourceContentHash', 'sourceId', 'sourceVersion'],
        'WorldCore origin',
      );
      if (!Object.hasOwn(origin, 'kind')
        || !['manual', 'forge', 'worldCharacterDerivation', 'import', 'system'].includes(String(origin.kind))) {
        return localAppError(
          'WorldCore origin kind is invalid.',
          'SDK_LOCAL_APP_INPUT_INVALID',
          'provide_world_core_origin',
        );
      }
      if (record.id !== undefined) requireText(record.id, 'world_core_id');
      if (record.visibility !== undefined) requireWorldVisibility(record.visibility);
      for (const key of ['parentCharacterId', 'parentWorldId', 'sourceContentHash', 'sourceId', 'sourceVersion']) {
        if (origin[key] !== undefined) requireText(origin[key], `world_core_origin_${key}`);
      }
      assertWorldCoreInputJson(record);
      return projectWorldCore(await shell.create(input));
    },
  });
}

function projectWorldCore(value: unknown): RealmModel<'WorldCoreDto'> {
  const record = asRecord(value);
  if (!record) localAppProjectionError('WorldCore');
  assertSafeProjection(record);
  return Object.freeze({ ...record }) as unknown as RealmModel<'WorldCoreDto'>;
}

function requireWorldCoreTake(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return localAppError(
      'WorldCore list take is invalid.',
      'SDK_LOCAL_APP_INPUT_INVALID',
      'provide_world_core_take',
    );
  }
  return value;
}

function requireWorldVisibility(
  value: unknown,
): 'private' | 'unlisted' | 'public' | 'system' {
  if (value !== 'private' && value !== 'unlisted' && value !== 'public' && value !== 'system') {
    return localAppError(
      'WorldCore visibility is invalid.',
      'SDK_LOCAL_APP_INPUT_INVALID',
      'provide_world_core_visibility',
    );
  }
  return value;
}

function assertWorldCoreInputJson(
  value: unknown,
  depth = 0,
  state = { nodes: 0, ancestors: new Set<object>() },
): void {
  state.nodes += 1;
  if (depth > 32 || state.nodes > 100_000) {
    return localAppError(
      'WorldCore create input exceeds structural bounds.',
      'SDK_LOCAL_APP_INPUT_INVALID',
      'reduce_world_core_input',
    );
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (!value || typeof value !== 'object' || state.ancestors.has(value)) {
    return localAppError(
      'WorldCore create input is not JSON-compatible.',
      'SDK_LOCAL_APP_INPUT_INVALID',
      'provide_json_world_core_input',
    );
  }
  state.ancestors.add(value);
  if (Array.isArray(value)) {
    for (const entry of value) assertWorldCoreInputJson(entry, depth + 1, state);
  } else {
    const record = asRecord(value);
    if (!record) {
      return localAppError(
        'WorldCore create input is not a plain JSON object.',
        'SDK_LOCAL_APP_INPUT_INVALID',
        'provide_json_world_core_input',
      );
    }
    for (const entry of Object.values(record)) assertWorldCoreInputJson(entry, depth + 1, state);
  }
  state.ancestors.delete(value);
}

const PERMISSION_POSTURE_OBSERVE_INTERVAL_MS = 1_000;

function subscribePermissionStatus(
  load: () => Promise<PermissionStatus>,
  callback: (event: PermissionPostureEvent) => void,
  onError?: (error: unknown) => void,
): () => void {
  if (typeof callback !== 'function') {
    return localAppError(
      'Local-app permission subscription callback is required.',
      'SDK_PERMISSION_CALLBACK_INVALID',
      'provide_permission_callback',
    );
  }
  return subscribeProjection(
    load,
    (status) => callback(Object.freeze({ status })),
    onError,
  );
}

function subscribeAgentPosture(
  load: () => Promise<NimiAgentCapabilityPosture>,
  callback: (posture: NimiAgentCapabilityPosture) => void,
  onError?: (error: unknown) => void,
): () => void {
  if (typeof callback !== 'function') {
    return localAppError(
      'Local-app Agent capability posture subscription callback is required.',
      'SDK_PERMISSION_CALLBACK_INVALID',
      'provide_permission_callback',
    );
  }
  return subscribeProjection(load, callback, onError);
}

function subscribeProjection<T>(
  load: () => Promise<T>,
  callback: (projection: T) => void,
  onError?: (error: unknown) => void,
): () => void {
  let active = true;
  let inFlight = false;
  let previous = '';
  const observe = async () => {
    if (!active || inFlight) return;
    inFlight = true;
    try {
      const projection = await load();
      const signature = JSON.stringify(projection);
      if (active && signature !== previous) {
        previous = signature;
        callback(projection);
      }
    } catch (error) {
      if (active) onError?.(error);
    } finally {
      inFlight = false;
    }
  };
  void observe();
  const interval = setInterval(() => { void observe(); }, PERMISSION_POSTURE_OBSERVE_INTERVAL_MS);
  return () => {
    active = false;
    clearInterval(interval);
  };
}

function projectAuth(value: unknown): NimiAppAuthProjection {
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['state', 'reasonCode', 'retryable'], 'auth');
  const rawState = projectionText(record.state, 'state');
  const reasonCode = projectionText(record.reasonCode, 'reasonCode');
  if (typeof record.retryable !== 'boolean') localAppProjectionError('auth retryable');
  const state = localAppSessionState(rawState, reasonCode);
  const actionHint = localAppSessionActionHint(state);
  if (state === 'unavailable') {
    return {
      mode: 'local-app',
      state,
      sessionBound: false,
      reasonCode,
      actionHint,
      retryable: record.retryable,
    };
  }
  return {
    mode: 'local-app',
    state,
    sessionBound: state === 'session-bound',
    reasonCode,
    actionHint,
    retryable: record.retryable,
  };
}

function projectPermissionStatus(
  value: unknown,
  requestedPermissionId: PermissionID,
): NimiAppPermissionStatus {
  const record = asRecord(value);
  assertExactProjectionKeys(
    record,
    ['state', 'permissionId', 'canRequest', 'reasonCode', 'agents'],
    'permission',
  );
  const state = String(record.state || '');
  if (!isPermissionPosture(state)) localAppProjectionError('permission state');
  const permissionId = projectionText(record.permissionId, 'permissionId');
  if (permissionId !== requestedPermissionId || !isKnownPermissionID(permissionId)) {
    localAppProjectionError('permission id binding');
  }
  if (typeof record.canRequest !== 'boolean' || !Array.isArray(record.agents)) {
    localAppProjectionError('permission request posture');
  }
  if (isReservedPermissionID(permissionId) && (state !== 'unavailable' || record.canRequest)) {
    localAppProjectionError('reserved permission posture');
  }
  const seenAgentHandles = new Set<string>();
  const agents = record.agents.map((value): NimiLocalAppAgent => {
    const agent = asRecord(value);
    assertExactProjectionKeys(agent, ['agentHandle', 'displayName', 'avatarUrl'], 'local-app Agent');
    const agentHandle = projectionText(agent.agentHandle, 'agentHandle') as NimiLocalAppAgentHandle;
    const displayName = projectionText(agent.displayName, 'displayName');
    const avatarUrl = projectStableAvatarUrl(agent.avatarUrl);
    if (new TextEncoder().encode(agentHandle).length > 240
      || new TextEncoder().encode(displayName).length > 240
      || seenAgentHandles.has(agentHandle)) {
      localAppProjectionError('permission Agent projection');
    }
    seenAgentHandles.add(agentHandle);
    return Object.freeze({ agentHandle, displayName, avatarUrl });
  });
  if (record.canRequest !== (state === 'prompt')
    || (state !== 'granted' && agents.length > 0)) {
    localAppProjectionError('permission Agents');
  }
  return {
    permissionId,
    posture: state,
    canRequest: record.canRequest,
    agents: Object.freeze(agents),
    detail: projectionText(record.reasonCode, 'reasonCode'),
  };
}

function projectStableAvatarUrl(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string'
    || !value
    || value.trim() !== value
    || new TextEncoder().encode(value).byteLength > 4096) {
    return localAppProjectionError('permission Agent avatarUrl');
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return localAppProjectionError('permission Agent avatarUrl');
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password || parsed.hash) {
    return localAppProjectionError('permission Agent avatarUrl');
  }
  return value;
}

function localAppSessionState(
  rawState: string,
  reasonCode: string,
): NimiAppLocalSessionState | 'unavailable' {
  const normalizedReason = normalizeFieldName(reasonCode);
  if (normalizedReason.includes('processreplaced')) return 'process-replaced';
  if (normalizedReason.includes('accountchanged')) return 'account-changed';
  if (normalizedReason.includes('runtimerestarted')) return 'runtime-restarted';
  switch (rawState) {
    case 'authorizing': return 'action-required';
    case 'ready': return 'session-bound';
    case 'denied': return 'action-required';
    case 'runtime-unavailable': return 'unavailable';
    case 'revoked': return 'revoked';
    case 'project-changed': return 'project-changed';
    default: return localAppProjectionError('auth state');
  }
}

function localAppSessionActionHint(state: NimiAppLocalSessionState | 'unavailable'): string {
  switch (state) {
    case 'session-bound': return 'continue_local_app_session';
    case 'action-required': return 'complete_local_app_authorization';
    case 'revoked': return 'reopen_local_app_session';
    case 'project-changed': return 'readmit_local_development_project';
    case 'process-replaced': return 'restart_through_verified_desktop_supervisor';
    case 'account-changed': return 'reauthorize_for_current_account';
    case 'runtime-restarted': return 'reopen_local_app_session';
    case 'unavailable': return 'start_fixed_runtime_service';
  }
}

function requireKnownPermissionID(value: unknown): PermissionID {
  if (!isKnownPermissionID(value)) {
    return localAppError(
      `Permission "${String(value)}" is not in the public catalog.`,
      'SDK_PERMISSION_ID_UNKNOWN',
      'use_known_permission_id',
    );
  }
  return value;
}

function createPermissionRequestID(): string {
  const requestId = globalThis.crypto?.randomUUID?.();
  if (!requestId) {
    return localAppError(
      'Permission request-id generation is unavailable.',
      'SDK_PERMISSION_REQUEST_INVALID',
      'restore_secure_random_source',
    );
  }
  return requestId;
}

function requirePermissionReason(value: unknown): string {
  const reason = requireText(value, 'reason');
  if (new TextEncoder().encode(reason).byteLength > 240) {
    return localAppError(
      'Permission reason exceeds 240 UTF-8 bytes.',
      'SDK_PERMISSION_REQUEST_INVALID',
      'shorten_permission_reason',
    );
  }
  return reason;
}
