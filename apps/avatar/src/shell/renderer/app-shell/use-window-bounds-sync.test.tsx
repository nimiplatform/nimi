// Wave 4 chunk 4-D — verifies useWindowBoundsSync consumes
// `BackendBranch.nominalBounds` and forwards the derived window size to the
// Tauri `nimi_avatar_set_window_size` IPC.
//
// Source-of-truth defaults (per
// .nimi/spec/avatar/kernel/tables/window-bounds-policy.yaml backends.*):
//   - VRM:    nominal_bounds_default = 360 × 720
//   - Live2D: nominal_bounds_default = 400 × 600
//
// The IPC params we expect are derived by `computeWindowBounds`:
//   width  = max(embodiment.width,  companion.width)  + 2 * padding(=16)
//   height =     embodiment.height + companion.height + 2 * padding(=16)
//   companion height clamped to [MIN=96, MAX=400] before composition.
//
// The hook itself is wired in App.tsx:
//   getEmbodimentBounds = () => bootstrapHandle.carrier.backend.nominalBounds
// so the test feeds the same shape directly to the hook.

import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWindowBoundsSync } from './use-window-bounds-sync.js';
import { useAvatarStore } from './app-store.js';
import {
  COMPANION_FOOTPRINT_MIN_HEIGHT_PX,
  WINDOW_BOUNDS_PADDING_PX,
} from './window-bounds.js';
import type { BackendNominalBounds } from '../carrier/backend-branch.js';

const setWindowSizeMock = vi.fn<(...args: unknown[]) => Promise<void>>();
let tauriRuntime = true;

vi.mock('./tauri-commands.js', () => ({
  setWindowSize: (...args: unknown[]) => setWindowSizeMock(...args),
  // Other commands not exercised by this hook test, but the App-shell module
  // surface includes them; keep the mock interface complete to avoid surprise
  // load-time failures if downstream re-imports change.
  startWindowDrag: vi.fn(),
  dragWindowBy: vi.fn(),
  setIgnoreCursorEvents: vi.fn(),
  constrainWindowToVisibleArea: vi.fn(),
  setAlwaysOnTop: vi.fn(),
}));

vi.mock('./tauri-lifecycle.js', () => ({
  isTauriRuntime: () => tauriRuntime,
  onLaunchContextUpdated: vi.fn(() => () => {}),
}));

vi.mock('./avatar-evidence.js', () => ({
  recordAvatarEvidenceEventually: vi.fn(),
}));

// Tiny harness component so we can mount the hook the same way App.tsx does.
// The bounds source comes from a `BackendBranch.nominalBounds`-shaped value
// to mirror the real wiring: `bootstrapHandle.carrier.backend.nominalBounds`.
function Harness({ nominalBounds }: { nominalBounds: BackendNominalBounds | null }) {
  useWindowBoundsSync({
    isReady: true,
    getEmbodimentBounds: () =>
      nominalBounds && nominalBounds.width > 0 && nominalBounds.height > 0
        ? { width: nominalBounds.width, height: nominalBounds.height }
        : null,
  });
  return null;
}

function renderWithBackend(nominalBounds: BackendNominalBounds | null) {
  return render(<Harness nominalBounds={nominalBounds} />);
}

function resetModelState() {
  // Match AvatarAppState['model'] shape exactly (modelPath, modelId,
  // loadState, error). Idle so the next setModelLoaded fires as a fresh edge.
  useAvatarStore.setState({
    model: { modelPath: null, modelId: null, loadState: 'idle', error: null },
  });
}

beforeEach(() => {
  setWindowSizeMock.mockReset();
  setWindowSizeMock.mockResolvedValue();
  tauriRuntime = true;
  resetModelState();
});

afterEach(() => {
  resetModelState();
});

