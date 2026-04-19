import { useEffect, useState } from 'react';

/**
 * Surface-local transient avatar transform store (D-LLM-065).
 *
 * Transform is strictly surface-local cosmetic state, not runtime truth. It must
 * reset deterministically on surface teardown, thread switch, agent switch, or
 * permission loss (D-LLM-057). This module exposes a single renderer-local
 * debug/script channel via `window.__NIMI_CHAT_AVATAR_TRANSFORM__`. The channel
 * is intentionally not a stable public contract; mods / SDK must not depend on
 * it.
 */

export type AvatarTransform = {
  x: number;
  y: number;
  scale: number;
  rotate?: number;
};

export const DEFAULT_AVATAR_TRANSFORM: AvatarTransform = {
  x: 0,
  y: 0,
  scale: 1,
};

export const CHAT_AGENT_AVATAR_TRANSFORM_EVENT = 'nimi:chat-agent-avatar-transform-changed';

type TransformGlobal = Window & typeof globalThis & {
  __NIMI_CHAT_AVATAR_TRANSFORM__?: Partial<AvatarTransform> | null;
};

function getHost(): TransformGlobal | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window as TransformGlobal;
}

function normalizeTransform(value: unknown): AvatarTransform {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_AVATAR_TRANSFORM };
  }
  const record = value as Record<string, unknown>;
  const readNumber = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  const scale = readNumber(record.scale, DEFAULT_AVATAR_TRANSFORM.scale);
  return {
    x: readNumber(record.x, DEFAULT_AVATAR_TRANSFORM.x),
    y: readNumber(record.y, DEFAULT_AVATAR_TRANSFORM.y),
    scale: scale > 0 ? scale : DEFAULT_AVATAR_TRANSFORM.scale,
    ...(typeof record.rotate === 'number' && Number.isFinite(record.rotate)
      ? { rotate: record.rotate }
      : {}),
  };
}

export function readChatAgentAvatarTransform(): AvatarTransform {
  const host = getHost();
  if (!host) {
    return { ...DEFAULT_AVATAR_TRANSFORM };
  }
  return normalizeTransform(host.__NIMI_CHAT_AVATAR_TRANSFORM__);
}

export function applyChatAgentAvatarTransform(next: Partial<AvatarTransform>): void {
  const host = getHost();
  if (!host) {
    return;
  }
  host.__NIMI_CHAT_AVATAR_TRANSFORM__ = normalizeTransform({
    ...readChatAgentAvatarTransform(),
    ...next,
  });
  window.dispatchEvent(new CustomEvent(CHAT_AGENT_AVATAR_TRANSFORM_EVENT));
}

export function resetChatAgentAvatarTransform(): void {
  const host = getHost();
  if (!host) {
    return;
  }
  host.__NIMI_CHAT_AVATAR_TRANSFORM__ = null;
  window.dispatchEvent(new CustomEvent(CHAT_AGENT_AVATAR_TRANSFORM_EVENT));
}

export function formatAvatarTransformCssValue(transform: AvatarTransform): string {
  const translate = `translate3d(${transform.x}px, ${transform.y}px, 0)`;
  const scale = `scale(${transform.scale})`;
  const rotate = typeof transform.rotate === 'number' && transform.rotate !== 0
    ? ` rotate(${transform.rotate}deg)`
    : '';
  return `${translate} ${scale}${rotate}`;
}

/**
 * React hook returning the current avatar transform. Re-renders on transform
 * changes dispatched through `applyChatAgentAvatarTransform` /
 * `resetChatAgentAvatarTransform`.
 */
export function useChatAgentAvatarTransform(): AvatarTransform {
  const [transform, setTransform] = useState<AvatarTransform>(() => readChatAgentAvatarTransform());

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const listener = () => setTransform(readChatAgentAvatarTransform());
    window.addEventListener(CHAT_AGENT_AVATAR_TRANSFORM_EVENT, listener);
    // refresh in case overrides changed before mount
    listener();
    return () => {
      window.removeEventListener(CHAT_AGENT_AVATAR_TRANSFORM_EVENT, listener);
    };
  }, []);

  return transform;
}
