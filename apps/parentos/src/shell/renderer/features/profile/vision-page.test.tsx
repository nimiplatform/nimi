// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VisionPage from './vision-page.js';
import { useAppStore } from '../../app-shell/app-store.js';

const {
  getMeasurementsMock,
  getMedicalEventsMock,
  deleteMeasurementMock,
  insertMeasurementMock,
  insertMedicalEventMock,
  analyzeCheckupSheetOCRMock,
  readImageFileAsDataUrlMock,
} = vi.hoisted(() => ({
  getMeasurementsMock: vi.fn().mockResolvedValue([]),
  getMedicalEventsMock: vi.fn().mockResolvedValue([]),
  deleteMeasurementMock: vi.fn().mockResolvedValue(undefined),
  insertMeasurementMock: vi.fn().mockResolvedValue(undefined),
  insertMedicalEventMock: vi.fn().mockResolvedValue(undefined),
  analyzeCheckupSheetOCRMock: vi.fn().mockResolvedValue({
    measurements: [
      {
        typeId: 'axial-length-right',
        value: 24.11,
        measuredAt: '2026-04-12',
        notes: 'AL OD',
      },
      {
        typeId: 'axial-length-left',
        value: 23.98,
        measuredAt: '2026-04-12',
        notes: 'AL OS',
      },
    ],
  }),
  readImageFileAsDataUrlMock: vi.fn().mockResolvedValue('data:image/png;base64,abc'),
}));

vi.mock('../../bridge/sqlite-bridge.js', () => ({
  deleteMeasurement: deleteMeasurementMock,
  getMeasurements: getMeasurementsMock,
  getMedicalEvents: getMedicalEventsMock,
  insertMedicalEvent: insertMedicalEventMock,
  insertMeasurement: insertMeasurementMock,
}));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  LineChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CartesianGrid: () => null,
  Line: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

vi.mock('./checkup-ocr.js', () => ({
  analyzeCheckupSheetOCR: analyzeCheckupSheetOCRMock,
  readImageFileAsDataUrl: readImageFileAsDataUrlMock,
}));

vi.mock('./ai-summary-card.js', () => ({
  AISummaryCard: () => <div>AI Summary</div>,
}));

vi.mock('./vision-guide.js', () => ({
  VisionGuide: () => <div>Vision Guide</div>,
}));

vi.mock('./outdoor-summary-card.js', () => ({
  OutdoorSummaryCard: () => <div>Outdoor Summary</div>,
}));

describe('VisionPage OCR intake', () => {
  beforeEach(() => {
    getMeasurementsMock.mockClear();
    getMedicalEventsMock.mockClear();
    deleteMeasurementMock.mockClear();
    insertMeasurementMock.mockClear();
    insertMedicalEventMock.mockClear();
    analyzeCheckupSheetOCRMock.mockClear();
    readImageFileAsDataUrlMock.mockClear();

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
          birthDate: '2018-01-15',
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

  it('prefills the vision form from OCR and stores confirmed rows as source=ocr', async () => {
    render(
      <MemoryRouter>
        <VisionPage />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('vision-ocr-file'), {
      target: {
        files: [new File(['fake-image'], 'axial-report.png', { type: 'image/png' })],
      },
    });

    let saveButton: HTMLButtonElement;
    await waitFor(() => {
      saveButton = screen.getByLabelText('vision-record-save') as HTMLButtonElement;
      expect(saveButton.disabled).toBe(false);
    });

    fireEvent.click(saveButton!);

    await waitFor(() => {
      expect(insertMeasurementMock).toHaveBeenCalledTimes(2);
    });

    expect(insertMeasurementMock).toHaveBeenCalledWith(expect.objectContaining({
      typeId: 'axial-length-right',
      value: 24.11,
      measuredAt: '2026-04-12',
      source: 'ocr',
      notes: 'AL OD',
    }));
    expect(insertMeasurementMock).toHaveBeenCalledWith(expect.objectContaining({
      typeId: 'axial-length-left',
      value: 23.98,
      measuredAt: '2026-04-12',
      source: 'ocr',
      notes: 'AL OS',
    }));
  });

  it('surfaces a readable OCR model capability error when image input is unsupported', async () => {
    analyzeCheckupSheetOCRMock.mockRejectedValueOnce(
      new Error('当前 AI 对话模型不支持图片识别。请在 AI 设置中切换到支持视觉输入的模型后重试。'),
    );

    render(
      <MemoryRouter>
        <VisionPage />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('vision-ocr-file'), {
      target: {
        files: [new File(['fake-image'], 'axial-report.png', { type: 'image/png' })],
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('vision-ocr-error').textContent).toContain('当前 AI 对话模型不支持图片识别');
    });
    expect(insertMeasurementMock).not.toHaveBeenCalled();
  });
  it('deletes every measurement belonging to a grouped vision record', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    getMeasurementsMock.mockResolvedValueOnce([
      {
        measurementId: 'm-1',
        childId: 'child-1',
        typeId: 'axial-length-right',
        value: 24.11,
        measuredAt: '2026-04-12',
        ageMonths: 99,
        percentile: null,
        source: 'manual',
        notes: null,
        createdAt: '2026-04-12T08:00:00.000Z',
      },
      {
        measurementId: 'm-2',
        childId: 'child-1',
        typeId: 'axial-length-left',
        value: 23.98,
        measuredAt: '2026-04-12',
        ageMonths: 99,
        percentile: null,
        source: 'manual',
        notes: null,
        createdAt: '2026-04-12T08:00:00.000Z',
      },
    ]);

    render(
      <MemoryRouter>
        <VisionPage />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByLabelText('delete-vision-record-2026-04-12'));

    await waitFor(() => {
      expect(deleteMeasurementMock).toHaveBeenCalledTimes(2);
    });

    expect(deleteMeasurementMock).toHaveBeenCalledWith('m-1');
    expect(deleteMeasurementMock).toHaveBeenCalledWith('m-2');
    confirmSpy.mockRestore();
  });
});
