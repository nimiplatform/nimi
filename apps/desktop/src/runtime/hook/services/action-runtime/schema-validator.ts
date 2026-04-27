import type { ErrorObject, ValidateFunction } from 'ajv';

type SchemaRecord = Record<string, unknown>;

const SUPPORTED_KEYS = new Set([
  '$schema',
  'title',
  'description',
  'type',
  'required',
  'properties',
  'additionalProperties',
  'items',
  'enum',
  'const',
  'minLength',
  'maxLength',
  'pattern',
  'minimum',
  'maximum',
  'anyOf',
  'oneOf',
  'allOf',
]);

function isRecord(value: unknown): value is SchemaRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function schemaError(instancePath: string, message: string): ErrorObject {
  return {
    instancePath,
    schemaPath: '',
    keyword: 'cspSafeSchema',
    params: {},
    message,
  };
}

function typeMatches(value: unknown, expected: string): boolean {
  switch (expected) {
    case 'object':
      return isRecord(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    default:
      return false;
  }
}

function validateSchemaShape(schema: unknown, path = 'schema'): asserts schema is SchemaRecord {
  if (!isRecord(schema)) {
    throw new Error(`${path} must be a JSON object`);
  }
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED_KEYS.has(key)) {
      throw new Error(`${path} uses unsupported keyword "${key}"`);
    }
  }
  const type = schema.type;
  if (type !== undefined) {
    const types = Array.isArray(type) ? type : [type];
    for (const item of types) {
      if (typeof item !== 'string' || !typeMatches(null, item) && item !== 'object' && item !== 'array' && item !== 'string' && item !== 'number' && item !== 'integer' && item !== 'boolean') {
        throw new Error(`${path}.type is unsupported`);
      }
    }
  }
  if (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.some((item) => typeof item !== 'string'))) {
    throw new Error(`${path}.required must be an array of strings`);
  }
  if (schema.properties !== undefined) {
    if (!isRecord(schema.properties)) {
      throw new Error(`${path}.properties must be an object`);
    }
    for (const [key, child] of Object.entries(schema.properties)) {
      validateSchemaShape(child, `${path}.properties.${key}`);
    }
  }
  if (schema.items !== undefined) {
    validateSchemaShape(schema.items, `${path}.items`);
  }
  for (const key of ['anyOf', 'oneOf', 'allOf']) {
    const value = schema[key];
    if (value === undefined) {
      continue;
    }
    if (!Array.isArray(value) || value.length === 0) {
      throw new Error(`${path}.${key} must be a non-empty schema array`);
    }
    value.forEach((child, index) => validateSchemaShape(child, `${path}.${key}.${index}`));
  }
}

function validateAgainstSchema(schema: SchemaRecord, value: unknown, instancePath: string, errors: ErrorObject[]): boolean {
  if (schema.const !== undefined && value !== schema.const) {
    errors.push(schemaError(instancePath, 'must match const'));
    return false;
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => item === value)) {
    errors.push(schemaError(instancePath, 'must be equal to one of the allowed values'));
    return false;
  }

  const types = Array.isArray(schema.type)
    ? schema.type.filter((item): item is string => typeof item === 'string')
    : typeof schema.type === 'string'
      ? [schema.type]
      : [];
  if (types.length > 0 && !types.some((type) => typeMatches(value, type))) {
    errors.push(schemaError(instancePath, `must be ${types.join(' or ')}`));
    return false;
  }

  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      errors.push(schemaError(instancePath, `must NOT have fewer than ${schema.minLength} characters`));
      return false;
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      errors.push(schemaError(instancePath, `must NOT have more than ${schema.maxLength} characters`));
      return false;
    }
    if (typeof schema.pattern === 'string' && !(new RegExp(schema.pattern).test(value))) {
      errors.push(schemaError(instancePath, 'must match pattern'));
      return false;
    }
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errors.push(schemaError(instancePath, `must be >= ${schema.minimum}`));
      return false;
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      errors.push(schemaError(instancePath, `must be <= ${schema.maximum}`));
      return false;
    }
  }

  if (isRecord(value)) {
    const required = Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === 'string') : [];
    for (const key of required) {
      if (!(key in value)) {
        errors.push(schemaError(instancePath || '/', `must have required property "${key}"`));
        return false;
      }
    }
    if (isRecord(schema.properties)) {
      for (const [key, childSchema] of Object.entries(schema.properties)) {
        if (key in value && isRecord(childSchema) && !validateAgainstSchema(childSchema, value[key], `${instancePath}/${key}`, errors)) {
          return false;
        }
      }
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(value)) {
          if (!(key in schema.properties)) {
            errors.push(schemaError(`${instancePath}/${key}`, 'must NOT have additional properties'));
            return false;
          }
        }
      }
    }
  }

  if (Array.isArray(value) && isRecord(schema.items)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!validateAgainstSchema(schema.items, value[index], `${instancePath}/${index}`, errors)) {
        return false;
      }
    }
  }

  const allOf = Array.isArray(schema.allOf) ? schema.allOf.filter(isRecord) : [];
  for (const child of allOf) {
    if (!validateAgainstSchema(child, value, instancePath, errors)) {
      return false;
    }
  }

  const anyOf = Array.isArray(schema.anyOf) ? schema.anyOf.filter(isRecord) : [];
  if (anyOf.length > 0 && !anyOf.some((child) => validateAgainstSchema(child, value, instancePath, []))) {
    errors.push(schemaError(instancePath, 'must match a schema in anyOf'));
    return false;
  }

  const oneOf = Array.isArray(schema.oneOf) ? schema.oneOf.filter(isRecord) : [];
  if (oneOf.length > 0 && oneOf.filter((child) => validateAgainstSchema(child, value, instancePath, [])).length !== 1) {
    errors.push(schemaError(instancePath, 'must match exactly one schema in oneOf'));
    return false;
  }

  return true;
}

export function compileCspSafeJsonSchema(schema: unknown): ValidateFunction {
  validateSchemaShape(schema);
  const schemaRecord = schema;
  const validate = ((value: unknown) => {
    const errors: ErrorObject[] = [];
    const ok = validateAgainstSchema(schemaRecord, value, '', errors);
    validate.errors = ok ? null : errors;
    return ok;
  }) as ValidateFunction;
  validate.errors = null;
  return validate;
}
