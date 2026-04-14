// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChildrenSettingsPage from './children-settings-page.js';
import { useAppStore } from '../../app-shell/app-store.js';

type ChildRow = import('../../bridge/sqlite-bridge.js').ChildRow;

const { createFamily, createChild, deleteChild, getChildren, updateChild } = vi.hoisted(() => ({
  createFamily: vi.fn().mockResolvedValue(undefined),
  createChild: vi.fn(),
  deleteChild: vi.fn(),
  getChildren: vi.fn(),
  updateChild: vi.fn(),
}));

let childRows: ChildRow[] = [];

vi.mock('../../bridge/sqlite-bridge.js', () => ({
  createFamily,
  createChild,
  deleteChild,
  getChildren,
  updateChild,
}));

vi.mock('../../bridge/child-avatar-bridge.js', () => ({
  saveChildAvatar: vi.fn().mockResolvedValue({ path: '/mock/avatar.jpg' }),
}));

vi.mock('../../app-shell/app-select.js', () => ({
  AppSelect: ({ value, onChange, options }: {
    value: string;
    onChange: (value: string) => void;
    options: Array<{ value: string; label: string }>;
  }) => (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
}));

vi.mock('../profile/profile-date-picker.js', () => ({
  ProfileDatePicker: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <input type="date" value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}));

vi.mock('../journal/journal-page-helpers.js', () => ({
  fileToBase64: vi.fn().mockResolvedValue('mockbase64'),
}));

vi.mock('../../bridge/ulid.js', () => {
  let counter = 0;
  return {
    isoNow: () => '2026-04-03T00:00:00.000Z',
    ulid: () => {
      counter += 1;
      return `generated-${counter}`;
    },
  };
});

function renderPage() {
  return render(
    <MemoryRouter>
      <ChildrenSettingsPage />
    </MemoryRouter>,
  );
}

describe('ChildrenSettingsPage', () => {
  beforeEach(() => {
    childRows = [];
    createFamily.mockClear();
    createChild.mockImplementation(async (params: ChildRow & { now: string }) => {
      childRows.push({
        childId: params.childId,
        familyId: params.familyId,
        displayName: params.displayName,
        gender: params.gender,
        birthDate: params.birthDate,
        birthWeightKg: params.birthWeightKg,
        birthHeightCm: params.birthHeightCm,
        birthHeadCircCm: params.birthHeadCircCm,
        avatarPath: params.avatarPath,
        nurtureMode: params.nurtureMode,
        nurtureModeOverrides: params.nurtureModeOverrides,
        allergies: params.allergies,
        medicalNotes: params.medicalNotes,
        recorderProfiles: params.recorderProfiles,
        createdAt: params.now,
        updatedAt: params.now,
      });
    });
    deleteChild.mockImplementation(async (childId: string) => {
      childRows = childRows.filter((row) => row.childId !== childId);
    });
    getChildren.mockImplementation(async (familyId: string) => childRows.filter((row) => row.familyId === familyId));
    updateChild.mockImplementation(async (params: ChildRow & { now: string }) => {
      childRows = childRows.map((row) =>
        row.childId === params.childId
          ? { ...row, ...params, updatedAt: params.now }
          : row,
      );
    });

    useAppStore.setState({
      bootstrapReady: true,
      familyId: null,
      activeChildId: null,
      children: [],
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

  it('creates a child with default recorder and displays it in the list', async () => {
    const { container } = renderPage();

    fireEvent.click(screen.getByRole('button', { name: /添加孩子/i }));

    const nameInput = container.querySelector('input:not([type="file"]):not([type="date"]):not([type="number"])') as HTMLInputElement;
    expect(nameInput).toBeTruthy();
    fireEvent.change(nameInput, { target: { value: 'Mimi' } });

    const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2024-01-15' } });

    fireEvent.click(screen.getByRole('button', { name: /爸爸/i }));
    fireEvent.click(screen.getByRole('button', { name: /添加$/i }));

    await waitFor(() => {
      expect(createFamily).toHaveBeenCalledTimes(1);
      expect(createChild).toHaveBeenCalledTimes(1);
      expect(useAppStore.getState().children).toHaveLength(1);
    });

    const profiles = useAppStore.getState().children[0]?.recorderProfiles;
    expect(profiles).toHaveLength(2);
    expect(profiles![0]!.name).toBe('妈妈');
    expect(profiles![1]!.name).toBe('爸爸');
  });

  it('deletes a child with confirmation', async () => {
    useAppStore.setState({
      bootstrapReady: true,
      familyId: 'fam-1',
      activeChildId: 'child-1',
      children: [{
        childId: 'child-1', familyId: 'fam-1', displayName: 'Mimi', gender: 'female' as const,
        birthDate: '2024-01-15', birthWeightKg: null, birthHeightCm: null, birthHeadCircCm: null,
        avatarPath: null, nurtureMode: 'balanced' as const, nurtureModeOverrides: null,
        allergies: null, medicalNotes: null, recorderProfiles: [{ id: 'r1', name: '妈妈' }],
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      }],
    });
    childRows = [{
      childId: 'child-1', familyId: 'fam-1', displayName: 'Mimi', gender: 'female',
      birthDate: '2024-01-15', birthWeightKg: null, birthHeightCm: null, birthHeadCircCm: null,
      avatarPath: null, nurtureMode: 'balanced', nurtureModeOverrides: null,
      allergies: null, medicalNotes: null, recorderProfiles: JSON.stringify([{ id: 'r1', name: '妈妈' }]),
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }];

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /删除/i }));
    fireEvent.click(screen.getByRole('button', { name: /确认删除/i }));

    await waitFor(() => {
      expect(deleteChild).toHaveBeenCalledTimes(1);
      expect(useAppStore.getState().children).toHaveLength(0);
      expect(useAppStore.getState().activeChildId).toBeNull();
    });
  });
});
