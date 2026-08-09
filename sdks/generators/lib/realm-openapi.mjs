import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { generatedBy, readText, repoRoot } from './context.mjs';

function configuredRealmOpenApiSource() {
  const configRel = 'config/realm-openapi-source.json';
  const config = JSON.parse(readText(configRel));
  if (process.env.NIMI_REALM_OPENAPI_PATH) {
    throw new Error('NIMI_REALM_OPENAPI_PATH is not an admitted Realm OpenAPI authority source');
  }
  return {
    source_label: config.source_path,
    abs_path: path.resolve(repoRoot, config.source_path),
    config,
    config_rel: configRel,
  };
}

function readProjectedRealmCore(source) {
  if (!existsSync(source.abs_path)) {
    return null;
  }
  const manifest = JSON.parse(readFileSync(source.abs_path, 'utf8'));
  return {
    operations: Array.isArray(manifest.operations) ? manifest.operations : [],
    modelNames: Array.isArray(manifest.model_maps)
      ? manifest.model_maps.map((entry) => String(entry?.name || '').trim()).filter(Boolean).sort()
      : [],
    modelSchemas: Array.isArray(manifest.model_schemas) ? manifest.model_schemas : [],
  };
}

function openApiRefName(ref) {
  return typeof ref === 'string' ? ref.split('/').pop() : null;
}

function withOpenApiNullable(schema, source) {
  return source?.nullable === true ? { ...schema, nullable: true } : schema;
}

export function parseOpenApiSchema(schema) {
  if (!schema || typeof schema !== 'object') {
    return { kind: 'unknown' };
  }
  if (schema.$ref) {
    return withOpenApiNullable({ kind: 'ref', ref: schema.$ref, ref_name: openApiRefName(schema.$ref) }, schema);
  }
  if (schema.enum) {
    return withOpenApiNullable({
      kind: 'enum',
      values: [...schema.enum],
      type: schema.type || 'string',
    }, schema);
  }
  if (schema.type === 'array') {
    return withOpenApiNullable({
      kind: 'array',
      items: parseOpenApiSchema(schema.items),
      min_items: Number.isInteger(schema.minItems) ? schema.minItems : null,
      max_items: Number.isInteger(schema.maxItems) ? schema.maxItems : null,
    }, schema);
  }
  if (schema.oneOf || schema.anyOf || schema.allOf) {
    const variants = schema.oneOf || schema.anyOf || schema.allOf;
    if (Array.isArray(schema.allOf) && variants.length === 1) {
      return withOpenApiNullable(parseOpenApiSchema(variants[0]), schema);
    }
    return withOpenApiNullable({
      kind: 'union',
      variants: variants.map(parseOpenApiSchema),
      discriminator: typeof schema.discriminator?.propertyName === 'string'
        ? schema.discriminator.propertyName
        : null,
      discriminator_mapping: schema.discriminator?.mapping
        && typeof schema.discriminator.mapping === 'object'
        && !Array.isArray(schema.discriminator.mapping)
        ? Object.fromEntries(Object.entries(schema.discriminator.mapping).sort(([left], [right]) =>
          left.localeCompare(right)))
        : {},
    }, schema);
  }
  if (schema.type === 'object' || schema.properties || schema.additionalProperties) {
    const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
    return withOpenApiNullable({
      kind: 'object',
      properties: Object.entries(schema.properties || {}).map(([name, property]) => ({
        name,
        required: required.has(name),
        schema: parseOpenApiSchema(property),
      })),
      required_properties: [...required],
      closed: schema.additionalProperties === false,
      additional_properties: schema.additionalProperties ? parseOpenApiSchema(schema.additionalProperties) : null,
    }, schema);
  }
  return withOpenApiNullable({
    kind: 'scalar',
    type: schema.type || 'unknown',
    format: schema.format || null,
    minimum: typeof schema.minimum === 'number' ? schema.minimum : null,
    maximum: typeof schema.maximum === 'number' ? schema.maximum : null,
    min_length: Number.isInteger(schema.minLength) ? schema.minLength : null,
    max_length: Number.isInteger(schema.maxLength) ? schema.maxLength : null,
    pattern: typeof schema.pattern === 'string' ? schema.pattern : null,
  }, schema);
}

