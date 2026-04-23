import { describe, expect, it } from 'vitest';
import type { WorldOwnedAgentRoster } from '@renderer/hooks/use-agent-queries.js';
import { planAgentMissingBatchItems, planWorldMissingBatchItems } from './use-asset-ops-batch-queue.js';

describe('use-asset-ops-batch-queue planning', () => {
  it('plans only missing world deliverables and keeps optional families in scope', () => {
    const planned = planWorldMissingBatchItems({
      workspaceId: 'ws-1',
      worldDraft: {
        worldId: 'world-1',
        name: 'Archive Realm',
        description: 'A city of memory.',
        overview: 'Moonlit towers.',
      } as any,
      worldDeliverables: [
        { family: 'world-icon', label: 'Icon', currentState: 'BOUND', opsState: 'BOUND', required: true, bindingPoint: 'WORLD_ICON', objectId: 'r1', value: 'icon' },
        { family: 'world-cover', label: 'Cover', currentState: 'MISSING', opsState: 'MISSING', required: true, bindingPoint: 'WORLD_BANNER', objectId: null, value: null },
        { family: 'world-background', label: 'Background', currentState: 'MISSING', opsState: 'MISSING', required: false, bindingPoint: 'SCENE_BACKGROUND', objectId: null, value: null },
        { family: 'world-scene', label: 'Scene', currentState: 'PRESENT', opsState: 'MISSING', required: false, bindingPoint: 'WORLD_GALLERY', objectId: null, value: null },
      ],
    });

    expect(planned.counts.pendingCount).toBe(2);
    expect(planned.items.map((item) => item.family)).toEqual(['world-cover', 'world-background']);
  });

  it('plans agent batch items in stable family order and skips drafts without canonical ids', () => {
    const roster: WorldOwnedAgentRoster = {
      worldId: 'world-1',
      items: [
        {
          id: 'agent-1',
          handle: 'ari',
          displayName: 'Ari',
          concept: 'Archivist',
          ownershipType: 'WORLD_OWNED',
          worldId: 'world-1',
          status: 'ACTIVE',
          avatarUrl: null,
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
          description: null,
          scenario: null,
          greeting: null,
          deliverables: [
            { family: 'agent-avatar', label: 'Avatar', required: true, currentState: 'MISSING', opsState: 'MISSING', source: 'DIRECT_FIELD', bindingPoint: 'AGENT_AVATAR', objectId: null, value: null },
            { family: 'agent-cover', label: 'Cover', required: false, currentState: 'MISSING', opsState: 'MISSING', source: 'WORLD_BINDING', bindingPoint: 'AGENT_PORTRAIT', objectId: null, value: null },
            { family: 'agent-greeting-primary', label: 'Greeting', required: true, currentState: 'MISSING', opsState: 'MISSING', source: 'DIRECT_FIELD', bindingPoint: 'AGENT_GREETING_PRIMARY', objectId: null, value: null },
            { family: 'agent-voice-demo', label: 'Voice Demo', required: true, currentState: 'MISSING', opsState: 'MISSING', source: 'WORLD_BINDING', bindingPoint: 'AGENT_VOICE_SAMPLE', objectId: null, value: null },
          ],
          completeness: {
            requiredFamilyCount: 3,
            currentReadyCount: 0,
            opsReadyCount: 0,
            boundCount: 0,
            unverifiedCount: 0,
            missingCount: 3,
            currentState: 'MISSING',
            opsState: 'MISSING',
          },
        },
      ],
      summary: {
        worldId: 'world-1',
        agentCount: 1,
        currentCompleteCount: 0,
        opsCompleteCount: 0,
        missingRequiredFamilyCount: 3,
        unverifiedRequiredFamilyCount: 0,
        familyCoverage: {
          'agent-avatar': { currentReadyCount: 0, opsReadyCount: 0, boundCount: 0, unverifiedCount: 0, missingCount: 1 },
          'agent-cover': { currentReadyCount: 0, opsReadyCount: 0, boundCount: 0, unverifiedCount: 0, missingCount: 1 },
          'agent-greeting-primary': { currentReadyCount: 0, opsReadyCount: 0, boundCount: 0, unverifiedCount: 0, missingCount: 1 },
          'agent-voice-demo': { currentReadyCount: 0, opsReadyCount: 0, boundCount: 0, unverifiedCount: 0, missingCount: 1 },
        },
      },
    };

    const planned = planAgentMissingBatchItems({
      workspaceId: 'ws-1',
      worldDraft: {
        worldId: 'world-1',
        name: 'Archive Realm',
        description: 'A city of memory.',
      } as any,
      agentDrafts: {
        'draft-1': {
          draftAgentId: 'draft-1',
          sourceAgentId: 'agent-1',
          ownershipType: 'WORLD_OWNED',
          displayName: 'Ari',
          handle: 'ari',
          concept: 'Archivist',
          description: '',
          scenario: '',
          greeting: '',
        } as any,
        'draft-2': {
          draftAgentId: 'draft-2',
          sourceAgentId: null,
          ownershipType: 'WORLD_OWNED',
          displayName: 'Bea',
          handle: 'bea',
          concept: 'Courier',
          description: '',
          scenario: '',
          greeting: '',
        } as any,
      },
      roster,
    });

    expect(planned.counts.pendingCount).toBe(4);
    expect(planned.counts.skippedCount).toBe(1);
    expect(planned.items.slice(0, 4).map((item) => item.family)).toEqual([
      'agent-avatar',
      'agent-cover',
      'agent-greeting-primary',
      'agent-voice-demo',
    ]);
    expect(planned.items[4]).toMatchObject({
      status: 'SKIPPED',
      lastError: 'Canonical agent id is required before batch asset generation can start.',
    });
  });
});
