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

function parseOpenApiSchema(schema) {
  if (!schema || typeof schema !== 'object') {
    return { kind: 'unknown' };
  }
  if (schema.$ref) {
    return withOpenApiNullable({ kind: 'ref', ref: schema.$ref, ref_name: openApiRefName(schema.$ref) }, schema);
  }
  if (schema.enum) {
    return withOpenApiNullable({ kind: 'enum', values: schema.enum.map(String) }, schema);
  }
  if (schema.type === 'array') {
    return withOpenApiNullable({ kind: 'array', items: parseOpenApiSchema(schema.items) }, schema);
  }
  if (schema.oneOf || schema.anyOf || schema.allOf) {
    const variants = schema.oneOf || schema.anyOf || schema.allOf;
    if (Array.isArray(schema.allOf) && variants.length === 1) {
      return withOpenApiNullable(parseOpenApiSchema(variants[0]), schema);
    }
    return withOpenApiNullable({ kind: 'union', variants: variants.map(parseOpenApiSchema) }, schema);
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
      additional_properties: schema.additionalProperties ? parseOpenApiSchema(schema.additionalProperties) : null,
    }, schema);
  }
  return withOpenApiNullable({
    kind: 'scalar',
    type: schema.type || 'unknown',
    format: schema.format || null,
  }, schema);
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
      const requestSchema = operation.requestBody?.content?.['application/json']?.schema || null;
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
        request_schema_ref: operation.requestBody?.content?.['application/json']?.schema?.$ref || null,
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
    authority_refs: source.config.authority_refs || ['.nimi/spec/sdks/kernel/realm-core-contract.md'],
    provenance: {
      source_rule: 'S-SURFACE-019',
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
