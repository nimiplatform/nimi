// Per-surface owner behavior tests for the closed non-ready lifecycle states.
// Covers all admitted state postures (loading / degraded:* / error / relaunch /
// unknown), reason interpolation, reload-button affordance, and i18n coverage.

import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DegradedSurface } from './degraded-surface.js';
import type { CompositionDerivation, CompositionState } from '../app-shell/composition-state.js';

const reloadAvatarShellMock = vi.fn();

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
            : state === 'ready' ? 'live'
              : 'degraded',
    reason: null,
    reasonCode: null,
    accountReasonCode: null,
    actionHint: null,
    stage: null,
    source: null,
    retryable: null,
    modelDiagnostics: null,
    ready: state === 'ready',
    ...overrides,
  };
}

beforeEach(() => {
  reloadAvatarShellMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('DegradedSurface — composition postures', () => {
  it.each([
    ['loading', 'Preparing the avatar'],
    ['degraded_reauth_required', 'Sign in to continue'],
    ['degraded_cloud_offline', 'Nimi Cloud is temporarily unavailable'],
    ['degraded_runtime_unavailable', "Can't connect to Runtime"],
    ['degraded_launch_context_invalid', 'Open the avatar from Nimi Desktop'],
    ['error_bootstrap_fatal', "The avatar couldn't start"],
    ['relaunch_pending', 'Switching avatar'],
  ] as const)('renders %s posture with i18n title', (state, expectedTitle) => {
    render(<DegradedSurface composition={makeComposition(state as CompositionState)} />);
    expect(screen.getByText(expectedTitle)).toBeTruthy();
  });

  it('falls through to unknown posture for ready (defensive)', () => {
    render(<DegradedSurface composition={makeComposition('ready')} />);
    expect(screen.getByText('Avatar paused')).toBeTruthy();
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
      screen.getByText("The avatar isn't receiving live data from Runtime."),
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

  it('renders model diagnostics without replacing the primary degraded reason', () => {
    render(
      <DegradedSurface
        composition={makeComposition('degraded_runtime_unavailable', {
          reason: 'runtime binding unavailable',
          reasonCode: 'RUNTIME_BINDING_UNAVAILABLE',
          modelDiagnostics: {
            loadState: 'error',
            modelId: 'avatar-broken',
            modelPath: 'C:/avatars/broken.vrm',
            error: 'VRM scene graph is missing a humanoid root',
          },
        })}
      />,
    );

    expect(screen.getByText('runtime binding unavailable')).toBeTruthy();
    expect(screen.getByText('RUNTIME_BINDING_UNAVAILABLE')).toBeTruthy();
    expect(screen.getByText('error')).toBeTruthy();
    expect(screen.getByText('avatar-broken')).toBeTruthy();
    expect(screen.getByText('C:/avatars/broken.vrm')).toBeTruthy();
    expect(screen.getByText('VRM scene graph is missing a humanoid root')).toBeTruthy();
  });
});

describe('DegradedSurface — reload affordance', () => {
  it('renders reload button and triggers reloadAvatarShell on click', () => {
    render(<DegradedSurface composition={makeComposition('degraded_runtime_unavailable')} />);
    const button = screen.getByRole('button', { name: 'Reload avatar' });
    fireEvent.click(button);
    expect(reloadAvatarShellMock).toHaveBeenCalledTimes(1);
  });
});
