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
            description: 'Ari is a desert scout with a disciplined eye for danger.',
            personality: '',
            scenario: 'You are planning a route across the ruins with Ari.',
            first_mes: 'I already mapped the safest path. Ready when you are.',
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
    expect(snapshot.agentDrafts[draftAgentId]?.description).toContain('desert scout');
    expect(snapshot.agentDrafts[draftAgentId]?.scenario).toContain('route across the ruins');
    expect(snapshot.agentDrafts[draftAgentId]?.greeting).toContain('mapped the safest path');
    expect(snapshot.importSessions[0]?.sessionId).toBe('imp_card_1');
  });

  it('converts final novel import into editable world and agent drafts', () => {
    const workspaceId = useForgeWorkspaceStore.getState().createWorkspace({
      mode: 'NEW_WORLD',
      title: 'Novel Draft',
    });

    useForgeWorkspaceStore.getState().applyNovelReviewDraft(workspaceId, {
      sessionId: 'novel_session_1',
      sourceFile: 'novel.md',
      importedAt: '2026-03-19T00:00:00.000Z',
      sourceManifest: {
        sourceType: 'novel',
        sourceFile: 'novel.md',
        importedAt: '2026-03-19T00:00:00.000Z',
        sourceText: 'chapter',
        chapterChunks: [],
      },
      accumulator: {
        sourceFile: 'novel.md',
        totalChapters: 2,
        processedChapters: 2,
        worldRules: {},
        agentRulesByCharacter: {},
        worldRuleLineage: {},
        agentRuleLineageByCharacter: {},
        characters: {
          Ari: {
            name: 'Ari',
            aliases: ['Aria'],
            firstAppearance: 1,
            description: 'Ari is a patient scout who reads danger before anyone else sees it.',
          },
        },
        conflicts: [],
        chapterArtifacts: [
          {
            chapterIndex: 1,
            chapterTitle: 'Arrival',
            worldRules: [],
            agentRules: [],
            newCharacters: [],
            contradictions: [],
            chapterSummary: 'A silent ruin-city emerges from the dust storm.',
            status: 'COMPLETED',
          },
          {
            chapterIndex: 2,
            chapterTitle: 'Signal',
            worldRules: [],
            agentRules: [],
            newCharacters: [],
            contradictions: [],
            chapterSummary: 'A forgotten signal tower starts pulsing again at dusk.',
            status: 'COMPLETED',
          },
        ],
      },
      worldRules: [{
        ruleKey: 'world:timeline:core',
        title: 'Timeline',
        statement: 'The empire has fallen.',
        domain: 'NARRATIVE',
        category: 'DEFINITION',
        hardness: 'SOFT',
        scope: 'WORLD',
        provenance: 'SYSTEM',
      }],
      agentBundles: [{
        characterName: 'Ari',
        rules: [{
          ruleKey: 'identity:context:mission',
          title: 'Current Mission',
          statement: 'Ari guides survivors through unstable ruins.',
          layer: 'CONTEXTUAL',
          category: 'DEFINITION',
          hardness: 'SOFT',
          importance: 88,
          provenance: 'NARRATIVE_EMERGED',
        }],
      }],
    });

    const snapshot = useForgeWorkspaceStore.getState().workspaces[workspaceId]!;
    const draft = Object.values(snapshot.agentDrafts)[0]!;

    expect(snapshot.workspace.activePanel).toBe('AGENTS');
    expect(snapshot.workspace.lifecycle).toBe('DRAFT');
    expect(snapshot.worldDraft.description).toContain('silent ruin-city');
    expect(draft.description).toContain('patient scout');
    expect(draft.scenario).toContain('guides survivors');
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
