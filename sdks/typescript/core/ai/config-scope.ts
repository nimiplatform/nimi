import type {
  NimiAIConfig,
  NimiAIConfigTargetRef,
  NimiAIProfileValidationResult,
  NimiAIScopeKind,
  NimiAIScopeRef,
  NimiBuiltInChatSurfaceId,
} from './config-types';
import {
  aiConfigError,
  collectForbiddenPayloadErrors,
  isNonEmptyString,
  isRecord,
  normalizeText,
  requireNonEmptyText,
} from './config-internal';
import { ReasonCode } from '../../types';

export const NIMI_BUILT_IN_CHAT_SURFACE_IDS: readonly NimiBuiltInChatSurfaceId[] = ['nimi', 'agent'];

export function createNimiAIScopeRef(input: {
  readonly kind: NimiAIScopeKind;
  readonly ownerId: string;
  readonly surfaceId?: string;
}): NimiAIScopeRef {
  const kind = input.kind;
  const ownerId = requireNonEmptyText(input.ownerId, 'ownerId is required', 'provide_ai_scope_owner_id');
  if (kind !== 'app' && kind !== 'module' && kind !== 'feature') {
    throw aiConfigError(ReasonCode.SDK_SCOPE_CATALOG_INVALID, 'AI scope kind must be app, module, or feature', 'use_supported_ai_scope_kind');
  }
  const surfaceId = normalizeText(input.surfaceId);
  return surfaceId ? { kind, ownerId, surfaceId } : { kind, ownerId };
}

export function createNimiAppAIScopeRef(appId: string, surfaceId?: string): NimiAIScopeRef {
  return createNimiAIScopeRef({ kind: 'app', ownerId: appId, surfaceId });
}

export function createNimiBuiltInChatAIScopeRef(surfaceId: NimiBuiltInChatSurfaceId): NimiAIScopeRef {
  return createNimiAIScopeRef({
    kind: 'feature',
    ownerId: 'desktop.chat',
    surfaceId,
  });
}

export function nimiBuiltInChatAIScopeRefs(): readonly NimiAIScopeRef[] {
  return NIMI_BUILT_IN_CHAT_SURFACE_IDS.map(createNimiBuiltInChatAIScopeRef);
}

export function isNimiBuiltInChatAIScopeRef(scopeRef: NimiAIScopeRef | null | undefined): boolean {
  if (!scopeRef || scopeRef.kind !== 'feature' || scopeRef.ownerId !== 'desktop.chat') {
    return false;
  }
  return NIMI_BUILT_IN_CHAT_SURFACE_IDS.includes(scopeRef.surfaceId as NimiBuiltInChatSurfaceId);
}

export function assertNimiBuiltInChatAIScopeRef(scopeRef: NimiAIScopeRef | null | undefined): NimiAIScopeRef {
  const normalized = assertNimiAIScopeRef(scopeRef);
  if (!isNimiBuiltInChatAIScopeRef(normalized)) {
    throw aiConfigError(
      ReasonCode.SDK_SCOPE_CATALOG_INVALID,
      'built-in chat AIConfig requires feature:desktop.chat:nimi or feature:desktop.chat:agent',
      'provide_built_in_chat_ai_scope_ref',
    );
  }
  return normalized;
}

export function isNimiAppAIScopeRef(scopeRef: NimiAIScopeRef | null | undefined): boolean {
  if (!scopeRef || scopeRef.kind !== 'app') {
    return false;
  }
  try {
    assertNimiAIScopeRef(scopeRef);
    return true;
  } catch {
    return false;
  }
}

export function assertNimiAppAIScopeRef(scopeRef: NimiAIScopeRef | null | undefined): NimiAIScopeRef {
  const normalized = assertNimiAIScopeRef(scopeRef);
  if (normalized.kind !== 'app') {
    throw aiConfigError(
      ReasonCode.SDK_SCOPE_CATALOG_INVALID,
      'app first-launch AIConfig requires an app scopeRef',
      'provide_explicit_app_ai_scope_ref',
    );
  }
  return normalized;
}

