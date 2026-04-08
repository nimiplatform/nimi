import { createDefaultAIScopeRef, type AIScopeRef } from '@nimiplatform/sdk/mod';
import { scopeKeyFromRef } from '@renderer/app-shell/providers/desktop-ai-config-storage';
import { pushDesktopAIConfigToBoundStore } from '@renderer/app-shell/providers/desktop-ai-config-service';

/**
 * Chat consumer-local active scope orchestration.
 *
 * This is a convenience state for chat projection and settings flows only.
 * It is not shared Desktop AIConfig authority and must not become a cross-domain
 * singleton for future mod consumers.
 */

let activeScopeRef: AIScopeRef | null = null;

type ActiveScopeChangeListener = (scopeRef: AIScopeRef) => void;
const activeScopeListeners: ActiveScopeChangeListener[] = [];

export function getActiveScope(): AIScopeRef {
  if (!activeScopeRef) {
    activeScopeRef = createDefaultAIScopeRef();
  }
  return activeScopeRef;
}

export function setActiveScope(scopeRef: AIScopeRef): void {
  const prevKey = activeScopeRef ? scopeKeyFromRef(activeScopeRef) : null;
  const nextKey = scopeKeyFromRef(scopeRef);
  activeScopeRef = scopeRef;

  if (prevKey === nextKey) {
    return;
  }

  pushDesktopAIConfigToBoundStore(scopeRef);
  for (const listener of activeScopeListeners) {
    try {
      listener(scopeRef);
    } catch {
      // Listener errors must not break active-scope orchestration.
    }
  }
}

export function onActiveScopeChange(listener: ActiveScopeChangeListener): () => void {
  activeScopeListeners.push(listener);
  return () => {
    const idx = activeScopeListeners.indexOf(listener);
    if (idx >= 0) {
      activeScopeListeners.splice(idx, 1);
    }
  };
}
