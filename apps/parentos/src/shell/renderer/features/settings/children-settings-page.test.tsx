// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
          ? {
              ...row,
              ...params,
              updatedAt: params.now,
            }
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

  it('creates, edits, and deletes a child while preserving typed recorder profiles', async () => {
    const { container } = renderPage();

    fireEvent.click(screen.getByRole('button', { name: /\+/ }));

    const inputs = container.querySelectorAll('input');
    fireEvent.change(inputs[0] as HTMLInputElement, { target: { value: 'Mimi' } });
    fireEvent.change(container.querySelector('input[type="date"]') as HTMLInputElement, {
      target: { value: '2024-01-15' },
    });
    fireEvent.change(inputs[7] as HTMLInputElement, { target: { value: 'Mom, Dad' } });

    fireEvent.click(screen.getAllByRole('button')[0] as HTMLButtonElement);

    await waitFor(() => {
      expect(createFamily).toHaveBeenCalledTimes(1);
      expect(createChild).toHaveBeenCalledTimes(1);
      expect(useAppStore.getState().children).toHaveLength(1);
    });

    expect(useAppStore.getState().children[0]?.recorderProfiles).toEqual([
      { id: 'recorder-1', name: 'Mom' },
      { id: 'recorder-2', name: 'Dad' },
    ]);

    await act(async () => {
      useAppStore.getState().setActiveChildId('generated-2');
    });

    const editButton = Array.from(container.querySelectorAll('button')).find(
      (button) => !button.textContent?.includes('+') && !button.className.includes('text-red-600'),
    );
    expect(editButton).toBeTruthy();
    fireEvent.click(editButton as HTMLButtonElement);

    await waitFor(() => {
      expect(container.querySelector('input[type="date"]')).toBeTruthy();
    });

    const editInputs = container.querySelectorAll('input');
    fireEvent.change(editInputs[0] as HTMLInputElement, { target: { value: 'Mimi Updated' } });
    fireEvent.change(editInputs[7] as HTMLInputElement, { target: { value: 'Mom, Grandpa' } });
    fireEvent.click(screen.getAllByRole('button')[0] as HTMLButtonElement);

    await waitFor(() => {
      expect(updateChild).toHaveBeenCalledTimes(1);
    });

    expect(useAppStore.getState().children[0]?.displayName).toBe('Mimi Updated');
    expect(useAppStore.getState().children[0]?.recorderProfiles).toEqual([
      { id: 'recorder-1', name: 'Mom' },
      { id: 'recorder-2', name: 'Grandpa' },
    ]);

    const deleteButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.className.includes('text-red-600'),
    );
    expect(deleteButton).toBeTruthy();
    fireEvent.click(deleteButton as HTMLButtonElement);
    fireEvent.click(screen.getAllByRole('button').at(-2) as HTMLButtonElement);

    await waitFor(() => {
      expect(deleteChild).toHaveBeenCalledTimes(1);
      expect(useAppStore.getState().children).toHaveLength(0);
      expect(useAppStore.getState().activeChildId).toBeNull();
    });
  });
});
