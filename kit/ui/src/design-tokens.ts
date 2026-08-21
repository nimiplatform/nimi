import {
  ACCENT_PACK_IDS,
  DESIGN_PACK_IDS,
  FOUNDATION_SCHEME_IDS,
  TYPOGRAPHY_ROLE_IDS,
} from './generated/tokens.js';

export { cn } from './lib/utils.js';

// Glass primitive types live in `kit/ui/src/glass/material.ts` (wave-b
// fork F6 carve-out). Re-exported here so the `kit/ui` barrel keeps
// the same public surface (single source of truth, no duplication).
export type { SurfaceMaterial, SurfaceMaterialTransparency } from './glass/material.js';

// @nimi-authority: definition.nimi.platform.ui-design-system.theme-system
// @nimi-authority: rule.nimi.platform.ui-design-system.p-design-003
// @nimi-authority: rule.nimi.platform.ui-design-system.p-design-024a
export type NimiDesignPackId = (typeof DESIGN_PACK_IDS)[number];
export type NimiThemeSchemeId = (typeof FOUNDATION_SCHEME_IDS)[number];
export type NimiAccentPackId = (typeof ACCENT_PACK_IDS)[number];
export type NimiThemeScheme = 'light' | 'dark';
export type NimiAccentPack = NimiAccentPackId;
export type SurfaceTone = 'canvas' | 'panel' | 'card' | 'hero' | 'overlay';
export type SurfaceElevation = 'base' | 'raised' | 'floating' | 'modal';
export type AmbientVariant = 'mesh' | 'minimal' | 'none';
export type ActionTone = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ActionSize = 'sm' | 'md' | 'lg';
export type OverlayKind = 'dialog' | 'drawer' | 'popover' | 'tooltip';
export type SidebarFamily = 'v1';
export type SidebarItemKind = 'entity-row' | 'category-row' | 'nav-row';
export type SidebarAffordance = 'badge' | 'status-dot' | 'chevron' | 'count';
export type FieldTone = 'default' | 'search' | 'quiet' | 'danger';
export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
export type StatusBadgeShape = 'soft' | 'outline' | 'dot';
export type AvatarSize = 'sm' | 'md' | 'lg';
export type AvatarShape = 'circle' | 'rounded';
export type AvatarTone = 'neutral' | 'accent';
export type TypographyRole =
  | 'page-title'
  | 'section-title'
  | 'card-title'
  | 'hero-title'
  | 'body'
  | 'helper'
  | 'label'
  | 'caption'
  | 'overline';
export type NimiDensity = 'compact' | 'regular' | 'expressive';
export type FeedbackTone = StatusTone;

export const NIMI_DESIGN_PACK_IDS = DESIGN_PACK_IDS;
export const NIMI_THEME_SCHEME_PACK_IDS = FOUNDATION_SCHEME_IDS;
export const NIMI_THEME_SCHEMES = ['light', 'dark'] as const;
export const NIMI_ACCENT_PACKS = ACCENT_PACK_IDS;
export const NIMI_TYPOGRAPHY_ROLE_IDS = TYPOGRAPHY_ROLE_IDS;
