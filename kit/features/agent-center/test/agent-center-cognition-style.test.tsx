import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AgentCenter } from '../src/components/AgentCenter.js';
import { sessionFor } from './session-fixture.js';

describe('AgentCenter cognition projection surface', () => {
  it('renders count-only cognition and never private Memory content', async () => {
    const session = await sessionFor({
      inspect: {
        lifecycleStatus: 'active', executionState: 'idle', statusText: 'ready', currentEmotion: 'calm',
        recentCanonicalMemories: [{ summary: 'PRIVATE_MEMORY_CANARY' }], presentationProfile: null,
      } as never,
    });
    const markup = renderToStaticMarkup(<AgentCenter activeSection="cognition" session={session} />);
    expect(markup).toContain('data-agent-center-cognition-surface="read-only-projection"');
    expect(markup).toContain('1');
    expect(markup).not.toContain('PRIVATE_MEMORY_CANARY');
  });
});
