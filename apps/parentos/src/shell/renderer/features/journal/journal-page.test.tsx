// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import JournalPage from './journal-page.js';
import { useAppStore } from '../../app-shell/app-store.js';

const {
  getJournalEntriesMock,
  insertJournalEntryWithTagsMock,
  saveJournalVoiceAudioMock,
  deleteJournalVoiceAudioMock,
  supportsVoiceRecordingMock,
  startVoiceRecordingMock,
  hasVoiceTranscriptionRuntimeMock,
  transcribeVoiceObservationMock,
  hasJournalTaggingRuntimeMock,
  suggestJournalTagsMock,
} = vi.hoisted(() => ({
  getJournalEntriesMock: vi.fn().mockResolvedValue([]),
  insertJournalEntryWithTagsMock: vi.fn().mockResolvedValue(undefined),
  saveJournalVoiceAudioMock: vi.fn().mockResolvedValue({ path: 'C:/voice/entry-1.webm' }),
  deleteJournalVoiceAudioMock: vi.fn().mockResolvedValue(undefined),
  supportsVoiceRecordingMock: vi.fn(() => true),
  startVoiceRecordingMock: vi.fn(),
  hasVoiceTranscriptionRuntimeMock: vi.fn().mockResolvedValue(true),
  transcribeVoiceObservationMock: vi.fn().mockResolvedValue({
    transcript: 'Observed sharing during block play.',
    artifacts: [],
    trace: { routeDecision: 'local' },
  }),
  hasJournalTaggingRuntimeMock: vi.fn().mockResolvedValue(true),
  suggestJournalTagsMock: vi.fn().mockResolvedValue({
    dimensionId: 'PO-OBS-SOCL-001',
    tags: ['Shared toys'],
  }),
}));

vi.mock('../../bridge/sqlite-bridge.js', () => ({
  getJournalEntries: getJournalEntriesMock,
  insertJournalEntryWithTags: insertJournalEntryWithTagsMock,
}));

vi.mock('../../bridge/journal-audio-bridge.js', () => ({
  saveJournalVoiceAudio: saveJournalVoiceAudioMock,
  deleteJournalVoiceAudio: deleteJournalVoiceAudioMock,
}));

vi.mock('../../engine/observation-matcher.js', () => ({
  getActiveDimensions: (dimensions: unknown) => dimensions,
}));

vi.mock('../../knowledge-base/index.js', () => ({
  OBSERVATION_MODES: [
    {
      modeId: 'quick-capture',
      displayName: 'Quick Capture',
      duration: '< 1 min',
      guidancePrompt: 'Capture a quick note.',
    },
    {
      modeId: 'focused-observation',
      displayName: 'Focused Observation',
      duration: '10-15 min',
      guidancePrompt: 'Observe quietly.',
    },
    {
      modeId: 'daily-reflection',
      displayName: 'Daily Reflection',
      duration: '2-3 min',
      guidancePrompt: 'Reflect on the day.',
    },
    {
      modeId: 'five-minute',
      displayName: 'Five Minute',
      duration: '< 1 min',
      guidancePrompt: null,
    },
  ],
  OBSERVATION_DIMENSIONS: [
    {
      dimensionId: 'PO-OBS-SOCL-001',
      displayName: 'Social interaction',
      description: '',
      ageRange: { startMonths: 0, endMonths: -1 },
      parentQuestion: 'How did the child relate to others?',
      observableSignals: [],
      guidedQuestions: ['Who did the child interact with?'],
      quickTags: ['Shared toys', 'Asked for help'],
      source: 'test',
    },
  ],
}));

vi.mock('./voice-observation-recorder.js', () => ({
  supportsVoiceRecording: supportsVoiceRecordingMock,
  startVoiceRecording: startVoiceRecordingMock,
  revokeVoicePreviewUrl: vi.fn(),
}));

vi.mock('./voice-observation-runtime.js', () => ({
  hasVoiceTranscriptionRuntime: hasVoiceTranscriptionRuntimeMock,
  transcribeVoiceObservation: transcribeVoiceObservationMock,
}));

vi.mock('./ai-journal-tagging.js', () => ({
  hasJournalTaggingRuntime: hasJournalTaggingRuntimeMock,
  suggestJournalTags: suggestJournalTagsMock,
}));

