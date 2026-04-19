import type { CSSProperties } from 'react';
import type { ConversationPresenceTheme } from '../types.js';

export function toSafeBackgroundImage(rawUrl: string | null | undefined): string | null {
  const normalized = String(rawUrl || '').trim();
  if (!normalized) {
    return null;
  }
  try {
    const baseUrl =
      typeof window !== 'undefined' && typeof window.location?.href === 'string'
        ? window.location.href
        : 'https://nimi.invalid';
    const parsed = new URL(normalized, baseUrl);
    if (!['http:', 'https:', 'file:', 'asset:', 'blob:', 'data:'].includes(parsed.protocol)) {
      return null;
    }
    return `url(${JSON.stringify(parsed.toString())})`;
  } catch {
    return null;
  }
}

export function resolveConversationThemeBackgroundStyle(input: {
  theme?: ConversationPresenceTheme | null;
  fallbackBackground: string;
  overlay?: string;
}): CSSProperties {
  const safeBackgroundImage = toSafeBackgroundImage(input.theme?.appBackdropImageUrl || null);
  if (safeBackgroundImage) {
    return {
      backgroundImage: `${input.overlay || 'linear-gradient(180deg, rgba(255,255,255,0.78), rgba(255,255,255,0.88))'}, ${safeBackgroundImage}`,
      backgroundSize: 'cover',
      backgroundPosition: 'center bottom',
      backgroundRepeat: 'no-repeat',
    };
  }
  return {
    background: input.theme?.roomAura || input.fallbackBackground,
  };
}
