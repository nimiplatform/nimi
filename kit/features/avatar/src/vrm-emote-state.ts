// Kit-owned VRM emote state machine. Translates emotion ontology ids (loaded as a
// pre-parsed recipe table from vrm-emote-states.yaml) into VRM expression
// preset weight bundles, easing each expression from its weight at blend
// start toward the bundle target over blendDurationSec of accumulated time,
// and coordinating with the lipsync driver: when lipsyncActive=true the
// viseme expression presets (aa/ih/ou/ee/oh) are NOT flushed this frame -
// the lipsync driver owns viseme writes during active speech.
//
// Construction enforces the primary-weight cap (<= 0.8 per emote bundle),
// as declared by `.nimi/spec/avatar/kernel/tables/vrm-emote-states.yaml`.
//
// expressionManager.setValue is wrapped safely: when a model lacks a
// referenced preset, the call may throw - we catch + skip silently
// (partial degrade is allowed per vrm-emote-states.yaml constraint #3).

/** Viseme expression preset names that are owned by the lipsync driver
 *  during active speech. The five-name set is fixed by the VRM backend
 *  contract; S projects to I but is not a VRM-side viseme preset name. */
export const VISEME_NAMES: ReadonlySet<string> = new Set([
  'aa',
  'ih',
  'ou',
  'ee',
  'oh',
]);

/** Cap on the primary (highest-weight) expression of any emote bundle.
 *  Avoids the "smiles too much" effect (lineage: airi useVRMEmote 0.8
 *  cap). Enforced at construction; mutations must also respect this. */
export const PRIMARY_EXPRESSION_WEIGHT_CAP = 0.8;

/** Default decay duration for one-shot transient expression overlays
 *  applied via applyTransientExpression when the caller does not supply
 *  an explicit fade duration (seconds). */
export const DEFAULT_TRANSIENT_FADE_SEC = 0.4;

export type VrmEmoteBundle = {
  blendDurationSec: number;
  expressions: Array<{ name: string; weight: number }>;
};

export type VrmEmoteTable = {
  emotes: Record<string, VrmEmoteBundle>;
};

export type VrmEmoteSnapshot = {
  activeEmote: string | null;
  targetWeights: Readonly<Record<string, number>>;
  currentWeights: Readonly<Record<string, number>>;
  lipsyncActive: boolean;
};

export type VrmExpressionWritable = {
  expressionManager?: {
    setValue: (name: string, weight: number) => void;
  } | null;
};

export interface VrmEmoteState {
  setEmote(name: string, options?: { previous?: string | null }): void;
  applyTransientExpression(name: string, weight: number, fade?: number): void;
  setLipsyncActive(active: boolean): void;
  tick(input: { vrm: VrmExpressionWritable; deltaSec: number }): { skippedCount: number };
  reset(input: { vrm: VrmExpressionWritable }): void;
  snapshot(): VrmEmoteSnapshot;
}

export type CreateVrmEmoteStateInputs = {
  emoteTable: VrmEmoteTable;
};

type TransientOverlay = {
  startWeight: number;
  fadeDurationSec: number;
  elapsedSec: number;
};

