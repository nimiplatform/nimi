import { useCallback, useEffect, useState } from 'react';
import type { CanonicalConversationAnchoredSurfacePlacement } from '@nimiplatform/nimi-kit/features/chat';

/**
 * Per-target agent avatar stage placement — desktop-shell-owned cosmetic
 * persistence service. Admitted under D-LLM-065 as an in-window cosmetic
 * preference the shell may persist to desktop-local storage with a canonical
 * default of `'right-center'`. Chat features consume this service; they do not
 * own storage themselves (see `check:desktop-chat-authority-anti-patterns`).
 *
 * Transient avatar interaction state (`AvatarInteractionState`) remains
 * separately owned by the avatar surface contract per D-LLM-057.
 */

export const AGENT_AVATAR_PLACEMENT_STORAGE_KEY = 'nimi.chat.agent.avatarPlacement.byTarget.v1';

const ADMITTED_PLACEMENTS: readonly CanonicalConversationAnchoredSurfacePlacement[] = [
  'left-center',
  'top-left',
  'top-right',
  'bottom-right',
  'bottom-center',
  'center',
  'right-center',
];

export const DEFAULT_AGENT_AVATAR_PLACEMENT: CanonicalConversationAnchoredSurfacePlacement = 'right-center';

function isAdmittedPlacement(value: unknown): value is CanonicalConversationAnchoredSurfacePlacement {
  return typeof value === 'string'
    && ADMITTED_PLACEMENTS.includes(value as CanonicalConversationAnchoredSurfacePlacement);
}

function normalizePlacementMap(value: unknown): Record<string, CanonicalConversationAnchoredSurfacePlacement> {
  if (!value || typeof value !== 'object') {
    return {};
  }
  const record = value as Record<string, unknown>;
  const out: Record<string, CanonicalConversationAnchoredSurfacePlacement> = {};
  for (const [targetId, placement] of Object.entries(record)) {
    if (typeof targetId === 'string' && targetId.length > 0 && isAdmittedPlacement(placement)) {
      out[targetId] = placement;
    }
  }
  return out;
}

function loadStoredPlacementMap(): Record<string, CanonicalConversationAnchoredSurfacePlacement> {
  try {
    const raw = localStorage.getItem(AGENT_AVATAR_PLACEMENT_STORAGE_KEY);
    if (raw) {
      return normalizePlacementMap(JSON.parse(raw));
    }
  } catch {
    // ignore — fall through to empty map
  }
  return {};
}

function persistStoredPlacementMap(map: Record<string, CanonicalConversationAnchoredSurfacePlacement>): void {
  try {
    localStorage.setItem(AGENT_AVATAR_PLACEMENT_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

const subscribers = new Set<() => void>();
let sharedMap: Record<string, CanonicalConversationAnchoredSurfacePlacement> | null = null;

function getSharedMap(): Record<string, CanonicalConversationAnchoredSurfacePlacement> {
  if (!sharedMap) {
    sharedMap = loadStoredPlacementMap();
  }
  return sharedMap;
}

function updateSharedMap(
  updater: (prev: Record<string, CanonicalConversationAnchoredSurfacePlacement>) =>
    Record<string, CanonicalConversationAnchoredSurfacePlacement>,
): void {
  const next = updater(getSharedMap());
  sharedMap = next;
  persistStoredPlacementMap(next);
  for (const listener of subscribers) {
    listener();
  }
}

export function getAgentAvatarPlacement(
  targetId: string | null | undefined,
): CanonicalConversationAnchoredSurfacePlacement {
  if (!targetId) {
    return DEFAULT_AGENT_AVATAR_PLACEMENT;
  }
  return getSharedMap()[targetId] || DEFAULT_AGENT_AVATAR_PLACEMENT;
}

export function setAgentAvatarPlacement(
  targetId: string,
  placement: CanonicalConversationAnchoredSurfacePlacement,
): void {
  if (!targetId) {
    return;
  }
  updateSharedMap((prev) => {
    if (prev[targetId] === placement) {
      return prev;
    }
    return { ...prev, [targetId]: placement };
  });
}

export function clearAgentAvatarPlacement(targetId: string): void {
  if (!targetId) {
    return;
  }
  updateSharedMap((prev) => {
    if (!(targetId in prev)) {
      return prev;
    }
    const { [targetId]: _removed, ...rest } = prev;
    return rest;
  });
}

/**
 * React hook returning the current placement for the given target id plus a
 * setter. Placement is persisted per-target to desktop-local storage via the
 * shell service. When `targetId` is null, returns the canonical default and a
 * no-op setter.
 */
export function useAgentAvatarPlacement(
  targetId: string | null | undefined,
): readonly [
  CanonicalConversationAnchoredSurfacePlacement,
  (next: CanonicalConversationAnchoredSurfacePlacement) => void,
] {
  const [placement, setPlacement] = useState<CanonicalConversationAnchoredSurfacePlacement>(
    () => getAgentAvatarPlacement(targetId),
  );

  useEffect(() => {
    setPlacement(getAgentAvatarPlacement(targetId));
    const listener = () => setPlacement(getAgentAvatarPlacement(targetId));
    subscribers.add(listener);
    return () => {
      subscribers.delete(listener);
    };
  }, [targetId]);

  const commit = useCallback(
    (next: CanonicalConversationAnchoredSurfacePlacement) => {
      if (!targetId) {
        return;
      }
      setAgentAvatarPlacement(targetId, next);
    },
    [targetId],
  );

  return [placement, commit] as const;
}
