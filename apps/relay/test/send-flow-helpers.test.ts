// Unit tests for send-flow-helpers.ts — turn/txn ID, beat normalization, deliveries

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTurnTxnId,
  createTurnId,
  normalizeBeatText,
  resolveFirstBeatIntent,
  ensureNotAborted,
  assertExplicitMediaAssetRequest,
  buildAssistantDeliveries,
  type OrchestratedBeat,
} from '../src/main/chat-pipeline/send-flow-helpers.js';

// ─── createTurnTxnId / createTurnId ──────────────────────────────────────

describe('createTurnTxnId', () => {
  it('starts with txn_ prefix', () => {
    const id = createTurnTxnId();
    assert.ok(id.startsWith('txn_'));
  });

  it('has 26-char ULID suffix', () => {
    const id = createTurnTxnId();
    const suffix = id.slice(4);
    assert.equal(suffix.length, 26);
  });

  it('produces unique IDs', () => {
    const a = createTurnTxnId();
    const b = createTurnTxnId();
    assert.notEqual(a, b);
  });
});

describe('createTurnId', () => {
  it('starts with turn_ prefix', () => {
    const id = createTurnId();
    assert.ok(id.startsWith('turn_'));
  });

  it('has 26-char ULID suffix', () => {
    const id = createTurnId();
    const suffix = id.slice(5);
    assert.equal(suffix.length, 26);
  });
});

// ─── normalizeBeatText ───────────────────────────────────────────────────

describe('normalizeBeatText', () => {
  it('strips |END| marker', () => {
    assert.equal(normalizeBeatText('Hello world|END|'), 'Hello world');
  });

  it('strips partial end marker', () => {
    assert.equal(normalizeBeatText('Hello world|EN'), 'Hello world');
  });

  it('collapses whitespace', () => {
    assert.equal(normalizeBeatText('Hello   world  '), 'Hello world');
  });

  it('handles empty input', () => {
    assert.equal(normalizeBeatText(''), '');
  });

  it('trims and collapses combined', () => {
    assert.equal(normalizeBeatText('  Hello   world  |END|  '), 'Hello world');
  });
});

// ─── resolveFirstBeatIntent ──────────────────────────────────────────────

describe('resolveFirstBeatIntent', () => {
  it('emotional → comfort', () => {
    assert.equal(resolveFirstBeatIntent('emotional'), 'comfort');
  });

  it('checkin → checkin', () => {
    assert.equal(resolveFirstBeatIntent('checkin'), 'checkin');
  });

  it('playful → tease', () => {
    assert.equal(resolveFirstBeatIntent('playful'), 'tease');
  });

  it('intimate → invite', () => {
    assert.equal(resolveFirstBeatIntent('intimate'), 'invite');
  });

  it('explicit-media → media', () => {
    assert.equal(resolveFirstBeatIntent('explicit-media'), 'media');
  });

  it('information → answer', () => {
    assert.equal(resolveFirstBeatIntent('information'), 'answer');
  });

  it('explicit-voice → answer', () => {
    assert.equal(resolveFirstBeatIntent('explicit-voice'), 'answer');
  });
});

// ─── ensureNotAborted ────────────────────────────────────────────────────

describe('ensureNotAborted', () => {
  it('does not throw when signal is undefined', () => {
    assert.doesNotThrow(() => ensureNotAborted(undefined));
  });

  it('does not throw when signal is not aborted', () => {
    const controller = new AbortController();
    assert.doesNotThrow(() => ensureNotAborted(controller.signal));
  });

  it('throws when signal is aborted', () => {
    const controller = new AbortController();
    controller.abort();
    assert.throws(
      () => ensureNotAborted(controller.signal),
      /RELAY_CHAT_TURN_SEND_ABORTED/,
    );
  });
});

// ─── assertExplicitMediaAssetRequest ────────────────────────────────────

