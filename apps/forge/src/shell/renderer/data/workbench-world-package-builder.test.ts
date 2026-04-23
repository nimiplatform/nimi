import { describe, expect, it } from 'vitest';
import {
  AGENT_DELIVERABLE_REGISTRY,
  type AgentDeliverableFamily,
  WORLD_DELIVERABLE_REGISTRY,
} from '@renderer/features/asset-ops/deliverable-registry.js';
import type { DeliverableFamilyCoverageSummary, WorldOwnedAgentRosterItem } from '@renderer/hooks/use-agent-queries.js';
import type { WorldDeliverableStatus } from '@renderer/hooks/use-world-queries.js';
import { useAgentAssetOpsStore } from '@renderer/state/agent-asset-ops-store.js';
import { useForgeWorkspaceStore } from '@renderer/state/forge-workspace-store.js';
import type { WorkbenchCanonicalPublishContext } from '@renderer/pages/workbench/workbench-asset-publish.js';
import { buildWorkbenchWorldPackage } from './workbench-world-package-builder.js';

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
    value: `https://cdn.example.com/${entry.family === 'world-icon' ? 'world-icon' : 'world-banner'}-reviewed.png`,
    }));
}

function createAgentDeliverables(): WorldOwnedAgentRosterItem['deliverables'] {
  return AGENT_DELIVERABLE_REGISTRY.map((entry) => {
    switch (entry.family) {
      case 'agent-avatar':
        return {
          family: entry.family,
          label: entry.label,
          required: entry.requiredForPublish,
          currentState: 'PRESENT' as const,
          opsState: 'MISSING' as const,
          source: 'DIRECT_FIELD' as const,
          bindingPoint: null,
          objectId: null,
          value: 'https://cdn.example.com/ari-avatar-reviewed.png',
        };
      case 'agent-cover':
        return {
          family: entry.family,
          label: entry.label,
          required: entry.requiredForPublish,
          currentState: 'MISSING' as const,
          opsState: 'MISSING' as const,
          source: 'WORLD_BINDING' as const,
          bindingPoint: 'AGENT_PORTRAIT' as const,
          objectId: null,
          value: null,
        };
      case 'agent-greeting-primary':
        return {
          family: entry.family,
          label: entry.label,
          required: entry.requiredForPublish,
          currentState: 'PRESENT' as const,
          opsState: 'MISSING' as const,
          source: 'DIRECT_FIELD' as const,
          bindingPoint: null,
          objectId: null,
          value: 'State your business.',
        };
      case 'agent-voice-demo':
        return {
          family: entry.family,
          label: entry.label,
          required: entry.requiredForPublish,
          currentState: 'BOUND' as const,
          opsState: 'BOUND' as const,
          source: 'WORLD_BINDING' as const,
          bindingPoint: 'AGENT_VOICE_SAMPLE' as const,
          objectId: 'resource-voice-ari',
          value: 'resource-voice-ari',
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

function createReadyWorkspace() {
  useForgeWorkspaceStore.getState().reset();
  useAgentAssetOpsStore.setState((state) => ({ ...state, profiles: {} }));
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

  useForgeWorkspaceStore.getState().patchWorldDraft(workspaceId, {
    tagline: 'Every oath is recorded.',
    overview: 'A memory-city on the brink of fracture.',
    genre: 'archive-fantasy',
    themes: ['memory', 'duty'],
    era: 'bronze future',
    bannerUrl: 'https://cdn.example.com/world-banner.png',
    iconUrl: 'https://cdn.example.com/world-icon.png',
  });
  useForgeWorkspaceStore.getState().updateAgentDraft(workspaceId, draftAgentId, {
    sourceAgentId: 'agent-1',
    worldId: 'world-1',
    description: 'Keeper of the archive gates.',
    scenario: 'Ari watches over the moon archive.',
    voiceDemoUrl: 'https://cdn.example.com/ari-voice-reviewed.mp3',
    voiceDemoResourceId: 'resource-voice-ari',
  });
  useForgeWorkspaceStore.setState((state) => ({
    ...state,
    workspaces: {
      ...state.workspaces,
      [workspaceId]: {
        ...state.workspaces[workspaceId]!,
        reviewState: {
          ...state.workspaces[workspaceId]!.reviewState,
          worldRules: [{
            ruleKey: 'world:axiom:memory',
            title: 'Memory is law',
            statement: 'Archive memory governs civic order.',
            domain: 'META',
            category: 'POLICY',
            hardness: 'HARD',
            scope: 'WORLD',
            provenance: 'CREATOR',
          }],
          agentBundles: [{
            draftAgentId,
            characterName: 'Ari',
            sourceSessionId: null,
            rules: [{
              ruleKey: 'identity:self:core',
              title: 'Core Identity',
              statement: 'Ari protects the archive.',
              layer: 'DNA',
              category: 'DEFINITION',
              hardness: 'FIRM',
              importance: 90,
              provenance: 'CREATOR',
            }],
          }],
        },
      },
    },
  }));

  const publishContext: WorkbenchCanonicalPublishContext = {
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
        avatarUrl: 'https://cdn.example.com/ari-avatar-reviewed.png',
        description: 'Keeper of the archive gates.',
        scenario: 'Ari watches over the moon archive.',
        greeting: 'State your business.',
        deliverables: createAgentDeliverables(),
        completeness: {
          requiredFamilyCount: AGENT_DELIVERABLE_REGISTRY.filter((entry) => entry.requiredForPublish).length,
          currentReadyCount: 3,
          opsReadyCount: 1,
          boundCount: 1,
          unverifiedCount: 2,
          missingCount: 0,
          currentState: 'COMPLETE',
          opsState: 'PARTIAL',
        },
        createdAt: '2026-03-19T00:00:00.000Z',
        updatedAt: '2026-03-19T00:00:00.000Z',
      }],
      summary: {
        worldId: 'world-1',
        agentCount: 1,
        currentCompleteCount: 1,
        opsCompleteCount: 0,
        missingRequiredFamilyCount: 0,
        unverifiedRequiredFamilyCount: 2,
        familyCoverage: createAgentFamilyCoverage(),
      },
    },
  };

  return {
    workspaceId,
    snapshot: useForgeWorkspaceStore.getState().workspaces[workspaceId]!,
    publishContext,
  };
}

describe('workbench-world-package-builder', () => {
  it('builds a canonical package from absorbed workbench publish state', () => {
    const { workspaceId, snapshot, publishContext } = createReadyWorkspace();
    useAgentAssetOpsStore.getState().enqueueCandidate({
      userId: 'user-1',
      agentId: 'agent-1',
      family: 'agent-avatar',
      kind: 'resource',
      resourceId: null,
      previewUrl: 'https://cdn.example.com/ari-avatar-reviewed.png',
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

    const result = buildWorkbenchWorldPackage({
      workspaceId,
      userId: 'user-1',
      snapshot,
      publishContext,
    });

    expect(result.meta.sourceMode).toBe('forge-official');
    expect(result.truth.world.record.bannerUrl).toBe('https://cdn.example.com/world-banner-reviewed.png');
    expect(result.truth.agents.blueprints[0]?.scenario).toBe('Ari watches over the moon archive.');
    expect(result.truth.agents.blueprints[0]?.greeting).toBe('State your business.');
    expect(result.truth.agents.blueprints[0]?.referenceImageUrl).toBe('https://cdn.example.com/ari-avatar-reviewed.png');
    expect(result.resources.map((resource) => resource.resourceType)).toEqual(['IMAGE', 'IMAGE', 'AUDIO']);
    expect(result.bindings.map((binding) => binding.bindingPoint)).toEqual(['WORLD_BANNER', 'WORLD_ICON', 'AGENT_VOICE_SAMPLE']);
  });

  it('fails close when required completeness fields are missing', () => {
    const { workspaceId, snapshot, publishContext } = createReadyWorkspace();
    useAgentAssetOpsStore.getState().enqueueCandidate({
      userId: 'user-1',
      agentId: 'agent-1',
      family: 'agent-avatar',
      kind: 'resource',
      resourceId: null,
      previewUrl: 'https://cdn.example.com/ari-avatar-reviewed.png',
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
    snapshot.worldDraft.tagline = '';

    expect(() => buildWorkbenchWorldPackage({
      workspaceId,
      userId: 'user-1',
      snapshot,
      publishContext,
    })).toThrow('FORGE_WORKBENCH_PACKAGE_WORLD_TAGLINE_REQUIRED');
  });

  it('allows new-world draft fallback without canonical world asset bindings', () => {
    useForgeWorkspaceStore.getState().reset();
    const workspaceId = useForgeWorkspaceStore.getState().createWorkspace({
      mode: 'NEW_WORLD',
      title: 'Fresh Realm',
      worldName: 'Fresh Realm',
      worldDescription: 'A draft-only world.',
    });
    const draftAgentId = useForgeWorkspaceStore.getState().attachMasterAgentClone(workspaceId, {
      masterAgentId: 'master-lyra',
      displayName: 'Lyra',
      handle: 'lyra',
      concept: 'Cartographer',
    });
    useForgeWorkspaceStore.getState().patchWorldDraft(workspaceId, {
      tagline: 'Draw the first map.',
      overview: 'An unwritten land.',
      genre: 'frontier-fantasy',
      themes: ['exploration'],
      bannerUrl: 'https://cdn.example.com/fresh-banner.png',
      iconUrl: 'https://cdn.example.com/fresh-icon.png',
    });
    useForgeWorkspaceStore.getState().updateAgentDraft(workspaceId, draftAgentId, {
      description: 'Maps the unknown.',
      scenario: 'Lyra prepares the expedition.',
      greeting: 'Ready to chart the frontier?',
      avatarUrl: 'https://cdn.example.com/lyra-avatar.png',
      voiceDemoUrl: 'https://cdn.example.com/lyra-voice.mp3',
      voiceDemoResourceId: 'resource-lyra-voice',
    });
    useForgeWorkspaceStore.setState((state) => ({
      ...state,
      workspaces: {
        ...state.workspaces,
        [workspaceId]: {
          ...state.workspaces[workspaceId]!,
          reviewState: {
            ...state.workspaces[workspaceId]!.reviewState,
            worldRules: [{
              ruleKey: 'world:axiom:frontier',
              title: 'The frontier is open',
              statement: 'Every map redraws the world.',
              domain: 'META',
              category: 'POLICY',
              hardness: 'HARD',
              scope: 'WORLD',
              provenance: 'CREATOR',
            }],
            agentBundles: [{
              draftAgentId,
              characterName: 'Lyra',
              sourceSessionId: null,
              rules: [{
                ruleKey: 'identity:self:core',
                title: 'Core Identity',
                statement: 'Lyra charts the frontier.',
                layer: 'DNA',
                category: 'DEFINITION',
                hardness: 'FIRM',
                importance: 90,
                provenance: 'CREATOR',
              }],
            }],
          },
        },
      },
    }));

    const snapshot = useForgeWorkspaceStore.getState().workspaces[workspaceId]!;
    const result = buildWorkbenchWorldPackage({
      workspaceId,
      userId: 'user-1',
      snapshot,
      publishContext: {},
    });

    expect(result.truth.world.record.bannerUrl).toBe('https://cdn.example.com/fresh-banner.png');
    expect(result.truth.world.record.iconUrl).toBe('https://cdn.example.com/fresh-icon.png');
    expect(result.resources.map((resource) => resource.resourceType)).toEqual(['AUDIO']);
    expect(result.bindings.map((binding) => binding.bindingPoint)).toEqual(['AGENT_VOICE_SAMPLE']);
  });
});
