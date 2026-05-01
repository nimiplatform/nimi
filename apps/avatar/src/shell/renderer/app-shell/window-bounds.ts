// Wave 4 — Window bounds computer + recompute orchestrator.
//
// Implements `.nimi/spec/avatar/kernel/tables/window-bounds-policy.yaml`:
//   - composition.formula     → computeWindowBounds()
//   - recompute_triggers.{model_load,model_switch,companion_footprint_change}
//                              → createWindowBoundsRecomputer()
//   - composition.{padding_px,min_*,max_*} clamps
//
// The renderer holds the source-of-truth for embodiment_bounds (from the
// active embodiment projection) and companion_footprint (from the live DOM
// rect of the companion-surface root). This module turns those two inputs
// into the physical pixel size handed to Tauri `nimi_avatar_set_window_size`.
//
// Why this is a separate module:
// - Pure computation (computeWindowBounds) is deterministic + unit-testable
//   without touching React or Tauri. Keeps the policy formula auditable.
// - The orchestrator (createWindowBoundsRecomputer) wraps debounce + the
//   set_size dispatch; App.tsx owns wiring it up to model-load events and a
//   ResizeObserver on the companion-surface root.

export type WindowBoundsInputs = {
  embodimentBounds: { width: number; height: number };
  companionFootprint: { width: number; height: number };
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

// Companion footprint bounds (yaml dimensions.companion_footprint). These
// clamp the contribution of a companion-surface that has gone runaway tall
// or that we measured before layout settled.
export const COMPANION_FOOTPRINT_MIN_HEIGHT_PX = 96;
export const COMPANION_FOOTPRINT_MAX_HEIGHT_PX = 400;

// Debounce window for ResizeObserver-driven recomputes (yaml
// recompute_triggers.companion_footprint_change.debounce_ms).
export const COMPANION_FOOTPRINT_DEBOUNCE_MS = 80;

export function computeWindowBounds(inputs: WindowBoundsInputs): WindowBoundsResult {
  const embodimentWidth = sanitizeNonNegative(inputs.embodimentBounds.width);
  const embodimentHeight = sanitizeNonNegative(inputs.embodimentBounds.height);
  const companionWidth = sanitizeNonNegative(inputs.companionFootprint.width);
  const companionHeightRaw = sanitizeNonNegative(inputs.companionFootprint.height);
  const companionHeight = clamp(
    companionHeightRaw,
    COMPANION_FOOTPRINT_MIN_HEIGHT_PX,
    COMPANION_FOOTPRINT_MAX_HEIGHT_PX,
  );

  const rawWidth = Math.max(embodimentWidth, companionWidth) + 2 * WINDOW_BOUNDS_PADDING_PX;
  const rawHeight = embodimentHeight + companionHeight + 2 * WINDOW_BOUNDS_PADDING_PX;

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

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

// Recompute trigger ids — match window-bounds-policy.yaml.recompute_triggers.*.id.
// Used in evidence emit + tests; do not free-form strings at call sites.
export type WindowBoundsTrigger = 'model_load' | 'model_switch' | 'companion_footprint_change';

export type WindowBoundsRecomputerDeps = {
  // Read latest embodiment bounds. Returns null when no model is loaded
  // (recompute is skipped — placeholder size stays).
  getEmbodimentBounds: () => { width: number; height: number } | null;
  // Read latest companion-surface footprint. May return zero-rect during
  // first paint; computeWindowBounds clamps via min height to keep window
  // from collapsing below the placeholder envelope.
  getCompanionFootprint: () => { width: number; height: number };
  // Apply the result to the OS window. In production this is the Tauri
  // `nimi_avatar_set_window_size` invoker; in tests a spy.
  applySize: (size: { width: number; height: number }) => void | Promise<void>;
  // Optional evidence sink. When provided, every successful recompute emits
  // `avatar.shell.window-bounds-changed` so the projection layer can record
  // the trigger + result + the inputs that produced it. Wave 4 evidence;
  // detail shape matches avatar-event-contract.md §4.
  onRecomputed?: (input: {
    trigger: WindowBoundsTrigger;
    width: number;
    height: number;
    clamped: boolean;
    embodimentBounds: { width: number; height: number };
    companionFootprint: { width: number; height: number };
  }) => void;
  // Schedule a debounced trigger. Defaults to setTimeout / clearTimeout.
  // Provided so tests can advance fake timers deterministically.
  setTimer?: (handler: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

export type WindowBoundsRecomputer = {
  trigger(reason: WindowBoundsTrigger): void;
  dispose(): void;
};

export function createWindowBoundsRecomputer(deps: WindowBoundsRecomputerDeps): WindowBoundsRecomputer {
  const setTimer = deps.setTimer ?? ((handler, ms) => setTimeout(handler, ms));
  const clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let pendingHandle: unknown = null;
  let disposed = false;

  function performRecompute(reason: WindowBoundsTrigger): void {
    if (disposed) return;
    const embodimentBounds = deps.getEmbodimentBounds();
    if (!embodimentBounds) {
      // No model loaded yet — skip. The next model_load trigger will fire
      // the first sizing pass.
      return;
    }
    const companionFootprint = deps.getCompanionFootprint();
    const result = computeWindowBounds({
      embodimentBounds,
      companionFootprint,
    });
    void deps.applySize({ width: result.width, height: result.height });
    deps.onRecomputed?.({
      trigger: reason,
      width: result.width,
      height: result.height,
      clamped: result.clamped,
      embodimentBounds,
      companionFootprint,
    });
  }

  return {
    trigger(reason) {
      if (disposed) return;
      // model_load + model_switch fire synchronously per policy
      // (debounce_ms = 0). Only companion_footprint_change is debounced.
      if (reason !== 'companion_footprint_change') {
        if (pendingHandle !== null) {
          clearTimer(pendingHandle);
          pendingHandle = null;
        }
        performRecompute(reason);
        return;
      }
      if (pendingHandle !== null) {
        clearTimer(pendingHandle);
      }
      pendingHandle = setTimer(() => {
        pendingHandle = null;
        performRecompute('companion_footprint_change');
      }, COMPANION_FOOTPRINT_DEBOUNCE_MS);
    },
    dispose() {
      disposed = true;
      if (pendingHandle !== null) {
        clearTimer(pendingHandle);
        pendingHandle = null;
      }
    },
  };
}
