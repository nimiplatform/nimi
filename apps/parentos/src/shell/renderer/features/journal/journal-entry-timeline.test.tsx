// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { JournalEntryTimeline } from './journal-entry-timeline.js';

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (value: string) => value,
}));

vi.mock('../../knowledge-base/index.js', () => ({
  OBSERVATION_DIMENSIONS: [
    {
      dimensionId: 'PO-OBS-SOCL-001',
      displayName: 'Social interaction',
    },
  ],
}));

function createJournalEntry() {
  return {
    entryId: 'entry-1',
    childId: 'child-1',
    contentType: 'text',
    textContent: 'Shared toys with a friend.',
    voicePath: null,
    photoPaths: null,
    recordedAt: '2026-04-05T09:48:00.000Z',
    ageMonths: 27,
    observationMode: 'quick-capture',
    dimensionId: 'PO-OBS-SOCL-001',
    selectedTags: JSON.stringify(['Shared toys']),
    guidedAnswers: null,
    observationDuration: null,
    keepsake: 0,
    moodTag: null,
    recorderId: 'rec-1',
    createdAt: '2026-04-05T09:48:00.000Z',
    updatedAt: '2026-04-05T09:48:00.000Z',
  };
}

describe('JournalEntryTimeline', () => {
  it('calls the AI callback with the clicked entry', () => {
    const entry = createJournalEntry();
    const onAskAiAboutEntry = vi.fn();

    render(
      <JournalEntryTimeline
        entries={[entry]}
        entryFilter="all"
        onFilterChange={() => {}}
        recorderProfiles={[{ id: 'rec-1', name: 'Mom' }]}
        onEditEntry={() => {}}
        onAskAiAboutEntry={onAskAiAboutEntry}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '和 AI 聊这条记录' }));

    expect(onAskAiAboutEntry).toHaveBeenCalledTimes(1);
    expect(onAskAiAboutEntry).toHaveBeenCalledWith(entry);
  });
});
