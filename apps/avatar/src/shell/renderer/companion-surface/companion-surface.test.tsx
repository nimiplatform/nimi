import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRef, useState, type RefObject } from 'react';
import type { BootstrapHandle } from '../app-shell/app-bootstrap.js';
import type { CompanionAnchorBinding } from '../companion-state.js';
import { defaultAvatarShellSettings } from '../settings-state.js';
import type { AvatarVoiceCaptureSession } from '../voice-capture.js';
import { initialVoiceCompanionState, type VoiceCompanionState } from '../voice-companion-state.js';
import { CompanionSurface, shouldMountCompanionSurface } from './companion-surface.js';

afterEach(() => vi.clearAllMocks());

const baseBinding: CompanionAnchorBinding = {
  conversationAnchorId: 'agent_anchor_TEST',
  agentHandle: 'agent-test',
};

function createBootstrapHandle(overrides: Partial<BootstrapHandle> = {}): BootstrapHandle {
  return {
    getVoiceInputAvailability: vi.fn(async () => ({ available: true, reason: null })),
    startVoiceCapture: vi.fn(),
    submitVoiceCaptureTurn: vi.fn(),
    interruptConversationTurn: vi.fn(async () => undefined),
    sendConversationText: vi.fn(async () => ({ turnId: 'turn-1' })),
    activateCommittedPresentation: vi.fn(async () => undefined),
    shutdown: vi.fn(async () => undefined),
    ...overrides,
  } as BootstrapHandle;
}

