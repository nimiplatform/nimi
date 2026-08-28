import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AgentCenter } from '../src/components/AgentCenter.js';
import { sessionFor } from './session-fixture.js';

describe('AgentCenter cognition projection surface', () => {
  it('projects cognition status only from the canonical Manager and Memory owners', async () => {
    const session = await sessionFor({
      manager: {
        lifecycleStatus: 'active', executionState: 'idle', statusText: 'ready', currentEmotion: 'calm',
        source: null, context: null,
      },
    });
    const markup = renderToStaticMarkup(<AgentCenter activeSection="cognition" session={session} />);
    expect(markup).toContain('data-agent-center-cognition-surface="memory-manager-projection"');
    expect(markup).toContain('Current state is available');
    expect(markup).not.toMatch(/localAgentRef|ownerUserId|runtimeSourceRef|recentCanonicalMemories/u);
  });

  it('renders the bounded Cognition owner projection and Memory controls', async () => {
    const session = await sessionFor({
      cognitionMemory: {
        outcome: 'ready', enabled: true, adoptionRequired: false,
        currentCount: 1, supersededCount: 0, forgottenCount: 0,
        items: [{
          memoryId: 'memory-opaque',
          content: 'The user prefers jasmine tea',
          epistemicStatus: 'explicit',
          lifecycle: 'current',
          occurredAt: '2026-08-27T10:00:00Z',
          updatedAt: '2026-08-27T10:00:00Z',
          sourceExplanation: 'Committed user message',
        }],
      },
    });
    const markup = renderToStaticMarkup(<AgentCenter activeSection="cognition" session={session} />);
    expect(markup).toContain('data-agent-center-cognition-surface="memory-manager-projection"');
    expect(markup).toContain('The user prefers jasmine tea');
    expect(markup).toContain('explicit');
    expect(markup).toContain('Committed user message');
    expect(markup).toContain('Correct');
    expect(markup).toContain('Forget');
    expect(markup).toContain('Delete all Memory');
    expect(markup).not.toMatch(/provider-a|model-a|sqlite|generation_ref|ranking_score/iu);
  });
});
