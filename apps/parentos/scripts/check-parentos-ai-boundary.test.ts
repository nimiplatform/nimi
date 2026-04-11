import { describe, expect, it } from 'vitest';
import {
  collectBannedWordViolations,
  findProfileBoundaryErrors,
  findReportsBoundaryErrors,
} from './check-parentos-ai-boundary.js';

describe('check-parentos-ai-boundary', () => {
  it('allows reports runtime usage inside the admitted narrative surface', () => {
    const errors = findReportsBoundaryErrors({
      routesSource: '<Route path="/reports" />',
      reportFiles: [
        {
          path: 'features/reports/narrative-prompt.ts',
          content: "filterAIResponse(); runtime.ai.text.stream({ metadata: { surfaceId: 'parentos.report' } });",
        },
      ],
    });

    expect(errors).toEqual([]);
  });

  it('fails when report runtime usage is missing safety markers', () => {
    const errors = findReportsBoundaryErrors({
      routesSource: '<Route path="/reports" />',
      reportFiles: [
        {
          path: 'features/reports/unsafe.ts',
          content: 'runtime.ai.text.stream({});',
        },
      ],
    });

    expect(errors).toEqual(
      expect.arrayContaining([
        'features/reports/unsafe.ts uses report runtime without the parentos.report surface marker',
        'features/reports/unsafe.ts uses report runtime without AI safety filtering',
      ]),
    );
  });

  it('allows admitted profile summary and OCR surfaces', () => {
    const errors = findProfileBoundaryErrors({
      rootPath: '/repo',
      profileFiles: [
        {
          path: '/repo/src/shell/renderer/features/profile/ai-summary-card.tsx',
          content: 'dataContext; filterAIResponse(); runtime.ai.text.generate({ metadata: { surfaceId: `parentos.profile.summary.${domain}` } });',
        },
        {
          path: '/repo/src/shell/renderer/features/profile/checkup-ocr.ts',
          content: 'parseOCRMeasurementExtraction(output.text); runtime.ai.text.generate({ input:[{role:"user", content:[{ type: \'image_url\', imageUrl }]}], metadata: { surfaceId: \'parentos.profile.checkup-ocr\' } });',
        },
        {
          path: '/repo/src/shell/renderer/features/profile/medical-events-page.tsx',
          content: [
            'filterAIResponse(text);',
            'JSON.parse(output.text);',
            "const image = { type: 'image_url', imageUrl };",
            "runtime.ai.text.generate({ metadata: { surfaceId: 'parentos.medical.smart-insight' } });",
            "runtime.ai.text.generate({ metadata: { surfaceId: 'parentos.medical.ocr-intake' } });",
            "runtime.ai.text.generate({ metadata: { surfaceId: 'parentos.medical.event-analysis' } });",
          ].join('\n'),
        },
      ],
    });

    expect(errors).toEqual([]);
  });

  it('fails when profile runtime usage appears on an unadmitted surface', () => {
    const errors = findProfileBoundaryErrors({
      rootPath: '/repo',
      profileFiles: [
        {
          path: '/repo/src/shell/renderer/features/profile/unsafe.ts',
          content: "runtime.ai.text.generate({ metadata: { surfaceId: 'parentos.profile.unsafe' } });",
        },
      ],
    });

    expect(errors).toContain(
      'Unexpected profile AI runtime use in src/shell/renderer/features/profile/unsafe.ts',
    );
  });

  it('ignores banned wording when it appears only inside string literals', () => {
    const errors = collectBannedWordViolations(
      [
        {
          path: '/repo/src/example.tsx',
          content: "const prompt = { label: '屈光异常筛查', desc: '不使用\"异常\"等词汇' };",
        },
      ],
      '/repo',
    );

    expect(errors).toEqual([]);
  });

  it('still flags banned wording in executable non-string contexts', () => {
    const errors = collectBannedWordViolations(
      [
        {
          path: '/repo/src/example.ts',
          content: 'const 异常状态 = computeRisk();',
        },
      ],
      '/repo',
    );

    expect(errors).toEqual([
      "Banned word '异常' found in src/example.ts:1 (non-string, non-comment context)",
    ]);
  });
});
