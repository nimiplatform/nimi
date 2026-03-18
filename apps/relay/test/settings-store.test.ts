// Unit tests for settings normalization and merge

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeLocalChatProductSettings,
  normalizeLocalChatInspectSettings,
  mergeLocalChatSettings,
  resolveLocalChatVoiceEnabled,
  DEFAULT_LOCAL_CHAT_PRODUCT_SETTINGS,
  DEFAULT_LOCAL_CHAT_INSPECT_SETTINGS,
  DEFAULT_LOCAL_CHAT_DEFAULT_SETTINGS,
} from '../src/main/settings/types.js';

// ─── normalizeLocalChatProductSettings ──────────────────────────────────

describe('normalizeLocalChatProductSettings', () => {
  it('returns defaults for null input', () => {
    const result = normalizeLocalChatProductSettings(null);
    assert.deepEqual(result, DEFAULT_LOCAL_CHAT_PRODUCT_SETTINGS);
  });

  it('returns defaults for undefined input', () => {
    const result = normalizeLocalChatProductSettings(undefined);
    assert.deepEqual(result, DEFAULT_LOCAL_CHAT_PRODUCT_SETTINGS);
  });

  it('returns defaults for non-object input', () => {
    const result = normalizeLocalChatProductSettings('not-an-object');
    assert.deepEqual(result, DEFAULT_LOCAL_CHAT_PRODUCT_SETTINGS);
  });

  it('normalizes invalid mediaAutonomy to natural', () => {
    const result = normalizeLocalChatProductSettings({ mediaAutonomy: 'invalid' });
    assert.equal(result.mediaAutonomy, 'natural');
  });

  it('preserves valid mediaAutonomy off', () => {
    const result = normalizeLocalChatProductSettings({ mediaAutonomy: 'off' });
    assert.equal(result.mediaAutonomy, 'off');
  });

  it('preserves valid mediaAutonomy explicit-only', () => {
    const result = normalizeLocalChatProductSettings({ mediaAutonomy: 'explicit-only' });
    assert.equal(result.mediaAutonomy, 'explicit-only');
  });

  it('normalizes invalid voiceAutonomy to default', () => {
    const result = normalizeLocalChatProductSettings({ voiceAutonomy: 'invalid' });
    assert.equal(result.voiceAutonomy, DEFAULT_LOCAL_CHAT_PRODUCT_SETTINGS.voiceAutonomy);
  });

  it('preserves valid voiceAutonomy values', () => {
    for (const value of ['off', 'explicit-only', 'natural'] as const) {
      const result = normalizeLocalChatProductSettings({ voiceAutonomy: value });
      assert.equal(result.voiceAutonomy, value);
    }
  });

  it('normalizes invalid voiceConversationMode to off', () => {
    const result = normalizeLocalChatProductSettings({ voiceConversationMode: 'invalid' });
    assert.equal(result.voiceConversationMode, 'off');
  });

  it('preserves on voiceConversationMode', () => {
    const result = normalizeLocalChatProductSettings({ voiceConversationMode: 'on' });
    assert.equal(result.voiceConversationMode, 'on');
  });

  it('normalizes invalid visualComfortLevel to default', () => {
    const result = normalizeLocalChatProductSettings({ visualComfortLevel: 'invalid' });
    assert.equal(result.visualComfortLevel, DEFAULT_LOCAL_CHAT_PRODUCT_SETTINGS.visualComfortLevel);
  });

  it('preserves valid visualComfortLevel values', () => {
    for (const value of ['text-only', 'restrained-visuals', 'natural-visuals'] as const) {
      const result = normalizeLocalChatProductSettings({ visualComfortLevel: value });
      assert.equal(result.visualComfortLevel, value);
    }
  });

  it('defaults allowProactiveContact to true when not explicitly false', () => {
    const result = normalizeLocalChatProductSettings({});
    assert.equal(result.allowProactiveContact, true);
  });

  it('sets allowProactiveContact to false when explicitly false', () => {
    const result = normalizeLocalChatProductSettings({ allowProactiveContact: false });
    assert.equal(result.allowProactiveContact, false);
  });

  it('defaults autoPlayVoiceReplies to false', () => {
    const result = normalizeLocalChatProductSettings({});
    assert.equal(result.autoPlayVoiceReplies, false);
  });

  it('sets autoPlayVoiceReplies to true when truthy', () => {
    const result = normalizeLocalChatProductSettings({ autoPlayVoiceReplies: true });
    assert.equal(result.autoPlayVoiceReplies, true);
  });
});

// ─── normalizeLocalChatInspectSettings ──────────────────────────────────

