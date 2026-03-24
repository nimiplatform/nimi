export type SurfaceTone = 'canvas' | 'panel' | 'card' | 'hero' | 'overlay';
export type SurfaceElevation = 'base' | 'raised' | 'floating' | 'modal';
export type ActionTone = 'primary' | 'secondary' | 'ghost';
export type OverlayKind = 'dialog' | 'drawer' | 'popover' | 'tooltip';
export type TypographyToken = 'pageTitle' | 'sectionTitle';
export type SpacingToken = 'section' | 'stack';
export type StrokeToken = 'subtle' | 'strong';
export type StateTone = 'selected' | 'danger';

export const SURFACE_TONE_CLASS: Record<SurfaceTone, string> = {
  canvas: 'nimi-surface--canvas',
  panel: 'nimi-surface--panel',
  card: 'nimi-surface--card',
  hero: 'nimi-surface--hero',
  overlay: 'nimi-surface--overlay',
};

export const SURFACE_ELEVATION_CLASS: Record<SurfaceElevation, string> = {
  base: 'nimi-surface--elevation-base',
  raised: 'nimi-surface--elevation-raised',
  floating: 'nimi-surface--elevation-floating',
  modal: 'nimi-surface--elevation-modal',
};

export const ACTION_TONE_CLASS: Record<ActionTone, string> = {
  primary: 'nimi-action--primary',
  secondary: 'nimi-action--secondary',
  ghost: 'nimi-action--ghost',
};

export const OVERLAY_PANEL_CLASS: Record<Exclude<OverlayKind, 'tooltip'>, string> = {
  dialog: 'nimi-overlay-panel--dialog',
  drawer: 'nimi-overlay-panel--drawer',
  popover: 'nimi-overlay-panel--popover',
};

export const OVERLAY_BACKDROP_CLASS: Record<Exclude<OverlayKind, 'tooltip'>, string> = {
  dialog: 'nimi-overlay-backdrop--dialog',
  drawer: 'nimi-overlay-backdrop--drawer',
  popover: 'nimi-overlay-backdrop--popover',
};

export const TYPOGRAPHY_TOKEN_CLASS: Record<TypographyToken, string> = {
  pageTitle: 'nimi-type--page-title',
  sectionTitle: 'nimi-type--section-title',
};

export const SPACING_TOKEN_VALUE: Record<SpacingToken, string> = {
  section: 'var(--nimi-space-section)',
  stack: 'var(--nimi-space-stack)',
};

export const STROKE_TOKEN_VALUE: Record<StrokeToken, string> = {
  subtle: 'var(--nimi-border-subtle)',
  strong: 'var(--nimi-border-strong)',
};

export const STATE_TONE_CLASS: Record<StateTone, string> = {
  selected: 'nimi-state--selected',
  danger: 'nimi-state--danger',
};

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}
