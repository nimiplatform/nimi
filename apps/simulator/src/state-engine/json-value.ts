/**
 * Simulator JSON value validation, immutability, and RFC 8785 (JCS)
 * canonical serialization. Pure module: no host time, randomness, or I/O.
 *
 * Authority: P-SIM-010..012, tables/simulator-state-engine-policy.yaml.
 */

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export class SimulatorJsonError extends Error {
  readonly path: string;
  constructor(message: string, path: string) {
    super(message);
    this.name = 'SimulatorJsonError';
    this.path = path;
  }
}

function isOrdinaryObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

/**
 * Validates that `value` is an ordinary JSON value: no `undefined`, symbols,
 * functions, bigint, non-finite numbers, negative zero, sparse arrays, class
 * instances, or duplicate keys (impossible after JS parse but guarded for
 * decoded input). Returns the input typed as JsonValue on success.
 */
function assertUnicodeScalarString(value: string, path: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new SimulatorJsonError('lone high surrogate is not valid I-JSON', path);
      }
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      throw new SimulatorJsonError('lone low surrogate is not valid I-JSON', path);
    }
  }
}

function validateJsonValue(value: unknown, path: string, ancestors: Set<object>): JsonValue {
  if (value === null) return null;
  const kind = typeof value;
  if (kind === 'boolean') return value as boolean;
  if (kind === 'string') {
    assertUnicodeScalarString(value as string, path);
    return value as string;
  }
  if (kind === 'number') {
    if (!Number.isFinite(value as number)) {
      throw new SimulatorJsonError('non-finite number is not a JSON value', path);
    }
    if (Object.is(value, -0)) {
      throw new SimulatorJsonError('negative zero is not a JSON value', path);
    }
    return value as number;
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new SimulatorJsonError('cyclic arrays are not JSON values', path);
    ancestors.add(value);
    try {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          throw new SimulatorJsonError('sparse arrays are not JSON values', `${path}[${index}]`);
        }
        validateJsonValue(value[index], `${path}[${index}]`, ancestors);
      }
    } finally {
      ancestors.delete(value);
    }
    return value as readonly JsonValue[];
  }
  if (kind === 'object' && isOrdinaryObject(value as object)) {
    const object = value as Record<string, unknown>;
    if (ancestors.has(object)) throw new SimulatorJsonError('cyclic objects are not JSON values', path);
    ancestors.add(object);
    try {
      for (const [key, entry] of Object.entries(object)) {
        assertUnicodeScalarString(key, `${path}.[key]`);
        validateJsonValue(entry, `${path}.${key}`, ancestors);
      }
    } finally {
      ancestors.delete(object);
    }
    return value as { readonly [key: string]: JsonValue };
  }
  throw new SimulatorJsonError(`unsupported JSON value of type ${kind}`, path);
}

export function assertJsonValue(value: unknown, path = '$'): JsonValue {
  return validateJsonValue(value, path, new Set());
}

export function isJsonValue(value: unknown): value is JsonValue {
  try {
    assertJsonValue(value);
    return true;
  } catch {
    return false;
  }
}

/** Deep-freezes an already validated JSON value so committed state cannot mutate. */
export function freezeJsonValue<T extends JsonValue>(value: T, seen = new Set<object>()): T {
  if (value !== null && typeof value === 'object' && !seen.has(value as object)) {
    seen.add(value as object);
    if (Array.isArray(value)) {
      for (const entry of value) freezeJsonValue(entry as JsonValue, seen);
    } else {
      for (const entry of Object.values(value)) freezeJsonValue(entry as JsonValue, seen);
    }
    Object.freeze(value);
  }
  return value;
}

/** Deep clone of a validated JSON value (result is mutable until frozen). */
export function cloneJsonValue<T extends JsonValue>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((entry) => cloneJsonValue(entry as JsonValue)) as unknown as T;
  }
  const output: Record<string, JsonValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = cloneJsonValue(entry as JsonValue);
  }
  return output as T;
}

/**
 * RFC 8785 (JSON Canonicalization Scheme) serialization.
 * Object keys sort by UTF-16 code unit order (ECMAScript default string
 * comparison); numbers serialize with the ECMAScript Number-to-String
 * algorithm; strings use JSON escaping. Input must pass assertJsonValue.
 */
function serializeCanonicalJson(value: JsonValue): string {
  if (value === null) return 'null';
  const kind = typeof value;
  if (kind === 'boolean' || kind === 'number' || kind === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => serializeCanonicalJson(entry as JsonValue)).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  const body = keys
    .map((key) => `${JSON.stringify(key)}:${serializeCanonicalJson((value as Record<string, JsonValue>)[key])}`)
    .join(',');
  return `{${body}}`;
}

export function canonicalizeJson(value: JsonValue): string {
  const validated = assertJsonValue(value);
  return serializeCanonicalJson(validated);
}

/** UTF-8 encode without Node dependencies (browser-safe). */
export function utf8Encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
