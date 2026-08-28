import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { AgentCenter } from '../src/components/AgentCenter.js';
import { projectAgentCenterManagerSourceContext } from '../src/source-context-projection.js';
import type { AgentCenterAppManagerSnapshot } from '../src/types.js';
import { sessionFor } from './session-fixture.js';

const LANES = [
  'runtime_policy',
  'output_contract',
  'source_identity',
  'canonical_memory',
  'conversation_history',
  'current_user_turn',
] as const;

function manager(
  overrides: Partial<AgentCenterAppManagerSnapshot> = {},
): AgentCenterAppManagerSnapshot {
  return {
    lifecycleStatus: 'active',
    executionState: 'idle',
    statusText: 'Ready',
    currentEmotion: 'calm',
    source: {
      ready: true,
      state: 'ready',
      reasonCode: 'none',
      capturedAt: { seconds: '1783731723', nanos: 0 },
      coverageSections: [
        { section: 'identity', state: 'complete', requiredCount: 1, resolvedCount: 1, omittedCount: 0 },
        { section: 'knowledge', state: 'complete', requiredCount: 2, resolvedCount: 2, omittedCount: 0 },
        { section: 'assets', state: 'optional_omitted', requiredCount: 0, resolvedCount: 0, omittedCount: 1 },
      ],
      lorebookReady: true,
      lorebookItemCount: 3,
      lorebookEstimatedTokens: '1615',
    },
    context: {
      ready: true,
      state: 'ready',
      reasonCode: 'none',
      lanes: LANES.map((laneId) => ({
        laneId,
        state: 'included',
        includedItemCount: 1,
        omittedItemCount: 0,
        truncatedItemCount: 0,
        allocatedTokens: '10',
        usedTokens: '1',
      })),
      inputBudgetTokens: '775',
      usedTokens: '11',
      requiredInputTokens: '600',
      requiredContextWindowTokens: '825',
      truncation: [{ reason: 'none', omittedItemCount: 0, truncatedItemCount: 0 }],
      transcriptTurnCount: 3,
      memoryItemCount: 2,
      mediaCount: 0,
      toolCount: 0,
      sourceAdapterStatus: 'ready',
      sourceSelectionStatus: 'ready',
      conversationSummaryStatus: 'ready',
      privateRecallCount: 1,
    },
    ...overrides,
  };
}

describe('Agent Center canonical Manager source/context projection', () => {
  it('projects only bounded safe source and context summaries', () => {
    const projected = projectAgentCenterManagerSourceContext(manager());
    expect(projected).toMatchObject({
      status: 'ready',
      source: {
        ready: true,
        coverage: {
          totalSections: 3,
          completeSections: 2,
          omittedSections: 1,
          requiredItemCount: 3,
          resolvedItemCount: 3,
          omittedItemCount: 1,
        },
        lorebookItemCount: 3,
      },
      context: {
        budget: { inputBudgetTokens: '775', requiredInputTokens: '600' },
        memoryItemCount: 2,
        privateRecallCount: 1,
      },
    });
    expect(JSON.stringify(projected)).not.toMatch(
      /localAgentRef|ownerUserId|runtimeSourceRef|sourceRef|prompt|reasoning|hash|generation|provider|storage/u,
    );
  });

  it('fails closed for contradictory Manager state and preserves blocked/unknown states', () => {
    expect(projectAgentCenterManagerSourceContext(null).status).toBe('unknown');
    expect(projectAgentCenterManagerSourceContext(manager({ context: null })).status).toBe('unknown');
    expect(projectAgentCenterManagerSourceContext(manager({
      source: {
        ...manager().source!, ready: false, state: 'validating', reasonCode: 'source_validation_pending',
      },
      context: null,
    })).status).toBe('blocked');
    expect(projectAgentCenterManagerSourceContext(manager({
      source: null,
      context: manager().context,
    })).status).toBe('failed');
  });

  it('marks bounded omissions as truncated', () => {
    const context = manager().context!;
    expect(projectAgentCenterManagerSourceContext(manager({
      context: {
        ...context,
        truncation: [{ reason: 'optional_content_omitted', omittedItemCount: 1, truncatedItemCount: 0 }],
      },
    })).status).toBe('truncated');
  });

  it('renders typed current and required capacity with the Machine Loadout owner action', async () => {
    const context = manager().context!;
    const session = await sessionFor({
      manager: manager({
        context: {
          ...context,
          ready: false,
          state: 'context_capacity_exceeded',
          reasonCode: 'context_capacity_exceeded',
          requiredInputTokens: '776',
          requiredContextWindowTokens: '1001',
          truncation: [{ reason: 'context_capacity_exceeded', omittedItemCount: 0, truncatedItemCount: 0 }],
        },
      }),
    });
    const openMachineLoadout = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(createElement(AgentCenter, {
          activeSection: 'advanced',
          placementActions: { openMachineLoadout },
          session,
        }));
      });
      expect(container.textContent).toContain('775 current, 776 required tokens');
      const action = Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('Open Machine Loadouts'));
      expect(action).toBeTruthy();
      act(() => { action?.click(); });
      expect(openMachineLoadout).toHaveBeenCalledWith('text.generate');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});
