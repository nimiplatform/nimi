import { describe, expect, it } from 'vitest';
import { useForgeWorkspaceStore } from '@renderer/state/forge-workspace-store.js';
import { buildWorkbenchWorldPackage } from './workbench-world-package-builder.js';

function createReadyWorkspace() {
  useForgeWorkspaceStore.getState().reset();
  const workspaceId = useForgeWorkspaceStore.getState().createWorkspace({
    mode: 'NEW_WORLD',
    title: 'Archive Realm',
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
    description: 'Keeper of the archive gates.',
    scenario: 'Ari watches over the moon archive.',
    greeting: 'State your business.',
    avatarUrl: 'https://cdn.example.com/ari-avatar.png',
    voiceDemoUrl: 'https://cdn.example.com/ari-voice.mp3',
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

  return {
    workspaceId,
    snapshot: useForgeWorkspaceStore.getState().workspaces[workspaceId]!,
  };
}

describe('workbench-world-package-builder', () => {
  it('builds a canonical package from enriched workbench state', () => {
    const { workspaceId, snapshot } = createReadyWorkspace();

    const result = buildWorkbenchWorldPackage({
      workspaceId,
      userId: 'user-1',
      snapshot,
    });

    expect(result.meta.sourceMode).toBe('forge-official');
    expect(result.truth.world.record.bannerUrl).toBe('https://cdn.example.com/world-banner.png');
    expect(result.truth.agents.blueprints[0]?.scenario).toBe('Ari watches over the moon archive.');
    expect(result.truth.agents.blueprints[0]?.greeting).toBe('State your business.');
    expect(result.resources[0]?.resourceType).toBe('AUDIO');
    expect(result.bindings[0]?.bindingPoint).toBe('AGENT_VOICE_SAMPLE');
  });

  it('fails close when required completeness fields are missing', () => {
    const { workspaceId, snapshot } = createReadyWorkspace();
    snapshot.worldDraft.tagline = '';

    expect(() => buildWorkbenchWorldPackage({
      workspaceId,
      userId: 'user-1',
      snapshot,
    })).toThrow('FORGE_WORKBENCH_PACKAGE_WORLD_TAGLINE_REQUIRED');
  });
});
