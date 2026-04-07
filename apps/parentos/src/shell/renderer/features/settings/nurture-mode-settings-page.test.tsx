// @vitest-environment jsdom

import { fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NurtureModeSettingsPage from './nurture-mode-settings-page.js';
import { useAppStore } from '../../app-shell/app-store.js';
import { REMINDER_DOMAINS } from '../../knowledge-base/index.js';

const { updateChild } = vi.hoisted(() => ({
  updateChild: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../bridge/sqlite-bridge.js', () => ({
  updateChild,
}));

vi.mock('../../bridge/ulid.js', () => ({
  isoNow: () => '2026-04-03T00:00:00.000Z',
}));

describe('NurtureModeSettingsPage', () => {
  const domain = REMINDER_DOMAINS[0] ?? 'sleep';

  beforeEach(() => {
    updateChild.mockClear();
    useAppStore.setState({
      bootstrapReady: true,
      familyId: 'family-1',
      activeChildId: 'child-1',
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
          nurtureModeOverrides: { [domain]: 'advanced' },
          allergies: ['egg'],
          medicalNotes: ['watch sleep'],
          recorderProfiles: [{ id: 'rec-1', name: 'Mom' }],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
  });

  afterEach(() => {
    useAppStore.setState({
      bootstrapReady: false,
      familyId: null,
      activeChildId: null,
      children: [],
    });
  });

  it('round-trips global mode changes and domain overrides through updateChild/store state', async () => {
    const { container } = render(
      <MemoryRouter>
        <NurtureModeSettingsPage />
      </MemoryRouter>,
    );

    const modeButtons = container.querySelectorAll('button');
    fireEvent.click(modeButtons[0] as HTMLButtonElement);

    await waitFor(() => {
      expect(updateChild).toHaveBeenCalled();
    });

    expect(updateChild.mock.calls[0]?.[0]).toMatchObject({
      childId: 'child-1',
      nurtureMode: 'relaxed',
      recorderProfiles: JSON.stringify([{ id: 'rec-1', name: 'Mom' }]),
      allergies: JSON.stringify(['egg']),
      medicalNotes: JSON.stringify(['watch sleep']),
    });
    expect(useAppStore.getState().children[0]?.nurtureMode).toBe('relaxed');

    const selects = container.querySelectorAll('select');
    fireEvent.change(selects[0] as HTMLSelectElement, { target: { value: 'advanced' } });

    await waitFor(() => {
      expect(updateChild).toHaveBeenCalledTimes(2);
    });

    const persistedOverrides = useAppStore.getState().children[0]?.nurtureModeOverrides ?? null;
    expect(updateChild.mock.calls[1]?.[0]).toMatchObject({
      childId: 'child-1',
      nurtureMode: 'relaxed',
      nurtureModeOverrides: persistedOverrides ? JSON.stringify(persistedOverrides) : null,
    });
    expect(persistedOverrides).not.toBeNull();
  });
});
