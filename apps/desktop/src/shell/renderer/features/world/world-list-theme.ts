import type { CSSProperties } from 'react';

type ExplorerStyle = CSSProperties & Record<`--${string}`, string>;

export const WORLD_EXPLORER_COLORS = {
  background: '#F6F8FB',
  surface: '#FFFFFF',
  weakSurface: '#F8FAFC',
  brand: 'var(--nimi-action-primary-bg)',
  brandHover: 'var(--nimi-action-primary-bg-hover)',
  brandSoft: 'color-mix(in srgb, var(--nimi-action-primary-bg) 12%, transparent)',
  text: '#17202A',
  textSecondary: '#6B7280',
  textMuted: '#9AA4B2',
  border: '#E5EAF0',
  favorite: '#E95C5C',
} as const;

export const WORLD_EXPLORER_SHADOWS = {
  shell: '0 26px 70px rgba(20, 35, 50, 0.08)',
  card: '0 12px 28px rgba(20, 35, 50, 0.05)',
  cardHover: '0 16px 34px rgba(20, 35, 50, 0.08)',
  selected: '0 16px 36px color-mix(in srgb, var(--nimi-action-primary-bg) 16%, transparent)',
  panel: '0 22px 52px rgba(20, 35, 50, 0.09)',
  nav: '0 10px 28px rgba(20, 35, 50, 0.045)',
  button: '0 12px 24px color-mix(in srgb, var(--nimi-action-primary-bg) 22%, transparent)',
  icon: '0 6px 16px rgba(20, 35, 50, 0.06)',
} as const;

export const WORLD_ABSTRACT_COVER_BACKGROUNDS = {
  history:
    'radial-gradient(circle at 20% 18%, rgba(93, 120, 113, 0.22), transparent 28%), linear-gradient(135deg, #E9EDEF 0%, #F6F2E8 48%, #DDE4E7 100%)',
  sciFi:
    'radial-gradient(circle at 70% 28%, color-mix(in srgb, var(--nimi-action-primary-bg) 28%, transparent), transparent 27%), radial-gradient(circle at 26% 74%, rgba(80, 104, 132, 0.22), transparent 28%), linear-gradient(135deg, #EEF4F8 0%, #F8FAFC 58%, #E8F2F5 100%)',
  sandbox:
    'linear-gradient(135deg, color-mix(in srgb, var(--nimi-action-primary-bg) 16%, transparent), transparent 38%), linear-gradient(45deg, #F8FAFC 0 24%, #EEF2F5 24% 48%, #F6F8FB 48% 72%, #EAF6FB 72% 100%)',
  nature:
    'radial-gradient(circle at 28% 70%, color-mix(in srgb, var(--nimi-action-primary-bg) 24%, transparent), transparent 30%), linear-gradient(135deg, #EEF4F6 0%, #F8FAF7 50%, #DDE7EB 100%)',
  fantasy:
    'radial-gradient(circle at 72% 20%, color-mix(in srgb, var(--nimi-action-primary-bg) 22%, transparent), transparent 30%), linear-gradient(135deg, #F3F6F8 0%, #F8FAFC 50%, #E8EEF0 100%)',
} as const;

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
      'radial-gradient(circle at 4% 92%, color-mix(in srgb, var(--nimi-action-primary-bg) 20%, transparent), transparent 34%), radial-gradient(circle at 98% 5%, rgba(221, 214, 254, 0.22), transparent 31%), linear-gradient(135deg, #F7F9FB 0%, #F6F8FB 58%, #FBF9FD 100%)',
  } satisfies CSSProperties,
  discoveryPanel: {
    boxShadow: WORLD_EXPLORER_SHADOWS.shell,
  } satisfies CSSProperties,
  nav: {
    background: 'rgba(255, 255, 255, 0.72)',
    border: '1px solid rgba(255, 255, 255, 0.82)',
    boxShadow: WORLD_EXPLORER_SHADOWS.nav,
  } satisfies CSSProperties,
  card: {
    background: 'rgba(255, 255, 255, 0.82)',
    border: '1px solid rgba(255, 255, 255, 0.78)',
    boxShadow: WORLD_EXPLORER_SHADOWS.card,
  } satisfies CSSProperties,
  selectedCard: {
    background: 'rgba(255, 255, 255, 0.88)',
    border: `1px solid ${WORLD_EXPLORER_COLORS.brand}`,
    boxShadow: WORLD_EXPLORER_SHADOWS.selected,
  } satisfies CSSProperties,
  panel: {
    background: 'rgba(255, 255, 255, 0.82)',
    border: '1px solid rgba(255, 255, 255, 0.78)',
    boxShadow: WORLD_EXPLORER_SHADOWS.panel,
  } satisfies CSSProperties,
  weakBlock: {
    background: 'rgba(248, 250, 252, 0.72)',
    border: `1px solid ${WORLD_EXPLORER_COLORS.border}`,
  } satisfies CSSProperties,
  primaryAction: {
    boxShadow: WORLD_EXPLORER_SHADOWS.button,
  } satisfies CSSProperties,
  iconButton: {
    background: 'rgba(255, 255, 255, 0.86)',
    border: `1px solid ${WORLD_EXPLORER_COLORS.border}`,
    boxShadow: WORLD_EXPLORER_SHADOWS.icon,
  } satisfies CSSProperties,
  discoverMore: {
    boxShadow: '0 10px 24px rgba(20, 35, 50, 0.04)',
  } satisfies CSSProperties,
  featuredOverlay: {
    background:
      'linear-gradient(180deg, transparent 22%, rgba(23, 32, 42, 0.10) 50%, rgba(23, 32, 42, 0.34) 100%)',
  } satisfies CSSProperties,
  coverOverlay: {
    background:
      'linear-gradient(180deg, rgba(23, 32, 42, 0.04) 0%, rgba(23, 32, 42, 0.24) 100%)',
  } satisfies CSSProperties,
} as const;
