import type { CSSProperties, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * Deterministic identity tile: every model family, cloud service or runtime
 * component gets the same hue and monogram every time it is shown, without
 * any brand artwork. FNV-1a over the seed picks the hue; the palette stays in
 * the theme's mid range so the tile reads in light and dark surfaces alike.
 */
const SIZE_CLASS = Object.freeze({
  xs: 'size-6 rounded-md text-[11px]',
  sm: 'size-8 rounded-lg text-xs',
  md: 'size-10 rounded-xl text-sm',
  lg: 'size-12 rounded-2xl text-base',
} as const);

export type IdentityTileSize = keyof typeof SIZE_CLASS;

export function identityHue(seed: string): number {
  let hash = 2166136261;
  const normalized = seed.trim().toLowerCase();
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 360;
}

export function identityMonogram(label: string): string {
  const words = label
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/u)
    .filter(Boolean);
  if (words.length === 0) return '·';
  const first = words[0]!;
  if (/^[\p{Script=Han}]/u.test(first)) return first.slice(0, 1);
  if (words.length === 1) return first.slice(0, 2).toUpperCase();
  return `${first.slice(0, 1)}${words[1]!.slice(0, 1)}`.toUpperCase();
}

export function identityTileStyle(seed: string): CSSProperties {
  const hue = identityHue(seed);
  return {
    background: `hsl(${hue} 60% 50% / 0.16)`,
    color: `hsl(${hue} 55% 38%)`,
    boxShadow: `inset 0 0 0 1px hsl(${hue} 50% 50% / 0.18)`,
  };
}

export function IdentityTile({
  seed,
  label,
  size = 'md',
  icon: Icon,
  className = '',
  children,
}: {
  /** Stable identity used for the hue (provider id, model family, component family). */
  readonly seed: string;
  /** Human label used for the monogram. */
  readonly label: string;
  readonly size?: IdentityTileSize;
  /** Optional glyph shown instead of the monogram. */
  readonly icon?: LucideIcon;
  readonly className?: string;
  readonly children?: ReactNode;
}) {
  const iconSize = size === 'xs' ? 13 : size === 'sm' ? 15 : size === 'md' ? 18 : 22;
  return (
    <span
      aria-hidden="true"
      className={`relative inline-flex shrink-0 select-none items-center justify-center font-semibold tracking-tight ${SIZE_CLASS[size]} ${className}`}
      style={identityTileStyle(seed)}
    >
      {Icon ? <Icon size={iconSize} strokeWidth={1.8} /> : identityMonogram(label)}
      {children}
    </span>
  );
}
