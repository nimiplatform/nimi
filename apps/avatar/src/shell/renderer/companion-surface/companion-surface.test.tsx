// Companion Surface unit tests for the stage-first surface:
// presence capsule by default, optional assistant cue, explicit composer tray,
// voice gating, and composition mount evidence.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState, type RefObject } from 'react';
import { CompanionSurface } from './companion-surface.js';
import { initialCompanionState, type CompanionAnchorBinding } from '../companion-state.js';
import { initialVoiceCompanionState } from '../voice-companion-state.js';
import { defaultAvatarShellSettings } from '../settings-state.js';
import type { BootstrapHandle } from '../app-shell/app-bootstrap.js';
import type { AvatarVoiceCaptureSession } from '../voice-capture.js';

const recordAvatarEvidenceEventuallyMock = vi.fn();

vi.mock('../app-shell/avatar-evidence.js', () => ({
  recordAvatarEvidenceEventually: (...args: unknown[]) => recordAvatarEvidenceEventuallyMock(...args),
}));

beforeEach(() => {
  recordAvatarEvidenceEventuallyMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

const baseBinding: CompanionAnchorBinding = {
  conversationAnchorId: 'agent_anchor_TEST',
  agentId: 'agent-test',
};

function makeProps(overrides: Partial<Parameters<typeof CompanionSurface>[0]> = {}) {
  const captureRef: RefObject<AvatarVoiceCaptureSession | null> = { current: null };
  const abortRef: RefObject<AbortController | null> = { current: null };
  return {
    bootstrapHandle: null as BootstrapHandle | null,
    binding: baseBinding,
    anchorKey: 'k',
    companion: initialCompanionState,
    voice: initialVoiceCompanionState,
    shellSettings: defaultAvatarShellSettings,
    compositionState: 'ready',
    setCompanion: vi.fn(),
    setVoice: vi.fn(),
    voiceCaptureSessionRef: captureRef,
    voiceSubmitAbortRef: abortRef,
    beginVoiceOperation: vi.fn(() => 1),
    clearVoiceOperation: vi.fn(),
    isVoiceOperationCurrent: vi.fn(() => true),
    onSettingsToggle: vi.fn(),
    settingsOpen: false,
    ...overrides,
  };
}

function createBootstrapHandle(): BootstrapHandle {
  return {
    getVoiceInputAvailability: vi.fn(async () => ({ available: true, reason: null })),
    startVoiceCapture: vi.fn(),
    submitVoiceCaptureTurn: vi.fn(),
    cancelCompanionParticipation: vi.fn(async () => ({
      projectionId: 'companion_participation_projection/agent_anchor_TEST/avatar_companion/turn-1',
      agentId: baseBinding.agentId,
      surfaceKind: 'avatar_companion',
      profileRef: 'runtime.agent.profile/agent-test',
      roomOrchestrationRef: 'runtime.room_orchestration/avatar_companion_presentation_room',
      triggerSource: 'user_explicit',
      status: 'canceled',
      auditRef: 'runtime.audit.companion_participation/agent_anchor_TEST',
      conversationAnchorId: baseBinding.conversationAnchorId,
      turnId: 'turn-1',
    })),
    requestCompanionParticipation: vi.fn(),
    shutdown: vi.fn(),
  } as unknown as BootstrapHandle;
}

function StatefulCompanionSurface() {
  const [companion, setCompanion] = useState(initialCompanionState);
  const [voice, setVoice] = useState(initialVoiceCompanionState);
  return (
    <CompanionSurface
      {...makeProps({
        bootstrapHandle: createBootstrapHandle(),
        companion,
        voice,
        setCompanion,
        setVoice,
      })}
    />
  );
}

describe('CompanionSurface - stage-first render', () => {
  it('renders the presence capsule by default and keeps composer tray collapsed', () => {
    render(<CompanionSurface {...makeProps({ bootstrapHandle: createBootstrapHandle() })} />);
    expect(screen.getByTestId('avatar-companion-presence-capsule')).toBeTruthy();
    expect(screen.getByLabelText('Companion status')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Type a message to send to this anchor' })).toBeTruthy();
    expect(screen.queryByTestId('avatar-companion-composer')).toBeNull();
    expect(screen.getByTestId('avatar-companion-surface').getAttribute('data-presence-state')).toBe('idle');
    expect(screen.getByTestId('avatar-companion-surface').getAttribute('data-privacy-indicator')).toBe('mic_idle');
  });

  it('expands the composer tray only after explicit text-entry action', () => {
    render(<StatefulCompanionSurface />);
    fireEvent.click(screen.getByRole('button', { name: 'Type a message to send to this anchor' }));
    expect(screen.getByTestId('avatar-companion-composer')).toBeTruthy();
    expect(screen.getByPlaceholderText(/Type a message/)).toBeTruthy();
  });

  it('disables composer input when bootstrap handle is missing', () => {
    render(
      <CompanionSurface
        {...makeProps({
          companion: { ...initialCompanionState, inputVisible: true },
          bootstrapHandle: null,
        })}
      />,
    );
    const textarea = screen.getByPlaceholderText(/Type a message/) as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);
  });

  it('disables mic button while voice is in pending or replying state', () => {
    render(
      <CompanionSurface
        {...makeProps({
          bootstrapHandle: createBootstrapHandle(),
          voice: { ...initialVoiceCompanionState, status: 'pending' },
        })}
      />,
    );
    const micButton = screen.getByLabelText('Voice input unavailable for this state') as HTMLButtonElement;
    expect(micButton.disabled).toBe(true);
    expect(screen.getByTestId('avatar-companion-surface').getAttribute('data-presence-state')).toBe('turn_pending');
  });

  it('reflects audio playback and lipsync state on the companion surface', () => {
    render(
      <CompanionSurface
        {...makeProps({
          bootstrapHandle: createBootstrapHandle(),
          voice: {
            ...initialVoiceCompanionState,
            lipsyncActive: true,
            audioPlaybackState: 'started',
          },
        })}
      />,
    );
    const surface = screen.getByTestId('avatar-companion-surface');
    expect(surface.getAttribute('data-presence-state')).toBe('assistant_speaking');
    expect(surface.getAttribute('data-privacy-indicator')).toBe('speaker_active');
    expect(surface.getAttribute('data-audio-playback-state')).toBe('started');
    expect(surface.getAttribute('data-lipsync-active')).toBe('true');
    expect(surface.className).toContain('avatar-companion-surface--audio-active');
    expect(surface.className).toContain('avatar-companion-surface--lipsync-active');
  });

  it('emits lifecycle and privacy evidence for presence state projection', () => {
    render(
      <CompanionSurface
        {...makeProps({
          bootstrapHandle: createBootstrapHandle(),
          voice: {
            ...initialVoiceCompanionState,
            status: 'listening',
          },
        })}
      />,
    );

    expect(recordAvatarEvidenceEventuallyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'avatar.audio.lifecycle.state_changed',
        detail: expect.objectContaining({
          to_state: 'foreground_listening',
          voice_status: 'listening',
        }),
      }),
    );
    expect(recordAvatarEvidenceEventuallyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'avatar.audio.privacy.indicator_changed',
        detail: expect.objectContaining({
          indicator: 'mic_active',
          foreground_only: true,
        }),
      }),
    );
  });
});

