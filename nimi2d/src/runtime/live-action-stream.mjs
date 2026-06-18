import { createNimi2DComposer } from './composer.mjs';
import { createNimi2DAmplitudeMouthLane } from './mouth-lane.mjs';

const eventFields = {
  activity: new Set(['type', 'name', 'intensity']),
  emotion: new Set(['type', 'current', 'previous']),
  expression: new Set(['type', 'name', 'weight', 'fade']),
  motion: new Set(['type', 'routeId', 'fade', 'durationMs', 'loop', 'queue', 'interrupt']),
  mouth_amplitude: new Set(['type', 'value']),
  silence: new Set(['type']),
  reset: new Set(['type']),
};

const eventTypes = new Set(Object.keys(eventFields));

export class Nimi2DReferenceActionStreamEventError extends Error {
  constructor(code, path, message) {
    super(message);
    this.name = 'Nimi2DReferenceActionStreamEventError';
    this.code = code;
    this.path = path;
  }
}

function assertRecord(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Nimi2DReferenceActionStreamEventError('NIMI2D_REFERENCE_EVENT_INVALID', path, 'Reference action event must be an object.');
  }
}

function assertKnownFields(event) {
  const allowed = eventFields[event.type];
  if (!allowed) {
    throw new Nimi2DReferenceActionStreamEventError('NIMI2D_REFERENCE_EVENT_TYPE_UNKNOWN', '$.type', `Unknown reference action event type ${String(event.type)}.`);
  }
  for (const field of Object.keys(event)) {
    if (!allowed.has(field)) {
      throw new Nimi2DReferenceActionStreamEventError('NIMI2D_REFERENCE_EVENT_FIELD_FORBIDDEN', `$.${field}`, `Field ${field} is not admitted for ${event.type}.`);
    }
  }
}

function stringValue(value, fallback) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function optionalNumber(value, path) {
  if (value === undefined || value === null) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Nimi2DReferenceActionStreamEventError('NIMI2D_REFERENCE_EVENT_VALUE_INVALID', path, 'Expected finite number.');
  }
  return number;
}

function boolValue(value) {
  return value === true;
}

function validateEvent(event) {
  assertRecord(event, '$');
  if (!eventTypes.has(event.type)) {
    throw new Nimi2DReferenceActionStreamEventError('NIMI2D_REFERENCE_EVENT_TYPE_UNKNOWN', '$.type', `Unknown reference action event type ${String(event.type)}.`);
  }
  assertKnownFields(event);
}

export function createNimi2DReferenceActionStream(input = {}) {
  const composer = input.composer ?? createNimi2DComposer();
  const mouthLane = input.mouthLane ?? createNimi2DAmplitudeMouthLane({ composer });

  function applyEvent(event) {
    validateEvent(event);
    if (event.type === 'activity') {
      composer.applyActivity({
        name: stringValue(event.name, 'idle'),
        intensity: optionalNumber(event.intensity, '$.intensity') ?? null,
      });
    } else if (event.type === 'emotion') {
      composer.applyEmotion({
        current: stringValue(event.current, 'neutral'),
        previous: stringValue(event.previous, null),
      });
    } else if (event.type === 'expression') {
      composer.applyExpression({
        name: stringValue(event.name, 'neutral'),
        weight: optionalNumber(event.weight, '$.weight'),
        fade: optionalNumber(event.fade, '$.fade'),
      });
    } else if (event.type === 'motion') {
      composer.applyMotion({
        routeId: stringValue(event.routeId, 'idle'),
        fade: optionalNumber(event.fade, '$.fade'),
        durationMs: optionalNumber(event.durationMs, '$.durationMs'),
        loop: boolValue(event.loop),
        queue: boolValue(event.queue),
        interrupt: boolValue(event.interrupt),
      });
    } else if (event.type === 'mouth_amplitude') {
      mouthLane.setAmplitude(optionalNumber(event.value, '$.value') ?? 0);
    } else if (event.type === 'silence') {
      mouthLane.silent();
    } else if (event.type === 'reset') {
      mouthLane.silent();
      composer.reset();
    }
    return composer.snapshot();
  }

  return {
    composer,
    mouthLane,
    applyEvent,
    applyEvents(events) {
      if (!Array.isArray(events)) {
        throw new Nimi2DReferenceActionStreamEventError('NIMI2D_REFERENCE_EVENT_BATCH_INVALID', '$', 'Reference action event batch must be an array.');
      }
      let snapshot = composer.snapshot();
      for (const event of events) {
        snapshot = applyEvent(event);
      }
      return snapshot;
    },
    advanceFrame(deltaMs = 16) {
      mouthLane.poll?.();
      return composer.advanceFrame(deltaMs);
    },
    snapshot() {
      return composer.snapshot();
    },
    reset() {
      mouthLane.silent?.();
      composer.reset();
      return composer.snapshot();
    },
  };
}

export {
  createNimi2DReferenceActionStream as createNimi2DLiveActionStream,
  Nimi2DReferenceActionStreamEventError as Nimi2DLiveActionStreamEventError,
};