describe('useWindowBoundsSync — BackendBranch.nominalBounds → set_window_size IPC', () => {
  it('forwards VRM 360×720 nominalBounds to nimi_avatar_set_window_size on model_load', async () => {
    // Source: window-bounds-policy.yaml backends.vrm.nominal_bounds_default
    const vrmBounds: BackendNominalBounds = {
      width: 360,
      height: 720,
      bodyCenterX: 0.5,
      bodyCenterY: 0.55,
    };

    renderWithBackend(vrmBounds);

    await act(async () => {
      useAvatarStore.getState().setModelLoaded('vrm-model-1');
    });

    // companion footprint defaults to baseline (no DOM node mounted), which is
    // clamped to MIN height per policy. Width = max(360, 232) + 32 = 392.
    // Height = 720 + 96 + 32 = 848.
    const expectedWidth = 360 + 2 * WINDOW_BOUNDS_PADDING_PX;
    const expectedHeight =
      720 + COMPANION_FOOTPRINT_MIN_HEIGHT_PX + 2 * WINDOW_BOUNDS_PADDING_PX;

    expect(setWindowSizeMock).toHaveBeenCalledTimes(1);
    expect(setWindowSizeMock).toHaveBeenCalledWith(expectedWidth, expectedHeight);
  });

  it('forwards Live2D 400×600 nominalBounds to nimi_avatar_set_window_size on model_load', async () => {
    // Source: window-bounds-policy.yaml backends.live2d.nominal_bounds_default
    const live2dBounds: BackendNominalBounds = {
      width: 400,
      height: 600,
      bodyCenterX: 0.5,
      bodyCenterY: 0.5,
    };

    renderWithBackend(live2dBounds);

    await act(async () => {
      useAvatarStore.getState().setModelLoaded('live2d-model-1');
    });

    // Width = max(400, 232) + 32 = 432. Height = 600 + 96 + 32 = 728.
    const expectedWidth = 400 + 2 * WINDOW_BOUNDS_PADDING_PX;
    const expectedHeight =
      600 + COMPANION_FOOTPRINT_MIN_HEIGHT_PX + 2 * WINDOW_BOUNDS_PADDING_PX;

    expect(setWindowSizeMock).toHaveBeenCalledTimes(1);
    expect(setWindowSizeMock).toHaveBeenCalledWith(expectedWidth, expectedHeight);
  });

  it('IPC params change between VRM (360×720) and Live2D (400×600) baselines', async () => {
    // First mount with VRM bounds → expect the VRM-derived size.
    const { unmount } = renderWithBackend({
      width: 360,
      height: 720,
      bodyCenterX: 0.5,
      bodyCenterY: 0.55,
    });
    await act(async () => {
      useAvatarStore.getState().setModelLoaded('vrm-model');
    });
    const vrmCall = setWindowSizeMock.mock.calls.at(-1);
    expect(vrmCall).toEqual([
      360 + 2 * WINDOW_BOUNDS_PADDING_PX,
      720 + COMPANION_FOOTPRINT_MIN_HEIGHT_PX + 2 * WINDOW_BOUNDS_PADDING_PX,
    ]);
    unmount();

    // Reset model state so the next mount sees a fresh `idle -> loaded` edge.
    resetModelState();
    setWindowSizeMock.mockClear();

    // Re-mount with Live2D bounds → expect the Live2D-derived size; not equal
    // to the VRM call params (different baseline width + height).
    renderWithBackend({
      width: 400,
      height: 600,
      bodyCenterX: 0.5,
      bodyCenterY: 0.5,
    });
    await act(async () => {
      useAvatarStore.getState().setModelLoaded('live2d-model');
    });
    const live2dCall = setWindowSizeMock.mock.calls.at(-1);
    expect(live2dCall).toEqual([
      400 + 2 * WINDOW_BOUNDS_PADDING_PX,
      600 + COMPANION_FOOTPRINT_MIN_HEIGHT_PX + 2 * WINDOW_BOUNDS_PADDING_PX,
    ]);
    expect(live2dCall).not.toEqual(vrmCall);
  });

  it('skips set_window_size when nominalBounds is null (no model loaded)', async () => {
    renderWithBackend(null);

    await act(async () => {
      useAvatarStore.getState().setModelLoaded('any-model-id');
    });

    expect(setWindowSizeMock).not.toHaveBeenCalled();
  });

  it('does not call IPC outside Tauri runtime even with a valid backend', async () => {
    tauriRuntime = false;
    renderWithBackend({
      width: 360,
      height: 720,
      bodyCenterX: 0.5,
      bodyCenterY: 0.55,
    });

    await act(async () => {
      useAvatarStore.getState().setModelLoaded('vrm-model-no-tauri');
    });

    expect(setWindowSizeMock).not.toHaveBeenCalled();
  });
});
