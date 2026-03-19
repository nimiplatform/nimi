import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useForgeWorkspaceStore } from './forge-workspace-store.js';

const storage = new Map<string, string>();

vi.stubGlobal('window', {
  localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
  },
});

describe('forge-workspace-store', () => {
  beforeEach(() => {
    storage.clear();
    useForgeWorkspaceStore.getState().reset();
  });

  it('creates and persists a workspace', () => {
    const workspaceId = useForgeWorkspaceStore.getState().createWorkspace({
      mode: 'NEW_WORLD',
      title: 'My Workspace',
      worldName: 'My World',
    });

    const snapshot = useForgeWorkspaceStore.getState().workspaces[workspaceId]!;
    expect(snapshot.workspace.title).toBe('My Workspace');
    expect(snapshot.worldDraft.name).toBe('My World');
    expect(storage.get('nimi:forge:workbench:v1')).toContain(workspaceId);
  });

  it('applies character-card review draft into workspace state', () => {
    const workspaceId = useForgeWorkspaceStore.getState().createWorkspace({
      mode: 'NEW_WORLD',
      title: 'Card Import',
    });

    const draftAgentId = useForgeWorkspaceStore.getState().applyCharacterCardReviewDraft(workspaceId, {
      sessionId: 'imp_card_1',
      sourceFile: 'hero.json',
      importedAt: '2026-03-19T00:00:00.000Z',
      characterName: 'Ari',
      sourceManifest: {
        sourceType: 'character_card',
        sourceFile: 'hero.json',
        importedAt: '2026-03-19T00:00:00.000Z',
        rawJson: '{}',
        rawCard: {},
        normalizedCard: {
          spec: 'chara_card_v2',
          spec_version: '2.0',
          data: {
            name: 'Ari',
            description: '',
            personality: '',
            scenario: '',
            first_mes: '',
            mes_example: '',
            creator_notes: '',
            system_prompt: '',
            post_history_instructions: '',
            alternate_greetings: [],
            tags: [],
            creator: '',
            character_version: '1',
            extensions: {},
          },
        },
        unknownRootFields: {},
        unknownDataFields: {},
        cardExtensions: {},
        characterBookExtensions: {},
        characterBookEntries: [],
      },
      agentRules: [{
        ruleKey: 'identity:self:core',
        title: 'Core Identity',
        statement: 'Ari is a brave scout.',
        layer: 'DNA',
        category: 'DEFINITION',
        hardness: 'FIRM',
        importance: 90,
        provenance: 'CREATOR',
      }],
      worldRules: [{
        ruleKey: 'world:seed:scenario',
        title: 'Scenario',
        statement: 'The world is an overgrown ruin.',
        domain: 'NARRATIVE',
        category: 'DEFINITION',
        hardness: 'SOFT',
        scope: 'WORLD',
        provenance: 'SEED',
      }],
    });

    const snapshot = useForgeWorkspaceStore.getState().workspaces[workspaceId]!;
    expect(snapshot.workspace.lifecycle).toBe('REVIEWING');
    expect(snapshot.reviewState.worldRules).toHaveLength(1);
    expect(snapshot.reviewState.agentBundles).toHaveLength(1);
    expect(snapshot.agentDrafts[draftAgentId]?.displayName).toBe('Ari');
    expect(snapshot.importSessions[0]?.sessionId).toBe('imp_card_1');
  });

  it('builds a publish plan using world-owned agent drafts', () => {
    const workspaceId = useForgeWorkspaceStore.getState().createWorkspace({
      mode: 'NEW_WORLD',
      title: 'Publishable',
    });

    const draftAgentId = useForgeWorkspaceStore.getState().attachMasterAgentClone(workspaceId, {
      masterAgentId: 'master_1',
      displayName: 'Ari',
      handle: 'ari',
      concept: 'Brave scout',
    });

    useForgeWorkspaceStore.getState().updateReviewWorldRule(workspaceId, 0, {});
    useForgeWorkspaceStore.setState((state) => ({
      ...state,
      workspaces: {
        ...state.workspaces,
        [workspaceId]: {
          ...state.workspaces[workspaceId]!,
          reviewState: {
            ...state.workspaces[workspaceId]!.reviewState,
            worldRules: [{
              ruleKey: 'world:seed:scenario',
              title: 'Scenario',
              statement: 'A ruined world.',
              domain: 'NARRATIVE',
              category: 'DEFINITION',
              hardness: 'SOFT',
              scope: 'WORLD',
              provenance: 'SEED',
            }],
            agentBundles: [{
              draftAgentId,
              characterName: 'Ari',
              sourceSessionId: null,
              rules: [{
                ruleKey: 'identity:self:core',
                title: 'Core Identity',
                statement: 'Ari is a brave scout.',
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

    const plan = useForgeWorkspaceStore.getState().buildPublishPlan(workspaceId);
    expect(plan?.worldAction).toBe('CREATE');
    expect(plan?.agents).toEqual([
      expect.objectContaining({
        draftAgentId,
        action: 'CREATE_WORLD_AGENT',
      }),
    ]);
    expect(plan?.agentRules).toHaveLength(1);
  });
});
