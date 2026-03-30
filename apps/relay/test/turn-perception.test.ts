import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { perceiveTurn } from '../src/main/chat-pipeline/turn-perception.js';

describe('perceiveTurn', () => {
  it('returns an explicit failed perception state instead of heuristic turn mode fallback', async () => {
    const aiClient = {
      generateObject: async () => {
        throw new Error('perception offline');
      },
    };

    const result = await perceiveTurn({
      aiClient: aiClient as never,
      invokeInput: {
        capability: 'text.generate',
        prompt: 'prompt',
        agentId: 'agent-1',
        mode: 'STORY',
      },
      userText: 'tell me more',
      snapshot: null,
      memorySlots: [],
      recentTurns: [],
      promptLocale: 'en',
    });

    assert.equal(result.status, 'failed');
    assert.equal(result.turnMode, null);
    assert.equal(result.failureReason, 'perception offline');
    assert.equal(result.conversationDirective, null);
    assert.deepEqual(result.relevantMemoryIds, []);
    assert.equal(result.intimacyCeiling, 'friendly');
  });
});
