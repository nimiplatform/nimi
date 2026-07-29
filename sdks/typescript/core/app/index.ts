import { createNimiError } from '../../types';
import {
  validateNimiAppInventoryEntry,
  validateNimiAppStatus,
} from './inventory-types.js';
import type { NimiAppAIProfileFactoryRow } from './ai-profile-factory.generated.js';
import type {
  NimiAppInventoryEntry,
  NimiAppStatus,
  NimiAppTransport,
} from './inventory-types.js';
import {
  isAdmittedPermissionID,
  isKnownPermissionID,
  isPermissionPosture,
} from './permission-types.js';
import type {
  NimiAppScopeRef,
  PermissionID,
  PermissionPostureEvent,
  PermissionRequestInput,
  PermissionStatus,
  PermissionTransport,
} from './permission-types.js';

export {
  NIMI_DESKTOP_OPEN_RESULT_REASON_CODES,
  NIMI_DESKTOP_OPEN_SCHEMA_VERSION,
  NIMI_DESKTOP_OPEN_SOURCE_HOSTS,
  NimiDesktopOpenIntentParseError,
  composeNimiDesktopOpenIntentEnvelope,
  createNimiDesktopOpenRequestId,
  isNimiDesktopOpenResultReasonCode,
  isNimiDesktopOpenSourceHost,
  parseNimiDesktopOpenIntent,
  parseNimiDesktopOpenIntentEnvelope,
  parseNimiDesktopOpenRendererRequest,
  parseNimiDesktopOpenResult,
  safeParseNimiDesktopOpenIntentEnvelope,
} from './desktop-open.js';
export type {
  ComposeNimiDesktopOpenIntentEnvelopeInput,
  NimiDesktopOpenAcceptedResult,
  NimiDesktopOpenAgentsIntent,
  NimiDesktopOpenAgentsView,
  NimiDesktopOpenAppsIntent,
  NimiDesktopOpenExploreIntent,
  NimiDesktopOpenExploreProductIntent,
  NimiDesktopOpenExploreSection,
  NimiDesktopOpenIntent,
  NimiDesktopOpenIntentEnvelope,
  NimiDesktopOpenIntentKind,
  NimiDesktopOpenIntentParseResult,
  NimiDesktopOpenParseReasonCode,
  NimiDesktopOpenRejectedResult,
  NimiDesktopOpenRejectedActionHint,
  NimiDesktopOpenRendererRequest,
  NimiDesktopOpenResult,
  NimiDesktopOpenResultReasonCode,
  NimiDesktopOpenRuntimeConfigAction,
  NimiDesktopOpenRuntimeConfigIntent,
  NimiDesktopOpenRuntimeConfigPage,
  NimiDesktopOpenSettingsIntent,
  NimiDesktopOpenSettingsSection,
  NimiDesktopOpenSourceHost,
} from './desktop-open.js';
export {
  createRuntimeAccountMediatedDesktopProductRealmTransport,
  createRuntimeAccountMediatedDesktopSourceReadinessRealmTransport,
  createRuntimeAccountMediatedRealmTransport,
  NIMI_DESKTOP_PRODUCT_REALM_OPERATION_IDS,
  NIMI_DESKTOP_SOURCE_READINESS_REALM_OPERATION_IDS,
  type NimiDesktopProductRealmOperationID,
  type NimiDesktopSourceReadinessRealmOperationID,
  type RuntimeAccountMediatedRealmRuntime,
} from './runtime-account-realm.js';
export type {
  NimiAppAuthMode,
  NimiAppAuthProjection,
  NimiAppAuthUnavailable,
  NimiAppLocalSessionProjection,
  NimiAppPermissionRequestInput,
  NimiAppPermissionStatus,
  NimiAppPermissionStatusInput,
  NimiLocalAppClient,
  NimiLocalAppClientInput,
  NimiLocalAppStandardShell,
  NimiLocalAppConversationEvent,
  NimiLocalAppConversationOpenInput,
  NimiLocalAppConversationOpenResult,
  NimiLocalAppConversationScopeInput,
  NimiLocalAppConversationSendInput,
  NimiLocalAppConversationSendResult,
  NimiLocalAppConversationShellSubscription,
  NimiLocalAppConversationSnapshot,
  NimiLocalAppConversationSubscription,
  NimiLocalAppAgent,
  NimiLocalAppAgentHandle,
  NimiAppRuntimeStorageDocument,
  NimiAppRuntimeStorageRemoveResult,
} from './local-app-runtime-platform.js';
export {
  NIMI_APP_AI_PROFILE_FACTORY_CATALOG,
  NIMI_APP_AI_PROFILE_FACTORY_ROWS,
  loadNimiAppAIProfileFactoryCatalog,
  loadNimiAppAIProfileFactoryRows,
} from './ai-profile-factory.generated.js';
export type { NimiAppAIProfileFactoryRow } from './ai-profile-factory.generated.js';
export * from './inventory-types.js';
export {
  ADMITTED_PERMISSION_IDS,
  KNOWN_PERMISSION_IDS,
  PERMISSION_POSTURES,
  isAdmittedPermissionID,
  isKnownPermissionID,
  isPermissionPosture,
} from './permission-types.js';
export type {
  NimiAppScopeKind,
  NimiAppScopeRef,
  PermissionID,
  PermissionPosture,
  PermissionPostureEvent,
  PermissionRequestInput,
  PermissionStatus,
  PermissionTransport,
} from './permission-types.js';
export type NimiFirstRunInstallLevel = 'minimal' | 'recommended';

