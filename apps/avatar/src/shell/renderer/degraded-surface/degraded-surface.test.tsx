// Wave 1 K-NAV-SHELL-DEGRADED-001..005 — per-surface unit test for degraded-surface.
// Covers all admitted state postures (loading / degraded:* / error / relaunch /
// unknown), reason interpolation, reload-button affordance, and i18n coverage.
// Surface-mounted/unmounted evidence is asserted via mocked
// `recordAvatarEvidenceEventually`.

import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DegradedSurface } from './degraded-surface.js';
import type { CompositionDerivation, CompositionState } from '../app-shell/composition-state.js';

const recordAvatarEvidenceEventuallyMock = vi.fn();
const reloadAvatarShellMock = vi.fn();

vi.mock('../app-shell/avatar-evidence.js', () => ({
  recordAvatarEvidenceEventually: (...args: unknown[]) => recordAvatarEvidenceEventuallyMock(...args),
}));

vi.mock('../shell-reload.js', () => ({
  reloadAvatarShell: () => reloadAvatarShellMock(),
}));

function makeComposition(state: CompositionState, overrides: Partial<CompositionDerivation> = {}): CompositionDerivation {
  return {
    state,
    variant:
      state === 'loading' ? 'loading'
        : state === 'relaunch_pending' ? 'relaunch'
          : state === 'error_bootstrap_fatal' ? 'error'
            : state === 'fixture_active' ? 'fixture'
              : state === 'ready' ? 'live'
                : 'degraded',
    reason: null,
    reasonCode: null,
    accountReasonCode: null,
    actionHint: null,
    stage: null,
    source: null,
    retryable: null,
    ready: state === 'ready' || state === 'fixture_active',
    ...overrides,
  };
}

beforeEach(() => {
  recordAvatarEvidenceEventuallyMock.mockReset();
  reloadAvatarShellMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('DegradedSurface — composition postures', () => {
  it.each([
    ['loading', 'Preparing the avatar'],
    ['degraded_reauth_required', 'Runtime account session is not authenticated'],
    ['degraded_runtime_unavailable', 'Runtime interaction path is not ready'],
    ['degraded_launch_context_invalid', 'Launch context invalid'],
    ['error_bootstrap_fatal', 'Avatar surface failed to start'],
    ['relaunch_pending', 'Desktop sent a launch update'],
  ] as const)('renders %s posture with i18n title', (state, expectedTitle) => {
    render(<DegradedSurface composition={makeComposition(state as CompositionState)} />);
    expect(screen.getByText(expectedTitle)).toBeTruthy();
  });

  it('falls through to unknown posture for ready / fixture_active (defensive)', () => {
    render(<DegradedSurface composition={makeComposition('ready')} />);
    expect(screen.getByText('Avatar surface paused')).toBeTruthy();
  });
});

describe('DegradedSurface — reason interpolation', () => {
  it('renders summary_with_reason text including the reason for reason-aware states', () => {
    render(
      <DegradedSurface
        composition={makeComposition('degraded_runtime_unavailable', { reason: 'driver_start timeout' })}
      />,
    );
    // Reason appears both in the interpolated summary AND in the diagnostics row.
    expect(screen.getAllByText(/driver_start timeout/).length).toBeGreaterThanOrEqual(1);
  });

  it('uses bare summary text when reason is empty', () => {
    render(<DegradedSurface composition={makeComposition('degraded_runtime_unavailable')} />);
    expect(
      screen.getByText('The local Runtime is not currently delivering the avatar carrier.'),
    ).toBeTruthy();
  });

  it('renders typed diagnostics fields for fail-closed bootstrap details', () => {
    render(
      <DegradedSurface
        composition={makeComposition('degraded_runtime_unavailable', {
          reason: 'local_avatar_asset_manifest: LOCAL_AVATAR_ASSET_RESOLVE_FAILED / reimport_or_select_local_avatar_asset',
          reasonCode: 'LOCAL_AVATAR_ASSET_RESOLVE_FAILED',
          actionHint: 'reimport_or_select_local_avatar_asset',
          stage: 'local_avatar_asset_manifest',
          source: 'avatar_local_materialization',
          retryable: false,
        })}
      />,
    );

    expect(screen.getByText('LOCAL_AVATAR_ASSET_RESOLVE_FAILED')).toBeTruthy();
    expect(screen.getByText('reimport_or_select_local_avatar_asset')).toBeTruthy();
    expect(screen.getByText('local_avatar_asset_manifest')).toBeTruthy();
    expect(screen.getByText('avatar_local_materialization')).toBeTruthy();
    expect(screen.getByText('No')).toBeTruthy();
  });
});

describe('DegradedSurface — reload affordance', () => {
  it('renders reload button and triggers reloadAvatarShell on click', () => {
    render(<DegradedSurface composition={makeComposition('degraded_runtime_unavailable')} />);
    const button = screen.getByRole('button', { name: 'Reload shell' });
    fireEvent.click(button);
    expect(reloadAvatarShellMock).toHaveBeenCalledTimes(1);
  });
});

describe('DegradedSurface — composition evidence emit', () => {
  it('emits avatar.composition.surface-mounted on mount with composition_state', () => {
    render(<DegradedSurface composition={makeComposition('degraded_runtime_unavailable')} />);
    expect(recordAvatarEvidenceEventuallyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'avatar.composition.surface-mounted',
        detail: expect.objectContaining({
          surface: 'degraded-surface',
          composition_state: 'degraded_runtime_unavailable',
        }),
      }),
    );
  });

  it('emits avatar.composition.surface-mounted when reused surface enters degraded state', () => {
    const { rerender } = render(<DegradedSurface composition={makeComposition('loading')} />);
    recordAvatarEvidenceEventuallyMock.mockClear();
    rerender(<DegradedSurface composition={makeComposition('degraded_runtime_unavailable')} />);
    expect(recordAvatarEvidenceEventuallyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'avatar.composition.surface-mounted',
        detail: expect.objectContaining({
          surface: 'degraded-surface',
          composition_state: 'degraded_runtime_unavailable',
        }),
      }),
    );
  });

  it('emits avatar.composition.surface-unmounted on unmount', () => {
    const { unmount } = render(<DegradedSurface composition={makeComposition('loading')} />);
    recordAvatarEvidenceEventuallyMock.mockClear();
    unmount();
    expect(recordAvatarEvidenceEventuallyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'avatar.composition.surface-unmounted',
        detail: expect.objectContaining({
          surface: 'degraded-surface',
          composition_state: 'loading',
        }),
      }),
    );
  });

  it('captures latest composition_state at unmount time when state evolved', () => {
    const { rerender, unmount } = render(<DegradedSurface composition={makeComposition('loading')} />);
    rerender(<DegradedSurface composition={makeComposition('degraded_runtime_unavailable')} />);
    recordAvatarEvidenceEventuallyMock.mockClear();
    unmount();
    expect(recordAvatarEvidenceEventuallyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'avatar.composition.surface-unmounted',
        detail: expect.objectContaining({
          composition_state: 'degraded_runtime_unavailable',
        }),
      }),
    );
  });
});
