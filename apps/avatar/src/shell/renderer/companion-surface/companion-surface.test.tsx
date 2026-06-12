// Wave 1 K-NAV-SHELL-COMPANION-001..010 — per-surface unit test for companion-surface.
// Covers render of the 3-layer stack (assistant-bubble / status-row / composer),
// composer enabled/disabled gating, mic disabled gating, and surface-mounted /
// surface-unmounted evidence emit. Heavy dependencies (i18n, voice capture) are
// the real ones; only the evidence emitter is mocked so we can assert spec
// scope K-NAV-SHELL-COMPOSITION-004 evidence.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RefObject } from 'react';
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

describe('CompanionSurface — render', () => {
  it('renders three-layer stack (assistant bubble + status row + composer)', () => {
    render(<CompanionSurface {...makeProps()} />);
    // Composer textarea + send button exist (composer layer).
    expect(screen.getByPlaceholderText('Type a message…')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeTruthy();
    // Status row toolbar exists.
    expect(screen.getByLabelText('Companion status')).toBeTruthy();
  });

  it('disables composer when bootstrap handle is missing', () => {
    render(<CompanionSurface {...makeProps({ bootstrapHandle: null })} />);
    const textarea = screen.getByPlaceholderText('Type a message…') as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);
  });

  it('disables mic button while voice is in pending or replying state', () => {
    render(
      <CompanionSurface
        {...makeProps({
          voice: { ...initialVoiceCompanionState, status: 'pending' },
        })}
      />,
    );
    const micButton = screen.getByLabelText('Start foreground voice listening') as HTMLButtonElement;
    expect(micButton.disabled).toBe(true);
  });
});

describe('CompanionSurface — composition evidence emit', () => {
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

describe('CompanionSurface — participation controls', () => {
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
          companion: { ...initialCompanionState, draft: 'hello' },
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