describe('normalizeLocalChatInspectSettings', () => {
  it('returns defaults for null input', () => {
    const result = normalizeLocalChatInspectSettings(null);
    assert.deepEqual(result, DEFAULT_LOCAL_CHAT_INSPECT_SETTINGS);
  });

  it('returns defaults for undefined input', () => {
    const result = normalizeLocalChatInspectSettings(undefined);
    assert.deepEqual(result, DEFAULT_LOCAL_CHAT_INSPECT_SETTINGS);
  });

  it('normalizes invalid ttsRouteSource to auto', () => {
    const result = normalizeLocalChatInspectSettings({ ttsRouteSource: 'invalid' });
    assert.equal(result.ttsRouteSource, 'auto');
  });

  it('preserves valid ttsRouteSource local', () => {
    const result = normalizeLocalChatInspectSettings({ ttsRouteSource: 'local' });
    assert.equal(result.ttsRouteSource, 'local');
  });

  it('preserves valid ttsRouteSource cloud', () => {
    const result = normalizeLocalChatInspectSettings({ ttsRouteSource: 'cloud' });
    assert.equal(result.ttsRouteSource, 'cloud');
  });

  it('normalizes all route sources to auto for invalid values', () => {
    const result = normalizeLocalChatInspectSettings({
      sttRouteSource: 'invalid',
      imageRouteSource: 'nope',
      videoRouteSource: 'wrong',
    });
    assert.equal(result.sttRouteSource, 'auto');
    assert.equal(result.imageRouteSource, 'auto');
    assert.equal(result.videoRouteSource, 'auto');
  });

  it('defaults diagnosticsVisible to true', () => {
    const result = normalizeLocalChatInspectSettings({});
    assert.equal(result.diagnosticsVisible, true);
  });

  it('sets diagnosticsVisible to false when explicitly false', () => {
    const result = normalizeLocalChatInspectSettings({ diagnosticsVisible: false });
    assert.equal(result.diagnosticsVisible, false);
  });

  it('defaults runtimeInspectorVisible to false', () => {
    const result = normalizeLocalChatInspectSettings({});
    assert.equal(result.runtimeInspectorVisible, false);
  });

  it('trims string fields', () => {
    const result = normalizeLocalChatInspectSettings({
      voiceName: '  alloy  ',
      ttsConnectorId: '  conn-1  ',
      ttsModel: '  model-1  ',
    });
    assert.equal(result.voiceName, 'alloy');
    assert.equal(result.ttsConnectorId, 'conn-1');
    assert.equal(result.ttsModel, 'model-1');
  });
});

// ─── mergeLocalChatSettings ─────────────────────────────────────────────

describe('mergeLocalChatSettings', () => {
  it('produces correct merged view from default settings', () => {
    const merged = mergeLocalChatSettings({
      product: { ...DEFAULT_LOCAL_CHAT_PRODUCT_SETTINGS },
      inspect: { ...DEFAULT_LOCAL_CHAT_INSPECT_SETTINGS },
    });

    assert.equal(merged.mediaAutonomy, DEFAULT_LOCAL_CHAT_PRODUCT_SETTINGS.mediaAutonomy);
    assert.equal(merged.voiceAutonomy, DEFAULT_LOCAL_CHAT_PRODUCT_SETTINGS.voiceAutonomy);
    assert.equal(merged.diagnosticsVisible, DEFAULT_LOCAL_CHAT_INSPECT_SETTINGS.diagnosticsVisible);
    assert.equal(merged.deliveryStyle, 'natural');
    assert.equal(merged.relationshipBoundaryPreset, 'balanced');
  });

  it('derives enableVoice from product settings', () => {
    const merged = mergeLocalChatSettings({
      product: {
        ...DEFAULT_LOCAL_CHAT_PRODUCT_SETTINGS,
        voiceAutonomy: 'off',
        voiceConversationMode: 'off',
      },
      inspect: { ...DEFAULT_LOCAL_CHAT_INSPECT_SETTINGS },
    });
    assert.equal(merged.enableVoice, false);

    const mergedOn = mergeLocalChatSettings({
      product: {
        ...DEFAULT_LOCAL_CHAT_PRODUCT_SETTINGS,
        voiceAutonomy: 'natural',
        voiceConversationMode: 'off',
      },
      inspect: { ...DEFAULT_LOCAL_CHAT_INSPECT_SETTINGS },
    });
    assert.equal(mergedOn.enableVoice, true);
  });

  it('overlays inspect settings onto product settings', () => {
    const merged = mergeLocalChatSettings({
      product: { ...DEFAULT_LOCAL_CHAT_PRODUCT_SETTINGS },
      inspect: {
        ...DEFAULT_LOCAL_CHAT_INSPECT_SETTINGS,
        voiceName: 'shimmer',
        ttsRouteSource: 'cloud',
      },
    });

    assert.equal(merged.voiceName, 'shimmer');
    assert.equal(merged.ttsRouteSource, 'cloud');
  });
});

// ─── resolveLocalChatVoiceEnabled ───────────────────────────────────────

describe('resolveLocalChatVoiceEnabled', () => {
  it('returns false when voiceAutonomy is off and voiceConversationMode is off', () => {
    assert.equal(resolveLocalChatVoiceEnabled({
      voiceAutonomy: 'off',
      voiceConversationMode: 'off',
    }), false);
  });

  it('returns true when voiceConversationMode is on', () => {
    assert.equal(resolveLocalChatVoiceEnabled({
      voiceAutonomy: 'off',
      voiceConversationMode: 'on',
    }), true);
  });

  it('returns true when voiceAutonomy is not off', () => {
    assert.equal(resolveLocalChatVoiceEnabled({
      voiceAutonomy: 'natural',
      voiceConversationMode: 'off',
    }), true);

    assert.equal(resolveLocalChatVoiceEnabled({
      voiceAutonomy: 'explicit-only',
      voiceConversationMode: 'off',
    }), true);
  });
});
