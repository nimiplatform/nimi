export const VISEME_NAMES: ReadonlySet<string> = new Set([
  'aa',
  'ih',
  'ou',
  'ee',
  'oh',
]);

export const PRIMARY_EXPRESSION_WEIGHT_CAP = 0.8;
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

const PRIMARY_CAP_EXEMPT_PRESETS: ReadonlySet<string> = new Set(['neutral']);

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function easeInOutCubic(t: number): number {
  if (t < 0.5) return 4 * t * t * t;
  const f = -2 * t + 2;
  return 1 - (f * f * f) / 2;
}

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
  for (const [name, bundle] of Object.entries(emoteTable.emotes)) {
    validateBundle(name, bundle);
  }

  const targetWeights = new Map<string, number>();
  const currentWeights = new Map<string, number>();
  const blends = new Map<string, BlendEntry>();
  const transients = new Map<string, TransientOverlay>();
  let activeEmote: string | null = null;
  let lipsyncActive = false;

  function startBlend(name: string, toWeight: number, durationSec: number): void {
    const fromWeight = currentWeights.get(name) ?? 0;
    targetWeights.set(name, toWeight);
    if (!currentWeights.has(name)) currentWeights.set(name, 0);
    if (fromWeight === toWeight) {
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
      startBlend(entry.name, 0, prev.blendDurationSec);
    }
  }

  function setEmote(name: string, _options?: { previous?: string | null }): void {
    const bundle = emoteTable.emotes[name];
    if (!bundle) {
      console.warn(`vrm-emote-state: unknown emote "${name}" - ignored`);
      return;
    }
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
      // Missing preset on this model is an admitted partial degrade.
    }
  }

  function tick(tickInput: { vrm: VrmExpressionWritable; deltaSec: number }): { skippedCount: number } {
    const { vrm, deltaSec } = tickInput;
    const dt = Number.isFinite(deltaSec) ? Math.max(0, deltaSec) : 0;
    let skippedCount = 0;

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

    for (const name of Array.from(transients.keys())) {
      const overlay = transients.get(name);
      if (!overlay) continue;
      overlay.elapsedSec += dt;
      if (overlay.elapsedSec >= overlay.fadeDurationSec) {
        transients.delete(name);
        currentWeights.set(name, clamp01(targetWeights.get(name) ?? 0));
        continue;
      }
      const eased = easeInOutCubic(clamp01(overlay.elapsedSec / overlay.fadeDurationSec));
      const transientWeight = overlay.startWeight * (1 - eased);
      currentWeights.set(name, clamp01(Math.max(currentWeights.get(name) ?? 0, transientWeight)));
    }

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
    for (const name of currentWeights.keys()) {
      safeSetExpression(resetInput.vrm, name, 0);
    }
    currentWeights.clear();
    targetWeights.clear();
    blends.clear();
    transients.clear();
    activeEmote = null;
  }

  function snapshot(): VrmEmoteSnapshot {
    return {
      activeEmote,
      targetWeights: Object.freeze(Object.fromEntries(targetWeights)),
      currentWeights: Object.freeze(Object.fromEntries(currentWeights)),
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
