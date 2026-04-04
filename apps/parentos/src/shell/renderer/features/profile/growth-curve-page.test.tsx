// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GrowthCurvePage from './growth-curve-page.js';
import { useAppStore } from '../../app-shell/app-store.js';

const {
  getMeasurementsMock,
  insertMeasurementMock,
  hasCheckupOCRRuntimeMock,
  analyzeCheckupSheetOCRMock,
} = vi.hoisted(() => ({
  getMeasurementsMock: vi.fn().mockResolvedValue([
    {
      measurementId: 'm-1',
      childId: 'child-1',
      typeId: 'height',
      value: 98,
      measuredAt: '2025-12-10T00:00:00.000Z',
      ageMonths: 143,
      percentile: null,
      source: 'manual',
      notes: null,
      createdAt: '2025-12-10T00:00:00.000Z',
    },
    {
      measurementId: 'm-2',
      childId: 'child-1',
      typeId: 'weight',
      value: 15,
      measuredAt: '2025-12-10T00:00:00.000Z',
      ageMonths: 143,
      percentile: null,
      source: 'manual',
      notes: null,
      createdAt: '2025-12-10T00:00:00.000Z',
    },
  ]),
  insertMeasurementMock: vi.fn().mockResolvedValue(undefined),
  hasCheckupOCRRuntimeMock: vi.fn().mockResolvedValue(true),
  analyzeCheckupSheetOCRMock: vi.fn().mockResolvedValue({
    measurements: [
      {
        typeId: 'height',
        value: 100.2,
        measuredAt: '2026-03-01',
        notes: 'OCR row 1',
      },
      {
        typeId: 'weight',
        value: 16.1,
        measuredAt: '2026-03-01',
        notes: null,
      },
    ],
  }),
}));

vi.mock('../../bridge/sqlite-bridge.js', () => ({
  getMeasurements: getMeasurementsMock,
  insertMeasurement: insertMeasurementMock,
}));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  LineChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CartesianGrid: () => null,
  Line: ({ name }: { name?: string }) => <div>{name ?? 'line'}</div>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

vi.mock('./checkup-ocr.js', () => ({
  hasCheckupOCRRuntime: hasCheckupOCRRuntimeMock,
  analyzeCheckupSheetOCR: analyzeCheckupSheetOCRMock,
  readImageFileAsDataUrl: vi.fn().mockResolvedValue('data:image/png;base64,abc'),
}));

describe('GrowthCurvePage', () => {
  beforeEach(() => {
    getMeasurementsMock.mockClear();
    insertMeasurementMock.mockClear();
    hasCheckupOCRRuntimeMock.mockResolvedValue(true);
    analyzeCheckupSheetOCRMock.mockResolvedValue({
      measurements: [
        {
          typeId: 'height',
          value: 100.2,
          measuredAt: '2026-03-01',
          notes: 'OCR row 1',
        },
        {
          typeId: 'weight',
          value: 16.1,
          measuredAt: '2026-03-01',
          notes: null,
        },
      ],
    });

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
          birthDate: '2015-01-15',
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

  it('renders WHO lines only inside official coverage and fails closed for weight after 120 months', async () => {
    render(
      <MemoryRouter>
        <GrowthCurvePage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(
        screen.getByText(/WHO percentile reference lines \(P3-P97\) are loaded/i),
      ).toBeTruthy();
    });

    const typeSelect = screen.getByRole('combobox');
    fireEvent.change(typeSelect, { target: { value: 'weight' } });

    await waitFor(() => {
      expect(screen.getByText(/covers 0-120 months/i)).toBeTruthy();
    });

    expect(screen.getByText(/Showing recorded measurements only/i)).toBeTruthy();
  });

  it('keeps non-LMS metrics on the static reference-range path', async () => {
    render(
      <MemoryRouter>
        <GrowthCurvePage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeTruthy();
    });

    const typeSelect = screen.getByRole('combobox');
    fireEvent.change(typeSelect, { target: { value: 'vision-left' } });

    await waitFor(() => {
      expect(screen.getByText(/static reference range instead of WHO percentile curves/i)).toBeTruthy();
    });
  });

  it('imports OCR candidates only after parent confirmation and stores them as source=ocr', async () => {
    render(
      <MemoryRouter>
        <GrowthCurvePage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /\+ Import from health sheet \(OCR\)/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /\+ Import from health sheet \(OCR\)/i }));
    fireEvent.change(screen.getByLabelText('checkup-sheet-file'), {
      target: {
        files: [new File(['fake-image'], 'checkup.png', { type: 'image/png' })],
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('ocr-image-name')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /Analyze sheet/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Import selected OCR measurements/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /Import selected OCR measurements/i }));

    await waitFor(() => {
      expect(insertMeasurementMock).toHaveBeenCalledTimes(2);
    });

    expect(insertMeasurementMock).toHaveBeenCalledWith(expect.objectContaining({
      typeId: 'height',
      source: 'ocr',
      notes: 'OCR row 1',
    }));
    expect(insertMeasurementMock).toHaveBeenCalledWith(expect.objectContaining({
      typeId: 'weight',
      source: 'ocr',
      notes: null,
    }));
  });
});
