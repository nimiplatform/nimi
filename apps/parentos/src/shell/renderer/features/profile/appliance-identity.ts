/**
 * Per-appliance visual identity (PO-ORTHO-003a multi-appliance surface).
 *
 * Each `applianceType` carries a stable identity colour used consistently
 * across the orthodontic surface: the hero card's top bar, the name dot, the
 * progress ring stroke, the compact card's left bar, and the case-review
 * agenda dots. Keeping the mapping in one place is what makes "扩弓器 = 蓝色"
 * read the same everywhere a parent looks.
 */
import type { OrthodonticApplianceType } from '../../bridge/sqlite-bridge.js';

export interface ApplianceIdentity {
  /** Saturated identity colour — bar / dot / ring stroke. */
  solid: string;
  /** Soft tint of the same hue — phase-pill background, card glow. */
  tint: string;
  /** Readable text colour on the tint background. */
  tintText: string;
}

const IDENTITY: Record<OrthodonticApplianceType, ApplianceIdentity> = {
  expander: { solid: '#3b82f6', tint: 'rgba(59,130,246,0.12)', tintText: '#1d4ed8' },
  'twin-block': { solid: '#6366f1', tint: 'rgba(99,102,241,0.12)', tintText: '#4338ca' },
  activator: { solid: '#8b5cf6', tint: 'rgba(139,92,246,0.12)', tintText: '#6d28d9' },
  'metal-braces': { solid: '#64748b', tint: 'rgba(100,116,139,0.14)', tintText: '#475569' },
  'ceramic-braces': { solid: '#a98467', tint: 'rgba(169,132,103,0.16)', tintText: '#8a6a52' },
  // Clear-aligner identity = the dashboard sleep-bar indigo (#818CF8). It's
  // the only orthodontic appliance type a parent also sees aggregated on the
  // home dashboard's right-rail "牙套周期" widget, so matching that hue keeps
  // "this is the aligner thing" visually consistent across surfaces.
  'clear-aligner': { solid: '#818CF8', tint: 'rgba(129,140,248,0.14)', tintText: '#4f46e5' },
  'retainer-fixed': { solid: '#06b6d4', tint: 'rgba(6,182,212,0.12)', tintText: '#0e7490' },
  'retainer-removable': { solid: '#ec4899', tint: 'rgba(236,72,153,0.12)', tintText: '#be185d' },
};

export function applianceIdentity(type: OrthodonticApplianceType): ApplianceIdentity {
  return IDENTITY[type];
}
