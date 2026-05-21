import { describe, expect, it } from 'vitest';
import {
  CREATE_REALM_AGENT_BLOCKED_REASON,
  normalizeCreateRealmAgentDraft,
  normalizeSelectableWorlds,
  normalizeSelectedWorldPreview,
  selectOasisDefaultWorld,
  validateCreateRealmAgentReadiness,
  type CreateRealmAgentDraftInput,
  type RealmAgentCreationWorldDetailDto,
  type RealmAgentCreationWorldDto,
} from './create-agent-draft.js';

const oasisWorld: RealmAgentCreationWorldDto = {
  id: 'world-oasis',
  name: 'OASIS',
  type: 'OASIS',
  status: 'ACTIVE',
  contentRating: 'PG13',
  createdAt: '2026-05-21T00:00:00.000Z',
  level: 1,
  lorebookEntryLimit: 10,
  nativeAgentLimit: 10,
  nativeCreationState: 'OPEN',
  scoreA: 0,
  scoreC: 0,
  scoreE: 0,
  scoreEwma: 0,
  scoreQ: 0,
  transitInLimit: 10,
  agentCount: 2,
  computed: {
    entry: { recommendedAgents: [] },
    featuredAgentCount: 0,
    languages: { common: [] },
    score: { scoreEwma: 0 },
    time: { flowRatio: 1, isPaused: false },
  },
  truth: {
    rules: [],
  },
};

const creatorWorld: RealmAgentCreationWorldDto = {
  ...oasisWorld,
  id: 'world-creator',
  name: 'Creator Workshop',
  type: 'CREATOR',
};

const baseInput: CreateRealmAgentDraftInput = {
  handle: ' @Mira.Agent ',
  displayName: ' Mira Agent ',
  publicBio: ' Public operator ',
  concept: ' Durable public Realm Agent ',
  description: ' Owner-created public identity ',
  ruleText: 'Stay visible and owner-reviewed.',
  selectedWorldId: ' world-oasis ',
};

describe('create Realm Agent draft normalization', () => {
  it('normalizes public identity and selected world fields for preview', () => {
    expect(normalizeCreateRealmAgentDraft(baseInput)).toEqual({
      handle: 'mira.agent',
      displayName: 'Mira Agent',
      publicBio: 'Public operator',
      concept: 'Durable public Realm Agent',
      description: 'Owner-created public identity',
      ruleText: 'Stay visible and owner-reviewed.',
      selectedWorldId: 'world-oasis',
    });
  });

  it('selects OASIS from the source-backed Realm world list', () => {
    const worlds = normalizeSelectableWorlds([creatorWorld, oasisWorld]);

    expect(selectOasisDefaultWorld(worlds)?.id).toBe('world-oasis');
    expect(worlds[0]?.source).toBe('Realm WorldsService.worldControllerListWorlds');
  });

  it('falls back to id/name when OASIS type is unavailable', () => {
    const worlds = normalizeSelectableWorlds([{ ...creatorWorld, id: 'oasis', name: 'Main World' }]);

    expect(selectOasisDefaultWorld(worlds)?.id).toBe('oasis');
  });
});

describe('selected world preview normalization', () => {
  it('keeps basic setting fields from detail-with-agents', () => {
    const preview = normalizeSelectedWorldPreview({
      ...oasisWorld,
      tagline: 'The main world',
      overview: 'Shared source world.',
      themes: ['social', 'agent-ip'],
      agentRuleSummary: {
        byLayer: {
          BEHAVIORAL: 1,
          CONTEXTUAL: 1,
          DNA: 0,
          RELATIONAL: 0,
        },
        totalAgentRuleCount: 2,
        worldLinkedRuleCount: 1,
      },
      agents: [],
    } satisfies RealmAgentCreationWorldDetailDto);

    expect(preview).toMatchObject({
      id: 'world-oasis',
      name: 'OASIS',
      type: 'OASIS',
      status: 'ACTIVE',
      contentRating: 'PG13',
      tagline: 'The main world',
      overview: 'Shared source world.',
      themes: ['social', 'agent-ip'],
      agentCount: 2,
      nativeCreationState: 'OPEN',
      source: 'Realm WorldsService.worldControllerGetWorldDetailWithAgents',
    });
  });
});

describe('create Realm Agent readiness', () => {
  it('returns a blocked candidate payload instead of creation success', () => {
    const result = validateCreateRealmAgentReadiness(baseInput);

    expect(result.ready).toBe(true);
    expect(result.blockedReason).toBe(CREATE_REALM_AGENT_BLOCKED_REASON);
    expect(result.payload).toEqual({
      candidate: true,
      source: 'realm-agent-studio.local-create-agent-draft',
      blocked: true,
      blockedReason: CREATE_REALM_AGENT_BLOCKED_REASON,
      publicFields: {
        handle: 'mira.agent',
        displayName: 'Mira Agent',
        publicBio: 'Public operator',
        concept: 'Durable public Realm Agent',
        description: 'Owner-created public identity',
        rulesText: 'Stay visible and owner-reviewed.',
      },
      realmCreateAgentCandidate: {
        handle: 'mira.agent',
        displayName: 'Mira Agent',
        worldId: 'world-oasis',
        concept: 'Durable public Realm Agent',
        description: 'Owner-created public identity',
        rules: {
          format: 'rule-lines-v1',
          lines: ['Stay visible and owner-reviewed.'],
          text: 'Stay visible and owner-reviewed.',
        },
      },
    });
  });

  it('fails readiness when required local draft fields are missing', () => {
    const result = validateCreateRealmAgentReadiness({ ...baseInput, handle: ' ', concept: ' ', selectedWorldId: '' });

    expect(result.ready).toBe(false);
    expect(result.errors).toEqual(['handle missing', 'concept missing', 'selected world missing']);
    expect(result.blockedReason).toBe(CREATE_REALM_AGENT_BLOCKED_REASON);
    expect(result.payload).toBeNull();
  });
});
