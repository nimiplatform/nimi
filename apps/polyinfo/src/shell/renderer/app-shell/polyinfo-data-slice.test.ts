import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPolyinfoDataSlice } from './polyinfo-data-slice.js';
import type { AppStoreSet, AppStoreState } from './store-types.js';

function createHarness() {
  let state = {} as AppStoreState;
  const set: AppStoreSet = (updater) => {
    const partial = typeof updater === 'function' ? updater(state) : updater;
    state = {
      ...state,
      ...partial,
    };
  };
  const get = () => state;
  const slice = createPolyinfoDataSlice(set, get);
  state = {
    ...state,
    ...slice,
  } as AppStoreState;
  return {
    getState: () => state,
  };
}

describe('polyinfo data slice', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-23T08:00:00.000Z'));
  });

  it('creates and deletes a custom sector together with its local records', () => {
    const harness = createHarness();
    const sectorId = harness.getState().addCustomSector('My Workspace');

    expect(harness.getState().customSectors[sectorId]?.title).toBe('My Workspace');
    expect(harness.getState().taxonomyBySector[sectorId]).toEqual({
      narratives: [],
      coreVariables: [],
    });
    expect(harness.getState().importedEventsBySector[sectorId]).toEqual([]);
    expect(harness.getState().lastActiveSectorId).toBe(sectorId);

    harness.getState().deleteCustomSector(sectorId);

    expect(harness.getState().customSectors[sectorId]).toBeUndefined();
    expect(harness.getState().taxonomyBySector[sectorId]).toBeUndefined();
    expect(harness.getState().importedEventsBySector[sectorId]).toBeUndefined();
  });

  it('adds and removes narratives and core variables for a sector', () => {
    const harness = createHarness();
    harness.getState().ensureSectorTaxonomy('custom-1');
    harness.getState().addNarrativeRecord('custom-1', {
      title: 'Rate cut repricing',
      definition: 'Track whether the market is repricing faster cuts.',
    });
    harness.getState().addCoreVariableRecord('custom-1', {
      title: 'Is repricing accelerating?',
      definition: 'Measure whether short-term expectations are moving faster.',
    });

    const overlay = harness.getState().taxonomyBySector['custom-1'];
    if (!overlay) {
      throw new Error('overlay should exist for custom-1');
    }
    expect(overlay.narratives).toHaveLength(1);
    expect(overlay.coreVariables).toHaveLength(1);

    harness.getState().removeNarrativeRecord('custom-1', overlay.narratives[0]!.id);
    harness.getState().removeCoreVariableRecord('custom-1', overlay.coreVariables[0]!.id);

    expect(harness.getState().taxonomyBySector['custom-1']).toEqual({
      narratives: [],
      coreVariables: [],
    });
  });

  it('resets a sector conversation but keeps the thread identity', () => {
    const harness = createHarness();
    harness.getState().ensureSectorThread('midterms', 'Midterms Analyst');
    harness.getState().setSectorDraftText('midterms', 'draft');
    harness.getState().upsertSectorMessage('midterms', {
      id: 'message-1',
      role: 'user',
      content: 'hello',
      createdAt: Date.now(),
      status: 'complete',
    });
    harness.getState().setSectorError('midterms', 'boom');
    harness.getState().setSectorDraftProposal('midterms', {
      id: 'proposal-1',
      entityType: 'narrative',
      action: 'create',
      title: 'Narrative',
    });

    const before = harness.getState().chatsBySector.midterms;
    if (!before) {
      throw new Error('chat should exist for midterms');
    }

    harness.getState().resetSectorConversation('midterms');

    expect(harness.getState().chatsBySector.midterms).toEqual({
      ...before,
      draftText: '',
      messages: [],
      draftProposal: null,
      isStreaming: false,
      error: null,
      updatedAt: Date.now(),
    });
  });

  it('persists draft, error, streaming, and proposal chat state changes', () => {
    const harness = createHarness();
    harness.getState().ensureSectorThread('rates', 'Rates Analyst');
    harness.getState().setSectorDraftText('rates', 'draft text');
    harness.getState().setSectorError('rates', 'temporary error');
    harness.getState().setSectorStreaming('rates', true);
    harness.getState().setSectorDraftProposal('rates', {
      id: 'proposal-1',
      entityType: 'core-variable',
      action: 'create',
      title: 'Policy pressure',
      definition: 'Track whether markets are pricing policy pressure.',
    });

    const saved = JSON.parse(window.localStorage.getItem('nimi:polyinfo:chat:v1') || '{}') as Record<string, unknown>;
    expect(saved.rates).toMatchObject({
      draftText: 'draft text',
      error: 'temporary error',
      isStreaming: true,
      draftProposal: {
        id: 'proposal-1',
        title: 'Policy pressure',
      },
    });
  });
});
