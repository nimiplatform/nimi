import { describe, expect, it } from 'vitest';
import {
  type AgentDeliverableLike,
  buildAgentRosterPageStatItems,
  buildAgentRosterStatusBadge,
  buildAgentDeliverableCardItems,
  buildWorldAgentHeroStatus,
  buildWorldAgentSummaryKpiItems,
  buildAgentRosterSummaryBadgeItems,
  buildWorldVisualCardItems,
} from './deliverable-presentation.js';

describe('deliverable-presentation', () => {
  it('builds required roster summary badges from registry semantics', () => {
    const badges = buildAgentRosterSummaryBadgeItems({
      'agent-avatar': { currentReadyCount: 2, boundCount: 0 },
      'agent-cover': { currentReadyCount: 1, boundCount: 1 },
      'agent-greeting-primary': { currentReadyCount: 3, boundCount: 0 },
      'agent-voice-demo': { currentReadyCount: 2, boundCount: 1 },
    });

    expect(badges).toEqual([
      { family: 'agent-avatar', label: 'Avatar Present', value: 2, state: 'PRESENT' },
      { family: 'agent-greeting-primary', label: 'Greeting Present', value: 3, state: 'PRESENT' },
      { family: 'agent-voice-demo', label: 'Voice Demo Bound', value: 1, state: 'BOUND' },
    ]);
  });

  it('builds agent deliverable cards with optional coverage only when requested', () => {
    const deliverables: AgentDeliverableLike[] = [
      { family: 'agent-avatar', currentState: 'PRESENT' as const },
      { family: 'agent-cover', currentState: 'BOUND' as const },
      { family: 'agent-greeting-primary', currentState: 'MISSING' as const },
      { family: 'agent-voice-demo', currentState: 'BOUND' as const },
    ];

    expect(buildAgentDeliverableCardItems(deliverables)).toEqual([
      { family: 'agent-avatar', label: 'Avatar', detail: 'Current active avatar presence', value: 1, state: 'PRESENT' },
      { family: 'agent-greeting-primary', label: 'Greeting', detail: 'Primary opening line', value: 0, state: 'MISSING' },
      { family: 'agent-voice-demo', label: 'Voice Demo', detail: 'Playable world voice sample', value: 1, state: 'BOUND' },
    ]);

    expect(buildAgentDeliverableCardItems(deliverables, { includeOptional: true })).toEqual([
      { family: 'agent-avatar', label: 'Avatar', detail: 'Current active avatar presence', value: 1, state: 'PRESENT' },
      { family: 'agent-cover', label: 'Cover', detail: 'World portrait binding slot', value: 1, state: 'BOUND' },
      { family: 'agent-greeting-primary', label: 'Greeting', detail: 'Primary opening line', value: 0, state: 'MISSING' },
      { family: 'agent-voice-demo', label: 'Voice Demo', detail: 'Playable world voice sample', value: 1, state: 'BOUND' },
    ]);
  });

  it('builds world visual cards from world registry families', () => {
    expect(buildWorldVisualCardItems({
      worldName: 'Archive Realm',
      iconUrl: 'https://cdn.example.com/icon.png',
      bannerUrl: null,
    })).toEqual([
      {
        family: 'world-icon',
        title: 'Icon',
        description: 'Current icon slot for catalog identity.',
        previewUrl: 'https://cdn.example.com/icon.png',
        previewName: 'Archive Realm',
      },
      {
        family: 'world-cover',
        title: 'Cover',
        description: 'Current cover/banner slot for world presentation.',
        previewUrl: null,
        previewName: 'Archive Realm',
      },
    ]);
  });

  it('builds world agent hero status and summary kpis from roster counts', () => {
    expect(buildWorldAgentHeroStatus({
      agentCount: 3,
      currentCompleteCount: 2,
    })).toEqual({
      state: 'PRESENT',
      label: '2 Current-Ready Agents',
    });

    expect(buildWorldAgentHeroStatus({
      agentCount: 3,
      currentCompleteCount: 0,
    })).toEqual({
      state: 'MISSING',
      label: '3 Agents Need Review',
    });

    expect(buildWorldAgentSummaryKpiItems({
      agentCount: 3,
      currentCompleteCount: 2,
      voiceDemoBoundCount: 1,
    })).toEqual([
      {
        key: 'current-complete',
        label: 'Current-Ready Agents',
        value: '2/3',
        detail: 'Required deliverables are present or already bound.',
      },
      {
        key: 'needs-review',
        label: 'Agents Needing Review',
        value: '1/3',
        detail: 'Roster items still missing one or more required current deliverables.',
      },
      {
        key: 'voice-demo-bound',
        label: 'Voice Demo Bound',
        value: '1/3',
        detail: 'Roster agents with a bound voice demo in canonical asset ops.',
      },
    ]);
  });

  it('builds world agents page stats and roster badge state from completeness summaries', () => {
    expect(buildAgentRosterPageStatItems({
      agentCount: 3,
      currentCompleteCount: 2,
      opsCompleteCount: 1,
      unverifiedRequiredFamilyCount: 4,
    })).toEqual([
      {
        key: 'world-owned-agents',
        label: 'World-Owned Agents',
        value: 3,
        detail: "Agents routed through this world's truth surface.",
      },
      {
        key: 'current-complete',
        label: 'Current Complete',
        value: '2/3',
        detail: 'Required deliverables are present or bound on the current roster.',
      },
      {
        key: 'ops-complete',
        label: 'Ops Complete',
        value: '1/3',
        detail: 'Required deliverables are fully backed by admitted bound ops truth.',
      },
      {
        key: 'unverified-required',
        label: 'Unverified Required',
        value: 4,
        detail: 'Required deliverables are present but not yet backed by bound ops truth.',
      },
    ]);

    expect(buildAgentRosterStatusBadge({
      currentState: 'COMPLETE',
      opsState: 'PARTIAL',
    })).toEqual({
      state: 'PRESENT',
      label: 'Roster Present',
    });

    expect(buildAgentRosterStatusBadge({
      currentState: 'COMPLETE',
      opsState: 'COMPLETE',
    })).toEqual({
      state: 'BOUND',
      label: 'Roster Bound',
    });

    expect(buildAgentRosterStatusBadge({
      currentState: 'MISSING',
      opsState: 'MISSING',
    })).toEqual({
      state: 'MISSING',
      label: 'Roster Missing',
    });
  });
});
