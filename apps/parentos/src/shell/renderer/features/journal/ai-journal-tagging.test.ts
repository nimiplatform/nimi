import { describe, expect, it } from 'vitest';
import { parseJournalTagSuggestion } from './ai-journal-tagging.js';
import type { ObservationDimension } from '../../knowledge-base/index.js';

const candidateDimensions: ObservationDimension[] = [
  {
    dimensionId: 'PO-OBS-SOCL-001',
    displayName: 'Social interaction',
    description: '',
    ageRange: { startMonths: 0, endMonths: -1 },
    parentQuestion: 'How did the child relate to others?',
    observableSignals: [],
    guidedQuestions: [],
    quickTags: ['Shared toys', 'Asked for help', 'Watched others'],
    source: 'test',
  },
  {
    dimensionId: 'PO-OBS-LANG-001',
    displayName: 'Language',
    description: '',
    ageRange: { startMonths: 0, endMonths: -1 },
    parentQuestion: 'How did the child communicate?',
    observableSignals: [],
    guidedQuestions: [],
    quickTags: ['Asked questions', 'Long sentence'],
    source: 'test',
  },
];

describe('parseJournalTagSuggestion', () => {
  it('accepts a closed-set dimension and tags suggestion', () => {
    expect(parseJournalTagSuggestion(JSON.stringify({
      dimensionId: 'PO-OBS-SOCL-001',
      tags: ['Shared toys', 'Asked for help'],
    }), candidateDimensions)).toEqual({
      dimensionId: 'PO-OBS-SOCL-001',
      tags: ['Shared toys', 'Asked for help'],
    });
  });

  it('fails closed for unknown dimension ids', () => {
    expect(() => parseJournalTagSuggestion(JSON.stringify({
      dimensionId: 'PO-OBS-UNKNOWN',
      tags: [],
    }), candidateDimensions)).toThrow(/unknown dimensionId/);
  });

  it('fails closed for tags outside the allowed quick-tag vocabulary', () => {
    expect(() => parseJournalTagSuggestion(JSON.stringify({
      dimensionId: 'PO-OBS-SOCL-001',
      tags: ['Invented tag'],
    }), candidateDimensions)).toThrow(/unsupported tag/);
  });

  it('fails closed when tags are returned without a dimension', () => {
    expect(() => parseJournalTagSuggestion(JSON.stringify({
      dimensionId: null,
      tags: ['Shared toys'],
    }), candidateDimensions)).toThrow(/without a dimensionId/);
  });
});