function pascalTypeSegment(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((segment) => `${segment[0].toUpperCase()}${segment.slice(1)}`)
    .join('') || 'Value';
}

function collectParsedSchemaRefs(schema, output) {
  if (!schema || typeof schema !== 'object') return;
  if (schema.kind === 'ref' && schema.ref_name) {
    output.add(schema.ref_name);
    return;
  }
  if (schema.kind === 'array') {
    collectParsedSchemaRefs(schema.items, output);
    return;
  }
  if (schema.kind === 'union') {
    for (const variant of schema.variants || []) collectParsedSchemaRefs(variant, output);
    return;
  }
  if (schema.kind === 'object') {
    for (const property of schema.properties || []) collectParsedSchemaRefs(property.schema, output);
    collectParsedSchemaRefs(schema.additional_properties, output);
  }
}

const materializationSchemaRoots = [
  'CreateSourceMaterializationPacketV3Dto',
  'SourceMaterializationPacketV3Dto',
];

function materializationModelClosure(modelByName) {
  const pending = [...materializationSchemaRoots];
  const selected = new Set();
  while (pending.length > 0) {
    const name = pending.shift();
    if (!name || selected.has(name)) continue;
    const schema = modelByName.get(name);
    if (!schema) throw new Error(`Realm materialization schema closure is missing ${name}`);
    selected.add(name);
    const refs = new Set();
    collectParsedSchemaRefs(schema, refs);
    for (const ref of [...refs].sort()) {
      if (!selected.has(ref)) pending.push(ref);
    }
  }
  return selected;
}

function closedEnumPaths(schema, modelByName, segments = [], visitedRefs = new Set(), depth = 0) {
  if (!schema || typeof schema !== 'object' || depth > 8) return new Map();
  if (schema.kind === 'ref') {
    if (!schema.ref_name || visitedRefs.has(schema.ref_name)) return new Map();
    const target = modelByName.get(schema.ref_name);
    if (!target) return new Map();
    const nextVisited = new Set(visitedRefs);
    nextVisited.add(schema.ref_name);
    return closedEnumPaths(target, modelByName, segments, nextVisited, depth + 1);
  }
  if (schema.kind === 'enum' && schema.values?.length === 1 && typeof schema.values[0] === 'string') {
    return new Map([[segments.join('.'), schema.values[0]]]);
  }
  if (schema.kind !== 'object') return new Map();
  const output = new Map();
  for (const property of [...(schema.properties || [])].sort((left, right) => left.name.localeCompare(right.name))) {
    if (property.required !== true) continue;
    for (const [candidatePath, value] of closedEnumPaths(
      property.schema,
      modelByName,
      [...segments, property.name],
      visitedRefs,
      depth + 1,
    )) {
      output.set(candidatePath, value);
    }
  }
  return output;
}

function inferClosedUnionDiscriminator(variants, modelByName, typeName) {
  const candidateSets = variants.map((variant) => closedEnumPaths(variant, modelByName));
  const candidates = [...(candidateSets[0]?.keys() || [])].filter((candidatePath) => {
    const values = candidateSets.map((candidateSet) => candidateSet.get(candidatePath));
    return values.every((value) => typeof value === 'string')
      && new Set(values).size === variants.length;
  });
  candidates.sort((left, right) => {
    const leftSegments = left.split('.');
    const rightSegments = right.split('.');
    const leftKind = leftSegments.at(-1) === 'kind' ? 0 : 1;
    const rightKind = rightSegments.at(-1) === 'kind' ? 0 : 1;
    return leftKind - rightKind
      || leftSegments.length - rightSegments.length
      || left.localeCompare(right);
  });
  if (candidates.length === 0) {
    throw new Error(`Realm materialization union ${typeName} has no required closed discriminator path`);
  }
  return candidates[0];
}

