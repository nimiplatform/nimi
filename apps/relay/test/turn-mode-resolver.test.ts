// Unit tests for regex-based turn mode resolution

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTurnMode } from '../src/main/chat-pipeline/turn-mode-resolver.js';
import type { DerivedInteractionProfile } from '../src/main/chat-pipeline/types.js';

function createProfile(overrides: Partial<DerivedInteractionProfile> = {}): DerivedInteractionProfile {
  return {
    expression: {
      responseLength: 'medium',
      formality: 'casual',
      sentiment: 'positive',
      pacingBias: 'balanced',
      firstBeatStyle: 'gentle',
      infoAnswerStyle: 'balanced',
      emojiUsage: 'occasional',
      ...(overrides.expression || {}),
    },
    relationship: {
      defaultDistance: 'friendly',
      warmth: 'warm',
      flirtAffinity: 'light',
      proactiveStyle: 'gentle',
      intimacyGuard: 'balanced',
      ...(overrides.relationship || {}),
    },
    voice: {
      voiceId: 'alloy',
      language: 'zh-CN',
      genderGuard: 'female',
      speedRange: 'balanced',
      pitchRange: 'mid',
      emotionEnabled: true,
      voiceAffinity: 'high',
      ...(overrides.voice || {}),
    },
    visual: {
      artStyle: 'anime',
      fashionStyle: 'casual',
      personaCue: 'gentle',
      nsfwLevel: 'suggestive',
      imageAffinity: 'medium',
      videoAffinity: 'low',
      ...(overrides.visual || {}),
    },
    modalityTraits: {
      textBias: 'medium',
      voiceBias: 'high',
      imageBias: 'medium',
      videoBias: 'low',
      latencyTolerance: 'medium',
      ...(overrides.modalityTraits || {}),
    },
    signals: [...(overrides.signals || [])],
  };
}

// ─── Explicit media detection ───────────────────────────────────────────

describe('resolveTurnMode — explicit media', () => {
  it('detects explicit media for 发图', () => {
    assert.equal(resolveTurnMode({ userText: '给我发图', interactionProfile: createProfile() }), 'explicit-media');
  });

  it('detects explicit media for 来张图', () => {
    assert.equal(resolveTurnMode({ userText: '来张图看看', interactionProfile: createProfile() }), 'explicit-media');
  });

  it('detects explicit media for 照片', () => {
    assert.equal(resolveTurnMode({ userText: '发一张照片', interactionProfile: createProfile() }), 'explicit-media');
  });

  it('detects explicit media for 看看你', () => {
    assert.equal(resolveTurnMode({ userText: '我想看看你', interactionProfile: createProfile() }), 'explicit-media');
  });

  it('detects explicit media for 发个视频', () => {
    assert.equal(resolveTurnMode({ userText: '发个视频给我', interactionProfile: createProfile() }), 'explicit-media');
  });

  it('detects explicit media for 自拍', () => {
    assert.equal(resolveTurnMode({ userText: '发个自拍', interactionProfile: createProfile() }), 'explicit-media');
  });
});

// ─── Explicit voice detection ───────────────────────────────────────────

describe('resolveTurnMode — explicit voice', () => {
  it('detects explicit voice for 语音', () => {
    assert.equal(resolveTurnMode({ userText: '用语音说', interactionProfile: createProfile() }), 'explicit-voice');
  });

  it('detects explicit voice for 说话', () => {
    assert.equal(resolveTurnMode({ userText: '直接说话', interactionProfile: createProfile() }), 'explicit-voice');
  });

  it('detects explicit voice for 声音', () => {
    assert.equal(resolveTurnMode({ userText: '我想听你的声音', interactionProfile: createProfile() }), 'explicit-voice');
  });

  it('detects explicit voice for 读给我听', () => {
    assert.equal(resolveTurnMode({ userText: '读给我听', interactionProfile: createProfile() }), 'explicit-voice');
  });
});

// ─── Emotional detection ────────────────────────────────────────────────

describe('resolveTurnMode — emotional', () => {
  it('detects emotional for 好累', () => {
    assert.equal(resolveTurnMode({ userText: '我今天好累', interactionProfile: createProfile() }), 'emotional');
  });

  it('detects emotional for 难过', () => {
    assert.equal(resolveTurnMode({ userText: '我很难过', interactionProfile: createProfile() }), 'emotional');
  });

  it('detects emotional for 想哭', () => {
    assert.equal(resolveTurnMode({ userText: '好想哭', interactionProfile: createProfile() }), 'emotional');
  });

  it('detects emotional for 委屈', () => {
    assert.equal(resolveTurnMode({ userText: '我好委屈', interactionProfile: createProfile() }), 'emotional');
  });

  it('detects emotional for 睡不着', () => {
    assert.equal(resolveTurnMode({ userText: '我睡不着', interactionProfile: createProfile() }), 'emotional');
  });
});

