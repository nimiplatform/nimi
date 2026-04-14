import { describe, expect, it } from 'vitest';
import {
  appendAdvisorSources,
  buildAdvisorGenericRuntimeUserMessage,
  buildAdvisorNeedsReviewRuntimeUserMessage,
  buildAdvisorUnknownClarifierRuntimeUserMessage,
  buildAdvisorRuntimeUserMessage,
  buildStructuredAdvisorFallback,
  canUseAdvisorGenericRuntime,
  canUseAdvisorRuntime,
  inferRequestedDomains,
  parseAdvisorSnapshot,
  resolveAdvisorPromptStrategy,
  serializeAdvisorSnapshot,
} from './advisor-boundary.js';

const snapshot = {
  child: {
    childId: 'child-1',
    displayName: 'Mimi',
    gender: 'female',
    birthDate: '2024-01-15',
    nurtureMode: 'balanced',
  },
  ageMonths: 14,
  measurements: [
    {
      measurementId: 'm-1',
      childId: 'child-1',
      typeId: 'weight',
      value: 9.2,
      measuredAt: '2025-03-10T08:00:00.000Z',
      ageMonths: 13,
      percentile: null,
      source: 'manual',
      notes: null,
      createdAt: '2025-03-10T08:00:00.000Z',
    },
  ],
  vaccines: [
    {
      recordId: 'v-1',
      childId: 'child-1',
      ruleId: 'PO-REM-VAC-001',
      vaccineName: 'MMR',
      vaccinatedAt: '2025-02-01T08:00:00.000Z',
      ageMonths: 12,
      batchNumber: null,
      hospital: null,
      adverseReaction: null,
      photoPath: null,
      createdAt: '2025-02-01T08:00:00.000Z',
    },
  ],
  milestones: [
    {
      recordId: 'ms-1',
      childId: 'child-1',
      milestoneId: 'PO-MS-LANG-003',
      achievedAt: '2025-01-20T08:00:00.000Z',
      ageMonthsWhenAchieved: 12,
      notes: null,
      photoPath: null,
      createdAt: '2025-01-20T08:00:00.000Z',
      updatedAt: '2025-01-20T08:00:00.000Z',
    },
  ],
  journalEntries: [
    {
      entryId: 'j-1',
      childId: 'child-1',
      contentType: 'text',
      textContent: 'Observed stacking blocks.',
      voicePath: null,
      photoPaths: null,
      recordedAt: '2025-03-11T08:00:00.000Z',
      ageMonths: 13,
      observationMode: 'five-minute',
      dimensionId: 'PO-OBS-CONC-001',
      selectedTags: null,
      guidedAnswers: null,
      observationDuration: 5,
      keepsake: 0,
      moodTag: null,
      recorderId: 'rec-1',
      createdAt: '2025-03-11T08:00:00.000Z',
      updatedAt: '2025-03-11T08:00:00.000Z',
    },
  ],
};

describe('advisor boundary', () => {
  it('allows runtime only for reviewed domains', () => {
    expect(inferRequestedDomains('Need help with sleep and sensitive period routines')).toEqual(
      expect.arrayContaining(['sleep', 'sensitivity']),
    );
    expect(canUseAdvisorRuntime([])).toBe(false);
    expect(canUseAdvisorRuntime(['sleep', 'digital'])).toBe(true);
    expect(canUseAdvisorRuntime(['sleep', 'growth'])).toBe(false);
  });

  it('allows generic advisor chat without opening the unknown-domain path', () => {
    expect(canUseAdvisorRuntime([])).toBe(false);
    expect(canUseAdvisorGenericRuntime('你好，测试，你的模型是？', [])).toBe(true);
    expect(canUseAdvisorGenericRuntime('最近怎么样？', [])).toBe(false);
    expect(resolveAdvisorPromptStrategy('你好，测试，你的模型是？', [])).toBe('generic-chat');
    expect(resolveAdvisorPromptStrategy('最近怎么样？', [])).toBe('unknown-clarifier');
    expect(resolveAdvisorPromptStrategy('How is growth going?', ['growth'])).toBe('needs-review-descriptive');
    expect(resolveAdvisorPromptStrategy('Need help with sleep', ['sleep'])).toBe('reviewed-advice');

    const message = buildAdvisorGenericRuntimeUserMessage('你好，测试，你的模型是？');
    expect(message).toContain('泛闲聊或产品能力澄清');
    expect(message).toContain('用户消息：你好，测试，你的模型是？');
  });

  it('builds descriptive and clarifier runtime prompts for non-reviewed paths', () => {
    const descriptive = buildAdvisorNeedsReviewRuntimeUserMessage('How is growth going?', ['growth'], snapshot);
    expect(descriptive).toContain('描述型回答策略');
    expect(descriptive).toContain('涉及领域：growth');
    expect(descriptive).toContain('"childId":"child-1"');

    const clarifier = buildAdvisorUnknownClarifierRuntimeUserMessage('最近怎么样？', snapshot);
    expect(clarifier).toContain('澄清型回答策略');
    expect(clarifier).toContain('当前本地记录概况');
  });

  it('forces mixed reviewed and needs-review questions back to structured facts', () => {
    const domains = inferRequestedDomains('Need help with sleep and growth together');
    expect(domains).toEqual(expect.arrayContaining(['sleep', 'growth']));
    expect(canUseAdvisorRuntime(domains)).toBe(false);

    const text = buildStructuredAdvisorFallback('Need help with sleep and growth together', domains, snapshot);
    expect(text).toContain('growth');
    expect(text).toContain('Phase 1');
    expect(text).toContain('建议咨询专业人士');
  });

  it('builds structured fallback for needs-review domains', () => {
    const text = buildStructuredAdvisorFallback('How is growth going?', ['growth'], snapshot);
    expect(text).toContain('问题：How is growth going?');
    expect(text).toContain('生长记录：');
    expect(text).toContain('Phase 1 仅返回结构化事实和来源标注');
    expect(text).toContain('建议咨询专业人士');
  });

  it('appends reviewed-domain source labels', () => {
    const text = appendAdvisorSources('Safe answer', ['sleep']);
    expect(text).toContain('Safe answer');
    expect(text).toContain('来源：');
    expect(text).toContain('sleep:');
  });

  it('serializes and parses a frozen advisor snapshot', () => {
    const serialized = serializeAdvisorSnapshot(snapshot);
    expect(parseAdvisorSnapshot(serialized)).toEqual(snapshot);
  });

  it('builds runtime user content from the frozen local snapshot', () => {
    const message = buildAdvisorRuntimeUserMessage('最近睡眠怎么样？', ['sleep'], snapshot);
    expect(message).toContain('问题：最近睡眠怎么样？');
    expect(message).toContain('已判定领域：sleep');
    expect(message).toContain('"childId":"child-1"');
  });
});
