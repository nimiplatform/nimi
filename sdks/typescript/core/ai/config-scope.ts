import type {
  NimiAIConfig,
  NimiAIConfigComponentSelection,
  NimiAIConfigTargetRef,
  NimiAIProfileValidationResult,
  NimiAIValidationIssue,
  NimiAIScopeKind,
  NimiAIScopeRef,
  NimiBuiltInChatSurfaceId,
} from './config-types';
import {
  aiValidationIssue,
  aiConfigError,
  collectForbiddenPayloadIssues,
  collectForbiddenSelectedParamsIssues,
  isNonEmptyString,
  isRecord,
  normalizeText,
  requireNonEmptyText,
} from './config-internal';
import { ReasonCode } from '../../types';

export const NIMI_BUILT_IN_CHAT_SURFACE_IDS: readonly NimiBuiltInChatSurfaceId[] = ['nimi'];

export function createNimiAIScopeRef(input: {
  readonly kind: NimiAIScopeKind;
  readonly ownerId: string;
  readonly surfaceId?: string;
}): NimiAIScopeRef {
  const kind = input.kind;
  const ownerId = requireNonEmptyText(input.ownerId, 'ownerId is required', 'provide_ai_scope_owner_id');
  if (kind !== 'app' && kind !== 'module' && kind !== 'feature' && kind !== 'local-agent') {
    throw aiConfigError(ReasonCode.SDK_SCOPE_CATALOG_INVALID, 'AI scope kind must be app, module, feature, or local-agent', 'use_supported_ai_scope_kind');
  }
  const surfaceId = normalizeText(input.surfaceId);
  if (kind === 'local-agent' && surfaceId) {
    throw aiConfigError(
      ReasonCode.SDK_SCOPE_CATALOG_INVALID,
      'Runtime-issued local-agent AI scope must not carry surfaceId',
      'use_runtime_local_agent_ai_scope_projection',
    );
  }
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

/**
 * Projects the canonical scope identity carried by an authenticated Runtime
 * LocalAgent projection. Callers must not derive the owner id from app state.
 */
export function projectNimiRuntimeLocalAgentAIScopeRef(localAgentRef: string): NimiAIScopeRef {
  return createNimiAIScopeRef({
    kind: 'local-agent',
    ownerId: localAgentRef,
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
      'built-in Desktop-owned chat AIConfig requires feature:desktop.chat:nimi',
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
      logicalModelIds: {},
      targetRefs: {},
      selectedComponents: {},
      selectedParams: {},
    },
    profileOrigin: null,
  };
}

export function validateNimiAIConfigTargetRef(value: unknown, path: string): readonly NimiAIValidationIssue[] {
  const issues = collectForbiddenPayloadIssues(value, path);
  if (!isRecord(value)) {
    issues.push(aiValidationIssue('AI_TYPE_INVALID', path));
    return issues;
  }
  if (value.kind === 'profile-slice') {
    if (!isNonEmptyString(value.sourceProfileId)) {
      issues.push(aiValidationIssue('AI_FIELD_REQUIRED', `${path}.sourceProfileId`));
    }
    if (!isNonEmptyString(value.sliceId)) {
      issues.push(aiValidationIssue('AI_FIELD_REQUIRED', `${path}.sliceId`));
    }
  } else if (value.kind === 'local-runtime') {
    if (value.version !== 'v2') {
      issues.push(aiValidationIssue('AI_VALUE_INVALID', `${path}.version`));
    }
    const hasProfileBinding = isNonEmptyString(value.profileBindingId);
    const hasReadinessRef = isNonEmptyString(value.readinessRef);
    if (!hasProfileBinding && !hasReadinessRef) {
      issues.push(aiValidationIssue('AI_TARGET_REF_BINDING_REQUIRED', path));
    }
    if (hasProfileBinding && hasReadinessRef) {
      issues.push(aiValidationIssue('AI_TARGET_REF_BINDING_CONFLICT', path));
    }
    if (isNonEmptyString(value.targetId)) {
      issues.push(aiValidationIssue('AI_FIELD_RETIRED', `${path}.targetId`));
    }
    if (isNonEmptyString(value.profileId)) {
      issues.push(aiValidationIssue('AI_FIELD_RETIRED', `${path}.profileId`));
    }
  } else if (value.kind === 'cloud-connector') {
    if (!isNonEmptyString(value.connectorId)) {
      issues.push(aiValidationIssue('AI_FIELD_REQUIRED', `${path}.connectorId`));
    }
    if (!isNonEmptyString(value.remoteModelCatalogId)) {
      issues.push(aiValidationIssue('AI_FIELD_REQUIRED', `${path}.remoteModelCatalogId`));
    }
    if (!isNonEmptyString(value.providerModelId)) {
      issues.push(aiValidationIssue('AI_FIELD_REQUIRED', `${path}.providerModelId`));
    }
  } else {
    issues.push(aiValidationIssue('AI_TARGET_REF_KIND_UNSUPPORTED', `${path}.kind`));
  }
  return issues;
}

export function validateNimiAIConfig(config: unknown): NimiAIProfileValidationResult {
  const issues: NimiAIValidationIssue[] = [];
  if (!isRecord(config)) {
    return {
      valid: false,
      issues: [aiValidationIssue('AI_TYPE_INVALID', 'config')],
    };
  }
  try {
    assertNimiAIScopeRef(config.scopeRef as NimiAIScopeRef);
  } catch {
    issues.push(aiValidationIssue('AI_SCOPE_REF_INVALID', 'config.scopeRef'));
  }
  issues.push(...collectForbiddenPayloadIssues(config, 'config'));
  const targetRefs = isRecord(config.capabilities)
    ? config.capabilities.targetRefs
    : undefined;
  const logicalModelIds = isRecord(config.capabilities)
    ? config.capabilities.logicalModelIds
    : undefined;
  const selectedParams = isRecord(config.capabilities)
    ? config.capabilities.selectedParams
    : undefined;
  const selectedComponents = isRecord(config.capabilities)
    ? config.capabilities.selectedComponents
    : undefined;
  if (!isRecord(logicalModelIds)) {
    issues.push(aiValidationIssue('AI_TYPE_INVALID', 'config.capabilities.logicalModelIds'));
  } else {
    for (const [capability, logicalModelId] of Object.entries(logicalModelIds)) {
      if (!isNonEmptyString(logicalModelId)) {
        issues.push(aiValidationIssue('AI_VALUE_INVALID', `config.capabilities.logicalModelIds.${capability}`));
      }
      if (!isRecord(targetRefs) || !(capability in targetRefs)) {
        issues.push(aiValidationIssue('AI_TARGET_REF_BINDING_REQUIRED', `config.capabilities.targetRefs.${capability}`));
      }
    }
  }
  if (!isRecord(targetRefs)) {
    issues.push(aiValidationIssue('AI_TYPE_INVALID', 'config.capabilities.targetRefs'));
  } else {
    for (const [capability, targetRef] of Object.entries(targetRefs)) {
      issues.push(...validateNimiAIConfigTargetRef(targetRef, `config.capabilities.targetRefs.${capability}`));
      if (!isRecord(logicalModelIds) || !isNonEmptyString(logicalModelIds[capability])) {
        issues.push(aiValidationIssue('AI_FIELD_REQUIRED', `config.capabilities.logicalModelIds.${capability}`));
      }
    }
  }
  if (!isRecord(selectedParams)) {
    issues.push(aiValidationIssue('AI_TYPE_INVALID', 'config.capabilities.selectedParams'));
  } else {
    for (const capability of Object.keys(selectedParams)) {
      if (!isRecord(logicalModelIds) || !isNonEmptyString(logicalModelIds[capability])) {
        issues.push(aiValidationIssue('AI_FIELD_REQUIRED', `config.capabilities.logicalModelIds.${capability}`));
      }
      issues.push(...collectForbiddenSelectedParamsIssues(
        selectedParams[capability],
        `config.capabilities.selectedParams.${capability}`,
      ));
    }
  }
  if (!isRecord(selectedComponents)) {
    issues.push(aiValidationIssue('AI_TYPE_INVALID', 'config.capabilities.selectedComponents'));
  } else {
    for (const [capability, selections] of Object.entries(selectedComponents)) {
      const path = `config.capabilities.selectedComponents.${capability}`;
      if (!Array.isArray(selections)) {
        issues.push(aiValidationIssue('AI_TYPE_INVALID', path));
        continue;
      }
      if (!isRecord(logicalModelIds) || !isNonEmptyString(logicalModelIds[capability])) {
        issues.push(aiValidationIssue('AI_FIELD_REQUIRED', `config.capabilities.logicalModelIds.${capability}`));
      }
      const occurrenceIds = new Set<string>();
      const orders = new Set<number>();
      let priorOrder = -1;
      selections.forEach((selection, index) => {
        const selectionPath = `${path}[${index}]`;
        if (!isRecord(selection)) {
          issues.push(aiValidationIssue('AI_TYPE_INVALID', selectionPath));
          return;
        }
        const typed = selection as unknown as NimiAIConfigComponentSelection;
        if (!isNonEmptyString(typed.occurrenceId)) {
          issues.push(aiValidationIssue('AI_FIELD_REQUIRED', `${selectionPath}.occurrenceId`));
        } else if (occurrenceIds.has(typed.occurrenceId)) {
          issues.push(aiValidationIssue('AI_VALUE_INVALID', `${selectionPath}.occurrenceId`));
        } else {
          occurrenceIds.add(typed.occurrenceId);
        }
        if (!Number.isInteger(typed.order) || typed.order < 0 || typed.order <= priorOrder || orders.has(typed.order)) {
          issues.push(aiValidationIssue('AI_VALUE_INVALID', `${selectionPath}.order`));
        } else {
          orders.add(typed.order);
          priorOrder = typed.order;
        }
        if (!isNonEmptyString(typed.role)) {
          issues.push(aiValidationIssue('AI_FIELD_REQUIRED', `${selectionPath}.role`));
        }
        if (!isNonEmptyString(typed.componentKind)) {
          issues.push(aiValidationIssue('AI_FIELD_REQUIRED', `${selectionPath}.componentKind`));
        }
        if (!isNonEmptyString(typed.logicalModelId)) {
          issues.push(aiValidationIssue('AI_FIELD_REQUIRED', `${selectionPath}.logicalModelId`));
        }
        issues.push(...validateNimiAIConfigTargetRef(typed.targetRef, `${selectionPath}.targetRef`));
        if (typeof typed.required !== 'boolean') {
          issues.push(aiValidationIssue('AI_FIELD_REQUIRED', `${selectionPath}.required`));
        }
        if (typed.weight !== undefined && !isNonEmptyString(typed.weight)) {
          issues.push(aiValidationIssue('AI_VALUE_INVALID', `${selectionPath}.weight`));
        }
        if (typed.options !== undefined && !isRecord(typed.options)) {
          issues.push(aiValidationIssue('AI_TYPE_INVALID', `${selectionPath}.options`));
        }
      });
    }
  }
  return { valid: issues.length === 0, issues };
}
