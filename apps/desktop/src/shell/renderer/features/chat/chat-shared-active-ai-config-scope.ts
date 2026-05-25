import {
  createBuiltInChatAIScopeRef,
  type AIScopeRef,
} from '@nimiplatform/sdk/ai';
import type { ConversationMode } from '@nimiplatform/kit/features/chat/headless';
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
 *   - `group` (Group Chat) -> see T3-2 below
 *
 * T3-2: Group Chat itself is a Realm-owned thread surface and binds no built-in
 * chat AIConfig scope by default. When the selected group has active LocalAgent
 * participation, the LocalAgent-participation path reuses the SAME canonical
 * `desktop.chat.agent` feature scope as Agent Chat. Group participation never
 * mints a group-specific AIConfig scope (product manual Chat rule: "Group agent
 * participation must not create a group-specific AIConfig scope").
 *
 * There is NO generic `app:desktop:chat` scope in the chat live path. Human and
 * Group modes bind no chat AIConfig scope unless Group LocalAgent participation
 * is active, in which case Group reuses the canonical agent feature scope.
 */

/**
 * Mode -> built-in chat scope resolution.
 *
 * `null` is the typed "no built-in chat AIConfig scope" result for modes that
 * do not own a built-in chat AIConfig (`human`, and `group` — Group resolves
 * its `desktop.chat.agent` reuse dynamically through
 * `resolveGroupLocalAgentParticipationAIScopeRef` and
 * `setGroupLocalAgentParticipationActive`, not from the mode alone).
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
 * Group LocalAgent participation -> built-in chat scope resolution (T3-2).
 *
 * Group Chat is a Realm-owned thread surface; its thread state stays
 * Realm-owned. Only the LocalAgent-participation AIConfig is scoped here, and
 * it reuses the SAME canonical built-in `desktop.chat.agent` feature scope as
 * Agent Chat (P-AISC-006). It MUST NOT mint a group-specific scope.
 *
 * - `hasLocalAgentParticipation === true`  -> feature:desktop.chat:agent
 * - `hasLocalAgentParticipation === false` -> `null` (no built-in chat scope)
 */
export function resolveGroupLocalAgentParticipationAIScopeRef(
  hasLocalAgentParticipation: boolean,
): AIScopeRef | null {
  return hasLocalAgentParticipation ? createBuiltInChatAIScopeRef('agent') : null;
}

/**
 * The mode the active scope was last resolved for. Initialized to the chat
 * surface default mode (`ai`) so the first `getActiveScope()` read resolves to
 * the canonical Nimi built-in chat scope without touching any generic scope.
 */
let activeMode: ConversationMode = 'ai';

/**
 * Whether the currently selected Group thread has active LocalAgent
 * participation. Only meaningful while `activeMode === 'group'`. When `true`,
 * the active scope reuses the canonical `desktop.chat.agent` feature scope.
 */
let groupLocalAgentParticipationActive = false;

/**
 * Resolve the active scope for `mode` honoring Group LocalAgent participation.
 *
 * For every non-group mode this is exactly `resolveChatModeAIScopeRef`. For
 * `group` it is participation-conditional: the canonical `desktop.chat.agent`
 * scope when LocalAgent participation is active, `null` otherwise. Group never
 * resolves a group-specific scope.
 */
function resolveActiveScopeForMode(mode: ConversationMode): AIScopeRef | null {
  if (mode === 'group') {
    return resolveGroupLocalAgentParticipationAIScopeRef(groupLocalAgentParticipationActive);
  }
  return resolveChatModeAIScopeRef(mode);
}

let activeScopeRef: AIScopeRef | null = resolveActiveScopeForMode(activeMode);

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
 * Recompute and rebind the active chat scope from the current `activeMode` and
 * Group participation state, notifying listeners only when the scope changes.
 *
 * Per-mode thread/session selection state is owned by the store and is not
 * touched here — this only rewires the AIConfig scope projection.
 */
function rebindActiveScope(): void {
  const prevKey = activeScopeRef ? scopeKeyFromRef(activeScopeRef) : null;
  const nextScopeRef = resolveActiveScopeForMode(activeMode);
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
 * Called by the chat-mode store transition. Switching Nimi <-> Agent rebinds
 * the active scope (and every active-scope subscriber) to the correct built-in
 * `feature` scope; switching to Human clears the active chat scope. Switching
 * to Group resolves the agent feature scope only when the selected group has
 * active LocalAgent participation, otherwise clears the active chat scope.
 *
 * Per-mode thread/session selection state is owned by the store and is not
 * touched here — this only rewires the AIConfig scope projection.
 */
export function setActiveScopeForMode(mode: ConversationMode): void {
  // Leaving Group always drops Group participation state; a non-group mode
  // never reuses a stale participation flag.
  if (mode !== 'group') {
    groupLocalAgentParticipationActive = false;
  }
  activeMode = mode;
  rebindActiveScope();
}

/**
 * Update whether the currently selected Group thread has active LocalAgent
 * participation (T3-2).
 *
 * When called while in Group mode it rebinds the active chat scope: active
 * participation reuses the canonical `desktop.chat.agent` feature scope (the
 * SAME scope as Agent Chat — never a group-specific scope); no participation
 * clears the active chat scope. Outside Group mode it only records the flag and
 * does not change the active scope.
 */
export function setGroupLocalAgentParticipationActive(active: boolean): void {
  if (groupLocalAgentParticipationActive === active) {
    return;
  }
  groupLocalAgentParticipationActive = active;
  if (activeMode === 'group') {
    rebindActiveScope();
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
