// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import JournalPage from './journal-page.js';
import { useAppStore } from '../../app-shell/app-store.js';

const {
  getJournalEntriesMock,
  insertJournalEntryWithTagsMock,
  updateJournalEntryWithTagsMock,
  updateJournalKeepsakeMock,
  completeReminderByRuleMock,
} = vi.hoisted(() => ({
  getJournalEntriesMock: vi.fn().mockResolvedValue([]),
  insertJournalEntryWithTagsMock: vi.fn().mockResolvedValue(undefined),
  updateJournalEntryWithTagsMock: vi.fn().mockResolvedValue(undefined),
  updateJournalKeepsakeMock: vi.fn().mockResolvedValue(undefined),
  completeReminderByRuleMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../bridge/sqlite-bridge.js', () => ({
  getJournalEntries: getJournalEntriesMock,
  insertJournalEntryWithTags: insertJournalEntryWithTagsMock,
  updateJournalEntryWithTags: updateJournalEntryWithTagsMock,
  updateJournalKeepsake: updateJournalKeepsakeMock,
}));

vi.mock('../../bridge/journal-audio-bridge.js', () => ({
  saveJournalVoiceAudio: vi.fn().mockResolvedValue({ path: 'C:/voice/entry-1.webm' }),
  deleteJournalVoiceAudio: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../bridge/journal-photo-bridge.js', () => ({
  saveJournalPhoto: vi.fn().mockResolvedValue({ path: 'C:/photos/journal-1.jpg' }),
  deleteJournalPhoto: vi.fn().mockResolvedValue(undefined),
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
  supportsVoiceRecording: vi.fn(() => true),
  startVoiceRecording: vi.fn(),
  revokeVoicePreviewUrl: vi.fn(),
}));

vi.mock('./voice-observation-runtime.js', () => ({
  hasVoiceTranscriptionRuntime: vi.fn().mockResolvedValue(true),
  transcribeVoiceObservation: vi.fn(),
}));

vi.mock('./ai-journal-tagging.js', () => ({
  hasJournalTaggingRuntime: vi.fn().mockResolvedValue(true),
  suggestJournalTags: vi.fn(),
}));

vi.mock('../../engine/reminder-actions.js', () => ({
  completeReminderByRule: completeReminderByRuleMock,
}));

function renderPage(initialEntry = '/journal') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <JournalPage />
    </MemoryRouter>,
  );
}

describe('JournalPage', () => {
  beforeEach(() => {
    getJournalEntriesMock.mockResolvedValue([]);
    insertJournalEntryWithTagsMock.mockClear();
    updateJournalEntryWithTagsMock.mockClear();
    updateJournalKeepsakeMock.mockClear();
    completeReminderByRuleMock.mockClear();

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

  it('renders the current journal composer shell', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /语音记事/i })).toBeTruthy();
    });

    expect(screen.getByRole('button', { name: /保存并让 ai 分析/i })).toBeTruthy();
    expect(screen.getByPlaceholderText(/他刚刚做了什么/i)).toBeTruthy();
  });

  it('saves a text journal entry from the current composer', async () => {
    renderPage();

    fireEvent.change(screen.getByPlaceholderText(/他刚刚做了什么/i), {
      target: { value: '她刚刚主动把积木递给了朋友。' },
    });

    fireEvent.click(screen.getByRole('button', { name: /保存并让 ai 分析/i }));

    await waitFor(() => {
      expect(insertJournalEntryWithTagsMock).toHaveBeenCalledTimes(1);
    });

    expect(insertJournalEntryWithTagsMock.mock.calls[0]?.[0]).toMatchObject({
      childId: 'child-1',
      contentType: 'text',
      textContent: '她刚刚主动把积木递给了朋友。',
      recorderId: 'rec-1',
    });
  });

  it('completes the linked reminder after save when reminder context is present', async () => {
    renderPage('/journal?reminderRuleId=PO-REM-GUIDE-001&repeatIndex=2');

    fireEvent.change(screen.getByPlaceholderText(/他刚刚做了什么/i), {
      target: { value: '今天留意到她会主动回应别人。' },
    });

    fireEvent.click(screen.getByRole('button', { name: /保存并让 ai 分析/i }));

    await waitFor(() => {
      expect(insertJournalEntryWithTagsMock).toHaveBeenCalledTimes(1);
      expect(completeReminderByRuleMock).toHaveBeenCalledWith({
        childId: 'child-1',
        ruleId: 'PO-REM-GUIDE-001',
        repeatIndex: 2,
        kind: 'guidance',
      });
    });
  });
});