type BlendEntry = {
  fromWeight: number;
  toWeight: number;
  durationSec: number;
  elapsedSec: number;
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function easeInOutCubic(t: number): number {
  // t in [0, 1]
  if (t < 0.5) return 4 * t * t * t;
  const f = -2 * t + 2;
  return 1 - (f * f * f) / 2;
}

/** The `neutral` expression is the VRM rest pose; it MAY be authored at
 *  weight 1.0 in the canonical neutral bundle (vrm-emote-states.yaml).
 *  The 0.8 primary-cap was authored to prevent expressive presets from
 *  saturating ("smiles too much"), so we exempt the literal `neutral`
 *  preset name from the cap. Every other expressive preset (happy / sad
 *  / angry / surprised / aa / ih / ou / ee / oh / relaxed / ...) is
 *  capped, which preserves the canonical primary-expression cap. */
const PRIMARY_CAP_EXEMPT_PRESETS: ReadonlySet<string> = new Set(['neutral']);

function bundlePrimaryExpressiveWeight(bundle: VrmEmoteBundle): number {
  let max = 0;
  for (const entry of bundle.expressions) {
    if (PRIMARY_CAP_EXEMPT_PRESETS.has(entry.name)) continue;
    if (entry.weight > max) max = entry.weight;
  }
  return max;
}

function validateBundle(name: string, bundle: VrmEmoteBundle): void {
  if (!bundle || !Array.isArray(bundle.expressions) || bundle.expressions.length === 0) {
    throw new Error(`vrm-emote-state: emote "${name}" has no expressions`);
  }
  if (typeof bundle.blendDurationSec !== 'number' || bundle.blendDurationSec <= 0) {
    throw new Error(
      `vrm-emote-state: emote "${name}" has invalid blendDurationSec ${bundle.blendDurationSec}`,
    );
  }
  for (const entry of bundle.expressions) {
    if (typeof entry.name !== 'string' || entry.name.length === 0) {
      throw new Error(`vrm-emote-state: emote "${name}" has expression with invalid name`);
    }
    if (typeof entry.weight !== 'number' || entry.weight < 0 || entry.weight > 1) {
      throw new Error(
        `vrm-emote-state: emote "${name}" expression "${entry.name}" has weight ${entry.weight} (must be in [0, 1])`,
      );
    }
  }
  const primary = bundlePrimaryExpressiveWeight(bundle);
  if (primary > PRIMARY_EXPRESSION_WEIGHT_CAP) {
    throw new Error(
      `vrm-emote-state: emote "${name}" primary weight ${primary} exceeds cap ${PRIMARY_EXPRESSION_WEIGHT_CAP}`,
    );
  }
}

export function createVrmEmoteState(input: CreateVrmEmoteStateInputs): VrmEmoteState {
  const { emoteTable } = input;
  if (!emoteTable || typeof emoteTable.emotes !== 'object' || emoteTable.emotes === null) {
    throw new Error('vrm-emote-state: emoteTable.emotes is missing');
  }

  // Validate every bundle at construction (fail-close on cap violation).
  for (const [name, bundle] of Object.entries(emoteTable.emotes)) {
    validateBundle(name, bundle);
  }

  const targetWeights = new Map<string, number>();
  const currentWeights = new Map<string, number>();
  // In-flight time-based blends; entries retire once elapsed >= duration.
  const blends = new Map<string, BlendEntry>();
  const transients = new Map<string, TransientOverlay>();

  let activeEmote: string | null = null;
  let lipsyncActive = false;

  function startBlend(name: string, toWeight: number, durationSec: number): void {
    const fromWeight = currentWeights.get(name) ?? 0;
    targetWeights.set(name, toWeight);
    if (!currentWeights.has(name)) currentWeights.set(name, 0);
    if (fromWeight === toWeight) {
      // Already at target - nothing to animate.
      blends.delete(name);
      return;
    }
    blends.set(name, { fromWeight, toWeight, durationSec, elapsedSec: 0 });
  }

  function clearActiveEmoteTargets(): void {
    if (activeEmote === null) return;
    const prev = emoteTable.emotes[activeEmote];
    if (!prev) return;
    for (const entry of prev.expressions) {
      // Drop the bundle's contribution; transient overlays remain untouched
      // and continue until their own decay completes.
      startBlend(entry.name, 0, prev.blendDurationSec);
    }
  }

  function setEmote(name: string, _options?: { previous?: string | null }): void {
    const bundle = emoteTable.emotes[name];
    if (!bundle) {
      // Fail-close (no crash; partial degrade with warning).
      console.warn(`vrm-emote-state: unknown emote "${name}" - ignored`);
      return;
    }
    // Zero out the previously-active bundle's targets, then layer the new
    // bundle on top.
    clearActiveEmoteTargets();
    for (const entry of bundle.expressions) {
      startBlend(entry.name, entry.weight, bundle.blendDurationSec);
    }
    activeEmote = name;
  }

  function applyTransientExpression(name: string, weight: number, fade?: number): void {
    const clamped = clamp01(weight);
    const fadeSec = typeof fade === 'number' && fade > 0 ? fade : DEFAULT_TRANSIENT_FADE_SEC;
    transients.set(name, {
      startWeight: clamped,
      fadeDurationSec: fadeSec,
      elapsedSec: 0,
    });
    // Establish a current entry so flush iterates over it.
    if (!currentWeights.has(name)) currentWeights.set(name, 0);
    if (!targetWeights.has(name)) targetWeights.set(name, 0);
  }

  function setLipsyncActive(active: boolean): void {
    lipsyncActive = !!active;
  }

  function safeSetExpression(vrm: VrmExpressionWritable, name: string, weight: number): void {
    const manager = vrm.expressionManager;
    if (!manager) return;
    try {
      manager.setValue(name, weight);
    } catch {
      // Missing preset on this model - partial degrade is allowed by
      // vrm-emote-states.yaml constraint. Skip silently.
    }
  }

  function tick(tickInput: { vrm: VrmExpressionWritable; deltaSec: number }): { skippedCount: number } {
    const { vrm, deltaSec } = tickInput;
    // A non-finite delta would poison the accumulated elapsed time and leave
    // every blend/transient stuck forever; treat it as a zero-length frame.
    const dt = Number.isFinite(deltaSec) ? Math.max(0, deltaSec) : 0;
    let skippedCount = 0;

    // Advance in-flight blends: accumulate elapsed time and ease between the
    // weight captured at blend start and the target. Once elapsed reaches the
    // blend duration the weight snaps exactly to target and the entry retires
    // from the per-frame loop.
    for (const [name, blend] of blends) {
      blend.elapsedSec += dt;
      if (blend.elapsedSec >= blend.durationSec) {
        currentWeights.set(name, clamp01(blend.toWeight));
        blends.delete(name);
        continue;
      }
      const eased = easeInOutCubic(clamp01(blend.elapsedSec / blend.durationSec));
      const next = blend.fromWeight + (blend.toWeight - blend.fromWeight) * eased;
      currentWeights.set(name, clamp01(next));
    }

    // Advance transient overlays. They decay startWeight to 0 over
    // fadeDurationSec, overriding the bundle-driven lerp during their
    // lifetime. When they expire we snap currentWeights down to the
    // bundle target so a one-shot transient on a name with no bundle
    // contribution returns cleanly to 0.
    const transientNames = Array.from(transients.keys());
    for (const name of transientNames) {
      const overlay = transients.get(name);
      if (!overlay) continue;
      overlay.elapsedSec += dt;
      if (overlay.elapsedSec >= overlay.fadeDurationSec) {
        transients.delete(name);
        // Snap to bundle target (0 if not part of any bundle). Any in-flight
        // bundle blend on this name terminates with the snap so the next
        // frame does not pull the weight back to a mid-blend value.
        const target = targetWeights.get(name) ?? 0;
        currentWeights.set(name, clamp01(target));
        blends.delete(name);
      } else {
        const t = clamp01(overlay.elapsedSec / overlay.fadeDurationSec);
        const eased = easeInOutCubic(t);
        const transientWeight = overlay.startWeight * (1 - eased);
        // Transient overrides the bundle for this frame: take max of
        // bundle current and transient. This avoids a fight at name
        // overlap.
        const bundleCurrent = currentWeights.get(name) ?? 0;
        currentWeights.set(name, clamp01(Math.max(bundleCurrent, transientWeight)));
      }
    }

    // Flush to expression manager. Suppress visemes when lipsync is active.
    for (const [name, weight] of currentWeights) {
      if (lipsyncActive && VISEME_NAMES.has(name)) {
        skippedCount += 1;
        continue;
      }
      safeSetExpression(vrm, name, weight);
    }

    return { skippedCount };
  }

  function reset(resetInput: { vrm: VrmExpressionWritable }): void {
    const { vrm } = resetInput;
    for (const name of currentWeights.keys()) {
      safeSetExpression(vrm, name, 0);
    }
    currentWeights.clear();
    targetWeights.clear();
    blends.clear();
    transients.clear();
    activeEmote = null;
  }

  function snapshot(): VrmEmoteSnapshot {
    const target: Record<string, number> = {};
    for (const [name, weight] of targetWeights) target[name] = weight;
    const current: Record<string, number> = {};
    for (const [name, weight] of currentWeights) current[name] = weight;
    return {
      activeEmote,
      targetWeights: Object.freeze(target),
      currentWeights: Object.freeze(current),
      lipsyncActive,
    };
  }

  return {
    setEmote,
    applyTransientExpression,
    setLipsyncActive,
    tick,
    reset,
    snapshot,
  };
}
