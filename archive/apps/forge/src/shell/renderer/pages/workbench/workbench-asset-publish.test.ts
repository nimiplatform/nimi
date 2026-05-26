import { beforeEach, describe, expect, it } from 'vitest';
import {
  AGENT_DELIVERABLE_REGISTRY,
  type AgentDeliverableFamily,
  WORLD_DELIVERABLE_REGISTRY,
} from '@renderer/features/asset-ops/deliverable-registry.js';
import type { DeliverableFamilyCoverageSummary, WorldOwnedAgentRosterItem } from '@renderer/hooks/use-agent-queries.js';
import type { WorldDeliverableStatus } from '@renderer/hooks/use-world-queries.js';
import { useAgentAssetOpsStore } from '@renderer/state/agent-asset-ops-store.js';
import { useForgeWorkspaceStore } from '@renderer/state/forge-workspace-store.js';
import {
  type WorkbenchCanonicalPublishContext,
  resolveWorkbenchAgentPublishAssets,
  resolveWorkbenchWorldPublishAssets,
} from './workbench-asset-publish.js';

const REQUIRED_AGENT_FAMILY_COUNT = AGENT_DELIVERABLE_REGISTRY.filter((entry) => entry.requiredForPublish).length;

function createWorldDeliverables(): WorldDeliverableStatus[] {
  return WORLD_DELIVERABLE_REGISTRY
    .filter((entry) => entry.requiredForPublish)
    .map((entry) => ({
    family: entry.family,
    label: entry.label,
    required: entry.requiredForPublish,
    currentState: 'BOUND' as const,
    opsState: 'BOUND' as const,
    bindingPoint: entry.bindingPoint,
    objectId: `resource-${entry.family}`,
    value: `https://cdn.example.com/${entry.family}-reviewed.png`,
    }));
}

function createAgentDeliverables(): WorldOwnedAgentRosterItem['deliverables'] {
  return AGENT_DELIVERABLE_REGISTRY.filter((entry) => entry.family !== 'agent-cover').map((entry) => {
    switch (entry.family) {
      case 'agent-avatar':
        return {
          family: entry.family,
          label: entry.label,
          required: entry.requiredForPublish,
          currentState: 'PRESENT' as const,
          opsState: 'MISSING' as const,
          source: 'DIRECT_FIELD' as const,
          bindingPoint: 'AGENT_AVATAR' as const,
          objectId: null,
          value: 'https://cdn.example.com/agent-avatar-reviewed.png',
        };
      case 'agent-greeting-primary':
        return {
          family: entry.family,
          label: entry.label,
          required: entry.requiredForPublish,
          currentState: 'PRESENT' as const,
          opsState: 'MISSING' as const,
          source: 'DIRECT_FIELD' as const,
          bindingPoint: 'AGENT_GREETING_PRIMARY' as const,
          objectId: null,
          value: 'State your business.',
        };
      case 'agent-voice-demo':
        return {
          family: entry.family,
          label: 'Voice Demo',
          required: entry.requiredForPublish,
          currentState: 'BOUND' as const,
          opsState: 'BOUND' as const,
          source: 'WORLD_BINDING' as const,
          bindingPoint: 'AGENT_VOICE_SAMPLE' as const,
          objectId: 'resource-agent-voice',
          value: null,
        };
    }
  });
}

function createAgentFamilyCoverage(): Record<AgentDeliverableFamily, DeliverableFamilyCoverageSummary> {
  return Object.fromEntries(
    AGENT_DELIVERABLE_REGISTRY.map((entry) => {
      switch (entry.family) {
        case 'agent-avatar':
          return [entry.family, { currentReadyCount: 1, opsReadyCount: 0, boundCount: 0, unverifiedCount: 1, missingCount: 0 }];
        case 'agent-cover':
          return [entry.family, { currentReadyCount: 0, opsReadyCount: 0, boundCount: 0, unverifiedCount: 0, missingCount: 1 }];
        case 'agent-greeting-primary':
          return [entry.family, { currentReadyCount: 1, opsReadyCount: 0, boundCount: 0, unverifiedCount: 1, missingCount: 0 }];
        case 'agent-voice-demo':
          return [entry.family, { currentReadyCount: 1, opsReadyCount: 1, boundCount: 1, unverifiedCount: 0, missingCount: 0 }];
      }
    }),
  ) as Record<AgentDeliverableFamily, DeliverableFamilyCoverageSummary>;
}

function createWorkspace() {
  useForgeWorkspaceStore.getState().reset();
  const workspaceId = useForgeWorkspaceStore.getState().createWorkspace({
    mode: 'EXISTING_WORLD',
    title: 'Archive Realm',
    worldId: 'world-1',
    worldName: 'Archive Realm',
    worldDescription: 'A city governed by memory.',
  });
  const draftAgentId = useForgeWorkspaceStore.getState().attachMasterAgentClone(workspaceId, {
    masterAgentId: 'master-ari',
    displayName: 'Ari',
    handle: 'ari',
    concept: 'Archive guardian',
  });
  useForgeWorkspaceStore.getState().updateAgentDraft(workspaceId, draftAgentId, {
    sourceAgentId: 'agent-1',
    worldId: 'world-1',
    description: 'Keeper of the archive gates.',
    scenario: 'Ari watches over the moon archive.',
    voiceDemoUrl: 'https://cdn.example.com/agent-voice-reviewed.mp3',
    voiceDemoResourceId: 'resource-agent-voice',
  });
  return {
    snapshot: useForgeWorkspaceStore.getState().workspaces[workspaceId]!,
    agentDraft: useForgeWorkspaceStore.getState().workspaces[workspaceId]!.agentDrafts[draftAgentId]!,
  };
}

