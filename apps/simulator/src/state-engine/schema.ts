/**
 * Closed owner-cataloged payload schema validation. Deliberately minimal and
 * exact: every schema declares the complete shape; unknown keys fail.
 *
 * Authority: P-SIM-019 (SIMULATOR_INVALID_PAYLOAD) and the protocol's exact
 * schema-checked payload requirement. Validation is deterministic and pure.
 */

import {
  assertJsonValue,
  cloneJsonValue,
  freezeJsonValue,
  type JsonValue,
} from './json-value.ts';

export type SimulatorSchema =
  | { readonly kind: 'null' }
  | { readonly kind: 'boolean' }
  | { readonly kind: 'integer'; readonly minimum?: number; readonly maximum?: number }
  | { readonly kind: 'number' }
  | { readonly kind: 'string'; readonly pattern?: RegExp; readonly minLength?: number; readonly maxLength?: number }
  | { readonly kind: 'stringEnum'; readonly values: readonly string[] }
  | { readonly kind: 'array'; readonly items: SimulatorSchema; readonly minItems?: number; readonly maxItems?: number }
  | { readonly kind: 'object'; readonly properties: Readonly<Record<string, SimulatorSchema>>; readonly required?: readonly string[] }
  | { readonly kind: 'union'; readonly variants: readonly SimulatorSchema[] }
  | { readonly kind: 'json' };

export const SCHEMA_ANY_JSON: SimulatorSchema = { kind: 'json' };

export interface SimulatorSchemaFailure {
  readonly path: string;
  readonly reason: string;
}

function describe(schema: SimulatorSchema): string {
  switch (schema.kind) {
    case 'null': return 'null';
    case 'boolean': return 'boolean';
    case 'integer': return 'integer';
    case 'number': return 'number';
    case 'string': return 'string';
    case 'stringEnum': return `one of ${schema.values.map((value) => JSON.stringify(value)).join(', ')}`;
    case 'array': return 'array';
    case 'object': return 'object';
    case 'union': return 'union';
    case 'json': return 'json value';
  }
}

function validateInto(schema: SimulatorSchema, value: JsonValue, path: string, failures: SimulatorSchemaFailure[]): void {
  switch (schema.kind) {
    case 'json': {
      try {
        assertJsonValue(value, path);
      } catch (error) {
        failures.push({ path, reason: error instanceof Error ? error.message : String(error) });
      }
      return;
    }
    case 'null':
      if (value !== null) failures.push({ path, reason: `expected null` });
      return;
    case 'boolean':
      if (typeof value !== 'boolean') failures.push({ path, reason: `expected boolean` });
      return;
    case 'number':
      if (typeof value !== 'number') failures.push({ path, reason: `expected number` });
      return;
    case 'integer': {
      if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
        failures.push({ path, reason: 'expected safe integer' });
        return;
      }
      if (schema.minimum !== undefined && value < schema.minimum) {
        failures.push({ path, reason: `below minimum ${schema.minimum}` });
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        failures.push({ path, reason: `above maximum ${schema.maximum}` });
      }
      return;
    }
    case 'string': {
      if (typeof value !== 'string') {
        failures.push({ path, reason: 'expected string' });
        return;
      }
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        failures.push({ path, reason: `shorter than ${schema.minLength}` });
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        failures.push({ path, reason: `longer than ${schema.maxLength}` });
      }
      if (schema.pattern && !schema.pattern.test(value)) {
        failures.push({ path, reason: 'pattern mismatch' });
      }
      return;
    }
    case 'stringEnum':
      if (typeof value !== 'string' || !schema.values.includes(value)) {
        failures.push({ path, reason: `expected ${describe(schema)}` });
      }
      return;
    case 'array': {
      if (!Array.isArray(value)) {
        failures.push({ path, reason: 'expected array' });
        return;
      }
      if (schema.minItems !== undefined && value.length < schema.minItems) {
        failures.push({ path, reason: `fewer than ${schema.minItems} items` });
      }
      if (schema.maxItems !== undefined && value.length > schema.maxItems) {
        failures.push({ path, reason: `more than ${schema.maxItems} items` });
      }
      value.forEach((entry, index) => validateInto(schema.items, entry as JsonValue, `${path}[${index}]`, failures));
      return;
    }
    case 'object': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        failures.push({ path, reason: 'expected object' });
        return;
      }
      const required = new Set(schema.required ?? Object.keys(schema.properties));
      const record = value as Record<string, JsonValue>;
      for (const key of Object.keys(record)) {
        if (!Object.hasOwn(schema.properties, key)) {
          failures.push({ path: `${path}.${key}`, reason: 'unknown key' });
        }
      }
      for (const key of required) {
        if (!Object.hasOwn(record, key)) {
          failures.push({ path: `${path}.${key}`, reason: 'missing required key' });
        }
      }
      for (const [key, propertySchema] of Object.entries(schema.properties)) {
        if (Object.hasOwn(record, key)) {
          validateInto(propertySchema, record[key], `${path}.${key}`, failures);
        }
      }
      return;
    }
    case 'union': {
      const matched = schema.variants.some((variant) => validateSchema(variant, value).ok);
      if (!matched) failures.push({ path, reason: 'no union variant matched' });
      return;
    }
  }
}

export function validateSchema(
  schema: SimulatorSchema,
  value: unknown,
): { readonly ok: true; readonly value: JsonValue } | { readonly ok: false; readonly failures: readonly SimulatorSchemaFailure[] } {
  let json: JsonValue;
  try {
    json = assertJsonValue(value);
  } catch (error) {
    return { ok: false, failures: [{ path: '$', reason: error instanceof Error ? error.message : String(error) }] };
  }
  const failures: SimulatorSchemaFailure[] = [];
  validateInto(schema, json, '$', failures);
  if (failures.length > 0) return { ok: false, failures };
  // Validation is the admission boundary. Retaining the caller's object would
  // let it mutate an accepted operation, event, or route after
  // validation but before deterministic consumption.
  return { ok: true, value: freezeJsonValue(cloneJsonValue(json)) };
}

export function isSchemaValid(schema: SimulatorSchema, value: unknown): boolean {
  return validateSchema(schema, value).ok;
}
