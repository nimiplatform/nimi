// Wave 4 chunk 4-D — verifies useWindowBoundsSync consumes
// `BackendBranch.nominalBounds` and forwards the derived window size to the
// Tauri `floatingWindow.setBounds` IPC.
//
// Source-of-truth defaults (per
// config/avatar-window-bounds-policy.yaml backends.*):
//   - VRM:    nominal_bounds_default = 360 x 720
//   - Live2D: nominal_bounds_default = 400 x 600
//
// The IPC params we expect are derived by `computeWindowBounds`:
//   width  = embodiment.width  * avatar_scale + 2 * padding(=16)
//   height = embodiment.height * avatar_scale + 2 * padding(=16)

import { act, render } from '@testing-library/react';
import { useCallback } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWindowBoundsSync } from './use-window-bounds-sync.js';
import { useAvatarStore } from './app-store.js';
import { recordAvatarEvidenceEventually } from './avatar-evidence.js';
import { WINDOW_BOUNDS_PADDING_PX } from './window-bounds.js';
import type { BackendNominalBounds } from '../carrier/backend-branch.js';

const setWindowSizeMock = vi.fn<(...args: unknown[]) => Promise<void>>();
const setIgnoreCursorEventsMock = vi.fn<(...args: unknown[]) => Promise<void>>();
let tauriRuntime = true;

