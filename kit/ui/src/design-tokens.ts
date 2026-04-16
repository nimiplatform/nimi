import {
  ACCENT_PACK_IDS,
  DESIGN_PACK_IDS,
  FOUNDATION_SCHEME_IDS,
  TYPOGRAPHY_ROLE_IDS,
} from './generated/tokens.js';

export { cn } from './lib/utils.js';

export type NimiDesignPackId = (typeof DESIGN_PACK_IDS)[number];
export type NimiThemeSchemeId = (typeof FOUNDATION_SCHEME_IDS)[number];
export type NimiAccentPackId = (typeof ACCENT_PACK_IDS)[number];
export type NimiThemeScheme = 'light' | 'dark';
export type NimiAccentPack = 'desktop-accent' | 'forge-accent' | 'relay-accent' | 'overtone-accent' | 'video-food-map-accent' | 'shiji-accent';
export type SurfaceTone = 'canvas' | 'panel' | 'card' | 'hero' | 'overlay';
export type SurfaceElevation = 'base' | 'raised' | 'floating' | 'modal';
export type SurfaceMaterial = 'solid' | 'glass-regular' | 'glass-thick';
export type AmbientVariant = 'mesh' | 'minimal' | 'none';
export type ActionTone = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ActionSize = 'sm' | 'md' | 'lg';
export type OverlayKind = 'dialog' | 'drawer' | 'popover' | 'tooltip';
export type SidebarFamily = 'v1';
export type SidebarItemKind = 'entity-row' | 'category-row' | 'nav-row' | 'action' | 'divider' | 'spacer';
export type SidebarAffordance = 'leading' | 'trailing' | 'badge' | 'expand';
export type FieldTone = 'default' | 'search' | 'quiet';
export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
export type AvatarSize = 'sm' | 'md' | 'lg';
export type AvatarShape = 'circle' | 'rounded';
export type AvatarTone = 'neutral' | 'accent';

export const NIMI_DESIGN_PACK_IDS = DESIGN_PACK_IDS;
export const NIMI_THEME_SCHEME_PACK_IDS = FOUNDATION_SCHEME_IDS;
export const NIMI_THEME_SCHEMES = ['light', 'dark'] as const;
export const NIMI_ACCENT_PACKS = ['desktop-accent', 'forge-accent', 'relay-accent', 'overtone-accent', 'video-food-map-accent', 'shiji-accent'] as const;
export const NIMI_TYPOGRAPHY_ROLE_IDS = TYPOGRAPHY_ROLE_IDS;