export class NimiAppClient {
  constructor(private readonly transport: NimiAppTransport) {
    if (!transport || typeof transport.list !== 'function' || typeof transport.get !== 'function' || typeof transport.status !== 'function') {
      appError('SDK_APP_TRANSPORT_INVALID', 'NimiAppClient requires explicit read-projection transport', 'provide_app_transport');
    }
  }

  async list(): Promise<readonly NimiAppInventoryEntry[]> {
    try {
      const entries = await this.transport.list();
      if (!Array.isArray(entries)) {
        appError('SDK_APP_RESPONSE_INVALID', 'Nimi app list response must be an array', 'fix_app_transport_response');
      }
      for (const entry of entries) {
        validateNimiAppInventoryEntry(entry);
      }
      return entries;
    } catch (error) {
      throw wrapTransportError(error, 'list Nimi apps');
    }
  }

  async get(appId: string): Promise<NimiAppInventoryEntry> {
    const normalizedAppId = requireText(appId, 'appId is required', 'SDK_APP_ID_REQUIRED', 'set_app_id');
    try {
      const entry = await this.transport.get(normalizedAppId);
      validateNimiAppInventoryEntry(entry);
      if (entry.appId !== normalizedAppId) {
        appError('SDK_APP_RESPONSE_INVALID', 'Nimi app inventory entry appId does not match request', 'fix_app_transport_response');
      }
      return entry;
    } catch (error) {
      throw wrapTransportError(error, 'get Nimi app');
    }
  }

  async status(appId: string): Promise<NimiAppStatus> {
    const normalizedAppId = requireText(appId, 'appId is required', 'SDK_APP_ID_REQUIRED', 'set_app_id');
    try {
      const status = await this.transport.status(normalizedAppId);
      validateNimiAppStatus(status, normalizedAppId);
      return status;
    } catch (error) {
      throw wrapTransportError(error, 'get Nimi app status');
    }
  }
}

export class PermissionClient {
  constructor(private readonly transport: PermissionTransport) {
    if (!isPermissionTransport(transport)) {
      appError('SDK_PERMISSION_TRANSPORT_INVALID', 'PermissionClient requires an explicit protected posture transport', 'provide_permission_transport');
    }
  }

  async status(permissionId: PermissionID): Promise<PermissionStatus> {
    validateKnownPermissionID(permissionId);
    try {
      const status = await this.transport.status(permissionId);
      validatePermissionStatus(status, permissionId);
      return status;
    } catch (error) {
      throw wrapPermissionTransportError(error, 'read permission posture');
    }
  }

