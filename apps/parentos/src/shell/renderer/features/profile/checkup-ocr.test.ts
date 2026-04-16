import { describe, expect, it } from 'vitest';
import { parseCheckupOCRResponse } from './checkup-ocr.js';

describe('checkup OCR parser', () => {
  it('accepts structured OCR measurement candidates for supported growth types', () => {
    const parsed = parseCheckupOCRResponse(JSON.stringify({
      measurements: [
        {
          typeId: 'axial-length-right',
          value: 24.12,
          measuredAt: '2026-03-01',
          notes: 'AL OD',
        },
        {
          typeId: 'corneal-k1-left',
          value: 43.75,
          measuredAt: '2026-03-01',
          notes: null,
        },
      ],
    }));

    expect(parsed.measurements).toEqual([
      {
        typeId: 'axial-length-right',
        value: 24.12,
        measuredAt: '2026-03-01',
        notes: 'AL OD',
      },
      {
        typeId: 'corneal-k1-left',
        value: 43.75,
        measuredAt: '2026-03-01',
        notes: null,
      },
    ]);
  });

  it('accepts OCR output wrapped in markdown code fences', () => {
    const parsed = parseCheckupOCRResponse([
      '```json',
      JSON.stringify({
        measurements: [
          {
            typeId: 'acd-right',
            value: 3.77,
            measuredAt: '2026-04-04',
            notes: 'ACD OD',
          },
        ],
      }, null, 2),
      '```',
    ].join('\n'));

    expect(parsed.measurements).toEqual([
      {
        typeId: 'acd-right',
        value: 3.77,
        measuredAt: '2026-04-04',
        notes: 'ACD OD',
      },
    ]);
  });

  it('accepts OCR output with surrounding prose when it still contains a JSON object', () => {
    const parsed = parseCheckupOCRResponse([
      'Here is the extracted result.',
      '{"measurements":[{"typeId":"lt-left","value":4.21,"measuredAt":"2026-04-04","notes":"LT OS"}]}',
      'Only explicit values were kept.',
    ].join('\n'));

    expect(parsed.measurements).toEqual([
      {
        typeId: 'lt-left',
        value: 4.21,
        measuredAt: '2026-04-04',
        notes: 'LT OS',
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

  it('surfaces a readable error when OCR output does not contain valid JSON', () => {
    try {
      parseCheckupOCRResponse('ACD: 3.77\nAL OD: 24.12');
      throw new Error('expected parser to reject invalid OCR output');
    } catch (error) {
      expect((error as Error).message).not.toMatch(/Unexpected token/);
    }
  });
});
