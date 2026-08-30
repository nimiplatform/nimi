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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
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
  const operationRef = useRef<{ id: number; anchorKey: string | null } | null>(null);
  const sequenceRef = useRef(0);
  return <CompanionSurface {...makeProps({
    bootstrapHandle: props.bootstrapHandle,
    voice,
    setVoice,
    voiceCaptureSessionRef: captureRef,
    voiceSubmitAbortRef: abortRef,
    beginVoiceOperation: (anchorKey) => {
      const id = ++sequenceRef.current;
      operationRef.current = { id, anchorKey };
      return id;
    },
    clearVoiceOperation: (id, anchorKey) => {
      if (operationRef.current?.id === id && operationRef.current.anchorKey === anchorKey) {
        operationRef.current = null;
      }
    },
    isVoiceOperationCurrent: (id, anchorKey) => (
      operationRef.current?.id === id && operationRef.current.anchorKey === anchorKey
    ),
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

  it('applies bounded caption size and contrast preferences directly to the surface', () => {
    render(<CompanionSurface {...makeProps({
      shellSettings: {
        ...defaultAvatarShellSettings,
        captionSize: 'large',
        captionContrast: 'high',
      },
      voice: {
        ...initialVoiceCompanionState,
        panelVisible: true,
        availability: 'ready',
        status: 'pending',
        userCaption: {
          text: 'caption', at: '2026-08-30T00:00:00.000Z', messageId: null, turnId: null, live: false,
        },
      },
    })} />);
    const surface = screen.getByTestId('avatar-companion-surface');
    expect(surface.getAttribute('data-caption-size')).toBe('large');
    expect(surface.getAttribute('data-caption-contrast')).toBe('high');
    expect(screen.getByText('caption').getAttribute('aria-live')).toBe('polite');
  });

  it('keeps either terminal idle caption visible until the existing App timeout closes it', () => {
    const terminalCue = {
      at: '2026-08-30T00:00:00.000Z',
      messageId: null,
      turnId: 'turn-terminal',
      live: false,
    };
    const result = render(<CompanionSurface {...makeProps({
      voice: {
        ...initialVoiceCompanionState,
        panelVisible: true,
        availability: 'ready',
        status: 'idle',
        userCaption: { ...terminalCue, text: 'Final user caption' },
      },
    })} />);
    expect(screen.getByText('Final user caption')).toBeTruthy();

    result.rerender(<CompanionSurface {...makeProps({
      voice: {
        ...initialVoiceCompanionState,
        panelVisible: true,
        availability: 'ready',
        status: 'idle',
        assistantCaption: { ...terminalCue, text: 'Final assistant caption' },
      },
    })} />);
    expect(screen.queryByText('Final user caption')).toBeNull();
    expect(screen.getByText('Final assistant caption')).toBeTruthy();
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

  it('shows truthful permission-request state and can cancel before permission resolves', async () => {
    const pending = deferred<AvatarVoiceCaptureSession>();
    const lateCancel = vi.fn();
    const bootstrapHandle = createBootstrapHandle({
      startVoiceCapture: vi.fn(() => pending.promise),
    });
    render(<StatefulSurface bootstrapHandle={bootstrapHandle} />);

    fireEvent.click(screen.getByLabelText('Start voice input'));
    expect(await screen.findByText('Requesting microphone permission…')).toBeTruthy();
    const surface = screen.getByTestId('avatar-companion-surface');
    expect(surface.getAttribute('data-presence-state')).toBe('requesting_permission');
    expect(surface.getAttribute('data-privacy-indicator')).toBe('mic_idle');
    expect(screen.queryByText('Listening…')).toBeNull();
    expect((screen.getByLabelText('Close companion controls') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByLabelText('Cancel and discard voice input'));
    expect(await screen.findByText('Idle')).toBeTruthy();
    expect(bootstrapHandle.submitVoiceCaptureTurn).not.toHaveBeenCalled();
    pending.resolve({ stop: vi.fn(), cancel: lateCancel });
    await waitFor(() => expect(lateCancel).toHaveBeenCalledOnce());
  });

  it('keeps Cancel and discard distinct from Stop and send while listening', async () => {
    const cancel = vi.fn();
    const bootstrapHandle = createBootstrapHandle({
      startVoiceCapture: vi.fn(async () => ({ stop: vi.fn(), cancel })),
    });
    render(<StatefulSurface bootstrapHandle={bootstrapHandle} />);
    fireEvent.click(screen.getByLabelText('Start voice input'));
    await screen.findByLabelText('Stop and send voice input');
    expect(screen.getByLabelText('Cancel and discard voice input')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Cancel and discard voice input'));
    expect(cancel).toHaveBeenCalledOnce();
    expect(bootstrapHandle.submitVoiceCaptureTurn).not.toHaveBeenCalled();
    expect(await screen.findByText('Idle')).toBeTruthy();
  });

  it('reports denied permission as blocked without claiming mic capture', async () => {
    const denied = new Error('Permission denied');
    denied.name = 'NotAllowedError';
    const bootstrapHandle = createBootstrapHandle({
      startVoiceCapture: vi.fn(async () => { throw denied; }),
    });
    render(<StatefulSurface bootstrapHandle={bootstrapHandle} />);
    fireEvent.click(screen.getByLabelText('Start voice input'));

    expect((await screen.findByRole('alert')).textContent).toContain('Microphone permission was denied');
    const surface = screen.getByTestId('avatar-companion-surface');
    expect(surface.getAttribute('data-presence-state')).toBe('error');
    expect(surface.getAttribute('data-privacy-indicator')).toBe('mic_blocked');
    expect(screen.queryByText('Listening…')).toBeNull();
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
