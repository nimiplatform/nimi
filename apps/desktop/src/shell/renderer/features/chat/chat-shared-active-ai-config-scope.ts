import {
  createNimiBuiltInChatAIScopeRef,
  type NimiAIScopeRef,
} from '@nimiplatform/sdk/ai';
import type { ConversationMode } from '@nimiplatform/kit/features/chat/headless';
import { scopeKeyFromRef } from '../../app-shell/providers/desktop-ai-config-storage';
import { pushDesktopAIConfigToBoundStore } from '../../app-shell/providers/desktop-ai-config-service';

/**
 * Chat consumer-local active scope orchestration.
 *
 * This is a convenience state for chat projection and settings flows only.
 * It is not shared Desktop NimiAIConfig authority and must not become a cross-domain
 * singleton for future app consumers.
 *
 * The active chat scope is mode-aware. Only Nimi Chat binds a Desktop-owned
 * built-in `NimiAIScopeRef`
 * (`rule.nimi.platform.core-protocol.p-aisc-006a` /
 * `rule.nimi.platform.core-protocol.p-aisc-006b`):
 *   - `ai`    (Nimi Chat)  -> feature:desktop.chat:nimi
 *   - `agent` (Agent Chat) -> no Desktop-owned scope; Runtime projects the
 *                             selected LocalAgent's `local-agent` scope
 *   - `human` (Human Chat) -> no built-in chat NimiAIConfig scope
 *   - `group` (Group Chat) -> no built-in chat NimiAIConfig scope
 *
 * There is NO generic `app:desktop:chat` scope in the chat live path. Human and
 * Group modes bind no chat NimiAIConfig scope.
 */

/**
 * Mode -> built-in chat scope resolution.
 *
 * `null` is the typed "no built-in chat NimiAIConfig scope" result for modes that
 * do not own a built-in chat NimiAIConfig (`human` and `group`).
 */
export function resolveChatModeAIScopeRef(mode: ConversationMode): NimiAIScopeRef | null {
  switch (mode) {
    case 'ai':
      return createNimiBuiltInChatAIScopeRef('nimi');
    case 'agent':
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

let activeScopeRef: NimiAIScopeRef | null = resolveChatModeAIScopeRef(activeMode);

type ActiveScopeChangeListener = (scopeRef: NimiAIScopeRef | null) => void;
const activeScopeListeners: ActiveScopeChangeListener[] = [];

/**
 * The current active chat NimiAIScopeRef, or `null` when the active chat mode
 * binds no built-in chat NimiAIConfig scope (`human` / `group`).
 */
export function getActiveScope(): NimiAIScopeRef | null {
  return activeScopeRef;
}

/** The chat mode the active scope is currently resolved for. */
export function getActiveScopeMode(): ConversationMode {
  return activeMode;
}

/**
 * Recompute and rebind the active chat scope from the current `activeMode`,
 * notifying listeners only when the scope changes.
 *
 * Per-mode thread/session selection state is owned by the store and is not
 * touched here — this only rewires the NimiAIConfig scope projection.
 */
function rebindActiveScope(): void {
  const prevKey = activeScopeRef ? scopeKeyFromRef(activeScopeRef) : null;
  const nextScopeRef = resolveChatModeAIScopeRef(activeMode);
  const nextKey = nextScopeRef ? scopeKeyFromRef(nextScopeRef) : null;

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

/**
 * Rebind the active chat scope to the canonical built-in scope for `mode`.
 *
 * Called by the chat-mode store transition. Switching away from Nimi clears
 * the Desktop-owned active scope; Agent mode receives its scope only from the
 * selected Runtime LocalAgent projection.
 *
 * Per-mode thread/session selection state is owned by the store and is not
 * touched here — this only rewires the NimiAIConfig scope projection.
 */
export function setActiveScopeForMode(mode: ConversationMode): void {
  activeMode = mode;
  rebindActiveScope();
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
