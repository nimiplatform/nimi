// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ShellLayout } from './shell-layout.js';
import { useAppStore } from './app-store.js';

describe('ShellLayout', () => {
  beforeEach(() => {
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
          nurtureModeOverrides: null,
          allergies: null,
          medicalNotes: null,
          recorderProfiles: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          childId: 'child-2',
          familyId: 'family-1',
          displayName: 'Niko',
          gender: 'male',
          birthDate: '2022-06-10',
          birthWeightKg: null,
          birthHeightCm: null,
          birthHeadCircCm: null,
          avatarPath: null,
          nurtureMode: 'advanced',
          nurtureModeOverrides: null,
          allergies: null,
          medicalNotes: null,
          recorderProfiles: null,
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

  it('shows /reports in navigation and lets the active child switch in-place', async () => {
    const { container } = render(
      <MemoryRouter>
        <ShellLayout>
          <div>APP_CONTENT</div>
        </ShellLayout>
      </MemoryRouter>,
    );

    expect(container.querySelector('a[href="/reports"]')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'M' }));
    fireEvent.click(await screen.findByRole('button', { name: /Niko/i }));

    await waitFor(() => {
      expect(useAppStore.getState().activeChildId).toBe('child-2');
    });
  });
});