describe('JournalPage', () => {
  beforeEach(() => {
    getJournalEntriesMock.mockResolvedValue([]);
    insertJournalEntryWithTagsMock.mockClear();
    saveJournalVoiceAudioMock.mockClear();
    deleteJournalVoiceAudioMock.mockClear();
    supportsVoiceRecordingMock.mockReturnValue(true);
    hasVoiceTranscriptionRuntimeMock.mockResolvedValue(true);
    hasJournalTaggingRuntimeMock.mockResolvedValue(true);
    suggestJournalTagsMock.mockResolvedValue({
      dimensionId: 'PO-OBS-SOCL-001',
      tags: ['Shared toys'],
    });
    transcribeVoiceObservationMock.mockResolvedValue({
      transcript: 'Observed sharing during block play.',
      artifacts: [],
      trace: { routeDecision: 'local' },
    });
    startVoiceRecordingMock.mockResolvedValue({
      stop: vi.fn().mockResolvedValue({
        blob: new Blob(['voice-bytes'], { type: 'audio/webm' }),
        mimeType: 'audio/webm',
        previewUrl: 'blob:voice-preview',
      }),
      cancel: vi.fn(),
    });

    useAppStore.setState({
      activeChildId: 'child-1',
      familyId: 'family-1',
      bootstrapReady: true,
      children: [
        {
          childId: 'child-1',
          familyId: 'family-1',
          displayName: 'Mimi',
          gender: 'female',
          birthDate: '2024-01-15',
          birthWeightKg: null,
          birthHeightCm: null,
          birthHeadCircCm: null,
          avatarPath: null,
          nurtureMode: 'balanced',
          nurtureModeOverrides: null,
          allergies: null,
          medicalNotes: null,
          recorderProfiles: [{ id: 'rec-1', name: 'Mom' }],
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
        },
      ],
    });
  });

  afterEach(() => {
    useAppStore.setState({
      activeChildId: null,
      familyId: null,
      bootstrapReady: false,
      children: [],
    });
    vi.clearAllMocks();
  });

  it('surfaces the five-minute observation mode in the journal flow', async () => {
    render(<JournalPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /five minute/i })).toBeTruthy();
    });
  });

  it('applies a closed-set AI tag suggestion and persists confirmed AI tags on save', async () => {
    render(<JournalPage />);

    fireEvent.click(screen.getByRole('button', { name: /quick capture/i }));
    fireEvent.change(screen.getByPlaceholderText(/write what you observed/i), {
      target: { value: 'She shared the blocks and asked another child for help.' },
    });

    fireEvent.click(screen.getByRole('button', { name: /suggest tags/i }));

    await waitFor(() => {
      expect(screen.getByTestId('tag-suggestion-applied')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(insertJournalEntryWithTagsMock).toHaveBeenCalledWith(expect.objectContaining({
        dimensionId: 'PO-OBS-SOCL-001',
        selectedTags: JSON.stringify(['Shared toys']),
        aiTags: [
          expect.objectContaining({
            domain: 'observation',
            tag: 'Shared toys',
            source: 'ai',
          }),
        ],
      }));
    });
  });

  it('saves a mixed journal entry after successful local transcription', async () => {
    render(<JournalPage />);

    fireEvent.click(screen.getByRole('button', { name: /quick capture/i }));
    fireEvent.click(screen.getByRole('button', { name: /^voice$/i }));
    fireEvent.click(screen.getByRole('button', { name: /start recording/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /stop recording/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /stop recording/i }));

    await waitFor(() => {
      expect(screen.getByTestId('voice-preview')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /transcribe/i }));

    await waitFor(() => {
      expect(screen.getByDisplayValue('Observed sharing during block play.')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /save voice observation/i }));

    await waitFor(() => {
      expect(saveJournalVoiceAudioMock).toHaveBeenCalledTimes(1);
      expect(insertJournalEntryWithTagsMock).toHaveBeenCalledWith(expect.objectContaining({
        contentType: 'mixed',
        textContent: 'Observed sharing during block play.',
        voicePath: 'C:/voice/entry-1.webm',
      }));
    });
  });

  it('saves a voice-only journal entry when transcription runtime is unavailable', async () => {
    hasVoiceTranscriptionRuntimeMock.mockResolvedValue(false);

    render(<JournalPage />);

    fireEvent.click(screen.getByRole('button', { name: /quick capture/i }));
    fireEvent.click(screen.getByRole('button', { name: /^voice$/i }));
    fireEvent.click(screen.getByRole('button', { name: /start recording/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /stop recording/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /stop recording/i }));

    await waitFor(() => {
      expect(screen.getByTestId('voice-preview')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /save voice observation/i }));

    await waitFor(() => {
      expect(insertJournalEntryWithTagsMock).toHaveBeenCalledWith(expect.objectContaining({
        contentType: 'voice',
        textContent: null,
        voicePath: 'C:/voice/entry-1.webm',
      }));
    });
  });

  it('lets the parent cancel a voice draft without persisting a journal row', async () => {
    render(<JournalPage />);

    fireEvent.click(screen.getByRole('button', { name: /quick capture/i }));
    fireEvent.click(screen.getByRole('button', { name: /^voice$/i }));
    fireEvent.click(screen.getByRole('button', { name: /start recording/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /stop recording/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /stop recording/i }));

    await waitFor(() => {
      expect(screen.getByTestId('voice-preview')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    await waitFor(() => {
      expect(screen.queryByTestId('voice-preview')).toBeNull();
    });

    expect(insertJournalEntryWithTagsMock).not.toHaveBeenCalled();
    expect(saveJournalVoiceAudioMock).not.toHaveBeenCalled();
  });
});