export function encodeNimiAIScopeRef(scopeRef: NimiAIScopeRef): string {
  const scope = assertNimiAIScopeRef(scopeRef);
  return [scope.kind, scope.ownerId, scope.surfaceId ?? ''].map(encodeURIComponent).join(':');
}

export function parseNimiAIScopeRefKey(key: string): NimiAIScopeRef | null {
  const parts = String(key || '').split(':');
  if (parts.length !== 3) {
    return null;
  }
  try {
    const kind = decodeURIComponent(parts[0] ?? '') as NimiAIScopeKind;
    const ownerId = decodeURIComponent(parts[1] ?? '');
    const surfaceId = decodeURIComponent(parts[2] ?? '');
    return createNimiAIScopeRef({ kind, ownerId, surfaceId: surfaceId || undefined });
  } catch {
    return null;
  }
}

export function assertNimiAIScopeRef(scopeRef: NimiAIScopeRef | null | undefined): NimiAIScopeRef {
  if (!scopeRef || typeof scopeRef !== 'object') {
    throw aiConfigError(ReasonCode.SDK_SCOPE_CATALOG_INVALID, 'AI scopeRef is required', 'provide_explicit_ai_scope_ref');
  }
  return createNimiAIScopeRef(scopeRef);
}

export function areNimiAIScopeRefsEqual(left: NimiAIScopeRef, right: NimiAIScopeRef): boolean {
  return encodeNimiAIScopeRef(left) === encodeNimiAIScopeRef(right);
}

export function createEmptyNimiAIConfig(scopeRef: NimiAIScopeRef): NimiAIConfig {
  return {
    scopeRef: assertNimiAIScopeRef(scopeRef),
    capabilities: {
      targetRefs: {},
      selectedParams: {},
    },
    profileOrigin: null,
  };
}

export function validateNimiAIConfigTargetRef(value: unknown, path: string): readonly string[] {
  const errors = collectForbiddenPayloadErrors(value, path);
  if (!isRecord(value)) {
    return [`${path} must be a compact AIConfig target ref`];
  }
  if (value.kind === 'profile-slice') {
    if (!isNonEmptyString(value.sourceProfileId)) errors.push(`${path}.sourceProfileId is required`);
    if (!isNonEmptyString(value.sliceId)) errors.push(`${path}.sliceId is required`);
  } else if (value.kind === 'local-runtime') {
    if (!isNonEmptyString(value.readinessRef)
      && !isNonEmptyString(value.targetId)
      && !isNonEmptyString(value.profileId)) {
      errors.push(`${path} requires readinessRef or targetId/profileId`);
    }
  } else if (value.kind === 'cloud-connector') {
    if (!isNonEmptyString(value.connectorId)) errors.push(`${path}.connectorId is required`);
    if (!isNonEmptyString(value.providerModelId)) errors.push(`${path}.providerModelId is required`);
  } else {
    errors.push(`${path}.kind is not an admitted AIConfig compact ref family`);
  }
  return errors;
}

export function validateNimiAIConfig(config: unknown): NimiAIProfileValidationResult {
  const errors: string[] = [];
  if (!isRecord(config)) {
    return { valid: false, errors: ['config must be a non-null object'] };
  }
  try {
    assertNimiAIScopeRef(config.scopeRef as NimiAIScopeRef);
  } catch {
    errors.push('scopeRef must be an explicit NimiAIScopeRef');
  }
  errors.push(...collectForbiddenPayloadErrors(config, 'config'));
  const targetRefs = isRecord(config.capabilities)
    ? config.capabilities.targetRefs
    : undefined;
  if (!isRecord(targetRefs)) {
    errors.push('capabilities.targetRefs must be an object');
  } else {
    for (const [capability, targetRef] of Object.entries(targetRefs)) {
      errors.push(...validateNimiAIConfigTargetRef(targetRef, `capabilities.targetRefs.${capability}`));
    }
  }
  return { valid: errors.length === 0, errors };
}