function makeProps(overrides: Partial<Parameters<typeof CompanionSurface>[0]> = {}) {
  const captureRef: RefObject<AvatarVoiceCaptureSession | null> = { current: null };
  const abortRef: RefObject<AbortController | null> = { current: null };
  return {
    bootstrapHandle: createBootstrapHandle(),
    binding: baseBinding,
    anchorKey: 'agent-test::agent_anchor_TEST',
    voice: {
      ...initialVoiceCompanionState,
      panelVisible: true,
      availability: 'ready' as const,
    },
    shellSettings: defaultAvatarShellSettings,
    compositionState: 'ready',
    setVoice: vi.fn(),
    voiceCaptureSessionRef: captureRef,
    voiceSubmitAbortRef: abortRef,
    beginVoiceOperation: vi.fn(() => 1),
    clearVoiceOperation: vi.fn(),
    isVoiceOperationCurrent: vi.fn(() => true),
    onExplicitEngage: vi.fn(),
    onOpenTextInput: vi.fn(),
    onInterruptLocalCleanup: vi.fn(),
    onInterruptFailure: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

function StatefulSurface(props: {
  bootstrapHandle: BootstrapHandle;
  initialVoice?: VoiceCompanionState;
}) {
  const [voice, setVoice] = useState<VoiceCompanionState>(props.initialVoice ?? {
    ...initialVoiceCompanionState,
    panelVisible: true,
    availability: 'ready',
  });
  const captureRef = useRef<AvatarVoiceCaptureSession | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  return <CompanionSurface {...makeProps({
    bootstrapHandle: props.bootstrapHandle,
    voice,
    setVoice,
    voiceCaptureSessionRef: captureRef,
    voiceSubmitAbortRef: abortRef,
  })} />;
}

describe('CompanionSurface', () => {
  it('is event-driven and contains no durable composer, settings, or history surface', () => {
    expect(shouldMountCompanionSurface(initialVoiceCompanionState)).toBe(false);
    expect(shouldMountCompanionSurface({
      ...initialVoiceCompanionState,
      panelVisible: true,
    })).toBe(true);
    expect(shouldMountCompanionSurface({
      ...initialVoiceCompanionState,
      audioPlaybackState: 'completed',
    })).toBe(false);

    render(<CompanionSurface {...makeProps()} />);
    expect(screen.getByTestId('avatar-companion-presence-capsule')).toBeTruthy();
    expect(screen.queryByTestId('avatar-companion-composer')).toBeNull();
    expect(screen.queryByLabelText(/settings/i)).toBeNull();
    expect((screen.getByLabelText('Start voice input') as HTMLButtonElement).disabled).toBe(false);
  });

  it('uses explicit click-to-start and click-to-stop before canonical transcription/send', async () => {
    const capture: AvatarVoiceCaptureSession = {
      stop: vi.fn(async () => ({
        bytes: new Uint8Array([1, 2, 3]),
        mimeType: 'audio/webm',
      })),
      cancel: vi.fn(),
    };
    const bootstrapHandle = createBootstrapHandle({
      startVoiceCapture: vi.fn(async () => capture),
      submitVoiceCaptureTurn: vi.fn(async () => ({ transcript: 'hello there' })),
    });
    render(<StatefulSurface bootstrapHandle={bootstrapHandle} />);

    fireEvent.click(screen.getByLabelText('Start voice input'));
    await waitFor(() => expect(
      (screen.getByLabelText('Stop and send voice input') as HTMLButtonElement).disabled,
    ).toBe(false));
    expect(bootstrapHandle.submitVoiceCaptureTurn).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('Stop and send voice input'));
    await waitFor(() => expect(bootstrapHandle.submitVoiceCaptureTurn).toHaveBeenCalledWith({
      agentHandle: 'agent-test',
      conversationAnchorId: 'agent_anchor_TEST',
      audioBytes: new Uint8Array([1, 2, 3]),
      mimeType: 'audio/webm',
      language: expect.any(String),
      signal: expect.any(AbortSignal),
    }));
    expect(await screen.findByText('hello there')).toBeTruthy();
  });

  it('maps typed invalid voice input to a user-facing retry message', async () => {
    const capture: AvatarVoiceCaptureSession = {
      stop: vi.fn(async () => ({ bytes: new Uint8Array([0]), mimeType: 'audio/webm' })),
      cancel: vi.fn(),
    };
    const invalid = Object.assign(new Error('SDK_LOCAL_APP_INPUT_INVALID: empty audio'), {
      code: 'SDK_LOCAL_APP_INPUT_INVALID',
    });
    const bootstrapHandle = createBootstrapHandle({
      startVoiceCapture: vi.fn(async () => capture),
      submitVoiceCaptureTurn: vi.fn(async () => { throw invalid; }),
    });
    render(<StatefulSurface bootstrapHandle={bootstrapHandle} />);
    fireEvent.click(screen.getByLabelText('Start voice input'));
    await waitFor(() => expect(
      (screen.getByLabelText('Stop and send voice input') as HTMLButtonElement).disabled,
    ).toBe(false));
    fireEvent.click(screen.getByLabelText('Stop and send voice input'));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Voice input could not be processed; try again.',
    );
    expect(screen.queryByText(/SDK_LOCAL_APP_INPUT_INVALID/)).toBeNull();
  });

  it('shows interrupt request pending and failure without claiming owner acknowledgment', async () => {
    const onInterruptLocalCleanup = vi.fn();
    const onInterruptFailure = vi.fn();
    const bootstrapHandle = createBootstrapHandle({
      interruptConversationTurn: vi.fn(async () => {
        throw new Error('Runtime rejected interrupt');
      }),
    });
    render(<CompanionSurface {...makeProps({
      bootstrapHandle,
      onInterruptLocalCleanup,
      onInterruptFailure,
      voice: {
        ...initialVoiceCompanionState,
        panelVisible: true,
        availability: 'ready',
        status: 'idle',
        audioPlaybackState: 'started',
      },
    })} />);

    fireEvent.click(screen.getByLabelText('Interrupt current reply'));
    expect(onInterruptLocalCleanup).toHaveBeenCalledOnce();
    expect(screen.getByText('Interrupting…')).toBeTruthy();
    expect(await screen.findByText('Interrupt failed')).toBeTruthy();
    expect(onInterruptFailure).toHaveBeenCalledWith('Runtime rejected interrupt');
  });
});
