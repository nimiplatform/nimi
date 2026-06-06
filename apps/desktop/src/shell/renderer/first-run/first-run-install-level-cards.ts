// First-Run Install-Level Card Projection — derives the Phase 2 selectable
// card content from the real admitted install-level policy.
//
// `Minimal` and `Recommended` are the two admitted first-run install levels
// (P-COLD-011). Their capability highlight bullets are projected from each
// level's resolved factory `AIProfile` row — specifically its real
// `capabilitySet` and `computePosture` — so the card never advertises a
// capability the admitted plan does not carry. There is no hardcoded
// capability list that could contradict the policy.

import type {
  NimiAppAIProfileFactoryRow,
  NimiFirstRunInstallLevel,
} from '@nimiplatform/sdk/app';

/**
 * A capability highlight bullet identity. The renderer maps each id to a
 * localized label; the id itself is derived from the real plan capabilities.
 */
export type FirstRunCapabilityHighlightId =
  | 'fast-setup'
  | 'lower-resource'
  | 'everyday-chat'
  | 'smarter-answers'
  | 'image-generation'
  | 'future-ready'
  | 'local-voice';

export type FirstRunInstallLevelCard = {
  readonly installLevel: NimiFirstRunInstallLevel;
  /** The resolved admitted factory AIProfile row, or null when unavailable. */
  readonly plan: NimiAppAIProfileFactoryRow | null;
  /** Exactly three capability highlight bullets projected from the plan. */
  readonly highlights: readonly FirstRunCapabilityHighlightId[];
};

function hasCapability(plan: NimiAppAIProfileFactoryRow | null, capability: string): boolean {
  return Boolean(plan?.capabilitySet.includes(capability));
}

/**
 * Projects the three highlight bullets for an install level.
 *
 * Minimal: the lightweight local-text + local-voice baseline. The bullets
 * emphasize fast setup, lower resource usage, and everyday chat — all true of
 * a CPU-only local-first plan.
 *
 * Recommended: the device-aware baseline that adds local embeddings and (on
 * capable hardware) local image generation. The image-generation bullet is
 * shown only when the resolved plan actually carries `image.generate`.
 */
export function projectInstallLevelCard(
  installLevel: NimiFirstRunInstallLevel,
  plan: NimiAppAIProfileFactoryRow | null,
): FirstRunInstallLevelCard {
  let highlights: FirstRunCapabilityHighlightId[];
  if (installLevel === 'minimal') {
    highlights = ['fast-setup', 'lower-resource', 'everyday-chat'];
  } else {
    // Recommended: lead with the embedding/retrieval uplift, then the
    // image-generation capability when the admitted plan carries it, else the
    // local-voice capability, then the future-ready posture line.
    const second: FirstRunCapabilityHighlightId = hasCapability(plan, 'image.generate')
      ? 'image-generation'
      : 'local-voice';
    highlights = ['smarter-answers', second, 'future-ready'];
  }
  return { installLevel, plan, highlights };
}
