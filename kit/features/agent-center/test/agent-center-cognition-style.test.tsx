import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AgentCenter } from '../src/components/AgentCenter.js';
import { sessionFor, testManagerActionAvailability } from './session-fixture.js';

describe('AgentCenter cognition projection surface', () => {
  it('projects cognition status only from the canonical Manager and Memory owners', async () => {
    const session = await sessionFor({
      manager: { life: { activities: [], revision:'1',current:null,recent:[],future:[],nextCheckAt:null,waitReason:''},
        conversationContext: null,
        lifecycleStatus: 'active', executionState: 'idle', statusText: 'ready', currentEmotion: 'calm',
        source: null, context: null,
        actionAvailability: testManagerActionAvailability(),
      },
    });
    const markup = renderToStaticMarkup(<AgentCenter activeSection="cognition" session={session} />);
    expect(markup).toContain('data-agent-center-cognition-surface="memory-manager-projection"');
    expect(markup).toContain('Active');
    expect(markup).toContain('Calm');
    expect(markup).not.toContain('Current state is available');
    expect(markup).not.toMatch(/localAgentRef|ownerUserId|runtimeSourceRef|recentCanonicalMemories/u);
  });

  it('renders the bounded Cognition owner projection and Memory controls', async () => {
    const session = await sessionFor({
      cognitionMemory: {
        outcome: 'ready', enabled: true, adoptionRequired: false,
        currentCount: 1, supersededCount: 0, forgottenCount: 0, nextPageToken: null,
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
    expect(markup).toContain('Explicitly stated');
    expect(markup).toContain('Active memories: 1');
    expect(markup).toContain('From your conversation');
    expect(markup).toContain('Correct');
    expect(markup).toContain('Forget');
    expect(markup).toContain('Delete all Memory');
    expect(markup).not.toMatch(/provider-a|model-a|sqlite|generation_ref|ranking_score/iu);
  });

  it.each([
    { outcome: 'ready' as const, enabled: true, expected: 'No saved memories yet' },
    { outcome: 'ready' as const, enabled: false, expected: 'Enable memory to start remembering' },
    { outcome: 'building' as const, enabled: true, expected: 'Organizing memories' },
    { outcome: 'failed' as const, enabled: true, expected: 'Memory processing failed' },
    { outcome: 'unavailable' as const, enabled: true, expected: 'Memory is temporarily unavailable' },
  ])('distinguishes an empty Memory bank from $outcome with enabled=$enabled', async ({ outcome, enabled, expected }) => {
    const session = await sessionFor({
      cognitionMemory: {
        outcome, enabled, adoptionRequired: false, items: [],
        currentCount: 0, supersededCount: 0, forgottenCount: 0, nextPageToken: null,
      },
    });
    const markup = renderToStaticMarkup(<AgentCenter activeSection="cognition" session={session} />);
    expect(markup).toContain(expected);
    if (outcome !== 'ready' || !enabled) expect(markup).not.toContain('No saved memories yet');
    expect(markup).not.toContain('Delete all Memory');
    session.dispose();
  });
});