  async request(input: PermissionRequestInput): Promise<PermissionStatus> {
    const request = validatePermissionRequest(input);
    try {
      const status = await this.transport.request(request);
      validatePermissionStatus(status, request.permissionId);
      return status;
    } catch (error) {
      throw wrapPermissionTransportError(error, 'request permission');
    }
  }

  subscribe(permissionId: PermissionID, callback: (event: PermissionPostureEvent) => void): () => void {
    validateKnownPermissionID(permissionId);
    if (typeof callback !== 'function') {
      appError('SDK_PERMISSION_CALLBACK_INVALID', 'permission subscribe callback is required', 'provide_permission_callback');
    }
    try {
      return this.transport.subscribe(permissionId, (event) => {
        if (!event || typeof event !== 'object') {
          appError('SDK_PERMISSION_RESPONSE_INVALID', 'permission posture event is missing', 'fix_permission_transport_response');
        }
        validatePermissionStatus(event.status, permissionId);
        callback(event);
      });
    } catch (error) {
      throw wrapPermissionTransportError(error, 'subscribe permission posture');
    }
  }
}

export function createNimiAppClient(transport: NimiAppTransport): NimiAppClient {
  return new NimiAppClient(transport);
}

export function createPermissionClient(transport: PermissionTransport): PermissionClient {
  return new PermissionClient(transport);
}

export function createAppScopeRef(input: {
  readonly appId: unknown;
  readonly surfaceId?: unknown;
}): NimiAppScopeRef {
  return {
    kind: 'app',
    ownerId: requireText(input.appId, 'scope appId is required', 'SDK_APP_ID_REQUIRED', 'set_app_id'),
    ...(normalizeText(input.surfaceId) ? { surfaceId: normalizeText(input.surfaceId) } : {}),
  };
}

export function isAdmittedNimiFirstRunLocalBaseline(row: NimiAppAIProfileFactoryRow): boolean {
  const levels = new Set(row.firstRunInstallLevels.map((level) => level.trim().toLowerCase()));
  if (!levels.has('minimal') && !levels.has('recommended')) return false;
  if (!row.applicableScopes.includes('first-run')) return false;
  if (row.computePosture === 'cloud-only') return false;
  if (row.routingPolicy === 'cloud-first' || row.routingPolicy === 'hybrid-explicit') return false;
  if (row.capabilitySet.includes('video.generate')) return false;
  return row.localComputePackRefs.length > 0 && row.dependencyFamilyRefs.length > 0;
}

export function selectNimiAppFactoryAIProfileForFirstRun(
  rows: readonly NimiAppAIProfileFactoryRow[],
  installLevel: NimiFirstRunInstallLevel = 'minimal',
): NimiAppAIProfileFactoryRow | null {
  const candidates = rows.filter((row) =>
    isAdmittedNimiFirstRunLocalBaseline(row) && row.firstRunInstallLevels.includes(installLevel));
  if (installLevel === 'recommended') {
    return candidates.find((row) => !row.firstRunInstallLevels.includes('minimal')) ?? candidates[0] ?? null;
  }
  return candidates[0] ?? null;
}

function validateKnownPermissionID(value: unknown): asserts value is PermissionID {
  if (!isKnownPermissionID(value)) {
    appError('SDK_PERMISSION_ID_UNKNOWN', `permission id "${String(value)}" is not in the public catalog`, 'use_known_permission_id');
  }
}

function validatePermissionRequest(input: PermissionRequestInput | null | undefined): PermissionRequestInput {
  if (!input || typeof input !== 'object') {
    appError('SDK_PERMISSION_REQUEST_INVALID', 'permission request is required', 'provide_permission_request');
  }
  const fields = Object.keys(input as object);
  if (fields.some((field) => field !== 'permissionId' && field !== 'reason')) {
    appError('SDK_PERMISSION_REQUEST_INVALID', 'permission request accepts only permissionId and reason', 'remove_permission_authority_fields');
  }
  validateKnownPermissionID(input.permissionId);
  const reason = normalizeText(input.reason);
  if (reason !== input.reason || new TextEncoder().encode(reason).length === 0 || new TextEncoder().encode(reason).length > 240) {
    appError('SDK_PERMISSION_REQUEST_INVALID', 'permission reason must be canonical and at most 240 UTF-8 bytes', 'provide_permission_reason');
  }
  if (!isAdmittedPermissionID(input.permissionId)) {
    appError('SDK_PERMISSION_NOT_ADMITTED', `permission "${input.permissionId}" is reserved and cannot be requested`, 'wait_for_permission_admission');
  }
  return { permissionId: input.permissionId, reason };
}

