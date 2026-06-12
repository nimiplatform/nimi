export function quote(value) {
  return JSON.stringify(value);
}

export function words(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

export function pascalCase(value) {
  return words(value)
    .map((word) => `${word[0].toUpperCase()}${word.slice(1)}`)
    .join('');
}

export function lowerCamelCase(value) {
  const pascal = pascalCase(value);
  return `${pascal[0].toLowerCase()}${pascal.slice(1)}`;
}

export function snakeCase(value) {
  return words(value)
    .map((word) => word.toLowerCase())
    .join('_');
}

const pythonKeywords = new Set(['False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield']);
const rustKeywords = new Set(['as', 'break', 'const', 'continue', 'crate', 'else', 'enum', 'extern', 'false', 'fn', 'for', 'if', 'impl', 'in', 'let', 'loop', 'match', 'mod', 'move', 'mut', 'pub', 'ref', 'return', 'self', 'Self', 'static', 'struct', 'super', 'trait', 'true', 'type', 'unsafe', 'use', 'where', 'while', 'async', 'await', 'dyn']);

export function pyFieldName(name) {
  return pythonKeywords.has(name) ? `${name}_` : name;
}

export function rustFieldName(name) {
  return rustKeywords.has(name) ? `r#${name}` : name;
}

export function tsPropertyName(name) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

export function uniqueRuntimeMessageTypes(runtime) {
  const types = new Set(runtime.schema_types.messages || []);
  for (const method of runtime.codec_maps) {
    types.add(method.request_type);
    types.add(method.response_type);
  }
  return [...types].sort();
}

export function runtimeMessageSchemas(runtime) {
  const byName = new Map((runtime.schema_types.message_schemas || []).map((schema) => [schema.name, schema]));
  return uniqueRuntimeMessageTypes(runtime).map((name) => byName.get(name) || { name, fields: [] });
}

export function runtimeEnumSchemas(runtime) {
  return runtime.schema_types.enum_schemas || [];
}

const protoScalars = new Set([
  'string',
  'bool',
  'int32',
  'int64',
  'uint32',
  'uint64',
  'sint32',
  'sint64',
  'fixed32',
  'fixed64',
  'sfixed32',
  'sfixed64',
  'float',
  'double',
  'bytes',
  'google.protobuf.Timestamp',
  'google.protobuf.Struct',
  'google.protobuf.Value',
  'google.protobuf.Duration',
  'google.protobuf.FieldMask',
]);

export function protoTypeKind(type, runtime) {
  if (protoScalars.has(type)) return 'scalar';
  if ((runtime.schema_types.enums || []).includes(type)) return 'enum';
  return 'message';
}

export function openApiSuccessSchema(operation) {
  return (operation.response_schemas || []).find((entry) => String(entry.status).startsWith('2'))?.schema
    || operation.response_schemas?.[0]?.schema
    || { kind: 'unknown' };
}

export function tsProtoType(field, runtime) {
  const inner = (type) => {
    if (type === 'string' || type === 'google.protobuf.Timestamp' || type === 'google.protobuf.Duration' || type === 'google.protobuf.FieldMask') return 'string';
    if (type === 'google.protobuf.Struct' || type === 'google.protobuf.Value') return 'Record<string, string | number | boolean | null>';
    if (type === 'bool') return 'boolean';
    if (type === 'bytes') return 'Uint8Array';
    if (['int32', 'int64', 'uint32', 'uint64', 'sint32', 'sint64', 'fixed32', 'fixed64', 'sfixed32', 'sfixed64', 'float', 'double'].includes(type)) return 'number';
    return type;
  };
  if (field.type === 'map') return `Readonly<Record<${inner(field.map_key_type)}, ${inner(field.map_value_type)}>>`;
  const base = inner(field.type);
  return field.repeated ? `readonly ${base}[]` : base;
}

export function pyProtoType(field, runtime) {
  const inner = (type) => {
    if (type === 'string' || type === 'google.protobuf.Timestamp' || type === 'google.protobuf.Duration' || type === 'google.protobuf.FieldMask') return 'str';
    if (type === 'google.protobuf.Struct' || type === 'google.protobuf.Value') return 'Mapping[str, object]';
    if (type === 'bool') return 'bool';
    if (type === 'bytes') return 'bytes';
    if (['int32', 'int64', 'uint32', 'uint64', 'sint32', 'sint64', 'fixed32', 'fixed64', 'sfixed32', 'sfixed64'].includes(type)) return 'int';
    if (['float', 'double'].includes(type)) return 'float';
    return type;
  };
  if (field.type === 'map') return `Mapping[${inner(field.map_key_type)}, ${inner(field.map_value_type)}]`;
  const base = inner(field.type);
  return field.repeated ? `tuple[${base}, ...]` : base;
}

export function goProtoType(field, runtime) {
  const inner = (type, repeated = false) => {
    if (type === 'string' || type === 'google.protobuf.Timestamp' || type === 'google.protobuf.Duration' || type === 'google.protobuf.FieldMask') return 'string';
    if (type === 'google.protobuf.Struct' || type === 'google.protobuf.Value') return 'map[string]any';
    if (type === 'bool') return 'bool';
    if (type === 'bytes') return '[]byte';
    if (type === 'int32' || type === 'sint32' || type === 'sfixed32') return 'int32';
    if (type === 'uint32' || type === 'fixed32') return 'uint32';
    if (type === 'int64' || type === 'sint64' || type === 'sfixed64') return 'int64';
    if (type === 'uint64' || type === 'fixed64') return 'uint64';
    if (type === 'float') return 'float32';
    if (type === 'double') return 'float64';
    return protoTypeKind(type, runtime) === 'message' && !repeated ? `*${type}` : type;
  };
  if (field.type === 'map') return `map[${inner(field.map_key_type, true)}]${inner(field.map_value_type, true)}`;
  const base = inner(field.type, field.repeated);
  return field.repeated ? `[]${base}` : base;
}

export function rustProtoType(field, runtime) {
  const inner = (type, nested = false) => {
    if (type === 'string' || type === 'google.protobuf.Timestamp' || type === 'google.protobuf.Duration' || type === 'google.protobuf.FieldMask') return 'String';
    if (type === 'google.protobuf.Struct' || type === 'google.protobuf.Value') return 'BTreeMap<String, String>';
    if (type === 'bool') return 'bool';
    if (type === 'bytes') return 'Vec<u8>';
    if (type === 'int32' || type === 'sint32' || type === 'sfixed32') return 'i32';
    if (type === 'uint32' || type === 'fixed32') return 'u32';
    if (type === 'int64' || type === 'sint64' || type === 'sfixed64') return 'i64';
    if (type === 'uint64' || type === 'fixed64') return 'u64';
    if (type === 'float') return 'f32';
    if (type === 'double') return 'f64';
    return protoTypeKind(type, runtime) === 'message' && nested ? `Box<${type}>` : type;
  };
  if (field.type === 'map') return `BTreeMap<${inner(field.map_key_type)}, ${inner(field.map_value_type, true)}>`;
  const base = inner(field.type, true);
  if (field.repeated) return `Vec<${base}>`;
  return `Option<${base}>`;
}

export function tsOpenApiType(schema) {
  if (!schema || schema.kind === 'unknown') return 'Record<string, never>';
  if (schema.kind === 'ref') return schema.ref_name;
  if (schema.kind === 'enum') return schema.values.map(quote).join(' | ') || 'string';
  if (schema.kind === 'array') return `readonly (${tsOpenApiType(schema.items)})[]`;
  if (schema.kind === 'object') return 'Record<string, unknown>';
  if (schema.kind === 'union') return schema.variants.map(tsOpenApiType).join(' | ') || 'unknown';
  if (schema.type === 'string' || schema.format === 'date-time') return 'string';
  if (schema.type === 'boolean') return 'boolean';
  if (schema.type === 'integer' || schema.type === 'number') return 'number';
  return 'unknown';
}

export function pyOpenApiType(schema) {
  if (!schema || schema.kind === 'unknown') return 'None';
  if (schema.kind === 'ref') return schema.ref_name;
  if (schema.kind === 'enum') return `Literal[${schema.values.map(quote).join(', ')}]`;
  if (schema.kind === 'array') return `tuple[${pyOpenApiType(schema.items)}, ...]`;
  if (schema.kind === 'object') return 'Mapping[str, object]';
  if (schema.kind === 'union') return schema.variants.map(pyOpenApiType).join(' | ') || 'object';
  if (schema.type === 'string' || schema.format === 'date-time') return 'str';
  if (schema.type === 'boolean') return 'bool';
  if (schema.type === 'integer') return 'int';
  if (schema.type === 'number') return 'float';
  return 'object';
}

export function goOpenApiType(schema) {
  if (!schema || schema.kind === 'unknown') return 'struct{}';
  if (schema.kind === 'ref') return schema.ref_name;
  if (schema.kind === 'enum') return 'string';
  if (schema.kind === 'array') return `[]${goOpenApiType(schema.items)}`;
  if (schema.kind === 'object') return 'map[string]any';
  if (schema.kind === 'union') return 'any';
  if (schema.type === 'string' || schema.format === 'date-time') return 'string';
  if (schema.type === 'boolean') return 'bool';
  if (schema.type === 'integer') return 'int64';
  if (schema.type === 'number') return 'float64';
  return 'any';
}

export function goOpenApiFieldType(schema) {
  return schema?.kind === 'ref' ? `*${schema.ref_name}` : goOpenApiType(schema);
}

export function goZeroExpr(type) {
  if (type === 'string') return '""';
  if (type === 'bool') return 'false';
  if (['int64', 'float64', 'any'].includes(type)) return 'nil';
  if (type.startsWith('[]')) return `${type}{}`;
  if (type.startsWith('map[')) return `${type}{}`;
  return `${type}{}`;
}

export function rustOpenApiType(schema) {
  if (!schema || schema.kind === 'unknown') return '()';
  if (schema.kind === 'ref') return schema.ref_name;
  if (schema.kind === 'enum') return 'String';
  if (schema.kind === 'array') return `Vec<${rustOpenApiType(schema.items)}>`;
  if (schema.kind === 'object') return 'BTreeMap<String, String>';
  if (schema.kind === 'union') return 'String';
  if (schema.type === 'string' || schema.format === 'date-time') return 'String';
  if (schema.type === 'boolean') return 'bool';
  if (schema.type === 'integer') return 'i64';
  if (schema.type === 'number') return 'f64';
  return 'String';
}

export function rustOpenApiFieldType(schema) {
  return schema?.kind === 'ref' ? `Box<${schema.ref_name}>` : rustOpenApiType(schema);
}

export function rustDefaultExpr(type) {
  if (type === '()') return '<()>::default()';
  if (type.startsWith('Vec<')) return `${type.replace('Vec<', 'Vec::<')}::default()`;
  if (type.startsWith('BTreeMap<')) return `${type.replace('BTreeMap<', 'BTreeMap::<')}::default()`;
  return `${type}::default()`;
}

export function realmOperationTypeBase(operationId) {
  return `Realm${pascalCase(operationId)}Operation`;
}

export function realmOperationRequestType(operationId) {
  return `${realmOperationTypeBase(operationId)}Request`;
}

export function realmOperationResponseType(operationId) {
  return `${realmOperationTypeBase(operationId)}Response`;
}

export function typedFixtureNames(runtimeMethod, streamMethod, realmOperation) {
  return {
    runtime_unary: {
      typescript: lowerCamelCase(runtimeMethod.method),
      python: snakeCase(runtimeMethod.method),
      go: pascalCase(runtimeMethod.method),
      rust: snakeCase(runtimeMethod.method),
    },
    runtime_stream: {
      typescript: lowerCamelCase(streamMethod.method),
      python: snakeCase(streamMethod.method),
      go: pascalCase(streamMethod.method),
      rust: snakeCase(streamMethod.method),
    },
    realm_operation: {
      typescript: lowerCamelCase(realmOperation.operation_id),
      python: snakeCase(realmOperation.operation_id),
      go: pascalCase(realmOperation.operation_id),
      rust: snakeCase(realmOperation.operation_id),
    },
  };
}
