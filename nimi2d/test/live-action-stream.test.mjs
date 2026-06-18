import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateNimi2DRmsVolume,
  createNimi2DAmplitudeMouthLane,
  createNimi2DComposer,
  createNimi2DReferenceActionStream,
  Nimi2DReferenceActionStreamEventError,
  runNimi2DReferenceActionStress,
} from '../src/reference-player/index.mjs';

test('amplitude mouth lane computes RMS volume and updates composer mouth state', async () => {
  assert.equal(calculateNimi2DRmsVolume(new Uint8Array([128, 128, 128, 128])), 0);
  assert.equal(calculateNimi2DRmsVolume(new Uint8Array([0, 255])) > 0.9, true);

  const composer = createNimi2DComposer();
  const mouthLane = createNimi2DAmplitudeMouthLane({ composer, fftSize: 8 });
  const source = {
    connected: null,
    disconnected: null,
    connect(target) {
      this.connected = target;
    },
    disconnect(target) {
      this.disconnected = target;
    },
  };
  const context = {
    createAnalyser() {
      return {
        fftSize: 8,
        getByteTimeDomainData(samples) {
          for (let index = 0; index < samples.length; index += 1) {
            samples[index] = index % 2 === 0 ? 0 : 255;
          }
        },
      };
    },
  };

  assert.deepEqual(await mouthLane.attachAudioSource(source, context), { status: 'ok' });
  const polled = mouthLane.poll();
  assert.equal(polled.lane, 'amplitude');
  assert.equal(polled.volume > 0.9, true);
  assert.equal(composer.snapshot().mouthOpen > 0.9, true);

  mouthLane.silent();
  assert.equal(composer.snapshot().mouthOpen, 0);
  assert.equal(source.disconnected, source.connected);
});

test('amplitude mouth lane returns typed silent result when audio source connection fails', async () => {
  const mouthLane = createNimi2DAmplitudeMouthLane();
  const result = await mouthLane.attachAudioSource({
    connect() {
      throw new Error('connect failed');
    },
  }, {
    createAnalyser() {
      return {
        fftSize: 8,
        getByteTimeDomainData() {},
      };
    },
  });

  assert.equal(result.status, 'silent');
  assert.equal(result.reason, 'audio_source_connect_failed');
  assert.equal(mouthLane.snapshot(), null);
});

test('reference action stream consumes semantic intent events and leaves frame control to runtime', () => {
  const stream = createNimi2DReferenceActionStream();
  const snapshot = stream.applyEvents([
    { type: 'activity', name: 'listen', intensity: 0.8 },
    { type: 'emotion', current: 'curious' },
    { type: 'motion', routeId: 'lean_in', fade: 0.05, durationMs: 240 },
    { type: 'mouth_amplitude', value: 0.65 },
  ]);

  assert.equal(snapshot.activity, 'listen');
  assert.equal(snapshot.emotion, 'curious');
  assert.equal(snapshot.expression, 'curious');
  assert.equal(snapshot.motion, 'lean_in');
  assert.equal(snapshot.mouthOpen, 0.65);

  const advanced = stream.advanceFrame(80);
  assert.equal(advanced.schedulerTimeMs, 80);
  assert.equal(advanced.motion, 'lean_in');
  assert.equal(advanced.motionWeight > 0, true);

  const recovered = stream.advanceFrame(260);
  assert.equal(recovered.motion, 'idle');
  assert.equal(recovered.motionWeight, 0);
});

test('reference action stream supports queue and interrupt without blocking expression or mouth lanes', () => {
  const stream = createNimi2DReferenceActionStream();
  stream.applyEvent({ type: 'expression', name: 'focused', weight: 0.7, fade: 0 });
  stream.applyEvent({ type: 'motion', routeId: 'wave', durationMs: 100, fade: 0.01 });
  stream.applyEvent({ type: 'motion', routeId: 'nod', durationMs: 100, fade: 0.01, queue: true });
  stream.applyEvent({ type: 'mouth_amplitude', value: 1 });

  assert.equal(stream.snapshot().motion, 'wave');
  assert.equal(stream.snapshot().motionQueueLength, 1);
  assert.equal(stream.snapshot().expression, 'focused');
  assert.equal(stream.snapshot().mouthOpen, 1);

  const queued = stream.advanceFrame(120);
  assert.equal(queued.motion, 'nod');
  assert.equal(queued.motionCompletedCount, 1);
  assert.equal(queued.expression, 'focused');
  assert.equal(queued.mouthOpen, 1);

  stream.applyEvent({ type: 'motion', routeId: 'spin', durationMs: 100, interrupt: true });
  assert.equal(stream.snapshot().motion, 'spin');
  assert.equal(stream.snapshot().motionInterruptedCount, 1);
  assert.equal(stream.snapshot().motionQueueLength, 0);
});

test('reference action stream rejects unknown events and low-level continuous motion fields', () => {
  const stream = createNimi2DReferenceActionStream();

  assert.throws(
    () => stream.applyEvent({ type: 'head_translate', x: 0.3 }),
    (error) => error instanceof Nimi2DReferenceActionStreamEventError
      && error.code === 'NIMI2D_REFERENCE_EVENT_TYPE_UNKNOWN',
  );

  assert.throws(
    () => stream.applyEvent({ type: 'motion', routeId: 'lean_in', x: 0.3 }),
    (error) => error instanceof Nimi2DReferenceActionStreamEventError
      && error.code === 'NIMI2D_REFERENCE_EVENT_FIELD_FORBIDDEN'
      && error.path === '$.x',
  );

  assert.throws(
    () => stream.applyEvents({ type: 'activity', name: 'listen' }),
    (error) => error instanceof Nimi2DReferenceActionStreamEventError
      && error.code === 'NIMI2D_REFERENCE_EVENT_BATCH_INVALID',
  );
});

test('reference action stress exercises queue, interrupt, mouth, reset, and fail-closed event validation', async () => {
  const result = await runNimi2DReferenceActionStress({
    backendKind: 'nimi2d',
    layerRefs: ['layer_body', 'layer_head', 'layer_mouth', 'layer_outfit'],
    defaultOutfitLayerRefs: ['layer_outfit'],
  });

  assert.equal(result.verdict, 'pass_stream_stress_tier1');
  assert.equal(result.metrics.rejectedInvalidEventCount, 1);
  assert.equal(result.metrics.maxQueueLength >= 2, true);
  assert.equal(result.metrics.maxCompletedCount >= 2, true);
  assert.equal(result.metrics.maxInterruptedCount >= 1, true);
  assert.equal(result.metrics.maxMouthOpen >= 0.9, true);
  assert.equal(result.metrics.finalNeutral, true);
  assert.equal(result.failures.length, 0);
});