describe('CompanionSurface - composition evidence emit', () => {
  it('emits avatar.composition.surface-mounted on mount with composition_state', () => {
    render(<CompanionSurface {...makeProps({ compositionState: 'ready' })} />);
    expect(recordAvatarEvidenceEventuallyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'avatar.composition.surface-mounted',
        detail: expect.objectContaining({
          surface: 'companion-surface',
          composition_state: 'ready',
        }),
      }),
    );
  });

  it('emits avatar.composition.surface-unmounted on unmount', () => {
    const { unmount } = render(<CompanionSurface {...makeProps({ compositionState: 'fixture_active' })} />);
    recordAvatarEvidenceEventuallyMock.mockClear();
    unmount();
    expect(recordAvatarEvidenceEventuallyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'avatar.composition.surface-unmounted',
        detail: expect.objectContaining({
          surface: 'companion-surface',
          composition_state: 'fixture_active',
        }),
      }),
    );
  });
});

describe('CompanionSurface - participation controls', () => {
  it('fails closed when companion participation returns an incomplete projection', async () => {
    const bootstrapHandle = {
      ...createBootstrapHandle(),
      requestCompanionParticipation: vi.fn(async () => ({
        projectionId: 'companion_participation_projection/agent_anchor_TEST/avatar_companion/turn-1',
        agentId: baseBinding.agentId,
        surfaceKind: 'avatar_companion',
        profileRef: 'runtime.agent.profile/agent-test',
        roomOrchestrationRef: 'runtime.room_orchestration/avatar_companion_presentation_room',
        triggerSource: 'user_explicit',
        status: 'running',
        conversationAnchorId: baseBinding.conversationAnchorId,
        turnId: 'turn-1',
      })),
    } as unknown as BootstrapHandle;
    const setCompanion = vi.fn();
    render(
      <CompanionSurface
        {...makeProps({
          bootstrapHandle,
          companion: { ...initialCompanionState, inputVisible: true, draft: 'hello' },
          setCompanion,
        })}
      />,
    );

    fireEvent.submit(screen.getByTestId('avatar-companion-composer'));

    await waitFor(() => {
      const finalUpdater = setCompanion.mock.calls.at(-1)?.[0];
      expect(typeof finalUpdater).toBe('function');
      const finalState = finalUpdater({
        ...initialCompanionState,
        sendState: 'sending',
        draft: '',
      });
      expect(finalState.sendState).toBe('error');
      expect(finalState.sendError).toContain('missing auditRef');
      expect(finalState.draft).toBe('hello');
      expect(finalState.inputVisible).toBe(true);
    });
  });

  it('routes interrupt through companion participation cancel', async () => {
    const bootstrapHandle = createBootstrapHandle();
    render(
      <CompanionSurface
        {...makeProps({
          bootstrapHandle,
          voice: { ...initialVoiceCompanionState, status: 'replying', currentTurnId: 'turn-1' },
        })}
      />,
    );

    fireEvent.click(screen.getByLabelText('Interrupt current reply'));

    await waitFor(() => {
      expect(bootstrapHandle.cancelCompanionParticipation).toHaveBeenCalledWith({
        agentId: 'agent-test',
        conversationAnchorId: 'agent_anchor_TEST',
        turnId: 'turn-1',
        reason: 'avatar_voice_interrupt',
      });
    });
  });
});
