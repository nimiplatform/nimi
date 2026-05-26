import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  join(process.cwd(), 'src/shell/renderer/pages/advisors/advisor-hub-page.tsx'),
  'utf8',
);

describe('AdvisorHubPage contract guards', () => {
  it('loads contract-required role context before advisor streaming', () => {
    expect(source).toContain('useWorldResourceQueries');
    expect(source).toContain('useAgentDetailQuery');
    expect(source).toContain('useAgentSoulPrimeQuery');
    expect(source).toContain('useAgentOriginQuery');
    expect(source).toContain('useRevenuePreviewQuery');
  });

  it('blocks chat and report success until loaded context is ready', () => {
    expect(source).toContain('if (!selectedAdvisor || !advisorContext.ready)');
    expect(source).toContain('Advisor context is not loaded; streaming is blocked.');
    expect(source).toContain('disabled={streaming || !advisorContext.ready}');
    expect(source).toContain('{advisorContext.ready ? (');
  });

  it('builds advisor requests from loaded context instead of generic prompts', () => {
    expect(source).toContain('createAdvisorSystemPrompt(selectedAdvisor, advisorContext.contextData)');
    expect(source).toContain('using only the loaded world context');
    expect(source).toContain('using only the loaded agent context');
    expect(source).toContain('using only the loaded revenue context');
    expect(source).not.toContain('Generate a detailed analysis report in markdown format');
  });
});
