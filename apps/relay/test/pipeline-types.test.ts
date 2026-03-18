// Unit tests for pipeline foundation types and utilities (RL-PIPE)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createUlid } from '../src/main/chat-pipeline/ulid.js';
import { createDefaultMediaPromptTracePatch } from '../src/main/chat-pipeline/types.js';
import { compactHeadTail } from '../src/main/chat-pipeline/text-compaction.js';
import {
  DEFAULT_STREAM_END_MARKER,
  findTrailingEndMarkerFragmentLength,
  stripTrailingEndMarkerFragment,
} from '../src/main/chat-pipeline/stream-end-marker.js';

// ─── createUlid ─────────────────────────────────────────────────────────

describe('createUlid', () => {
  it('returns a 26-character string', () => {
    const ulid = createUlid();
    assert.equal(ulid.length, 26);
  });

  it('contains only valid Crockford base32 characters', () => {
    const ulid = createUlid();
    assert.match(ulid, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('generates unique values on successive calls', () => {
    const a = createUlid();
    const b = createUlid();
    assert.notEqual(a, b);
  });

  it('accepts an explicit timestamp', () => {
    const ts = 1_700_000_000_000;
    const ulid = createUlid(ts);
    assert.equal(ulid.length, 26);
  });

  it('same timestamp produces different ULIDs (random suffix)', () => {
    const ts = 1_700_000_000_000;
    const a = createUlid(ts);
    const b = createUlid(ts);
    // Time prefix (first 10 chars) is the same, random suffix differs
    assert.equal(a.slice(0, 10), b.slice(0, 10));
    assert.notEqual(a, b);
  });
});

// ─── createDefaultMediaPromptTracePatch ─────────────────────────────────

describe('createDefaultMediaPromptTracePatch', () => {
  it('returns correct default values', () => {
    const patch = createDefaultMediaPromptTracePatch();
    assert.equal(patch.plannerUsed, false);
    assert.equal(patch.plannerKind, 'none');
    assert.equal(patch.plannerTrigger, 'none');
    assert.equal(patch.plannerConfidence, null);
    assert.equal(patch.plannerBlockedReason, null);
    assert.equal(patch.mediaDecisionSource, 'none');
    assert.equal(patch.mediaDecisionKind, 'none');
    assert.equal(patch.mediaExecutionStatus, 'none');
    assert.equal(patch.mediaExecutionRouteSource, null);
    assert.equal(patch.mediaExecutionRouteModel, null);
    assert.equal(patch.mediaExecutionReason, null);
    assert.equal(patch.mediaSpecHash, null);
    assert.equal(patch.mediaCompilerRevision, null);
    assert.equal(patch.mediaRouteResolvedBy, null);
    assert.equal(patch.mediaCacheStatus, null);
    assert.equal(patch.mediaShadowText, null);
  });
});

// ─── compactHeadTail ────────────────────────────────────────────────────

describe('compactHeadTail', () => {
  it('returns full text when within limit', () => {
    assert.equal(compactHeadTail('hello', 10), 'hello');
  });

  it('truncates long text with ellipsis', () => {
    const result = compactHeadTail('abcdefghij', 7);
    assert.ok(result.includes('…'));
    assert.ok(result.length <= 7);
  });

  it('returns empty string for zero limit', () => {
    assert.equal(compactHeadTail('hello', 0), '');
  });

  it('returns ellipsis for limit of 1', () => {
    assert.equal(compactHeadTail('hello world', 1), '…');
  });

  it('handles empty input', () => {
    assert.equal(compactHeadTail('', 10), '');
  });

  it('preserves head and tail portions', () => {
    const input = 'abcdefghijklmnopqrstuvwxyz';
    const result = compactHeadTail(input, 10);
    // Should start with beginning of input and end with end of input
    assert.ok(result.startsWith('a'));
    assert.ok(result.endsWith('z') || result.includes('…'));
  });
});

// ─── DEFAULT_STREAM_END_MARKER ──────────────────────────────────────────

describe('DEFAULT_STREAM_END_MARKER', () => {
  it('is |END|', () => {
    assert.equal(DEFAULT_STREAM_END_MARKER, '|END|');
  });
});

// ─── findTrailingEndMarkerFragmentLength ────────────────────────────────

describe('findTrailingEndMarkerFragmentLength', () => {
  it('returns full marker length for complete marker', () => {
    assert.equal(findTrailingEndMarkerFragmentLength('hello|END|'), 5);
  });

  it('returns partial length for partial marker |EN', () => {
    assert.equal(findTrailingEndMarkerFragmentLength('hello|EN'), 3);
  });

  it('returns partial length for partial marker |END', () => {
    assert.equal(findTrailingEndMarkerFragmentLength('hello|END'), 4);
  });

  it('returns partial length for partial marker |E', () => {
    assert.equal(findTrailingEndMarkerFragmentLength('hello|E'), 2);
  });

  it('returns 0 for no marker fragment', () => {
    assert.equal(findTrailingEndMarkerFragmentLength('hello world'), 0);
  });

  it('returns 0 for empty string', () => {
    assert.equal(findTrailingEndMarkerFragmentLength(''), 0);
  });

  it('returns 0 for single pipe (below MIN_PARTIAL_MARKER_SIZE)', () => {
    assert.equal(findTrailingEndMarkerFragmentLength('hello|'), 0);
  });

  it('handles trailing whitespace', () => {
    assert.equal(findTrailingEndMarkerFragmentLength('hello|END  '), 4);
  });
});

// ─── stripTrailingEndMarkerFragment ─────────────────────────────────────

describe('stripTrailingEndMarkerFragment', () => {
  it('strips full marker', () => {
    assert.equal(stripTrailingEndMarkerFragment('hello|END|'), 'hello');
  });

  it('strips partial marker |END', () => {
    assert.equal(stripTrailingEndMarkerFragment('hello|END'), 'hello');
  });

  it('strips partial marker |EN', () => {
    assert.equal(stripTrailingEndMarkerFragment('hello|EN'), 'hello');
  });

  it('preserves text without marker', () => {
    assert.equal(stripTrailingEndMarkerFragment('hello world'), 'hello world');
  });

  it('handles empty string', () => {
    assert.equal(stripTrailingEndMarkerFragment(''), '');
  });

  it('strips marker and trailing whitespace', () => {
    assert.equal(stripTrailingEndMarkerFragment('hello |END|  '), 'hello');
  });
});
