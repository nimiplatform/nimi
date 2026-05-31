import { createNimiError } from '../core/errors.js';
import { ReasonCode } from '../types/index.js';

export type AIScopeKind = 'app' | 'module' | 'feature';

/** Canonical identity for an AI configuration scope. */
export type AIScopeRef = {
  kind: AIScopeKind;
  ownerId: string;
  surfaceId?: string;
};

/** Canonical owner of the two built-in first-run chat feature surfaces. */
const BUILT_IN_CHAT_FEATURE_OWNER_ID = 'desktop.chat';

/** The two canonical built-in first-run chat surface ids (P-AISC-006). */
export type BuiltInChatSurfaceId = 'nimi' | 'agent';

const BUILT_IN_CHAT_SURFACE_IDS: readonly BuiltInChatSurfaceId[] = ['nimi', 'agent'];

/**
 * Create a canonical built-in first-run chat AIScopeRef (P-AISC-006).
 *
 * Produces the `feature` shape owned by `desktop.chat`:
 *   - `nimi`  -> { kind: 'feature', ownerId: 'desktop.chat', surfaceId: 'nimi' }
 *   - `agent` -> { kind: 'feature', ownerId: 'desktop.chat', surfaceId: 'agent' }
 *
 * The caller must pass an explicit surface id. There is no omitted-scope
 * inference and the result is never a generic desktop chat app scope.
 */
export function createBuiltInChatAIScopeRef(surfaceId: BuiltInChatSurfaceId): AIScopeRef {
  const normalized = String(surfaceId || '').trim();
  if (normalized !== 'nimi' && normalized !== 'agent') {
    throw createNimiError({
      message: "built-in chat surface id must be 'nimi' or 'agent'",
      reasonCode: ReasonCode.ACTION_INPUT_INVALID,
      actionHint: 'provide_canonical_built_in_chat_surface_id',
      source: 'sdk',
    });
  }
  return {
    kind: 'feature',
    ownerId: BUILT_IN_CHAT_FEATURE_OWNER_ID,
    surfaceId: normalized,
  };
}

/** True when the scope is exactly one of the two canonical built-in chat scopes. */
export function isBuiltInChatAIScopeRef(scopeRef: AIScopeRef | null | undefined): boolean {
  if (!scopeRef) {
    return false;
  }
  const surfaceId = String(scopeRef.surfaceId || '').trim();
  return scopeRef.kind === 'feature'
    && String(scopeRef.ownerId || '').trim() === BUILT_IN_CHAT_FEATURE_OWNER_ID
    && (surfaceId === 'nimi' || surfaceId === 'agent');
}

/**
 * Assert that the caller provided an exact canonical built-in chat scope.
 *
 * Rejects: omitted/null scope, generic `app:desktop:chat`, the retired
 * `app:desktop.chat.nimi|agent` shape, a merged `desktop.chat` scope with no
 * `surfaceId`, and any other non-canonical key. SDK never infers the scope.
 */
export function assertBuiltInChatAIScopeRef(scopeRef: AIScopeRef | null | undefined): AIScopeRef {
  if (!scopeRef) {
    throw createNimiError({
      message: 'built-in chat AIScopeRef is required and must be provided explicitly',
      reasonCode: ReasonCode.ACTION_INPUT_INVALID,
      actionHint: 'provide_explicit_built_in_chat_scope_ref',
      source: 'sdk',
    });
  }
  if (!isBuiltInChatAIScopeRef(scopeRef)) {
    throw createNimiError({
      message:
        "built-in chat AIScopeRef must equal feature:desktop.chat:nimi or feature:desktop.chat:agent",
      reasonCode: ReasonCode.ACTION_INPUT_INVALID,
      actionHint: 'use_canonical_built_in_chat_scope_ref',
      source: 'sdk',
    });
  }
  return createBuiltInChatAIScopeRef(scopeRef.surfaceId as BuiltInChatSurfaceId);
}

/** The canonical first-run built-in chat scope set, in stable order (P-AISC-006). */
export function builtInChatAIScopeRefs(): AIScopeRef[] {
  return BUILT_IN_CHAT_SURFACE_IDS.map((surfaceId) => createBuiltInChatAIScopeRef(surfaceId));
}
