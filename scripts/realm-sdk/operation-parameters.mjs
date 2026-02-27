import { PARAMETER_VALUE_TYPES } from './constants.mjs';
import { resolveOpenApiRef } from './openapi-ref.mjs';

const PARAMETER_IN_PRIORITY = Object.freeze({
  path: 0,
  query: 1,
  header: 2,
  cookie: 3,
});

function extractPathParameterOrder(pathName) {
  const order = new Map();
  const matcher = /\{([^}]+)\}/g;
  let match = matcher.exec(String(pathName || ''));
  while (match) {
    const name = String(match[1] || '').trim();
    if (name && !order.has(name)) {
      order.set(name, order.size);
    }
    match = matcher.exec(String(pathName || ''));
  }
  return order;
}

function compareParameters(left, right, pathOrder) {
  const leftRequiredPriority = left.required ? 0 : 1;
  const rightRequiredPriority = right.required ? 0 : 1;
  if (leftRequiredPriority !== rightRequiredPriority) {
    return leftRequiredPriority - rightRequiredPriority;
  }

  const leftPriority = PARAMETER_IN_PRIORITY[left.in] ?? 99;
  const rightPriority = PARAMETER_IN_PRIORITY[right.in] ?? 99;
  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }

  if (left.in === 'path' && right.in === 'path') {
    const leftPathOrder = pathOrder.get(left.name);
    const rightPathOrder = pathOrder.get(right.name);
    if (leftPathOrder !== undefined && rightPathOrder !== undefined && leftPathOrder !== rightPathOrder) {
      return leftPathOrder - rightPathOrder;
    }
    if (leftPathOrder !== undefined && rightPathOrder === undefined) {
      return -1;
    }
    if (leftPathOrder === undefined && rightPathOrder !== undefined) {
      return 1;
    }
  }

  return left.index - right.index;
}

function toParameterValueType(value) {
  return PARAMETER_VALUE_TYPES.includes(value) ? value : 'unknown';
}

function inferPrimitiveTypeFromEnum(enumValues) {
  if (!Array.isArray(enumValues) || enumValues.length === 0) {
    return '';
  }

  const kinds = new Set(
    enumValues.map((value) => {
      if (typeof value === 'string') return 'string';
      if (typeof value === 'number') return 'number';
      if (typeof value === 'boolean') return 'boolean';
      return 'unknown';
    }),
  );

  if (kinds.size === 1) {
    return String(Array.from(kinds)[0] || '');
  }
  return '';
}

function inferParameterValueType(spec, schema) {
  if (!schema || typeof schema !== 'object') {
    return 'unknown';
  }

  if (schema.$ref) {
    const resolved = resolveOpenApiRef(spec, schema.$ref);
    return inferParameterValueType(spec, resolved);
  }

  const enumPrimitive = inferPrimitiveTypeFromEnum(schema.enum);
  if (enumPrimitive) {
    return toParameterValueType(enumPrimitive);
  }

  const typeName = String(schema.type || '').trim();
  if (typeName === 'string') {
    return 'string';
  }
  if (typeName === 'integer' || typeName === 'number') {
    return 'number';
  }
  if (typeName === 'boolean') {
    return 'boolean';
  }
  if (typeName === 'array') {
    const itemType = inferParameterValueType(spec, schema.items);
    if (itemType === 'string') return 'string[]';
    if (itemType === 'number') return 'number[]';
    if (itemType === 'boolean') return 'boolean[]';
    return 'unknown';
  }

  for (const compositeKey of ['oneOf', 'anyOf', 'allOf']) {
    const variants = Array.isArray(schema[compositeKey]) ? schema[compositeKey] : [];
    if (variants.length === 0) {
      continue;
    }
    const variantTypes = new Set(
      variants.map((variant) => inferParameterValueType(spec, variant)).filter((value) => value !== 'unknown'),
    );
    if (variantTypes.size === 1) {
      return String(Array.from(variantTypes)[0] || 'unknown');
    }
  }

  return 'unknown';
}

function resolveParameterSchema(spec, parameter) {
  if (!parameter || typeof parameter !== 'object') {
    return null;
  }

  if (parameter.schema) {
    const resolved = parameter.schema?.$ref ? resolveOpenApiRef(spec, parameter.schema.$ref) : parameter.schema;
    return resolved && typeof resolved === 'object' ? resolved : null;
  }

  const content = parameter.content;
  if (!content || typeof content !== 'object') {
    return null;
  }

  for (const payload of Object.values(content)) {
    if (!payload || typeof payload !== 'object') {
      continue;
    }
    const schema = payload.schema;
    if (!schema) {
      continue;
    }
    const resolved = schema?.$ref ? resolveOpenApiRef(spec, schema.$ref) : schema;
    if (resolved && typeof resolved === 'object') {
      return resolved;
    }
  }

  return null;
}

function resolveParameterValueType(spec, parameter) {
  const schema = resolveParameterSchema(spec, parameter);
  const inferred = inferParameterValueType(spec, schema);
  return toParameterValueType(inferred);
}

function resolveParameter(spec, rawParameter) {
  return rawParameter?.$ref ? resolveOpenApiRef(spec, rawParameter.$ref) || {} : rawParameter || {};
}

function mergeRawParameters(spec, pathItem, operation) {
  const pathParameters = Array.isArray(pathItem?.parameters) ? pathItem.parameters : [];
  const operationParameters = Array.isArray(operation?.parameters) ? operation.parameters : [];

  const operationKeys = new Set(
    operationParameters.map((item) => {
      const resolved = resolveParameter(spec, item);
      const parameterIn = String(resolved.in || '').trim();
      const name = String(resolved.name || '').trim();
      return `${parameterIn}:${name}`;
    }),
  );

  const merged = [];
  for (const raw of pathParameters) {
    const resolved = resolveParameter(spec, raw);
    const parameterIn = String(resolved.in || '').trim();
    const name = String(resolved.name || '').trim();
    const key = `${parameterIn}:${name}`;
    if (!operationKeys.has(key)) {
      merged.push(resolved);
    }
  }

  for (const raw of operationParameters) {
    merged.push(resolveParameter(spec, raw));
  }

  return merged;
}

export function mergeOperationParameters(spec, pathName, pathItem, operation) {
  const pathOrder = extractPathParameterOrder(pathName);
  const merged = mergeRawParameters(spec, pathItem, operation);

  return merged
    .map((parameter) => ({
      name: String(parameter.name || '').trim(),
      in: String(parameter.in || '').trim(),
      required: Boolean(parameter.required),
      valueType: resolveParameterValueType(spec, parameter),
    }))
    .filter((parameter) => parameter.name && ['path', 'query', 'header', 'cookie'].includes(parameter.in))
    .map((parameter, index) => ({
      ...parameter,
      index,
    }))
    .sort((left, right) => compareParameters(left, right, pathOrder))
    .map(({ index, ...parameter }) => parameter);
}