function validatePermissionStatus(status: PermissionStatus | null | undefined, expectedPermissionId: PermissionID): void {
  if (!status || typeof status !== 'object') {
    appError('SDK_PERMISSION_RESPONSE_INVALID', 'permission status is missing', 'fix_permission_transport_response');
  }
  if (status.permissionId !== expectedPermissionId || !isKnownPermissionID(status.permissionId)) {
    appError('SDK_PERMISSION_RESPONSE_INVALID', 'permission response id does not match request', 'fix_permission_transport_response');
  }
  const seenAgentHandles = new Set<string>();
  if (!isPermissionPosture(status.posture) || typeof status.canRequest !== 'boolean'
    || !Array.isArray(status.agents)
    || status.agents.some((agent) => {
      const fields = agent && typeof agent === 'object' ? Object.keys(agent) : [];
      if (!agent || typeof agent !== 'object'
        || fields.length !== 2
        || !fields.includes('agentHandle')
        || !fields.includes('displayName')
        || typeof agent.agentHandle !== 'string'
        || agent.agentHandle.trim() !== agent.agentHandle
        || new TextEncoder().encode(agent.agentHandle).length === 0
        || new TextEncoder().encode(agent.agentHandle).length > 240
        || seenAgentHandles.has(agent.agentHandle)
        || typeof agent.displayName !== 'string'
        || agent.displayName.trim() !== agent.displayName
        || new TextEncoder().encode(agent.displayName).length === 0
        || new TextEncoder().encode(agent.displayName).length > 240) {
        return true;
      }
      seenAgentHandles.add(agent.agentHandle);
      return false;
    })) {
    appError('SDK_PERMISSION_RESPONSE_INVALID', 'permission response posture is not canonical', 'fix_permission_transport_response');
  }
  if (status.canRequest !== (status.posture === 'prompt')
    || (status.posture !== 'granted' && status.agents.length > 0)) {
    appError('SDK_PERMISSION_RESPONSE_INVALID', 'permission Agent projection does not match posture', 'fix_permission_transport_response');
  }
  if (!isAdmittedPermissionID(status.permissionId) && (status.posture !== 'unavailable' || status.canRequest)) {
    appError('SDK_PERMISSION_RESPONSE_INVALID', 'reserved permission must remain unavailable', 'fix_permission_transport_response');
  }
}

function isPermissionTransport(value: unknown): value is PermissionTransport {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return ['request', 'status', 'subscribe']
    .every((method) => typeof candidate[method] === 'function');
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function requireText(value: unknown, message: string, code: string, actionHint: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    appError(code, message, actionHint);
  }
  return normalized;
}

function wrapTransportError(error: unknown, action: string): never {
  if (isNimiSdkError(error)) {
    throw error;
  }
  appError('SDK_APP_TRANSPORT_FAILED', `failed to ${action}`, 'check_app_transport', error);
}

function wrapPermissionTransportError(error: unknown, action: string): never {
  if (isNimiSdkError(error)) {
    throw error;
  }
  appError('SDK_PERMISSION_TRANSPORT_FAILED', `failed to ${action}`, 'check_permission_transport', error);
}

function isNimiSdkError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && typeof (error as { reasonCode?: unknown }).reasonCode === 'string');
}

function appError(code: string, message: string, actionHint: string, cause?: unknown): never {
  throw createNimiError({
    message,
    code,
    reasonCode: code,
    actionHint,
    source: 'sdk',
    details: cause === undefined ? undefined : { cause: String(cause instanceof Error ? cause.message : cause) },
  });
}
