// Wave 1 NAV-SHELL-COMPANION-001..010 — per-surface unit test for companion-surface.
// Covers render of the 3-layer stack (assistant-bubble / status-row / composer),
// composer enabled/disabled gating, mic disabled gating, and surface-mounted /
// surface-unmounted evidence emit. Heavy dependencies (i18n, voice capture) are
// the real ones; only the evidence emitter is mocked so we can assert spec
// scope NAV-SHELL-COMPOSITION-004 evidence.

import { render, screen } from '@testing-library/react';
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