function promoteClosedInlineSchema(schema, typeName, syntheticModels, modelByName) {
  if (!schema || typeof schema !== 'object') return schema;
  if (schema.kind === 'array') {
    return {
      ...schema,
      items: promoteClosedInlineSchema(schema.items, `${typeName}Item`, syntheticModels, modelByName),
    };
  }
  if (schema.kind === 'union') {
    const promotedUnion = {
      ...schema,
      variants: (schema.variants || []).map((variant, index) =>
        promoteClosedInlineSchema(variant, `${typeName}Variant${index + 1}`, syntheticModels, modelByName)),
    };
    if (!(promotedUnion.variants || []).every((variant) => variant.kind === 'ref')) {
      return promotedUnion;
    }
    if (!promotedUnion.discriminator) {
      promotedUnion.discriminator = inferClosedUnionDiscriminator(
        promotedUnion.variants,
        modelByName,
        typeName,
      );
    }
    if (syntheticModels.has(typeName)) {
      throw new Error(`duplicate generated Realm materialization inline model: ${typeName}`);
    }
    syntheticModels.set(typeName, promotedUnion);
    return {
      kind: 'ref',
      ref: `#generated/materialization/${typeName}`,
      ref_name: typeName,
      ...(schema.nullable === true ? { nullable: true } : {}),
    };
  }
  if (schema.kind !== 'object') return schema;

  const promotedObject = {
    ...schema,
    properties: (schema.properties || []).map((property) => ({
      ...property,
      schema: promoteClosedInlineSchema(
        property.schema,
        `${typeName}${pascalTypeSegment(property.name)}`,
        syntheticModels,
        modelByName,
      ),
    })),
    additional_properties: schema.additional_properties
      ? promoteClosedInlineSchema(
        schema.additional_properties,
        `${typeName}AdditionalProperty`,
        syntheticModels,
        modelByName,
      )
      : null,
  };
  if (schema.closed !== true) return promotedObject;
  if (syntheticModels.has(typeName)) {
    throw new Error(`duplicate generated Realm materialization inline model: ${typeName}`);
  }
  syntheticModels.set(typeName, promotedObject);
  return { kind: 'ref', ref: `#generated/materialization/${typeName}`, ref_name: typeName };
}

function promoteMaterializationInlineModels(modelSchemas) {
  const modelByName = new Map(modelSchemas.map((model) => [model.name, model.schema]));
  const closure = materializationModelClosure(modelByName);
  const syntheticModels = new Map();
  const promoted = modelSchemas.map((model) => {
    if (!closure.has(model.name) || model.schema.kind !== 'object') return model;
    return {
      ...model,
      schema: {
        ...model.schema,
        properties: (model.schema.properties || []).map((property) => ({
          ...property,
          schema: promoteClosedInlineSchema(
            property.schema,
            `${model.name}${pascalTypeSegment(property.name)}`,
            syntheticModels,
            modelByName,
          ),
        })),
      },
    };
  });
  return [
    ...promoted,
    ...[...syntheticModels.entries()].map(([name, schema]) => ({ name, schema })),
  ].sort((left, right) => left.name.localeCompare(right.name));
}

