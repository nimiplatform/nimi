import { createNimiError } from '../core/errors.js';
import type { AIScopeRef } from '../scope/ai-scope.js';
import { ReasonCode } from '../types/index.js';

export type MemoryEmbeddingSourceKind = 'cloud' | 'local';

export type MemoryEmbeddingCloudConfigBindingRef = {
  kind: 'cloud';
  connectorId: string;
  modelId: string;
};

export type MemoryEmbeddingLocalConfigBindingRef = {
  kind: 'local';
  targetId: string;
};

export type MemoryEmbeddingBindingRef =
  | MemoryEmbeddingCloudConfigBindingRef
  | MemoryEmbeddingLocalConfigBindingRef;

export type MemoryEmbeddingConfig = {
  scopeRef: AIScopeRef;
  sourceKind: MemoryEmbeddingSourceKind | null;
  bindingRef: MemoryEmbeddingBindingRef | null;
  revisionToken: string;
  updatedAt: string;
};

export type MemoryEmbeddingRuntimeTargetRef = {
  kind: 'agent-core';
  localAgentRef: string;
};

export type MemoryEmbeddingConfigInput = {
  scopeRef: AIScopeRef;
  targetRef: MemoryEmbeddingRuntimeTargetRef;
};

export type MemoryEmbeddingConfigSurface = {
  get(input: MemoryEmbeddingConfigInput): Promise<MemoryEmbeddingConfig>;
  update(input: MemoryEmbeddingConfigInput, config: MemoryEmbeddingConfig): Promise<MemoryEmbeddingConfig>;
  subscribe(input: MemoryEmbeddingConfigInput, callback: (config: MemoryEmbeddingConfig) => void): () => void;
};

function assertExplicitAIScopeRef(scopeRef: AIScopeRef | null | undefined): AIScopeRef {
  if (!scopeRef || !String(scopeRef.kind || '').trim() || !String(scopeRef.ownerId || '').trim()) {
    throw createNimiError({
      message: 'MemoryEmbeddingConfig factory requires an explicit AIScopeRef',
      reasonCode: ReasonCode.ACTION_INPUT_INVALID,
      actionHint: 'provide_explicit_memory_embedding_ai_scope_ref',
      source: 'sdk',
    });
  }
  const surfaceId = scopeRef.surfaceId === undefined ? undefined : String(scopeRef.surfaceId).trim();
  if (scopeRef.surfaceId !== undefined && !surfaceId) {
    throw createNimiError({
      message: 'AIScopeRef surfaceId must be omitted or non-empty',
      reasonCode: ReasonCode.ACTION_INPUT_INVALID,
      actionHint: 'provide_valid_ai_scope_ref_surface_id',
      source: 'sdk',
    });
  }
  return surfaceId === undefined
    ? { kind: scopeRef.kind, ownerId: scopeRef.ownerId }
    : { kind: scopeRef.kind, ownerId: scopeRef.ownerId, surfaceId };
}

/** Create an empty editable memory-embedding binding intent for a given scope. */
export function createEmptyMemoryEmbeddingConfig(scopeRef: AIScopeRef): MemoryEmbeddingConfig {
  const now = new Date().toISOString();
  return {
    scopeRef: assertExplicitAIScopeRef(scopeRef),
    sourceKind: null,
    bindingRef: null,
    revisionToken: now,
    updatedAt: now,
  };
}
