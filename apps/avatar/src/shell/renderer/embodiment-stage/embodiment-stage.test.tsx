// Wave 1 NAV-SHELL-COMPOSITION-001..002 + topic
// `2026-04-30-avatar-vrm-backend-branch` wave_1 step_4 — per-surface
// unit test for embodiment-stage covering:
//  * render presence under ready / fixture_active composition states
//  * surface-mounted / surface-unmounted evidence emission
//  * BackendBranch surface mount + the three lifecycle callbacks
//    (audio-consumer registration, hit-region throttle, lifecycle
//    evidence record) introduced in step_4

import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentType } from 'react';
import { useEffect } from 'react';
import { EmbodimentStage } from './embodiment-stage.js';
import type {
  BackendAudioConsumer,
  BackendBranch,
  BackendHitRegion,
  BackendSurfaceProps,
} from '../carrier/backend-branch.js';

const recordAvatarEvidenceEventuallyMock = vi.fn();
const setIgnoreCursorEventsMock = vi.fn();
const registerLipsyncSinkMock = vi.fn();

vi.mock('../app-shell/avatar-evidence.js', () => ({
  recordAvatarEvidenceEventually: (...args: unknown[]) =>
    recordAvatarEvidenceEventuallyMock(...args),
}));

vi.mock('../app-shell/tauri-commands.js', () => ({
  startWindowDrag: vi.fn(),
  dragWindowBy: vi.fn(),
  setIgnoreCursorEvents: (...args: unknown[]) => setIgnoreCursorEventsMock(...args),
  constrainWindowToVisibleArea: vi.fn(),
  setAlwaysOnTop: vi.fn(),
}));

vi.mock('../app-shell/tauri-lifecycle.js', () => ({
  isTauriRuntime: () => false,
  onLaunchContextUpdated: () => Promise.resolve(() => {}),
}));

vi.mock('../audio/audio-pipeline.js', () => ({
  getSharedAudioPipelineController: () => ({
    registerLipsyncSink: (...args: unknown[]) => registerLipsyncSinkMock(...args),
    setRuntime: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
    play: vi.fn(),
    stop: vi.fn(),
  }),
}));

function createAudioConsumerStub(): BackendAudioConsumer {
  return {
    async attachAudioSource() {},
    detachAudioSource() {},
    silent() {},
    snapshot() {
      return null;
    },
  };
}

function createHitRegionStub(): BackendHitRegion {
  return {
    body: { left: 0.1, top: 0.1, right: 0.9, bottom: 0.9 },
    drag: { left: 0.1, top: 0.1, right: 0.9, bottom: 0.9 },
    isOpaqueAtClientPoint: null,
  };
}

function createMockBackend(input?: {
  audioConsumer?: BackendAudioConsumer;
  hitRegion?: BackendHitRegion;
}): BackendBranch & { kind: 'live2d' } {
  const audioConsumer = input?.audioConsumer ?? createAudioConsumerStub();
  const hitRegion = input?.hitRegion ?? createHitRegionStub();
  const Component: ComponentType<BackendSurfaceProps> = (props) => {
    useEffect(() => {
      props.onAudioConsumerReady?.(audioConsumer);
      props.onHitRegionChange?.(hitRegion);
      props.onLifecycleEvidence?.('mounted', { test_marker: true });
    }, [
      props.onAudioConsumerReady,
      props.onHitRegionChange,
      props.onLifecycleEvidence,
    ]);
    return null;
  };
  return {
    kind: 'live2d',
    nominalBounds: { width: 400, height: 600, bodyCenterX: 0.5, bodyCenterY: 0.5 },
    projection: {
      applyActivity() {},
      applyEmotion() {},
      applyMotion() {},
      applyExpression() {},
      reset() {},
    },
    surface: { Component },
    metadata: () => ({}),
    shutdown() {},
    live2dExtension: { setParameter() {} },
  };
}

beforeEach(() => {
  recordAvatarEvidenceEventuallyMock.mockReset();
  setIgnoreCursorEventsMock.mockReset();
  registerLipsyncSinkMock.mockReset();
  registerLipsyncSinkMock.mockReturnValue(() => undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

const baseProps = {
  backend: null,
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

describe('EmbodimentStage — BackendBranch surface mount (wave_1 step_4)', () => {
  it('mounts backend.surface.Component when backend is provided', () => {
    const consumer = createAudioConsumerStub();
    const backend = createMockBackend({ audioConsumer: consumer });
    render(<EmbodimentStage {...baseProps} backend={backend} />);
    expect(registerLipsyncSinkMock).toHaveBeenCalledWith(consumer);
  });

  it('routes onHitRegionChange through setIgnoreCursorEvents', () => {
    const backend = createMockBackend({
      hitRegion: {
        body: { left: 0, top: 0, right: 1, bottom: 1 },
        drag: { left: 0, top: 0, right: 1, bottom: 1 },
        isOpaqueAtClientPoint: null,
      },
    });
    render(<EmbodimentStage {...baseProps} backend={backend} />);
    // body rect is non-zero → carrier interactive → ignore=false.
    expect(setIgnoreCursorEventsMock).toHaveBeenCalledWith(false);
  });

  it('forwards onLifecycleEvidence as avatar.carrier.visual evidence with lifecycle phase', () => {
    const backend = createMockBackend();
    render(<EmbodimentStage {...baseProps} backend={backend} />);
    expect(recordAvatarEvidenceEventuallyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'avatar.carrier.visual',
        detail: expect.objectContaining({
          source: 'embodiment-stage',
          lifecycle: 'mounted',
          test_marker: true,
        }),
      }),
    );
  });

  it('unregisters the lipsync sink on unmount', () => {
    const unregister = vi.fn();
    registerLipsyncSinkMock.mockReturnValueOnce(unregister);
    const backend = createMockBackend();
    const { unmount } = render(<EmbodimentStage {...baseProps} backend={backend} />);
    unmount();
    expect(unregister).toHaveBeenCalled();
  });
});
