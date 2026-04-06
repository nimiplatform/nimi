// Unit tests for media-spec.ts — prompt compilation, size/duration inference, hash

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMediaGenerationSpec,
  compileMediaExecution,
  createMediaSpecHash,
  type MediaIntent,
} from '../src/main/media/media-spec.js';

function createIntent(overrides: Partial<MediaIntent> = {}): MediaIntent {
  return {
    kind: 'image',
    intentSource: 'tag',
    plannerTrigger: 'user-explicit',
    confidence: 0.9,
    nsfwIntent: 'none',
    subject: 'a girl',
    scene: 'in a park',
    styleIntent: 'natural',
    mood: 'happy',
    ...overrides,
  };
}

// ─── buildMediaGenerationSpec ─────────────────────────────────────────────

describe('buildMediaGenerationSpec', () => {
  it('builds image spec with default values', () => {
    const spec = buildMediaGenerationSpec({
      intent: createIntent({ kind: 'image' }),
      targetId: 'target-1',
    });
    assert.equal(spec.kind, 'image');
    assert.equal(spec.targetId, 'target-1');
    assert.equal(spec.requestedCount, 1);
    assert.equal(spec.worldId, null);
  });

  it('builds video spec with duration', () => {
    const spec = buildMediaGenerationSpec({
      intent: createIntent({ kind: 'video', subject: 'a walk in the park' }),
      targetId: 'target-1',
    });
    assert.equal(spec.kind, 'video');
    assert.ok(spec.requestedDurationSeconds! >= 4);
    assert.equal(spec.requestedCount, undefined);
  });

  it('uses fallback subject when empty', () => {
    const spec = buildMediaGenerationSpec({
      intent: createIntent({ subject: '' }),
      targetId: 'target-1',
    });
    assert.equal(spec.subject, 'subject in current conversation');
  });

  it('preserves worldId', () => {
    const spec = buildMediaGenerationSpec({
      intent: createIntent(),
      targetId: 'target-1',
      worldId: 'world-1',
    });
    assert.equal(spec.worldId, 'world-1');
  });
});

// ─── Image size inference ─────────────────────────────────────────────────

describe('buildMediaGenerationSpec — image size inference', () => {
  it('selfie → 1024x1024', () => {
    const spec = buildMediaGenerationSpec({
      intent: createIntent({ subject: 'selfie of the girl' }),
      targetId: 't1',
    });
    assert.equal(spec.requestedSize, '1024x1024');
  });

  it('landscape → 1536x1024', () => {
    const spec = buildMediaGenerationSpec({
      intent: createIntent({ scene: 'wide landscape panorama' }),
      targetId: 't1',
    });
    assert.equal(spec.requestedSize, '1536x1024');
  });

  it('portrait → 1024x1536', () => {
    const spec = buildMediaGenerationSpec({
      intent: createIntent({ subject: 'portrait close-up' }),
      targetId: 't1',
    });
    assert.equal(spec.requestedSize, '1024x1536');
  });

  it('no cue → no requestedSize', () => {
    const spec = buildMediaGenerationSpec({
      intent: createIntent({ subject: 'some abstract art', scene: 'in a room' }),
      targetId: 't1',
    });
    assert.equal(spec.requestedSize, undefined);
  });
});

// ─── Video duration inference ─────────────────────────────────────────────

describe('buildMediaGenerationSpec — video duration inference', () => {
  it('walk → 6s', () => {
    const spec = buildMediaGenerationSpec({
      intent: createIntent({ kind: 'video', subject: 'girl walking in park' }),
      targetId: 't1',
    });
    assert.equal(spec.requestedDurationSeconds, 6);
  });

  it('blink → 4s', () => {
    const spec = buildMediaGenerationSpec({
      intent: createIntent({ kind: 'video', subject: 'girl blink and smile' }),
      targetId: 't1',
    });
    assert.equal(spec.requestedDurationSeconds, 4);
  });

  it('default → 5s', () => {
    const spec = buildMediaGenerationSpec({
      intent: createIntent({ kind: 'video', subject: 'a girl', scene: 'sitting' }),
      targetId: 't1',
    });
    assert.equal(spec.requestedDurationSeconds, 5);
  });
});

// ─── compileMediaExecution ────────────────────────────────────────────────

describe('compileMediaExecution', () => {
  it('compiles prompt with subject/scene/style/mood', () => {
    const spec = buildMediaGenerationSpec({
      intent: createIntent(),
      targetId: 't1',
    });
    const compiled = compileMediaExecution(spec);
    assert.ok(compiled.compiledPromptText.includes('a girl'));
    assert.ok(compiled.compiledPromptText.includes('in a park'));
    assert.ok(compiled.runtimePayload.prompt.length > 0);
  });

  it('includes negative prompt from hints', () => {
    const spec = buildMediaGenerationSpec({
      intent: createIntent({ hints: { negativeCues: ['extra people', 'hand artifacts'] } }),
      targetId: 't1',
    });
    const compiled = compileMediaExecution(spec);
    assert.ok(compiled.runtimePayload.negativePrompt);
    assert.ok(compiled.runtimePayload.negativePrompt!.includes('extra people'));
  });

  it('infers camera motion for video', () => {
    const spec = buildMediaGenerationSpec({
      intent: createIntent({ kind: 'video', scene: 'tracking shot following the girl' }),
      targetId: 't1',
    });
    const compiled = compileMediaExecution(spec);
    assert.equal(compiled.runtimePayload.cameraMotion, 'tracking');
  });

  it('infers style for cinematic', () => {
    const spec = buildMediaGenerationSpec({
      intent: createIntent({ styleIntent: 'cinematic film look' }),
      targetId: 't1',
    });
    const compiled = compileMediaExecution(spec);
    assert.equal(compiled.runtimePayload.style, 'cinematic');
  });

  it('includes compiler revision', () => {
    const spec = buildMediaGenerationSpec({
      intent: createIntent(),
      targetId: 't1',
    });
    const compiled = compileMediaExecution(spec);
    assert.ok(compiled.compilerRevision.startsWith('media-compiler.'));
  });
});

// ─── createMediaSpecHash ──────────────────────────────────────────────────

describe('createMediaSpecHash', () => {
  it('produces deterministic hash', async () => {
    const spec = buildMediaGenerationSpec({
      intent: createIntent(),
      targetId: 't1',
    });
    const a = await createMediaSpecHash(spec);
    const b = await createMediaSpecHash(spec);
    assert.equal(a, b);
    assert.ok(a.length === 64, 'sha256 hex is 64 chars');
  });

  it('different specs produce different hashes', async () => {
    const specA = buildMediaGenerationSpec({
      intent: createIntent({ subject: 'girl A' }),
      targetId: 't1',
    });
    const specB = buildMediaGenerationSpec({
      intent: createIntent({ subject: 'girl B' }),
      targetId: 't1',
    });
    const a = await createMediaSpecHash(specA);
    const b = await createMediaSpecHash(specB);
    assert.notEqual(a, b);
  });
});