function createPublishContext(): WorkbenchCanonicalPublishContext {
  return {
    worldDeliverables: createWorldDeliverables(),
    agentRoster: {
      worldId: 'world-1',
      items: [{
        id: 'agent-1',
        handle: 'ari',
        displayName: 'Ari',
        concept: 'Archive guardian',
        ownershipType: 'WORLD_OWNED',
        worldId: 'world-1',
        status: 'ACTIVE',
        avatarUrl: 'https://cdn.example.com/agent-avatar-reviewed.png',
        createdAt: '',
        updatedAt: '',
        description: 'Keeper of the archive gates.',
        scenario: 'Ari watches over the moon archive.',
        greeting: 'State your business.',
        deliverables: createAgentDeliverables(),
        completeness: {
          requiredFamilyCount: REQUIRED_AGENT_FAMILY_COUNT,
          currentReadyCount: 3,
          opsReadyCount: 1,
          boundCount: 1,
          unverifiedCount: 2,
          missingCount: 0,
          currentState: 'COMPLETE',
          opsState: 'PARTIAL',
        },
      }],
      summary: {
        worldId: 'world-1',
        agentCount: 1,
        currentCompleteCount: 1,
        opsCompleteCount: 0,
        missingRequiredFamilyCount: 0,
        unverifiedRequiredFamilyCount: 0,
        familyCoverage: createAgentFamilyCoverage(),
      },
    },
  };
}

describe('workbench-asset-publish', () => {
  beforeEach(() => {
    useForgeWorkspaceStore.getState().reset();
    useAgentAssetOpsStore.setState((state) => ({ ...state, profiles: {} }));
  });

  it('prefers canonical publish context for existing worlds and agents', () => {
    const { snapshot, agentDraft } = createWorkspace();
    const context = createPublishContext();
    useAgentAssetOpsStore.getState().enqueueCandidate({
      userId: 'user-1',
      agentId: 'agent-1',
      family: 'agent-avatar',
      kind: 'resource',
      resourceId: null,
      previewUrl: 'https://cdn.example.com/agent-avatar-reviewed.png',
      origin: 'manual',
      lifecycle: 'confirmed',
    });
    useAgentAssetOpsStore.getState().enqueueCandidate({
      userId: 'user-1',
      agentId: 'agent-1',
      family: 'agent-greeting-primary',
      kind: 'text',
      text: 'State your business.',
      origin: 'manual',
      lifecycle: 'confirmed',
    });

    const worldAssets = resolveWorkbenchWorldPublishAssets({
      worldDraft: snapshot.worldDraft,
      context,
    });
    const agentAssets = resolveWorkbenchAgentPublishAssets({
      userId: 'user-1',
      agentDraft,
      context,
    });

    expect(worldAssets.coverUrl).toBe('https://cdn.example.com/world-cover-reviewed.png');
    expect(worldAssets.coverResourceId).toBe('resource-world-cover');
    expect(agentAssets.avatarUrl).toBe('https://cdn.example.com/agent-avatar-reviewed.png');
    expect(agentAssets.greeting).toBe('State your business.');
    expect(agentAssets.voiceDemoResourceId).toBe('resource-agent-voice');
    expect(agentAssets.issues).toEqual([]);
  });

  it('fails closed when canonical bindings are missing for an existing world-owned agent', () => {
    const { snapshot, agentDraft } = createWorkspace();
    const context: WorkbenchCanonicalPublishContext = {
      worldDeliverables: createWorldDeliverables().map((item) =>
        item.family === 'world-cover'
          ? {
            ...item,
            currentState: 'MISSING' as const,
            opsState: 'MISSING' as const,
            objectId: null,
            value: null,
          }
          : {
            ...item,
            currentState: 'PRESENT' as const,
            opsState: 'MISSING' as const,
            objectId: null,
            value: 'https://cdn.example.com/world-icon-generated.png',
          }
      ),
      agentRoster: {
        ...createPublishContext().agentRoster!,
        items: [{
          ...createPublishContext().agentRoster!.items[0]!,
          greeting: null,
          deliverables: createPublishContext().agentRoster!.items[0]!.deliverables.map((item) =>
            item.family === 'agent-greeting-primary'
              ? { ...item, currentState: 'MISSING' as const, value: null }
              : item
          ),
        }],
      },
    };

    const worldAssets = resolveWorkbenchWorldPublishAssets({
      worldDraft: snapshot.worldDraft,
      context,
    });
    const agentAssets = resolveWorkbenchAgentPublishAssets({
      userId: 'user-1',
      agentDraft,
      context,
    });

    expect(worldAssets.issues).toContain('World cover must be bound in canonical world asset ops before publish.');
    expect(worldAssets.issues).toContain('World icon must be bound in canonical world asset ops before publish.');
    expect(agentAssets.issues).toContain('Ari: avatar must be adopted into local agent asset ops before publish.');
    expect(agentAssets.issues).toContain('Ari: greeting must be present on the canonical agent record before publish.');
  });
});
