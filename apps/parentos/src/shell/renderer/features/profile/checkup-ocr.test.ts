import { describe, expect, it } from 'vitest';
import { parseCheckupOCRResponse } from './checkup-ocr.js';

describe('checkup OCR parser', () => {
  it('accepts structured OCR measurement candidates for supported growth types', () => {
    const parsed = parseCheckupOCRResponse(JSON.stringify({
      measurements: [
        {
          typeId: 'height',
          value: 102.4,
          measuredAt: '2026-03-01',
          notes: 'Row 1',
        },
        {
          typeId: 'weight',
          value: 16.2,
          measuredAt: '2026-03-01',
          notes: null,
        },
      ],
    }));

    expect(parsed.measurements).toEqual([
      {
        typeId: 'height',
        value: 102.4,
        measuredAt: '2026-03-01',
        notes: 'Row 1',
      },
      {
        typeId: 'weight',
        value: 16.2,
        measuredAt: '2026-03-01',
        notes: null,
      },
    ]);
  });

  it('fails closed for unsupported type ids', () => {
    expect(() => parseCheckupOCRResponse(JSON.stringify({
      measurements: [
        {
          typeId: 'blood-pressure',
          value: 1.0,
          measuredAt: '2026-03-01',
          notes: null,
        },
      ],
    }))).toThrow(/unsupported typeId/);
  });

  it('fails closed for non-ISO dates', () => {
    expect(() => parseCheckupOCRResponse(JSON.stringify({
      measurements: [
        {
          typeId: 'height',
          value: 100,
          measuredAt: '2026/03/01',
          notes: null,
        },
      ],
    }))).toThrow(/YYYY-MM-DD/);
  });
});
