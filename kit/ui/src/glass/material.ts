// @nimi-authority: definition.nimi.platform.ui-design-system.ui-material
// @nimi-authority: rule.nimi.platform.ui-design-system.p-design-022a
// @nimi-authority: rule.nimi.platform.ui-design-system.p-design-022c
/**
 * Glass material taxonomy primitive (5-tier admitted, 2026-04-18).
 *
 * Authority: `.nimi/spec/platform/ui-design-system.authority.yaml`.
 * Generator parallel: kit/ui/src/design-tokens.ts re-exports
 * `SurfaceMaterial` / `SurfaceMaterialTransparency` from this file so
 * that the public `kit/ui` barrel and the carved-out `kit/ui/glass`
 * sub-module share one source of truth (no parallel tier authority).
 *
 * Wave-b carve-out (fork F6): the typed glass primitive contract +
 * transparency-driven downgrade helper live here, not in
 * `components/surface.tsx`. The Surface component still owns the
 * React rendering of glass marker classes (the only admitted
 * rendering path per kit/ui/AGENTS.md) and imports the helper from
 * here.
 */

export type GlassMaterialTier =
  | 'glass-thin'
  | 'glass-regular'
  | 'glass-thick'
  | 'glass-chrome';

export type SurfaceMaterial = 'solid' | GlassMaterialTier;
export type SurfaceMaterialTransparency = 'default' | 'reduced' | 'solid';

export const SURFACE_MATERIAL_TIERS: readonly SurfaceMaterial[] = [
  'solid',
  'glass-thin',
  'glass-regular',
  'glass-thick',
  'glass-chrome',
] as const;

export const SURFACE_MATERIAL_TRANSPARENCY_MODES: readonly SurfaceMaterialTransparency[] = [
  'default',
  'reduced',
  'solid',
] as const;

export function isGlassMaterial(material: SurfaceMaterial): material is GlassMaterialTier {
  return material !== 'solid';
}

/**
 * Resolve the rendered material tier under a transparency mode.
 *
 * - `transparency='solid'` forces opaque (`'solid'`) regardless of
 *   requested tier (used by reduced-transparency a11y opt-in /
 *   prefers-reduced-transparency media query).
 * - `transparency='reduced'` downgrades glass by one tier
 *   (chrome→thick, thick→regular, regular→thin); thin / solid pass
 *   through.
 * - `transparency='default'` returns the requested material verbatim.
 */
export function downgradeSurfaceMaterial(
  material: SurfaceMaterial,
  transparency: SurfaceMaterialTransparency = 'default',
): SurfaceMaterial {
  if (transparency === 'solid') return 'solid';
  if (transparency !== 'reduced') return material;
  if (material === 'glass-chrome') return 'glass-thick';
  if (material === 'glass-thick') return 'glass-regular';
  if (material === 'glass-regular') return 'glass-thin';
  return material;
}
