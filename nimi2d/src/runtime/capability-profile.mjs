import {
  asRecord,
  stringField,
  optionalString,
  nonEmptyStringArray,
  parseYamlObject,
} from './common.mjs';

function numberRange(value, path) {
  if (value == null) return undefined;
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error(`Nimi2D capability profile ${path} must be a two-number range`);
  }
  const from = Number(value[0]);
  const to = Number(value[1]);
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    throw new Error(`Nimi2D capability profile ${path} must contain finite numbers`);
  }
  return [from, to];
}

function optionalBinding(value, path) {
  if (value == null) return undefined;
  const record = asRecord(value, path);
  return {
    layer_refs: nonEmptyStringArray(record.layer_refs, `${path}.layer_refs`),
    translate_x_range_px: numberRange(record.translate_x_range_px, `${path}.translate_x_range_px`),
    translate_y_range_px: numberRange(record.translate_y_range_px, `${path}.translate_y_range_px`),
    scale_x_range: numberRange(record.scale_x_range, `${path}.scale_x_range`),
    scale_y_range: numberRange(record.scale_y_range, `${path}.scale_y_range`),
    opacity_range: numberRange(record.opacity_range, `${path}.opacity_range`),
  };
}

function optionalBindingMap(value, path) {
  if (value == null) return undefined;
  const record = asRecord(value, path);
  const result = {};
  for (const [key, binding] of Object.entries(record)) {
    if (!/^[a-z][a-z0-9_.-]{0,63}$/u.test(key)) {
      throw new Error(`Nimi2D capability profile ${path} route id is invalid`);
    }
    result[key] = optionalBinding(binding, `${path}.${key}`);
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function parseNimi2DBackendCapabilityProfile(raw) {
  const value = parseYamlObject(raw, 'capability_profile');
  if (value.backend_kind !== 'nimi2d') {
    throw new Error('Nimi2D capability profile backend_kind must be nimi2d');
  }
  const renderer = asRecord(value.renderer, 'renderer');
  const canvas = asRecord(renderer.canvas, 'renderer.canvas');
  const width = Number(canvas.width_px);
  const height = Number(canvas.height_px);
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error('Nimi2D capability profile renderer canvas is invalid');
  }
  const rawBindings = asRecord(renderer.bindings ?? {}, 'renderer.bindings');
  return {
    profile_id: stringField(value.profile_id, 'profile_id'),
    backend_kind: 'nimi2d',
    renderer: {
      canvas: {
        width_px: Math.round(width),
        height_px: Math.round(height),
      },
      bindings: {
        speech_mouth: optionalBinding(rawBindings.speech_mouth, 'renderer.bindings.speech_mouth'),
        expression: optionalBinding(rawBindings.expression, 'renderer.bindings.expression'),
        idle_life: optionalBinding(rawBindings.idle_life, 'renderer.bindings.idle_life'),
        motion_routes: optionalBindingMap(rawBindings.motion_routes, 'renderer.bindings.motion_routes'),
      },
    },
  };
}

function optionalCapabilityProfileRef(value) {
  return optionalString(value);
}

export { parseNimi2DBackendCapabilityProfile, optionalCapabilityProfileRef };
