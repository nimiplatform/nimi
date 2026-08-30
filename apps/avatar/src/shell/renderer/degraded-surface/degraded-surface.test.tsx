// Per-surface owner behavior tests for App-local prerequisite composition.
// Covers all current postures (loading / degraded:* / error / unknown), reason
// interpolation, restart affordance, and i18n coverage.

import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DegradedSurface } from './degraded-surface.js';
import type { CompositionDerivation, CompositionState } from '../app-shell/composition-state.js';

const restartAvatarMock = vi.fn();
const closeAvatarWindowMock = vi.fn();

vi.mock('../app-shell/avatar-window-commands.js', () => ({
  closeAvatarWindow: () => closeAvatarWindowMock(),
}));

function makeComposition(state: CompositionState, overrides: Partial<CompositionDerivation> = {}): CompositionDerivation {
  return {
    state,
    variant:
      state === 'loading' ? 'loading'
        : state === 'error_bootstrap_fatal' ? 'error'
          : state === 'ready' ? 'live'
            : state === 'fixture_not_verified' ? 'fixture'
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
    renderable: state === 'ready' || state === 'fixture_not_verified',
    developmentPreview: state === 'fixture_not_verified',
    ...overrides,
  };
}

beforeEach(() => {
  restartAvatarMock.mockReset();
  closeAvatarWindowMock.mockReset();
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
  ] as const)('renders %s posture with i18n title', (state, expectedTitle) => {
    render(<DegradedSurface composition={makeComposition(state as CompositionState)} onRestart={restartAvatarMock} />);
    expect(screen.getByText(expectedTitle)).toBeTruthy();
  });

  it('falls through to unknown posture for ready (defensive)', () => {
    render(<DegradedSurface composition={makeComposition('ready')} onRestart={restartAvatarMock} />);
    expect(screen.getByText('Avatar paused')).toBeTruthy();
  });
});

describe('DegradedSurface — reason interpolation', () => {
  it('renders summary_with_reason text including the reason for reason-aware states', () => {
    render(
      <DegradedSurface
        composition={makeComposition('degraded_runtime_unavailable', { reason: 'driver_start timeout' })}
        onRestart={restartAvatarMock}
      />,
    );
    // Reason appears both in the interpolated summary AND in the diagnostics row.
    expect(screen.getAllByText(/driver_start timeout/).length).toBeGreaterThanOrEqual(1);
  });

  it('uses bare summary text when reason is empty', () => {
    render(<DegradedSurface composition={makeComposition('degraded_runtime_unavailable')} onRestart={restartAvatarMock} />);
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
        onRestart={restartAvatarMock}
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
        onRestart={restartAvatarMock}
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

describe('DegradedSurface — restart affordance', () => {
  it('renders restart and close actions', () => {
    render(<DegradedSurface composition={makeComposition('degraded_runtime_unavailable')} onRestart={restartAvatarMock} />);
    const button = screen.getByRole('button', { name: 'Restart avatar' });
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('button', { name: 'Close this avatar' }));
    expect(restartAvatarMock).toHaveBeenCalledTimes(1);
    expect(closeAvatarWindowMock).toHaveBeenCalledTimes(1);
  });

  it('hides the restart action during loading but keeps the close action', () => {
    render(<DegradedSurface composition={makeComposition('loading')} onRestart={restartAvatarMock} />);
    expect(screen.queryByTestId('avatar-degraded-restart')).toBeNull();
    expect(screen.getByTestId('avatar-degraded-close')).toBeTruthy();
  });

  it('keeps owner-classified permanent failures fail-closed', () => {
    render(
      <DegradedSurface
        composition={makeComposition('degraded_runtime_unavailable', { retryable: false })}
        onRestart={restartAvatarMock}
      />,
    );
    expect(screen.queryByTestId('avatar-degraded-restart')).toBeNull();
    expect(screen.getByTestId('avatar-degraded-close')).toBeTruthy();
  });
});

describe('DegradedSurface — live-region semantics', () => {
  it('uses a polite status role for routine loading', () => {
    render(<DegradedSurface composition={makeComposition('loading')} onRestart={restartAvatarMock} />);
    expect(screen.getByTestId('avatar-degraded-surface').getAttribute('role')).toBe('status');
  });

  it('keeps an assertive alert role for genuine failure postures', () => {
    render(<DegradedSurface composition={makeComposition('degraded_runtime_unavailable')} onRestart={restartAvatarMock} />);
    expect(screen.getByTestId('avatar-degraded-surface').getAttribute('role')).toBe('alert');
  });
});