function parseOpenApiOperations(spec) {
  const operations = [];
  const paths = spec?.paths && typeof spec.paths === 'object' ? spec.paths : {};
  const verbs = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);
  for (const [route, routeItem] of Object.entries(paths)) {
    if (!routeItem || typeof routeItem !== 'object') continue;
    for (const [verb, operation] of Object.entries(routeItem)) {
      if (!verbs.has(verb) || !operation || typeof operation !== 'object') continue;
      const tags = Array.isArray(operation.tags) ? operation.tags.map(String) : [];
      const parameters = [
        ...(Array.isArray(routeItem.parameters) ? routeItem.parameters : []),
        ...(Array.isArray(operation.parameters) ? operation.parameters : []),
      ].filter((parameter) => parameter && typeof parameter === 'object').map((parameter) => ({
        name: String(parameter.name),
        in: String(parameter.in),
        required: Boolean(parameter.required),
        schema: parseOpenApiSchema(parameter.schema),
      }));
      const requestContent = operation.requestBody?.content || {};
      const requestContentType = ['application/json', 'application/x-www-form-urlencoded']
        .find((contentType) => requestContent?.[contentType]?.schema) || null;
      const requestSchema = requestContentType ? requestContent[requestContentType].schema : null;
      const responseSchemas = Object.entries(operation.responses || {})
        .map(([status, response]) => ({
          status,
          schema: parseOpenApiSchema(response?.content?.['application/json']?.schema),
          schema_ref: response?.content?.['application/json']?.schema?.$ref || null,
        }))
        .filter((entry) => entry.schema_ref || entry.schema.kind !== 'unknown');
      operations.push({
        operation_id: String(operation.operationId || `${verb}_${route}`),
        method: verb.toUpperCase(),
        path: route,
        service: tags[0] || 'default',
        tags,
        parameters,
        path_parameters: parameters.filter((parameter) => parameter.in === 'path'),
        query_parameters: parameters.filter((parameter) => parameter.in === 'query'),
        header_parameters: parameters.filter((parameter) => parameter.in === 'header'),
        request_schema: parseOpenApiSchema(requestSchema),
        request_schema_ref: requestSchema?.$ref || null,
        request_content_type: requestContentType,
        response_schemas: responseSchemas,
        response_schema_refs: responseSchemas.filter((entry) => entry.schema_ref).map(({ status, schema_ref }) => ({ status, schema_ref })),
      });
    }
  }
  return operations.sort((a, b) => a.operation_id.localeCompare(b.operation_id));
}

export function extractRealmCore() {
  const source = configuredRealmOpenApiSource();
  const sourcePaths = [source.config_rel, source.config.source_path].filter(Boolean);
  let sourceState = 'openapi_missing';
  let sourceKind = 'realm_openapi_missing';
  let operations = [];
  let modelNames = [];
  let modelSchemas = [];

  if (source.config.source_kind === 'public_realm_core_manifest_projection') {
    const projection = readProjectedRealmCore(source);
    if (projection) {
      sourceState = 'projection_loaded';
      sourceKind = 'public_realm_core_manifest_projection';
      operations = projection.operations;
      modelNames = projection.modelNames;
      modelSchemas = projection.modelSchemas;
    } else {
      sourceState = 'projection_missing';
      sourceKind = 'public_realm_core_manifest_projection_missing';
    }
  } else if (existsSync(source.abs_path)) {
    sourceState = 'openapi_loaded';
    sourceKind = 'realm_openapi';
    const spec = YAML.parse(readFileSync(source.abs_path, 'utf8'));
    operations = parseOpenApiOperations(spec);
    const schemas = spec?.components?.schemas || {};
    modelNames = Object.keys(schemas).sort();
    modelSchemas = modelNames.map((name) => ({
      name,
      schema: parseOpenApiSchema(schemas[name]),
    }));
    modelSchemas = promoteMaterializationInlineModels(modelSchemas);
    modelNames = modelSchemas.map((model) => model.name);
  }

  const services = new Map();
  for (const operation of operations) {
    if (!services.has(operation.service)) {
      services.set(operation.service, []);
    }
    services.get(operation.service).push(operation.operation_id);
  }

  return {
    contract: 'nimi.sdks.realm-core-manifest.v1',
    generated_by: generatedBy,
    source_kind: sourceKind,
    source_state: sourceState,
    source_label: source.source_label,
    source_paths: sourcePaths,
    authority_refs: source.config.authority_refs || ['.nimi/spec/sdks/realm-consumer.authority.yaml'],
    provenance: {
      notes: [
        'Realm core operation truth is derived from Realm OpenAPI when available.',
        'Configured Realm OpenAPI absence is fail-closed by the SDK generator; spec tables are not REST schema fallback authority.',
      ],
    },
    operations,
    operation_maps: operations.map((operation) => ({
      operation_id: operation.operation_id,
      service: operation.service,
      method: operation.method,
      path: operation.path,
    })),
    service_registry: [...services.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, operation_ids]) => ({ name, operation_ids: operation_ids.sort() })),
    model_maps: modelNames.map((name) => ({ name })),
    model_schemas: modelSchemas,
    property_enums: [],
  };
}
