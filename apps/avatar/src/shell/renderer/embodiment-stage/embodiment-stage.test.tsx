// Wave 1 NAV-SHELL-COMPOSITION-001..002 — per-surface unit test for embodiment-stage.
// Covers render, surface-mounted/unmounted evidence emit, and embodied/non-embodied
// rendering postures. Live2D backend session, hit-region controller, and Tauri
// commands are stubbed because they belong to platform-adjacent surfaces.

import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmbodimentStage } from './embodiment-stage.js';

const recordAvatarEvidenceEventuallyMock = vi.fn();

vi.mock('../app-shell/avatar-evidence.js', () => ({
  recordAvatarEvidenceEventually: (...args: unknown[]) => recordAvatarEvidenceEventuallyMock(...args),
}));

vi.mock('../live2d/Live2DCarrierVisualSurface.js', () => ({
  Live2DCarrierVisualSurface: () => null,
}));

vi.mock('../app-shell/tauri-commands.js', () => ({
  startWindowDrag: vi.fn(),
  dragWindowBy: vi.fn(),
  setIgnoreCursorEvents: vi.fn(),
  constrainWindowToVisibleArea: vi.fn(),
  setAlwaysOnTop: vi.fn(),
}));

vi.mock('../app-shell/tauri-lifecycle.js', () => ({
  isTauriRuntime: () => false,
  onLaunchContextUpdated: () => Promise.resolve(() => {}),
}));

beforeEach(() => {
  recordAvatarEvidenceEventuallyMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

const baseProps = {
  visualSession: null,
  windowSize: { width: 400, height: 600 },
  embodied: true,
  compositionState: 'ready',
  interactionModality: 'pointer' as const,
};

describe('EmbodimentStage — render', () => {
  it('renders the embodiment stage section with body hit-region', () => {
    render(<EmbodimentStage {...baseProps} />);
    expect(screen.getByTestId('avatar-embodiment-stage')).toBeTruthy();
    expect(screen.getByTestId('avatar-body-hit-region')).toBeTruthy();
  });

  it('renders even when not embodied (during transient embodiment swap)', () => {
    render(<EmbodimentStage {...baseProps} embodied={false} />);
    expect(screen.getByTestId('avatar-embodiment-stage')).toBeTruthy();
  });
});

describe('EmbodimentStage — composition evidence emit', () => {
  it('emits avatar.composition.surface-mounted on mount with composition_state', () => {
    render(<EmbodimentStage {...baseProps} compositionState="ready" />);
    expect(recordAvatarEvidenceEventuallyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'avatar.composition.surface-mounted',
        detail: expect.objectContaining({
          surface: 'embodiment-stage',
          composition_state: 'ready',
        }),
      }),
    );
  });

  it('emits surface-mounted with fixture_active when in fixture mode', () => {
    render(<EmbodimentStage {...baseProps} compositionState="fixture_active" />);
    expect(recordAvatarEvidenceEventuallyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'avatar.composition.surface-mounted',
        detail: expect.objectContaining({
          surface: 'embodiment-stage',
          composition_state: 'fixture_active',
        }),
      }),
    );
  });

  it('emits avatar.composition.surface-unmounted on unmount', () => {
    const { unmount } = render(<EmbodimentStage {...baseProps} compositionState="ready" />);
    recordAvatarEvidenceEventuallyMock.mockClear();
    unmount();
    expect(recordAvatarEvidenceEventuallyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'avatar.composition.surface-unmounted',
        detail: expect.objectContaining({
          surface: 'embodiment-stage',
          composition_state: 'ready',
        }),
      }),
    );
  });
});
