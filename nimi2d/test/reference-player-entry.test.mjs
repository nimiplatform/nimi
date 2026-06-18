import assert from 'node:assert/strict';
import test from 'node:test';

test('reference-player package entry exposes reference action proof names', async () => {
  const entry = await import('@nimiplatform/nimi2d/reference-player');

  assert.equal(typeof entry.createNimi2DReferenceActionStream, 'function');
  assert.equal(typeof entry.runNimi2DReferenceActionBench, 'function');
  assert.equal(typeof entry.runNimi2DReferenceActionStress, 'function');
  assert.equal(typeof entry.Nimi2DReferenceActionStreamEventError, 'function');
  assert.equal(entry.createNimi2DLiveActionStream, undefined);
  assert.equal(entry.runNimi2DLiveActionBench, undefined);
});

test('reference action stream rejects low-level frame control with reference event codes', async () => {
  const {
    createNimi2DReferenceActionStream,
    Nimi2DReferenceActionStreamEventError,
  } = await import('@nimiplatform/nimi2d/reference-player');

  const stream = createNimi2DReferenceActionStream();
  assert.throws(
    () => stream.applyEvent({ type: 'motion', routeId: 'lean_in', x: 0.5 }),
    (error) => error instanceof Nimi2DReferenceActionStreamEventError
      && error.code === 'NIMI2D_REFERENCE_EVENT_FIELD_FORBIDDEN',
  );
});
