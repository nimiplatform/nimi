/**
 * `@nimiplatform/kit/ui/glass`
 *
 * Glass material primitive contract carve-out (wave-b fork F6).
 *
 * Authority: `.nimi/spec/platform/kernel/nimi-ui-material-contract.md`
 * + `kit/ui/AGENTS.md` "Glass Material Consumption (P-DESIGN-022)".
 *
 * Tier taxonomy (5-tier, 2026-04-18 admission):
 *   solid | glass-thin | glass-regular | glass-thick | glass-chrome.
 *
 * Consumption rules (kit/ui/AGENTS.md hard boundary):
 *   - Glass is consumed only via `<Surface material="...">` from
 *     `@nimiplatform/kit/ui` or the 5-tier marker class names
 *     emitted by `surfaceVariants` (`nimi-material-glass-thin` etc.).
 *   - No inline `rgba(...)` material fills, no inline
 *     `backdrop-filter`, no hand-picked `backdrop-blur-[Npx]` arbitrary
 *     values outside kit-emitted surfaces.
 *   - Adding a 6th tier requires a new admission (not pre-authorized).
 *
 * This sub-module re-publishes the typed glass primitive contract
 * (tier union, transparency union, the transparency-driven downgrade
 * helper) so external consumers and internal kit code can reference
 * the glass contract without pulling the full `Surface` component
 * surface. The Surface component itself remains the only React
 * primitive that emits glass class names; this module is data + types
 * only.
 *
 * a11y note: glass tiers preserve readable contrast pairs via
 * theme tokens (`--nimi-material-glass-*-bg` / `-border`); reduced
 * transparency mode (`Surface transparency="reduced"`) downgrades
 * by one tier and `transparency="solid"` forces opaque. See
 * `downgradeSurfaceMaterial` below.
 */

export {
  SURFACE_MATERIAL_TIERS,
  SURFACE_MATERIAL_TRANSPARENCY_MODES,
  isGlassMaterial,
  downgradeSurfaceMaterial,
} from './material.js';
export type {
  SurfaceMaterial,
  SurfaceMaterialTransparency,
  GlassMaterialTier,
} from './material.js';
