// Unit tests for nsfw-media-policy.ts — NSFW guardrail logic (RL-PIPE-011)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateNsfwMediaPolicy,
  isPromptLikelyNsfw,
  isMediaGenerationAllowed,
  isNsfwMediaAllowed,
} from '../src/main/media/nsfw-media-policy.js';

// ─── evaluateNsfwMediaPolicy ──────────────────────────────────────────────

describe('evaluateNsfwMediaPolicy', () => {
  it('returns local-only for cloud route', () => {
    assert.equal(
      evaluateNsfwMediaPolicy({ routeSource: 'cloud' }),
      'local-only',
    );
  });

  it('returns local-only for cloud even with natural-visuals', () => {
    assert.equal(
      evaluateNsfwMediaPolicy({ routeSource: 'cloud', visualComfortLevel: 'natural-visuals' }),
      'local-only',
    );
  });

  it('returns allowed for local + natural-visuals', () => {
    assert.equal(
      evaluateNsfwMediaPolicy({ routeSource: 'local', visualComfortLevel: 'natural-visuals' }),
      'allowed',
    );
  });

  it('returns disabled for local + restrained-visuals', () => {
    assert.equal(
      evaluateNsfwMediaPolicy({ routeSource: 'local', visualComfortLevel: 'restrained-visuals' }),
      'disabled',
    );
  });

  it('returns disabled for local + text-only', () => {
    assert.equal(
      evaluateNsfwMediaPolicy({ routeSource: 'local', visualComfortLevel: 'text-only' }),
      'disabled',
    );
  });

  it('returns disabled for local + undefined comfort level', () => {
    assert.equal(
      evaluateNsfwMediaPolicy({ routeSource: 'local' }),
      'disabled',
    );
  });
});

// ─── isNsfwMediaAllowed ───────────────────────────────────────────────────

describe('isNsfwMediaAllowed', () => {
  it('true for allowed', () => {
    assert.equal(isNsfwMediaAllowed('allowed'), true);
  });

  it('false for disabled', () => {
    assert.equal(isNsfwMediaAllowed('disabled'), false);
  });

  it('false for local-only', () => {
    assert.equal(isNsfwMediaAllowed('local-only'), false);
  });
});

// ─── isPromptLikelyNsfw ──────────────────────────────────────────────────

describe('isPromptLikelyNsfw', () => {
  it('detects English NSFW keywords', () => {
    assert.equal(isPromptLikelyNsfw('a nude photo'), true);
    assert.equal(isPromptLikelyNsfw('erotic scene'), true);
    assert.equal(isPromptLikelyNsfw('explicit content'), true);
    assert.equal(isPromptLikelyNsfw('topless model'), true);
  });

  it('detects Chinese NSFW keywords', () => {
    assert.equal(isPromptLikelyNsfw('裸体照片'), true);
    assert.equal(isPromptLikelyNsfw('色情内容'), true);
    assert.equal(isPromptLikelyNsfw('脱光衣服'), true);
    assert.equal(isPromptLikelyNsfw('乳房特写'), true);
  });

  it('does not trigger on non-NSFW content', () => {
    assert.equal(isPromptLikelyNsfw('a beautiful sunset'), false);
    assert.equal(isPromptLikelyNsfw('cute cat photo'), false);
    assert.equal(isPromptLikelyNsfw('森林风景'), false);
    assert.equal(isPromptLikelyNsfw('日落海边'), false);
  });

  it('returns false for empty input', () => {
    assert.equal(isPromptLikelyNsfw(''), false);
    assert.equal(isPromptLikelyNsfw('   '), false);
  });
});

// ─── isMediaGenerationAllowed ─────────────────────────────────────────────

describe('isMediaGenerationAllowed', () => {
  it('allows non-NSFW prompt regardless of policy', () => {
    assert.equal(
      isMediaGenerationAllowed({ policy: 'disabled', routeSource: 'cloud', prompt: 'sunset' }),
      true,
    );
  });

  it('blocks NSFW prompt when policy is disabled', () => {
    assert.equal(
      isMediaGenerationAllowed({ policy: 'disabled', routeSource: 'local', prompt: 'nude photo' }),
      false,
    );
  });

  it('allows NSFW prompt when policy is allowed', () => {
    assert.equal(
      isMediaGenerationAllowed({ policy: 'allowed', routeSource: 'local', prompt: 'nude photo' }),
      true,
    );
  });

  it('allows NSFW prompt on local route when policy is local-only', () => {
    assert.equal(
      isMediaGenerationAllowed({ policy: 'local-only', routeSource: 'local', prompt: 'nude photo' }),
      true,
    );
  });

  it('blocks NSFW prompt on cloud route when policy is local-only', () => {
    assert.equal(
      isMediaGenerationAllowed({ policy: 'local-only', routeSource: 'cloud', prompt: 'nude photo' }),
      false,
    );
  });

  it('respects explicit isNsfwPrompt override', () => {
    assert.equal(
      isMediaGenerationAllowed({ policy: 'disabled', routeSource: 'local', prompt: 'harmless text', isNsfwPrompt: true }),
      false,
    );
    assert.equal(
      isMediaGenerationAllowed({ policy: 'disabled', routeSource: 'local', prompt: 'nude photo', isNsfwPrompt: false }),
      true,
    );
  });
});
