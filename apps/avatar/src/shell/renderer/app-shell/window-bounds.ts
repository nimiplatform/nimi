// Wave 4 — Window bounds computer + recompute orchestrator.
//
// Implements `config/avatar-window-bounds-policy.yaml`:
//   - composition.formula     → computeWindowBounds()
//   - recompute_triggers.{model_load,model_switch,avatar_scale_change}
//                              → createWindowBoundsRecomputer()
//   - composition.{padding_px,min_*,max_*} clamps
//
// The renderer holds the source-of-truth for embodiment_bounds (from the
// active embodiment projection) and avatar_scale (per avatar instance). This
// module turns those inputs into the physical pixel size handed to the kit
// standard `floatingWindow.setBounds` primitive.
//
// Why this is a separate module:
// - Pure computation (computeWindowBounds) is deterministic + unit-testable
//   without touching React or Tauri. Keeps the policy formula auditable.
// - The orchestrator (createWindowBoundsRecomputer) wraps the set_size
//   dispatch; App.tsx owns wiring it up to model-load and scale-change events.

export type WindowBoundsInputs = {
  embodimentBounds: { width: number; height: number };
  avatarScale?: number;
};

export type WindowBoundsResult = {
  width: number;
  height: number;
  // Whether the requested size hit a clamp (min/max). Surfaced so callers can
  // log when the embodiment backend produces sizes outside the operating
  // envelope (signal of a misbehaving backend, not a user-visible failure).
  clamped: boolean;
};

// Constants mirror window-bounds-policy.yaml composition.* fields. If the
// yaml changes, update these AND the unit test that asserts the formula.
export const WINDOW_BOUNDS_PADDING_PX = 16;
export const WINDOW_BOUNDS_MIN_WIDTH_PX = 320;
export const WINDOW_BOUNDS_MIN_HEIGHT_PX = 480;
export const WINDOW_BOUNDS_MAX_WIDTH_PX = 1200;
export const WINDOW_BOUNDS_MAX_HEIGHT_PX = 1600;
export const WINDOW_BOUNDS_DEFAULT_AVATAR_SCALE = 1;

export function computeWindowBounds(inputs: WindowBoundsInputs): WindowBoundsResult {
  const embodimentWidth = sanitizeNonNegative(inputs.embodimentBounds.width);
  const embodimentHeight = sanitizeNonNegative(inputs.embodimentBounds.height);
  const avatarScale = sanitizeScale(inputs.avatarScale);

  const rawWidth = embodimentWidth * avatarScale + 2 * WINDOW_BOUNDS_PADDING_PX;
  const rawHeight = embodimentHeight * avatarScale + 2 * WINDOW_BOUNDS_PADDING_PX;

  const widthClamped = clamp(rawWidth, WINDOW_BOUNDS_MIN_WIDTH_PX, WINDOW_BOUNDS_MAX_WIDTH_PX);
  const heightClamped = clamp(rawHeight, WINDOW_BOUNDS_MIN_HEIGHT_PX, WINDOW_BOUNDS_MAX_HEIGHT_PX);

  return {
    width: Math.round(widthClamped),
    height: Math.round(heightClamped),
    clamped: widthClamped !== rawWidth || heightClamped !== rawHeight,
  };
}

function sanitizeNonNegative(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return value;
}

function sanitizeScale(value: number | null | undefined): number {
  if (!Number.isFinite(value) || value === null || value === undefined || value <= 0) {
    return WINDOW_BOUNDS_DEFAULT_AVATAR_SCALE;
  }
  return value;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

// Recompute trigger ids — match window-bounds-policy.yaml.recompute_triggers.*.id.
// Used in evidence emit + tests; do not free-form strings at call sites.
export type WindowBoundsTrigger = 'model_load' | 'model_switch' | 'avatar_scale_change';

export type WindowBoundsRecomputerDeps = {
  // Read latest embodiment bounds. Returns null when no model is loaded
  // (recompute is skipped — placeholder size stays).
  getEmbodimentBounds: () => { width: number; height: number } | null;
  // Read latest per-avatar scale. Wave 1 defaults to 1; Wave 5 wires this to
  // wheel-driven persistent avatar instance scale.
  getAvatarScale?: () => number;
  // Apply the result to the OS window. In production this is the Tauri
  // `floatingWindow.setBounds` invoker; in tests a spy.
  applySize: (size: { width: number; height: number }) => void | Promise<void>;
  // Optional evidence sink. When provided, every successful recompute emits
  // `avatar.shell.window-bounds-changed` so the projection layer can record
  // the trigger + result + the inputs that produced it. The detail remains a
  // bounded Avatar-local observation under rules
  // rule.nimi.avatar.embodiment.r018 and r019.
  onRecomputed?: (input: {
    trigger: WindowBoundsTrigger;
    width: number;
    height: number;
    clamped: boolean;
    embodimentBounds: { width: number; height: number };
    avatarScale: number;
  }) => void;
};

export type WindowBoundsRecomputer = {
  trigger(reason: WindowBoundsTrigger): void;
  dispose(): void;
};

// @nimi-authority: rule.nimi.avatar.embodiment.r073
export function createWindowBoundsRecomputer(deps: WindowBoundsRecomputerDeps): WindowBoundsRecomputer {
  let disposed = false;

  async function performRecompute(reason: WindowBoundsTrigger): Promise<void> {
    if (disposed) return;
    const embodimentBounds = deps.getEmbodimentBounds();
    if (!embodimentBounds) {
      // No model loaded yet — skip. The next model_load trigger will fire
      // the first sizing pass.
      return;
    }
    const avatarScale = sanitizeScale(deps.getAvatarScale?.());
    const result = computeWindowBounds({
      embodimentBounds,
      avatarScale,
    });
    await deps.applySize({ width: result.width, height: result.height });
    if (disposed) return;
    deps.onRecomputed?.({
      trigger: reason,
      width: result.width,
      height: result.height,
      clamped: result.clamped,
      embodimentBounds,
      avatarScale,
    });
  }

  return {
    trigger(reason) {
      if (disposed) return;
      void performRecompute(reason).catch((error: unknown) => {
        console.warn(`[avatar:shell] window bounds apply failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    },
    dispose() {
      disposed = true;
    },
  };
}
