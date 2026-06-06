import type { NimiMemoryEmbeddingScopeRef } from '@nimiplatform/sdk/runtime';

const DESKTOP_MEMORY_EMBEDDING_SCOPE_REF: NimiMemoryEmbeddingScopeRef = {
  kind: 'feature',
  ownerId: 'desktop.memory',
  surfaceId: 'embedding',
};

export function createDesktopMemoryEmbeddingScopeRef(): NimiMemoryEmbeddingScopeRef {
  return { ...DESKTOP_MEMORY_EMBEDDING_SCOPE_REF };
}
