import { describe, expect, it } from 'vitest';
import { extractDraftProposal } from './sector-analyst.js';

describe('sector analyst proposal parsing', () => {
  it('ignores retired market-mapping proposals', () => {
    const parsed = extractDraftProposal([
      '先给一个结论。',
      '```polyinfo-proposal',
      JSON.stringify({
        entityType: 'market-mapping',
        action: 'remap-market',
        title: '旧式映射提案',
      }),
      '```',
    ].join('\n'));

    expect(parsed.content).toBe('先给一个结论。');
    expect(parsed.proposal).toBeNull();
  });
});