// ─── Checkin detection ──────────────────────────────────────────────────

describe('resolveTurnMode — checkin', () => {
  it('detects checkin for 在吗', () => {
    assert.equal(resolveTurnMode({ userText: '在吗', interactionProfile: createProfile() }), 'checkin');
  });

  it('detects checkin for 早安', () => {
    assert.equal(resolveTurnMode({ userText: '早安', interactionProfile: createProfile() }), 'checkin');
  });

  it('detects checkin for 晚安', () => {
    assert.equal(resolveTurnMode({ userText: '晚安', interactionProfile: createProfile() }), 'checkin');
  });

  it('detects checkin for hello', () => {
    assert.equal(resolveTurnMode({ userText: 'hello', interactionProfile: createProfile() }), 'checkin');
  });

  it('detects checkin for hi', () => {
    assert.equal(resolveTurnMode({ userText: 'hi', interactionProfile: createProfile() }), 'checkin');
  });

  it('detects checkin for 想你了', () => {
    assert.equal(resolveTurnMode({ userText: '想你了', interactionProfile: createProfile() }), 'checkin');
  });
});

// ─── Playful detection ──────────────────────────────────────────────────

describe('resolveTurnMode — playful', () => {
  it('detects playful for 哈哈', () => {
    assert.equal(resolveTurnMode({ userText: '哈哈太好玩了', interactionProfile: createProfile() }), 'playful');
  });

  it('detects playful for 笑死', () => {
    assert.equal(resolveTurnMode({ userText: '笑死我了', interactionProfile: createProfile() }), 'playful');
  });

  it('detects playful for 好耶', () => {
    assert.equal(resolveTurnMode({ userText: '好耶', interactionProfile: createProfile() }), 'playful');
  });
});

// ─── Intimate detection ─────────────────────────────────────────────────

describe('resolveTurnMode — intimate', () => {
  it('detects intimate for 喜欢你', () => {
    assert.equal(resolveTurnMode({ userText: '我喜欢你', interactionProfile: createProfile() }), 'intimate');
  });

  it('detects intimate for 爱你', () => {
    assert.equal(resolveTurnMode({ userText: '我爱你', interactionProfile: createProfile() }), 'intimate');
  });

  it('detects intimate for 暧昧', () => {
    assert.equal(resolveTurnMode({ userText: '我们是不是有点暧昧', interactionProfile: createProfile() }), 'intimate');
  });
});

// ─── Information detection ──────────────────────────────────────────────

describe('resolveTurnMode — information', () => {
  it('detects information for question mark', () => {
    assert.equal(resolveTurnMode({ userText: '这个怎么用？', interactionProfile: createProfile() }), 'information');
  });

  it('detects information for 为什么', () => {
    assert.equal(resolveTurnMode({ userText: '为什么天是蓝的', interactionProfile: createProfile() }), 'information');
  });

  it('detects information for 如何', () => {
    assert.equal(resolveTurnMode({ userText: '如何做蛋糕', interactionProfile: createProfile() }), 'information');
  });

  it('detects information for 是什么', () => {
    assert.equal(resolveTurnMode({ userText: '这是什么东西', interactionProfile: createProfile() }), 'information');
  });
});

// ─── Proactive mode ─────────────────────────────────────────────────────

describe('resolveTurnMode — proactive', () => {
  it('returns checkin when proactive flag is set', () => {
    assert.equal(resolveTurnMode({ userText: '任意内容', interactionProfile: createProfile(), proactive: true }), 'checkin');
  });
});

// ─── Default fallback ───────────────────────────────────────────────────

describe('resolveTurnMode — default fallback', () => {
  it('defaults to emotional for general conversation', () => {
    assert.equal(resolveTurnMode({ userText: '我今天去了公园', interactionProfile: createProfile() }), 'emotional');
  });

  it('defaults to playful for bursty pacing bias', () => {
    const profile = createProfile({
      expression: {
        responseLength: 'medium',
        formality: 'casual',
        sentiment: 'positive',
        pacingBias: 'bursty',
        firstBeatStyle: 'gentle',
        infoAnswerStyle: 'balanced',
        emojiUsage: 'occasional',
      },
    });
    assert.equal(resolveTurnMode({ userText: '我今天去了公园', interactionProfile: profile }), 'playful');
  });
});

// ─── Priority order ─────────────────────────────────────────────────────

describe('resolveTurnMode — priority order', () => {
  it('voice takes priority over media when both match', () => {
    // "用语音给我看看" contains both voice and media cues
    // voice RE is checked before media RE
    assert.equal(resolveTurnMode({ userText: '用语音给我看看你', interactionProfile: createProfile() }), 'explicit-voice');
  });

  it('proactive overrides all other detections', () => {
    assert.equal(resolveTurnMode({ userText: '发一张图', interactionProfile: createProfile(), proactive: true }), 'checkin');
  });
});
