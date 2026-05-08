import { describe, expect, it } from 'vitest';
import aiMessages from '../../../../mock/tables/aiMessages.json';
import growthReports from '../../../../mock/tables/growthReports.json';

type MockAiMessage = { role: string };
type MockGrowthReport = { content: string };

describe('knowledge readiness mock content', () => {
  it('does not seed accepted AI advisor replies from app-local mock tables', () => {
    const messages = aiMessages as MockAiMessage[];
    expect(messages.some((message) => message.role === 'assistant')).toBe(false);
  });

  it('does not seed narrative-ai reports as mock accepted generated advice', () => {
    const reports = growthReports as MockGrowthReport[];
    const formats = reports.map((report) => JSON.parse(report.content) as { format?: string });

    expect(formats.some((content) => content.format === 'narrative-ai')).toBe(false);
  });
});
