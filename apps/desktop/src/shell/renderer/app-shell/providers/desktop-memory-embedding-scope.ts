import type { AIScopeRef } from '@nimiplatform/sdk/ai';

const DESKTOP_MEMORY_EMBEDDING_SCOPE_REF: AIScopeRef = {
  kind: 'feature',
  ownerId: 'desktop.memory',
  surfaceId: 'embedding',
};

export function createDesktopMemoryEmbeddingScopeRef(): AIScopeRef {
  return { ...DESKTOP_MEMORY_EMBEDDING_SCOPE_REF };
}