vi.mock('./tauri-commands.js', () => ({
  setWindowSize: (...args: unknown[]) => setWindowSizeMock(...args),
  beginManualDragWindow: vi.fn(),
  moveManualDragWindow: vi.fn(),
  setIgnoreCursorEvents: (...args: unknown[]) => setIgnoreCursorEventsMock(...args),
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

function Harness({
  nominalBounds,
  avatarScale = 1,
}: {
  nominalBounds: BackendNominalBounds | null;
  avatarScale?: number;
}) {
  const getEmbodimentBounds = useCallback(
    () =>
      nominalBounds && nominalBounds.width > 0 && nominalBounds.height > 0
        ? { width: nominalBounds.width, height: nominalBounds.height }
        : null,
    [nominalBounds],
  );
  useWindowBoundsSync({
    isReady: true,
    getEmbodimentBounds,
    avatarScale,
  });
  return null;
}

function renderWithBackend(nominalBounds: BackendNominalBounds | null, avatarScale = 1) {
  return render(<Harness nominalBounds={nominalBounds} avatarScale={avatarScale} />);
}

function resetModelState() {
  useAvatarStore.setState({
    model: { modelPath: null, modelId: null, loadState: 'idle', error: null },
    shell: {
      ...useAvatarStore.getState().shell,
      windowSize: { width: 400, height: 600 },
    },
  });
}

beforeEach(() => {
  setWindowSizeMock.mockReset();
  setWindowSizeMock.mockResolvedValue();
  setIgnoreCursorEventsMock.mockReset();
  setIgnoreCursorEventsMock.mockResolvedValue();
  vi.mocked(recordAvatarEvidenceEventually).mockReset();
  tauriRuntime = true;
  resetModelState();
});

afterEach(() => {
  resetModelState();
});

describe('useWindowBoundsSync - BackendBranch.nominalBounds -> set_window_size IPC', () => {
  it('forwards VRM 360x720 nominalBounds to floatingWindow.setBounds on model_load', async () => {
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

    const expectedWidth = 360 + 2 * WINDOW_BOUNDS_PADDING_PX;
    const expectedHeight = 720 + 2 * WINDOW_BOUNDS_PADDING_PX;

    expect(setWindowSizeMock).toHaveBeenCalledTimes(1);
    expect(setWindowSizeMock).toHaveBeenCalledWith(expectedWidth, expectedHeight);
    expect(setIgnoreCursorEventsMock).toHaveBeenCalledWith(false);
  });

  it('forwards Live2D 400x600 nominalBounds to floatingWindow.setBounds on model_load', async () => {
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

    expect(setWindowSizeMock).toHaveBeenCalledTimes(1);
    expect(setWindowSizeMock).toHaveBeenCalledWith(
      400 + 2 * WINDOW_BOUNDS_PADDING_PX,
      600 + 2 * WINDOW_BOUNDS_PADDING_PX,
    );
  });

  it('applies avatar scale to the embodiment bounds', async () => {
    renderWithBackend({
      width: 400,
      height: 600,
      bodyCenterX: 0.5,
      bodyCenterY: 0.5,
    }, 1.25);

    await act(async () => {
      useAvatarStore.getState().setModelLoaded('scaled-live2d-model');
    });

    expect(setWindowSizeMock).toHaveBeenCalledWith(
      400 * 1.25 + 2 * WINDOW_BOUNDS_PADDING_PX,
      600 * 1.25 + 2 * WINDOW_BOUNDS_PADDING_PX,
    );
    expect(recordAvatarEvidenceEventually).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'avatar.shell.window-bounds-changed',
        detail: expect.objectContaining({ scale: 1.25 }),
      }),
    );
  });

  it('recomputes with avatar_scale_change when avatarScale changes without replaying model_load', async () => {
    const bounds = {
      width: 400,
      height: 600,
      bodyCenterX: 0.5,
      bodyCenterY: 0.5,
    };
    const { rerender } = renderWithBackend(bounds, 1);

    await act(async () => {
      useAvatarStore.getState().setModelLoaded('scaled-live2d-model');
    });
    setWindowSizeMock.mockClear();
    vi.mocked(recordAvatarEvidenceEventually).mockClear();

    rerender(<Harness nominalBounds={bounds} avatarScale={1.3} />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(setWindowSizeMock).toHaveBeenCalledTimes(1);
    expect(setWindowSizeMock).toHaveBeenCalledWith(
      400 * 1.3 + 2 * WINDOW_BOUNDS_PADDING_PX,
      600 * 1.3 + 2 * WINDOW_BOUNDS_PADDING_PX,
    );
    expect(recordAvatarEvidenceEventually).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'avatar.shell.window-bounds-changed',
        detail: expect.objectContaining({
          trigger: 'avatar_scale_change',
          scale: 1.3,
        }),
      }),
    );
    expect(recordAvatarEvidenceEventually).not.toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'avatar.shell.window-bounds-changed',
        detail: expect.objectContaining({ trigger: 'model_load' }),
      }),
    );
  });

  it('IPC params change between VRM and Live2D baselines', async () => {
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
      720 + 2 * WINDOW_BOUNDS_PADDING_PX,
    ]);
    unmount();

    resetModelState();
    setWindowSizeMock.mockClear();

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
      600 + 2 * WINDOW_BOUNDS_PADDING_PX,
    ]);
    expect(live2dCall).not.toEqual(vrmCall);
  });

  it('skips set_window_size when nominalBounds is null (no model loaded)', async () => {
    renderWithBackend(null);

    await act(async () => {
      useAvatarStore.getState().setModelLoaded('any-model-id');
    });

    expect(setWindowSizeMock).not.toHaveBeenCalled();
    expect(setIgnoreCursorEventsMock).not.toHaveBeenCalled();
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

  it('does not record bounds evidence or store size when set_window_size IPC fails', async () => {
    setWindowSizeMock.mockRejectedValue(new Error('native resize failed'));
    renderWithBackend({
      width: 360,
      height: 720,
      bodyCenterX: 0.5,
      bodyCenterY: 0.55,
    });

    await act(async () => {
      useAvatarStore.getState().setModelLoaded('vrm-model-fail');
      await Promise.resolve();
    });

    expect(setWindowSizeMock).toHaveBeenCalledTimes(1);
    expect(recordAvatarEvidenceEventually).not.toHaveBeenCalled();
    expect(useAvatarStore.getState().shell.windowSize).toEqual({ width: 400, height: 600 });
  });
});
