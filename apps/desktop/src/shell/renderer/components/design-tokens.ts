export type SurfaceTone = 'canvas' | 'panel' | 'card' | 'hero' | 'overlay';
export type SurfaceElevation = 'base' | 'raised' | 'floating' | 'modal';
export type ActionTone = 'primary' | 'secondary' | 'ghost';
export type OverlayKind = 'dialog' | 'drawer' | 'popover' | 'tooltip';

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

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}
