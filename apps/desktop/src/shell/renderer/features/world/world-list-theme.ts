import type { CSSProperties } from 'react';

type ExplorerStyle = CSSProperties & Record<`--${string}`, string>;

export const WORLD_EXPLORER_COLORS = {
  background: 'var(--nimi-surface-canvas)',
  surface: 'var(--nimi-surface-card)',
  weakSurface: 'var(--nimi-surface-panel)',
  brand: 'var(--nimi-action-primary-bg)',
  brandHover: 'var(--nimi-action-primary-bg-hover)',
  brandSoft: 'color-mix(in srgb, var(--nimi-action-primary-bg) 12%, transparent)',
  text: 'var(--nimi-text-primary)',
  textSecondary: 'var(--nimi-text-secondary)',
  textMuted: 'var(--nimi-text-muted)',
  border: 'var(--nimi-border-subtle)',
  favorite: 'var(--nimi-status-danger)',
} as const;

export const WORLD_EXPLORER_SHADOWS = {
  shell: 'var(--nimi-elevation-floating)',
  card: 'var(--nimi-elevation-base)',
  cardHover: 'var(--nimi-elevation-floating)',
  selected: '0 16px 36px color-mix(in srgb, var(--nimi-action-primary-bg) 16%, transparent)',
  panel: 'var(--nimi-elevation-floating)',
  nav: 'var(--nimi-elevation-base)',
  button: '0 12px 24px color-mix(in srgb, var(--nimi-action-primary-bg) 22%, transparent)',
  icon: 'var(--nimi-elevation-base)',
} as const;

// The one abstract cover for Worlds without a banner; Worlds declare no cover style to choose from.
export const WORLD_NEUTRAL_COVER_BACKGROUND =
  'linear-gradient(135deg, color-mix(in srgb, var(--nimi-action-primary-bg) 16%, transparent), transparent 42%), linear-gradient(45deg, var(--nimi-surface-panel) 0 25%, var(--nimi-surface-card) 25% 50%, var(--nimi-surface-panel) 50% 75%, color-mix(in srgb, var(--nimi-action-primary-bg) 8%, var(--nimi-surface-panel)) 75% 100%)';

export const WORLD_EXPLORER_THEME = {
  root: {
    '--world-explorer-bg': WORLD_EXPLORER_COLORS.background,
    '--world-explorer-surface': WORLD_EXPLORER_COLORS.surface,
    '--world-explorer-surface-weak': WORLD_EXPLORER_COLORS.weakSurface,
    '--world-explorer-brand': WORLD_EXPLORER_COLORS.brand,
    '--world-explorer-brand-hover': WORLD_EXPLORER_COLORS.brandHover,
    '--world-explorer-brand-soft': WORLD_EXPLORER_COLORS.brandSoft,
    '--world-explorer-text': WORLD_EXPLORER_COLORS.text,
    '--world-explorer-text-secondary': WORLD_EXPLORER_COLORS.textSecondary,
    '--world-explorer-text-muted': WORLD_EXPLORER_COLORS.textMuted,
    '--world-explorer-border': WORLD_EXPLORER_COLORS.border,
    '--world-explorer-favorite': WORLD_EXPLORER_COLORS.favorite,
    color: WORLD_EXPLORER_COLORS.text,
  } satisfies ExplorerStyle,
  page: {
    background:
      'radial-gradient(circle at 4% 92%, color-mix(in srgb, var(--nimi-action-primary-bg) 16%, transparent), transparent 34%), radial-gradient(circle at 98% 5%, color-mix(in srgb, var(--nimi-action-primary-bg) 10%, transparent), transparent 31%), var(--nimi-surface-canvas)',
  } satisfies CSSProperties,
  discoveryPanel: {
    boxShadow: WORLD_EXPLORER_SHADOWS.shell,
  } satisfies CSSProperties,
  nav: {
    background: 'color-mix(in srgb, var(--nimi-surface-card) 86%, transparent)',
    border: `1px solid ${WORLD_EXPLORER_COLORS.border}`,
    boxShadow: WORLD_EXPLORER_SHADOWS.nav,
  } satisfies CSSProperties,
  card: {
    background: 'var(--nimi-surface-card)',
    border: `1px solid ${WORLD_EXPLORER_COLORS.border}`,
    boxShadow: WORLD_EXPLORER_SHADOWS.card,
  } satisfies CSSProperties,
  selectedCard: {
    background: 'var(--nimi-surface-card)',
    border: `1px solid ${WORLD_EXPLORER_COLORS.brand}`,
    boxShadow: WORLD_EXPLORER_SHADOWS.selected,
  } satisfies CSSProperties,
  panel: {
    background: 'var(--nimi-surface-card)',
    border: `1px solid ${WORLD_EXPLORER_COLORS.border}`,
    boxShadow: WORLD_EXPLORER_SHADOWS.panel,
  } satisfies CSSProperties,
  weakBlock: {
    background: 'var(--nimi-surface-panel)',
    border: `1px solid ${WORLD_EXPLORER_COLORS.border}`,
  } satisfies CSSProperties,
  primaryAction: {
    boxShadow: WORLD_EXPLORER_SHADOWS.button,
  } satisfies CSSProperties,
  iconButton: {
    background: 'var(--nimi-surface-card)',
    border: `1px solid ${WORLD_EXPLORER_COLORS.border}`,
    boxShadow: WORLD_EXPLORER_SHADOWS.icon,
  } satisfies CSSProperties,
  discoverMore: {
    boxShadow: WORLD_EXPLORER_SHADOWS.card,
  } satisfies CSSProperties,
  featuredOverlay: {
    background:
      'linear-gradient(180deg, transparent 22%, rgba(0, 0, 0, 0.14) 50%, rgba(0, 0, 0, 0.42) 100%)',
  } satisfies CSSProperties,
  coverOverlay: {
    background:
      'linear-gradient(180deg, rgba(0, 0, 0, 0.04) 0%, rgba(0, 0, 0, 0.28) 100%)',
  } satisfies CSSProperties,
} as const;
