import {
  ACCENT_PACK_IDS,
  DESIGN_PACK_IDS,
  FOUNDATION_SCHEME_IDS,
  TOKEN_CATEGORY_GROUPS,
  TOKEN_DEFINITIONS,
  TYPOGRAPHY_ROLE_IDS,
} from './generated/tokens.js';
import {
  ACTION_SIZE_CLASS,
  ACTION_SLOT_CLASS,
  ACTION_TONE_CLASS,
  FIELD_SLOT_CLASS,
  FIELD_TONE_CLASS,
  OVERLAY_BACKDROP_CLASS,
  OVERLAY_PANEL_CLASS,
  OVERLAY_SLOT_CLASS,
  PRIMITIVE_CONTRACT,
  SIDEBAR_AFFORDANCE_CLASS,
  SIDEBAR_FAMILY_CLASS,
  SIDEBAR_ITEM_KIND_CLASS,
  SIDEBAR_SLOT_CLASS,
  STATUS_TONE_CLASS,
  SURFACE_ELEVATION_CLASS,
  SURFACE_TONE_CLASS,
  TYPOGRAPHY_TOKEN_CLASS,
  type GeneratedActionSize,
  type GeneratedActionTone,
  type GeneratedFieldTone,
  type GeneratedOverlayKind,
  type GeneratedSidebarAffordance,
  type GeneratedSidebarFamily,
  type GeneratedSidebarItemKind,
  type GeneratedStatusTone,
  type GeneratedSurfaceElevation,
  type GeneratedSurfaceTone,
  type GeneratedTypographyToken,
} from './generated/primitive-contract.js';

export type NimiDesignPackId = (typeof DESIGN_PACK_IDS)[number];
export type NimiThemeSchemeId = (typeof FOUNDATION_SCHEME_IDS)[number];
export type NimiAccentPackId = (typeof ACCENT_PACK_IDS)[number];
export type NimiThemeScheme = 'light' | 'dark';
export type NimiAccentPack = 'desktop-accent' | 'forge-accent' | 'relay-accent' | 'overtone-accent';
export type SurfaceTone = GeneratedSurfaceTone;
export type SurfaceElevation = GeneratedSurfaceElevation;
export type ActionTone = GeneratedActionTone;
export type ActionSize = GeneratedActionSize;
export type OverlayKind = GeneratedOverlayKind | 'tooltip';
export type SidebarFamily = GeneratedSidebarFamily;
export type SidebarItemKind = GeneratedSidebarItemKind;
export type SidebarAffordance = GeneratedSidebarAffordance;
export type FieldTone = GeneratedFieldTone;
export type StatusTone = GeneratedStatusTone;
export type TypographyToken = GeneratedTypographyToken;
export type SpacingToken = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | '12' | 'section' | 'stack';
export type StrokeToken = 'subtle' | 'strong';
export type SizingToken =
  | 'actionSmHeight'
  | 'actionMdHeight'
  | 'actionLgHeight'
  | 'fieldMdHeight'
  | 'fieldLgHeight'
  | 'textareaMinHeight'
  | 'sidebarItemHeight'
  | 'iconSm'
  | 'iconMd'
  | 'iconLg'
  | 'avatarSm'
  | 'avatarMd'
  | 'avatarLg';

export const DESIGN_TOKEN_DEFINITIONS = TOKEN_DEFINITIONS;
export const NIMI_DESIGN_PACK_IDS = DESIGN_PACK_IDS;
export const NIMI_THEME_SCHEME_PACK_IDS = FOUNDATION_SCHEME_IDS;
export const NIMI_THEME_SCHEMES = ['light', 'dark'] as const;
export const NIMI_ACCENT_PACKS = ['desktop-accent', 'forge-accent', 'relay-accent', 'overtone-accent'] as const;
export const NIMI_PRIMITIVE_CONTRACT = PRIMITIVE_CONTRACT;
export const NIMI_TOKEN_CATEGORY_GROUPS = TOKEN_CATEGORY_GROUPS;
export const NIMI_TYPOGRAPHY_ROLE_IDS = TYPOGRAPHY_ROLE_IDS;

export {
  ACTION_SIZE_CLASS,
  ACTION_SLOT_CLASS,
  ACTION_TONE_CLASS,
  FIELD_SLOT_CLASS,
  FIELD_TONE_CLASS,
  OVERLAY_BACKDROP_CLASS,
  OVERLAY_PANEL_CLASS,
  OVERLAY_SLOT_CLASS,
  SIDEBAR_AFFORDANCE_CLASS,
  SIDEBAR_FAMILY_CLASS,
  SIDEBAR_ITEM_KIND_CLASS,
  SIDEBAR_SLOT_CLASS,
  STATUS_TONE_CLASS,
  SURFACE_ELEVATION_CLASS,
  SURFACE_TONE_CLASS,
  TYPOGRAPHY_TOKEN_CLASS,
};

export const SPACING_TOKEN_VALUE: Record<SpacingToken, string> = {
  '0': 'var(--nimi-space-0)',
  '1': 'var(--nimi-space-1)',
  '2': 'var(--nimi-space-2)',
  '3': 'var(--nimi-space-3)',
  '4': 'var(--nimi-space-4)',
  '5': 'var(--nimi-space-5)',
  '6': 'var(--nimi-space-6)',
  '7': 'var(--nimi-space-7)',
  '8': 'var(--nimi-space-8)',
  '9': 'var(--nimi-space-9)',
  '10': 'var(--nimi-space-10)',
  '12': 'var(--nimi-space-12)',
  section: 'var(--nimi-space-section)',
  stack: 'var(--nimi-space-stack)',
};

export const STROKE_TOKEN_VALUE: Record<StrokeToken, string> = {
  subtle: 'var(--nimi-border-subtle)',
  strong: 'var(--nimi-border-strong)',
};

export const SIZING_TOKEN_VALUE: Record<SizingToken, string> = {
  actionSmHeight: 'var(--nimi-sizing-action-sm-height)',
  actionMdHeight: 'var(--nimi-sizing-action-md-height)',
  actionLgHeight: 'var(--nimi-sizing-action-lg-height)',
  fieldMdHeight: 'var(--nimi-sizing-field-md-height)',
  fieldLgHeight: 'var(--nimi-sizing-field-lg-height)',
  textareaMinHeight: 'var(--nimi-sizing-textarea-min-height)',
  sidebarItemHeight: 'var(--nimi-sizing-sidebar-item-height)',
  iconSm: 'var(--nimi-sizing-icon-sm)',
  iconMd: 'var(--nimi-sizing-icon-md)',
  iconLg: 'var(--nimi-sizing-icon-lg)',
  avatarSm: 'var(--nimi-sizing-avatar-sm)',
  avatarMd: 'var(--nimi-sizing-avatar-md)',
  avatarLg: 'var(--nimi-sizing-avatar-lg)',
};

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

export function resolveNimiThemeClassName(scheme: NimiThemeScheme, accentPack: NimiAccentPack) {
  return cx('nimi-theme-root', `nimi-theme--${scheme}`, `nimi-theme-accent--${accentPack}`);
}
