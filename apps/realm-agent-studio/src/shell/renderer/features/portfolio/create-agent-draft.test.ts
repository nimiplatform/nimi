import { describe, expect, it } from 'vitest';
import {
  REALM_AGENT_CREATE_PATH,
  REALM_AGENT_CREATE_SOURCE,
  normalizeRealmAgentHandleAvailability,
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
  it('returns a reviewed owner-scoped CreateAgentDto request payload', () => {
    const result = validateCreateRealmAgentReadiness(baseInput, {
      handleAvailability: normalizeRealmAgentHandleAvailability('mira.agent', {
        available: true,
        normalized: 'mira.agent',
      }),
    });

    expect(result.ready).toBe(true);
    expect(result.source).toBe(REALM_AGENT_CREATE_SOURCE);
    expect(result.payload).toEqual({
      source: REALM_AGENT_CREATE_SOURCE,
      path: REALM_AGENT_CREATE_PATH,
      publicFields: {
        handle: 'mira.agent',
        displayName: 'Mira Agent',
        publicBio: 'Public operator',
        concept: 'Durable public Realm Agent',
        description: 'Owner-created public identity',
        rulesText: 'Stay visible and owner-reviewed.',
      },
      body: {
        handle: 'mira.agent',
        displayName: 'Mira Agent',
        worldId: 'world-oasis',
        concept: 'Durable public Realm Agent',
        description: 'Owner-created public identity',
        ownershipType: 'MASTER_OWNED',
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
    expect(result.source).toBe(REALM_AGENT_CREATE_SOURCE);
    expect(result.payload).toBeNull();
  });

  it('fails readiness when selected world is not source-backed by the current world list', () => {
    const result = validateCreateRealmAgentReadiness(baseInput, {
      selectableWorldIds: ['world-creator'],
      handleAvailability: normalizeRealmAgentHandleAvailability('mira.agent', {
        available: true,
        normalized: 'mira.agent',
      }),
    });

    expect(result.ready).toBe(false);
    expect(result.errors).toEqual(['selected world not source-backed by WorldsService.worldControllerListWorlds']);
    expect(result.payload).toBeNull();
  });

  it('fails readiness when handle availability is missing, unavailable, or stale', () => {
    const unchecked = validateCreateRealmAgentReadiness(baseInput);
    const unavailable = validateCreateRealmAgentReadiness(baseInput, {
      handleAvailability: normalizeRealmAgentHandleAvailability('mira.agent', {
        available: false,
        normalized: 'mira.agent',
        message: 'Handle already taken.',
      }),
    });
    const stale = validateCreateRealmAgentReadiness(baseInput, {
      handleAvailability: normalizeRealmAgentHandleAvailability('other.agent', {
        available: true,
        normalized: 'other.agent',
      }),
    });

    expect(unchecked.ready).toBe(false);
    expect(unchecked.errors).toEqual(['handle availability not checked by AgentsService.agentControllerCheckHandle']);
    expect(unavailable.ready).toBe(false);
    expect(unavailable.errors).toEqual(['handle unavailable: Handle already taken.']);
    expect(stale.ready).toBe(false);
    expect(stale.errors).toEqual(['handle availability not checked for the current normalized handle']);
  });
});
