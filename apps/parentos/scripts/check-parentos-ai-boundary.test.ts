import { describe, expect, it } from 'vitest';
import {
  collectBannedWordViolations,
  findAdvisorBoundaryErrors,
  findProfileBoundaryErrors,
  findReportsBoundaryErrors,
  findSettingsPrivacyErrors,
} from './check-parentos-ai-boundary.js';

describe('check-parentos-ai-boundary', () => {
  it('allows reports runtime usage inside the admitted narrative surface', () => {
    const errors = findReportsBoundaryErrors({
      routesSource: '<Route path="/reports" />',
      reportFiles: [
        {
          path: 'features/reports/narrative-prompt.ts',
          content: "filterAIResponse(); resolveParentosTextRuntimeConfig('parentos.report'); ensureParentosLocalRuntimeReady(); runtime.ai.text.stream({ metadata: buildParentosRuntimeMetadata('parentos.report') });",
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
        'features/reports/unsafe.ts must resolve report runtime params through the governed surface helper',
      ]),
    );
  });

  it('allows admitted profile summary and OCR surfaces', () => {
    const errors = findProfileBoundaryErrors({
      rootPath: '/repo',
      profileFiles: [
        {
          path: '/repo/src/shell/renderer/features/profile/ai-summary-card.tsx',
          content: 'const surfaceId = `parentos.profile.summary.${domain}`; dataContext; filterAIResponse(); resolveParentosTextRuntimeConfig(surfaceId); ensureParentosLocalRuntimeReady(); runtime.ai.text.generate({ metadata: buildParentosRuntimeMetadata(surfaceId) });',
        },
        {
          path: '/repo/src/shell/renderer/features/profile/checkup-ocr.ts',
          content: 'parseOCRMeasurementExtraction(output.text); resolveParentosTextRuntimeConfig(\'parentos.profile.checkup-ocr\'); ensureParentosLocalRuntimeReady(); runtime.ai.text.generate({ input:[{role:"user", content:[{ type: \'image_url\', imageUrl }]}], metadata: buildParentosRuntimeMetadata(\'parentos.profile.checkup-ocr\') });',
        },
        {
          path: '/repo/src/shell/renderer/features/profile/medical-events-page-insights.ts',
          content: [
            'filterAIResponse(text);',
            "resolveParentosTextRuntimeConfig('parentos.medical.smart-insight');",
            'ensureParentosLocalRuntimeReady();',
            "runtime.ai.text.generate({ metadata: buildParentosRuntimeMetadata('parentos.medical.smart-insight') });",
            "resolveParentosTextRuntimeConfig('parentos.medical.event-analysis');",
            'ensureParentosLocalRuntimeReady();',
            "runtime.ai.text.generate({ metadata: buildParentosRuntimeMetadata('parentos.medical.event-analysis') });",
          ].join('\n'),
        },
        {
          path: '/repo/src/shell/renderer/features/profile/medical-events-page-form-state.ts',
          content: [
            'JSON.parse(output.text);',
            "const image = { type: 'image_url', imageUrl };",
            "resolveParentosTextRuntimeConfig('parentos.medical.ocr-intake');",
            'ensureParentosLocalRuntimeReady();',
            "runtime.ai.text.generate({ metadata: buildParentosRuntimeMetadata('parentos.medical.ocr-intake') });",
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

  it('requires advisor snapshot and fail-close markers', () => {
    const errors = findAdvisorBoundaryErrors({
      advisorPageSource: [
        'REVIEWED_DOMAINS',
        'NEEDS_REVIEW_DOMAINS',
        'filterAIResponse',
        'inferRequestedDomains',
        'resolveAdvisorPromptStrategy',
        'buildAdvisorSnapshot',
        'serializeAdvisorSnapshot',
        'buildAdvisorRuntimeUserMessage',
        'buildAdvisorNeedsReviewRuntimeUserMessage',
        'buildAdvisorUnknownClarifierRuntimeUserMessage',
        'buildAdvisorGenericRuntimeUserMessage',
        'buildStructuredAdvisorFallback',
        'appendAdvisorSources',
        "resolveParentosTextRuntimeConfig('parentos.advisor')",
        'ensureParentosLocalRuntimeReady',
        "buildParentosRuntimeMetadata('parentos.advisor')",
        'contextSnapshot: snapshotJson',
        'runtime.ai.text.stream',
        'buildAdvisorRuntimeInput(',
        'shouldAppendAdvisorSources(',
        '运行时响应触发了安全过滤',
      ].join('\n'),
      advisorBoundarySource: [
        'export type AdvisorPromptStrategy',
        "return 'generic-chat';",
        "return 'unknown-clarifier';",
        "return 'reviewed-advice';",
        "return 'needs-review-descriptive';",
      ].join('\n'),
    });

    expect(errors).toEqual([]);
  });

  it('flags settings/privacy drift when cloud controls remain exposed', () => {
    const errors = findSettingsPrivacyErrors({
      settingsPageSource: '所有数据存储在本地，不上传至云端',
      aiSettingsSurfaceSources: [
        {
          path: 'src/shell/renderer/features/settings/ai-settings-page.tsx',
          content: "value: 'cloud'\nConnector ID\nroute、model 和 connector",
        },
      ],
      aiConfigSource: "surfaceId: 'advisor'",
    });

    expect(errors).toEqual(expect.arrayContaining([
      "AI settings must stay local-only while privacy copy says no cloud upload (value: 'cloud' in src/shell/renderer/features/settings/ai-settings-page.tsx)",
      'ParentOS AI config scope must be app-wide (surfaceId: parentos.ai)',
    ]));
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
