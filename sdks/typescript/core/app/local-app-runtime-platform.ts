import type { JsonValue } from '../../types';
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
  type PermissionID,
  type PermissionRequestInput,
  type PermissionStatus,
} from './permission-types.js';

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
    readonly request: (input: NimiAppPermissionRequestInput) => Promise<unknown>;
  };
  readonly storage: {
    readonly readJson: (relativePath: string) => Promise<unknown>;
    readonly writeJson: (relativePath: string, value: JsonValue) => Promise<unknown>;
    readonly removeJson: (relativePath: string) => Promise<unknown>;
  };
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
  };
  readonly storage: {
    readonly readJson: (relativePath: string) => Promise<NimiAppRuntimeStorageDocument>;
    readonly writeJson: (
      relativePath: string,
      value: JsonValue,
    ) => Promise<NimiAppRuntimeStorageDocument>;
    readonly removeJson: (relativePath: string) => Promise<NimiAppRuntimeStorageRemoveResult>;
  };
};

export function createNimiLocalAppClient(
  input: NimiLocalAppClientInput,
): NimiLocalAppClient {
  assertExactKeys(input, ['standardShell'], 'SDK local-app client input');
  const standardShell = input.standardShell;
  assertExactKeys(standardShell, ['session', 'permission', 'storage'], 'local-app standardShell');
  assertExactMethodNamespace(standardShell.session, ['status'], 'session');
  assertExactMethodNamespace(standardShell.permission, ['status', 'request'], 'permission');
  assertExactMethodNamespace(standardShell.storage, ['readJson', 'writeJson', 'removeJson'], 'storage');

  return Object.freeze({
    auth: Object.freeze({
      status: async () => projectAuth(await standardShell.session.status()),
    }),
    permissions: Object.freeze({
      status: async (permissionId: NimiAppPermissionStatusInput) => {
        const normalized = requireKnownPermissionID(permissionId);
        return projectPermissionStatus(
          await standardShell.permission.status({ permissionId: normalized }),
          normalized,
        );
      },
      request: async (requestInput: NimiAppPermissionRequestInput) => {
        assertExactKeys(requestInput, ['permissionId', 'reason'], 'local-app permission request input');
        const permissionId = requireKnownPermissionID(requestInput.permissionId);
        const reason = requirePermissionReason(requestInput.reason);
        if (!isAdmittedPermissionID(permissionId)) {
          return localAppError(
            `Permission "${permissionId}" is reserved and cannot be requested.`,
            'SDK_PERMISSION_NOT_ADMITTED',
            'wait_for_permission_admission',
          );
        }
        return projectPermissionStatus(
          await standardShell.permission.request({ permissionId, reason }),
          permissionId,
        );
      },
    }),
    storage: createNimiAppRuntimeStorageClient(standardShell.storage),
  });
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
    ['state', 'permissionId', 'canRequest', 'reasonCode'],
    'permission',
  );
  const state = String(record.state || '');
  if (!isPermissionPosture(state)) localAppProjectionError('permission state');
  const permissionId = projectionText(record.permissionId, 'permissionId');
  if (permissionId !== requestedPermissionId || !isKnownPermissionID(permissionId)) {
    localAppProjectionError('permission id binding');
  }
  if (typeof record.canRequest !== 'boolean') localAppProjectionError('permission request posture');
  if (!isAdmittedPermissionID(permissionId) && (state !== 'unavailable' || record.canRequest)) {
    localAppProjectionError('reserved permission posture');
  }
  return {
    permissionId,
    posture: state,
    canRequest: record.canRequest,
    detail: projectionText(record.reasonCode, 'reasonCode'),
  };
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
