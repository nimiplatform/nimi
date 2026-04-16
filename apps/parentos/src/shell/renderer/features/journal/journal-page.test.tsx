// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import JournalPage from './journal-page.js';
import { useAppStore } from '../../app-shell/app-store.js';

const {
  getJournalEntriesMock,
  insertJournalEntryWithTagsMock,
  updateJournalEntryWithTagsMock,
  updateJournalKeepsakeMock,
  deleteJournalEntryMock,
  completeReminderByRuleMock,
  hasJournalTaggingRuntimeMock,
  suggestJournalTagsMock,
} = vi.hoisted(() => ({
  getJournalEntriesMock: vi.fn().mockResolvedValue([]),
  insertJournalEntryWithTagsMock: vi.fn().mockResolvedValue(undefined),
  updateJournalEntryWithTagsMock: vi.fn().mockResolvedValue(undefined),
  updateJournalKeepsakeMock: vi.fn().mockResolvedValue(undefined),
  deleteJournalEntryMock: vi.fn().mockResolvedValue(undefined),
  completeReminderByRuleMock: vi.fn().mockResolvedValue(undefined),
  hasJournalTaggingRuntimeMock: vi.fn().mockResolvedValue(true),
  suggestJournalTagsMock: vi.fn(),
}));

vi.mock('../../bridge/sqlite-bridge.js', () => ({
  getJournalEntries: getJournalEntriesMock,
  insertJournalEntryWithTags: insertJournalEntryWithTagsMock,
  updateJournalEntryWithTags: updateJournalEntryWithTagsMock,
  updateJournalKeepsake: updateJournalKeepsakeMock,
  deleteJournalEntry: deleteJournalEntryMock,
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
  REMINDER_RULES: [
    {
      ruleId: 'PO-REM-GUIDE-001',
      title: 'Observe response to others',
      description: 'Test guidance rule for journal linking.',
      domain: 'language',
      priority: 'P2',
      category: 'guidance',
      actionType: 'observe',
      triggerAge: { startMonths: 0, endMonths: 3 },
      delivery: {
        relaxed: 'card',
        balanced: 'card',
        advanced: 'card',
      },
    },
  ],
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
  hasJournalTaggingRuntime: hasJournalTaggingRuntimeMock,
  suggestJournalTags: suggestJournalTagsMock,
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

function getComposerTextarea() {
  return screen.getByPlaceholderText(/他刚刚做了什么|参考上面的引导问题/i);
}

function createJournalEntry(overrides: Record<string, unknown> = {}) {
  return {
    entryId: 'entry-1',
    childId: 'child-1',
    recordedAt: '2026-04-05T09:48:00.000Z',
    contentType: 'text',
    textContent: '刚才孩子看明朝那些事专注了30分钟。',
    voicePath: null,
    transcriptionText: null,
    dimensionId: 'PO-OBS-SOCL-001',
    selectedTags: JSON.stringify(['Shared toys']),
    moodTag: null,
    recorderId: 'rec-1',
    observationMode: 'quick-capture',
    keepsake: 0,
    guidedAnswers: null,
    aiSuggestedDimensionId: null,
    aiSuggestedTags: null,
    aiSuggestionAccepted: 0,
    subjectiveNotes: null,
    photoPaths: null,
    createdAt: '2026-04-05T09:48:00.000Z',
    updatedAt: '2026-04-05T09:48:00.000Z',
    ...overrides,
  };
}

function installMockLocalStorage() {
  const storage = new Map<string, string>();
  const localStorageMock = {
    getItem(key: string) {
      return storage.has(key) ? storage.get(key)! : null;
    },
    setItem(key: string, value: string) {
      storage.set(key, value);
    },
    removeItem(key: string) {
      storage.delete(key);
    },
    clear() {
      storage.clear();
    },
  };
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: localStorageMock,
  });
  return localStorageMock;
}

describe('JournalPage', () => {
  beforeEach(() => {
    installMockLocalStorage().clear();
    getJournalEntriesMock.mockResolvedValue([]);
    insertJournalEntryWithTagsMock.mockClear();
    updateJournalEntryWithTagsMock.mockClear();
    updateJournalKeepsakeMock.mockClear();
    deleteJournalEntryMock.mockClear();
    completeReminderByRuleMock.mockClear();
    hasJournalTaggingRuntimeMock.mockResolvedValue(true);
    suggestJournalTagsMock.mockReset();
    suggestJournalTagsMock.mockResolvedValue({
      dimensionId: 'PO-OBS-SOCL-001',
      tags: ['Shared toys'],
    });
    window.scrollTo = vi.fn();

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
    installMockLocalStorage().clear();
    useAppStore.setState({
      activeChildId: null,
      familyId: null,
      bootstrapReady: false,
      children: [],
    });
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('renders the current journal composer shell', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /语音记事/i })).toBeTruthy();
    });

    expect(screen.getByRole('button', { name: /^保存$/i })).toBeTruthy();
    expect(getComposerTextarea()).toBeTruthy();
    expect(screen.queryByRole('button', { name: /专项观察/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /阶段复盘/i })).toBeNull();
  });

  it('saves a text journal entry via the confirmation modal', async () => {
    renderPage();

    fireEvent.change(getComposerTextarea(), {
      target: { value: '她刚刚主动把积木递给了朋友。' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^保存$/i }));
    });

    // Modal opens with text preview
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /保存随手记/i })).toBeTruthy();
    });

    // Confirm save inside the modal
    await act(async () => {
      const modalSaveButtons = screen.getAllByRole('button', { name: /^保存/ });
      const confirmBtn = modalSaveButtons.find((btn) => btn.closest('[role="dialog"]'));
      fireEvent.click(confirmBtn!);
    });

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

    fireEvent.change(getComposerTextarea(), {
      target: { value: '今天留意到她会主动回应别人。' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^保存$/i }));
    });

    // Confirm in modal
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /保存随手记/i })).toBeTruthy();
    });
    await act(async () => {
      const modalSaveButtons = screen.getAllByRole('button', { name: /^保存/ });
      const confirmBtn = modalSaveButtons.find((btn) => btn.closest('[role="dialog"]'));
      fireEvent.click(confirmBtn!);
    });

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

  it('triggers AI tag analysis in save confirmation modal, not during writing', async () => {
    renderPage();

    fireEvent.change(getComposerTextarea(), {
      target: { value: '她刚刚主动把玩具递给了朋友，并且耐心等待对方回应。' },
    });

    // AI should NOT be triggered while typing
    expect(suggestJournalTagsMock).not.toHaveBeenCalled();

    // Click save — modal opens
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^保存$/i }));
    });

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /保存随手记/i })).toBeTruthy();
    });

    // AI analysis is triggered inside the modal
    await waitFor(() => {
      expect(suggestJournalTagsMock).toHaveBeenCalledTimes(1);
    });

    expect(suggestJournalTagsMock.mock.calls[0]?.[0]).toMatchObject({
      draftText: '她刚刚主动把玩具递给了朋友，并且耐心等待对方回应。',
    });
  });

  it('silently restores a recent local draft without showing the banner', async () => {
    vi.useFakeTimers();
    const view = renderPage();

    fireEvent.change(getComposerTextarea(), {
      target: { value: '先记下来' },
    });

    await act(async () => {
      vi.advanceTimersByTime(2100);
    });

    expect(screen.getByText(/已自动保存/i)).toBeTruthy();

    vi.useRealTimers();

    await act(async () => {
      view.unmount();
    });

    renderPage();

    // Recent draft (< 5 min) is auto-restored — no banner shown
    expect(screen.queryByRole('button', { name: /继续编辑/i })).toBeNull();
    expect((getComposerTextarea() as HTMLTextAreaElement).value).toBe('先记下来');
  });

  it('shows the recovery banner for old drafts', async () => {
    window.localStorage.setItem('parentos:journal-draft:child-1', JSON.stringify({
      version: 1,
      childId: 'child-1',
      textContent: '很久前的草稿',
      selectedDimension: null,
      selectedTags: [],
      selectedRecorderId: 'rec-1',
      keepsake: false,
      moodTag: null,
      subjectiveNotes: '',
      updatedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    }));

    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /继续编辑/i }));

    expect((getComposerTextarea() as HTMLTextAreaElement).value).toBe('很久前的草稿');
  });

  it('surfaces the draft restore banner again when the page regains focus', async () => {
    renderPage();

    window.localStorage.setItem('parentos:journal-draft:child-1', JSON.stringify({
      version: 1,
      childId: 'child-1',
      textContent: '被打断前的随手记',
      selectedDimension: null,
      selectedTags: [],
      selectedRecorderId: 'rec-1',
      keepsake: false,
      moodTag: null,
      subjectiveNotes: '',
      updatedAt: '2026-04-14T07:30:00.000Z',
    }));

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    fireEvent.click(await screen.findByRole('button', { name: /继续编辑/i }));

    expect((getComposerTextarea() as HTMLTextAreaElement).value).toBe('被打断前的随手记');
  });

  it('clears the local draft after a successful save', async () => {
    vi.useFakeTimers();
    renderPage();

    fireEvent.change(getComposerTextarea(), {
      target: { value: '先记下来' },
    });

    await act(async () => {
      vi.advanceTimersByTime(2100);
    });

    expect(window.localStorage.getItem('parentos:journal-draft:child-1')).toContain('先记下来');
    vi.useRealTimers();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^保存$/i }));
    });

    // Confirm in modal
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /保存随手记/i })).toBeTruthy();
    });
    await act(async () => {
      const modalSaveButtons = screen.getAllByRole('button', { name: /^保存/ });
      const confirmBtn = modalSaveButtons.find((btn) => btn.closest('[role="dialog"]'));
      fireEvent.click(confirmBtn!);
    });

    await waitFor(() => {
      expect(insertJournalEntryWithTagsMock).toHaveBeenCalledTimes(1);
    });

    expect(window.localStorage.getItem('parentos:journal-draft:child-1')).toBeNull();
  });

  it('loads an entry into the composer when editing and saves updates in place', async () => {
    getJournalEntriesMock.mockResolvedValue([createJournalEntry()]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/刚才孩子看明朝那些事专注了30分钟/i)).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /编辑记录/i }));

    await waitFor(() => {
      expect(screen.getByText(/正在编辑 2026-04-05 09:48 的记录/i)).toBeTruthy();
      expect(screen.getByRole('button', { name: /保存修改/i })).toBeTruthy();
    });

    fireEvent.change(getComposerTextarea(), {
      target: { value: '更新后的随手记内容。' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /保存修改/i }));
    });

    await waitFor(() => {
      expect(updateJournalEntryWithTagsMock).toHaveBeenCalledTimes(1);
    });

    expect(updateJournalEntryWithTagsMock.mock.calls[0]?.[0]).toMatchObject({
      entryId: 'entry-1',
      childId: 'child-1',
      textContent: '更新后的随手记内容。',
      recorderId: 'rec-1',
      observationMode: 'quick-capture',
    });
  });

  it('confirms before deleting an entry and removes it from the timeline', async () => {
    getJournalEntriesMock
      .mockResolvedValueOnce([createJournalEntry()])
      .mockResolvedValueOnce([]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/刚才孩子看明朝那些事专注了30分钟/i)).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /删除记录/i }));

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /删除随手记/i })).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /确认删除/i }));
    });

    await waitFor(() => {
      expect(deleteJournalEntryMock).toHaveBeenCalledWith('entry-1');
    });

    await waitFor(() => {
      expect(screen.getByText(/还没有随手记，先写下一条吧/i)).toBeTruthy();
    });
  });
});
