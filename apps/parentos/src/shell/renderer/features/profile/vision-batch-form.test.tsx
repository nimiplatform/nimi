// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BatchForm } from './vision-batch-form.js';

const {
  deleteMeasurementMock,
  insertMeasurementMock,
  updateMeasurementMock,
} = vi.hoisted(() => ({
  deleteMeasurementMock: vi.fn().mockResolvedValue(undefined),
  insertMeasurementMock: vi.fn().mockResolvedValue(undefined),
  updateMeasurementMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../bridge/sqlite-bridge.js', () => ({
  deleteMeasurement: deleteMeasurementMock,
  insertMeasurement: insertMeasurementMock,
  updateMeasurement: updateMeasurementMock,
}));

vi.mock('./checkup-ocr.js', () => ({
  analyzeCheckupSheetOCR: vi.fn(),
  readImageFileAsDataUrl: vi.fn(),
}));

describe('BatchForm editing', () => {
  it('updates an existing vision record instead of inserting duplicate measurements', async () => {
    const onClose = vi.fn();
    const onSave = vi.fn();
    const initialRecord = {
      date: '2026-04-12',
      ageMonths: 99,
      data: new Map<string, number>([
        ['axial-length-right', 24.11],
        ['axial-length-left', 23.98],
      ]),
      measurementsByType: new Map([
        ['axial-length-right', {
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
        }],
        ['axial-length-left', {
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
        }],
      ]),
    };

    render(
      <BatchForm
        childId="child-1"
        birthDate="2018-01-15"
        onSave={onSave}
        onClose={onClose}
        initialRecord={initialRecord}
      />,
    );

    fireEvent.click(screen.getByLabelText('vision-record-save'));

    await waitFor(() => {
      expect(updateMeasurementMock).toHaveBeenCalledTimes(2);
    });

    expect(insertMeasurementMock).not.toHaveBeenCalled();
    expect(deleteMeasurementMock).not.toHaveBeenCalled();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
