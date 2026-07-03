import type { CSSProperties } from 'react';

type ExplorerStyle = CSSProperties & Record<`--${string}`, string>;

export const WORLD_EXPLORER_COLORS = {
  background: '#F6F8FB',
  surface: '#FFFFFF',
  weakSurface: '#F8FAFC',
  brand: '#24C6A4',
  brandHover: '#1DB393',
  brandSoft: '#EAFBF6',
  text: '#17202A',
  textSecondary: '#6B7280',
  textMuted: '#9AA4B2',
  border: '#E5EAF0',
  favorite: '#E95C5C',
} as const;

export const WORLD_EXPLORER_SHADOWS = {
  card: '0 8px 24px rgba(20, 35, 50, 0.04)',
  cardHover: '0 14px 30px rgba(20, 35, 50, 0.07)',
  selected: '0 12px 30px rgba(36, 198, 164, 0.14)',
  panel: '0 18px 44px rgba(20, 35, 50, 0.08)',
  nav: '0 8px 22px rgba(20, 35, 50, 0.04)',
  button: '0 12px 24px rgba(36, 198, 164, 0.22)',
  icon: '0 6px 16px rgba(20, 35, 50, 0.06)',
} as const;

export const WORLD_ABSTRACT_COVER_BACKGROUNDS = {
  history:
    'radial-gradient(circle at 20% 18%, rgba(93, 120, 113, 0.22), transparent 28%), linear-gradient(135deg, #E9EEE9 0%, #F6F2E8 48%, #DDE7E4 100%)',
  sciFi:
    'radial-gradient(circle at 70% 28%, rgba(36, 198, 164, 0.28), transparent 27%), radial-gradient(circle at 26% 74%, rgba(80, 104, 132, 0.22), transparent 28%), linear-gradient(135deg, #EEF4F8 0%, #F8FAFC 58%, #E8F5F2 100%)',
  sandbox:
    'linear-gradient(135deg, rgba(36, 198, 164, 0.16), transparent 38%), linear-gradient(45deg, #F8FAFC 0 24%, #EEF3F0 24% 48%, #F6F8FB 48% 72%, #EAFBF6 72% 100%)',
  nature:
    'radial-gradient(circle at 28% 70%, rgba(36, 198, 164, 0.24), transparent 30%), linear-gradient(135deg, #EEF6EF 0%, #F8FAF7 50%, #DDEBE4 100%)',
  fantasy:
    'radial-gradient(circle at 72% 20%, rgba(36, 198, 164, 0.22), transparent 30%), linear-gradient(135deg, #F3F6F2 0%, #F8FAFC 50%, #E8EFEA 100%)',
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
      'linear-gradient(135deg, #F7FAF8 0%, #F6F8FB 58%, #FBF9FD 100%)',
  } satisfies CSSProperties,
  nav: {
    background: WORLD_EXPLORER_COLORS.surface,
    border: `1px solid ${WORLD_EXPLORER_COLORS.border}`,
    boxShadow: WORLD_EXPLORER_SHADOWS.nav,
  } satisfies CSSProperties,
  card: {
    background: WORLD_EXPLORER_COLORS.surface,
    border: `1px solid ${WORLD_EXPLORER_COLORS.border}`,
    boxShadow: WORLD_EXPLORER_SHADOWS.card,
  } satisfies CSSProperties,
  selectedCard: {
    background: WORLD_EXPLORER_COLORS.surface,
    border: `1px solid ${WORLD_EXPLORER_COLORS.brand}`,
    boxShadow: WORLD_EXPLORER_SHADOWS.selected,
  } satisfies CSSProperties,
  panel: {
    background: WORLD_EXPLORER_COLORS.surface,
    border: `1px solid ${WORLD_EXPLORER_COLORS.border}`,
    boxShadow: WORLD_EXPLORER_SHADOWS.panel,
  } satisfies CSSProperties,
  weakBlock: {
    background: WORLD_EXPLORER_COLORS.weakSurface,
    border: `1px solid ${WORLD_EXPLORER_COLORS.border}`,
  } satisfies CSSProperties,
  primaryAction: {
    background: WORLD_EXPLORER_COLORS.brand,
    color: WORLD_EXPLORER_COLORS.surface,
    boxShadow: WORLD_EXPLORER_SHADOWS.button,
  } satisfies CSSProperties,
  iconButton: {
    background: WORLD_EXPLORER_COLORS.surface,
    border: `1px solid ${WORLD_EXPLORER_COLORS.border}`,
    boxShadow: WORLD_EXPLORER_SHADOWS.icon,
  } satisfies CSSProperties,
  introClamp: {
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 4,
    overflow: 'hidden',
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
