import { describe, expect, it } from 'vitest';
import type { ForgeWorkspaceSnapshot } from '@renderer/state/creator-world-workspace.js';
import { buildForgeOfficialWorldPackage } from './world-package-builder.js';

function createSnapshot(): ForgeWorkspaceSnapshot {
  return {
    createStep: 'DRAFT',
    sourceText: 'Seed text',
    sourceRef: 'manual-source',
    selectedStartTimeId: 'timeline-start-1',
    selectedCharacters: ['Ari'],
    panel: { searchText: '', selectedWorldId: '', selectedDraftId: '', activeMaintainTab: 'WORLD' },
    parseJob: {
      phase: 'done',
      chunkTotal: 1,
      chunkProcessed: 1,
      chunkCompleted: 1,
      chunkFailed: 0,
      progress: 1,
      etaSeconds: 0,
      startedAt: null,
      updatedAt: null,
    },
    knowledgeGraph: { events: { primary: [], secondary: [] }, characters: [], locations: [], timeline: [], characterRelations: [], futureHistoricalEvents: [], worldSetting: '' },
    worldviewPatch: {
      lifecycle: 'ACTIVE',
      timeModel: { timeFlowRatio: 1 },
      spaceTopology: { kind: 'layered' },
      causality: { mode: 'linear' },
      coreSystem: { engine: 'qi' },
    },
    ruleTruthDraft: {
      worldRules: [{
        ruleKey: 'axiom:time:flow',
        title: 'Time flows',
        statement: 'Time moves forward.',
        domain: 'AXIOM',
        category: 'DEFINITION',
        hardness: 'HARD',
        scope: 'WORLD',
      }],
      agentRules: [{
        characterName: 'Ari',
        payload: {
          ruleKey: 'identity:self:core',
          title: 'Ari Core Identity',
          statement: 'Ari protects the archive.',
          layer: 'DNA',
          category: 'DEFINITION',
          hardness: 'FIRM',
          scope: 'SELF',
          importance: 80,
          priority: 100,
          provenance: 'CREATOR',
          structured: {
            characterName: 'Ari',
            concept: 'Archive guardian',
            backstory: 'Raised by librarians.',
            coreValues: 'Duty and memory',
            relationshipStyle: 'Calm and observant',
          },
        },
      }],
    },
    eventsDraft: { primary: [], secondary: [] },
    lorebooksDraft: [{
      key: 'world.archive',
      name: 'Archive',
      content: 'The city archive stores every oath.',
      keywords: ['archive'],
    }],
    phase1Artifact: null,
    assets: {
      worldCover: { status: 'succeeded', imageUrl: 'https://example.com/world.png' },
      characterPortraits: {
        Ari: { status: 'succeeded', imageUrl: 'https://example.com/ari.png' },
      },
      locationImages: {},
    },
    draftQuality: {
      worldCutStatus: 'ready',
      enrichStatus: 'complete',
      enrichFailureReason: null,
      weakFieldIssues: [],
      updatedAt: null,
    },
    agentSync: {
      selectedCharacterIds: ['Ari'],
      draftsByCharacter: {
        Ari: {
          characterName: 'Ari',
          handle: 'ari',
          concept: 'Archive guardian',
          backstory: 'Raised by librarians.',
          coreValues: 'Duty and memory',
          relationshipStyle: 'Calm and observant',
          description: 'Keeper of the archive gates.',
          scenario: 'Ari stands watch over the moon archive.',
          greeting: 'State your business.',
          exampleDialogue: 'The archive remembers.',
          systemPromptBase: 'Protect the archive and preserve truth.',
          dnaPrimary: 'Archive guardian',
          dnaSecondary: ['Duty', 'Memory'],
        },
      },
    },
    eventGraphLayout: { selectedEventId: '', expandedPrimaryIds: [] },
    embeddingIndex: { entries: {} },
    finalDraftAccumulator: {
      world: {},
      worldview: {},
      worldLorebooks: [],
      futureHistoricalEvents: [],
      agentDraftsByCharacter: {},
      worldWorkingProseByField: {},
      agentWorkingProseByCharacterAndField: {},
      worldProseCandidatesByField: {},
      agentProseCandidatesByCharacterAndField: {},
      evidenceRefs: [],
      revisions: [],
      lastUpdatedChunk: -1,
    },
    taskState: { activeTask: null, recentTasks: [], expertMode: false },
    unsavedChangesByPanel: {},
    futureEventsText: '',
    worldStateDraft: {
      name: 'Archive Realm',
      tagline: 'Every oath is recorded.',
      motto: 'Truth leaves a trace.',
      overview: 'A city governed by memory.',
      description: 'An official archive city where memory is law.',
      genre: 'archive-fantasy',
      themes: ['memory', 'duty'],
      era: 'bronze age future',
      contentRating: 'UNRATED',
      type: 'CREATOR',
      status: 'ACTIVE',
      nativeCreationState: 'OPEN',
      transitInLimit: 16,
      level: 1,
      scoreQ: 0,
      scoreC: 0,
      scoreA: 0,
      scoreE: 0,
      scoreEwma: 0,
    },
    workspaceVersion: 'workspace-v1',
  } as unknown as ForgeWorkspaceSnapshot;
}

describe('world-package-builder', () => {
  it('builds a canonical official package from forge snapshot state', () => {
    const result = buildForgeOfficialWorldPackage({
      userId: 'user-1',
      sourceMode: 'TEXT',
      draftId: 'draft-1',
      snapshot: createSnapshot(),
    });

    expect(result.meta.sourceMode).toBe('forge-official');
    expect(result.world.id).toBe('forge-world-workspace-v1');
    expect(result.world.reviewedBy).toBe('user-1');
    expect(result.agentBlueprints[0]?.name).toBe('Ari');
    expect(result.worldDrafts[0]?.id).toBe('draft-1');
    expect(result.worldLorebooks[0]?.name).toBe('Archive');
  });

  it('fails close when authored prose required by the package is missing', () => {
    const snapshot = createSnapshot();
    snapshot.worldStateDraft.tagline = '';

    expect(() => buildForgeOfficialWorldPackage({
      userId: 'user-1',
      sourceMode: 'TEXT',
      draftId: 'draft-1',
      snapshot,
    })).toThrow('FORGE_PACKAGE_WORLD_TAGLINE_REQUIRED');
  });
});
