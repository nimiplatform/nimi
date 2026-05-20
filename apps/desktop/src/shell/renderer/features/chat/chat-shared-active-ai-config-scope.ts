import {
  createBuiltInChatAIScopeRef,
  type AIScopeRef,
} from '@nimiplatform/sdk/mod';
import type { ConversationMode } from '@nimiplatform/nimi-kit/features/chat/headless';
import { scopeKeyFromRef } from '@renderer/app-shell/providers/desktop-ai-config-storage';
import { pushDesktopAIConfigToBoundStore } from '@renderer/app-shell/providers/desktop-ai-config-service';

/**
 * Chat consumer-local active scope orchestration.
 *
 * This is a convenience state for chat projection and settings flows only.
 * It is not shared Desktop AIConfig authority and must not become a cross-domain
 * singleton for future mod consumers.
 *
 * T3-1: the active chat scope is mode-aware. Each chat mode binds to its
 * canonical built-in `AIScopeRef` (P-AISC-006):
 *   - `ai`    (Nimi Chat)  -> feature:desktop.chat:nimi
 *   - `agent` (Agent Chat) -> feature:desktop.chat:agent
 *   - `human` (Human Chat) -> no built-in chat AIConfig scope
 *   - `group` (Group Chat) -> no built-in chat AIConfig scope (T3-2 owns reuse)
 *
 * There is NO generic `app:desktop:chat` scope in the chat live path. Human and
 * Group modes bind no chat AIConfig scope; their active-scope result is `null`.
 */

/**
 * Mode -> built-in chat scope resolution.
 *
 * `null` is the typed "no built-in chat AIConfig scope" result for modes that
 * do not own a built-in chat AIConfig (`human`, and `group` until T3-2 wires
 * its `desktop.chat.agent` reuse).
 */
export function resolveChatModeAIScopeRef(mode: ConversationMode): AIScopeRef | null {
  switch (mode) {
    case 'ai':
      return createBuiltInChatAIScopeRef('nimi');
    case 'agent':
      return createBuiltInChatAIScopeRef('agent');
    case 'human':
    case 'group':
      return null;
    default: {
      const exhaustive: never = mode;
      return exhaustive;
    }
  }
}

/**
 * The mode the active scope was last resolved for. Initialized to the chat
 * surface default mode (`ai`) so the first `getActiveScope()` read resolves to
 * the canonical Nimi built-in chat scope without touching any generic scope.
 */
let activeMode: ConversationMode = 'ai';
let activeScopeRef: AIScopeRef | null = resolveChatModeAIScopeRef(activeMode);

type ActiveScopeChangeListener = (scopeRef: AIScopeRef | null) => void;
const activeScopeListeners: ActiveScopeChangeListener[] = [];

/**
 * The current active chat AIScopeRef, or `null` when the active chat mode
 * binds no built-in chat AIConfig scope (`human` / `group`).
 */
export function getActiveScope(): AIScopeRef | null {
  return activeScopeRef;
}

/** The chat mode the active scope is currently resolved for. */
export function getActiveScopeMode(): ConversationMode {
  return activeMode;
}

/**
 * Rebind the active chat scope to the canonical built-in scope for `mode`.
 *
 * Called by the chat-mode store transition. Switching Nimi <-> Agent rebinds
 * the active scope (and every active-scope subscriber) to the correct built-in
 * `feature` scope; switching to Human / Group clears the active chat scope.
 *
 * Per-mode thread/session selection state is owned by the store and is not
 * touched here — this only rewires the AIConfig scope projection.
 */
export function setActiveScopeForMode(mode: ConversationMode): void {
  const prevKey = activeScopeRef ? scopeKeyFromRef(activeScopeRef) : null;
  const nextScopeRef = resolveChatModeAIScopeRef(mode);
  const nextKey = nextScopeRef ? scopeKeyFromRef(nextScopeRef) : null;

  activeMode = mode;
  activeScopeRef = nextScopeRef;

  if (prevKey === nextKey) {
    return;
  }

  if (nextScopeRef) {
    pushDesktopAIConfigToBoundStore(nextScopeRef);
  }
  for (const listener of activeScopeListeners) {
    try {
      listener(nextScopeRef);
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