describe('assertExplicitMediaAssetRequest', () => {
  it('does not throw for non explicit-media turns', () => {
    assert.doesNotThrow(() =>
      assertExplicitMediaAssetRequest({
        turnMode: 'information',
        markerOverrideIntent: null,
      }));
  });

  it('does not throw when explicit-media has a marker override intent', () => {
    assert.doesNotThrow(() =>
      assertExplicitMediaAssetRequest({
        turnMode: 'explicit-media',
        markerOverrideIntent: {
          type: 'image',
          prompt: 'selfie',
          source: 'tag',
          plannerTrigger: 'marker-override',
          pendingMessageId: 'beat-1',
          plannerConfidence: 0.9,
          plannerSuggestsNsfw: false,
        },
      }));
  });

  it('throws when explicit-media composer output lacks an asset request', () => {
    assert.throws(
      () =>
        assertExplicitMediaAssetRequest({
          turnMode: 'explicit-media',
          markerOverrideIntent: null,
        }),
      /did not produce an asset request/,
    );
  });
});

// ─── buildAssistantDeliveries ────────────────────────────────────────────

describe('buildAssistantDeliveries', () => {
  function makeBeat(overrides: Partial<OrchestratedBeat> = {}): OrchestratedBeat {
    return {
      beatId: 'beat-1',
      turnId: 'turn-1',
      beatIndex: 0,
      beatCount: 2,
      intent: 'answer',
      relationMove: 'friendly',
      sceneMove: 'daily',
      modality: 'text',
      text: 'Hello',
      pauseMs: 300,
      cancellationScope: 'turn',
      ...overrides,
    };
  }

  it('filters out empty text beats (non-media)', () => {
    const deliveries = buildAssistantDeliveries({
      beats: [
        makeBeat({ text: '' }),
        makeBeat({ beatId: 'beat-2', beatIndex: 1, text: 'World' }),
      ],
      planId: 'plan-1',
      turnMode: 'emotional',
      voiceConversationMode: 'off',
    });
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].content, 'World');
  });

  it('preserves media beats even with empty text', () => {
    const deliveries = buildAssistantDeliveries({
      beats: [
        makeBeat({
          text: '',
          modality: 'image',
          assetRequest: { kind: 'image', prompt: 'selfie', confidence: 0.9, nsfwIntent: 'none' },
        }),
      ],
      planId: 'plan-1',
      turnMode: 'explicit-media',
      voiceConversationMode: 'off',
    });
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].kind, 'image');
  });

  it('sets delayMs=0 for first beat', () => {
    const deliveries = buildAssistantDeliveries({
      beats: [makeBeat({ pauseMs: 500 })],
      planId: 'plan-1',
      turnMode: 'emotional',
      voiceConversationMode: 'off',
    });
    assert.equal(deliveries[0].delayMs, 0);
  });

  it('uses pauseMs for non-first beats', () => {
    const deliveries = buildAssistantDeliveries({
      beats: [
        makeBeat({ text: 'First' }),
        makeBeat({ beatId: 'beat-2', beatIndex: 1, text: 'Second', pauseMs: 700 }),
      ],
      planId: 'plan-1',
      turnMode: 'emotional',
      voiceConversationMode: 'off',
    });
    assert.equal(deliveries[1].delayMs, 700);
  });

  it('populates meta fields correctly', () => {
    const deliveries = buildAssistantDeliveries({
      beats: [makeBeat({ modality: 'voice', autoPlayVoice: true })],
      planId: 'plan-1',
      turnMode: 'emotional',
      voiceConversationMode: 'on',
    });
    const meta = deliveries[0].meta;
    assert.equal(meta.planId, 'plan-1');
    assert.equal(meta.turnMode, 'emotional');
    assert.equal(meta.voiceConversationMode, 'on');
    assert.equal(meta.autoPlayVoice, true);
    assert.equal(meta.beatModality, 'voice');
  });
});
