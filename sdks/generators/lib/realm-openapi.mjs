import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { generatedBy, readText, readYaml, repoRoot } from './context.mjs';

function configuredRealmOpenApiSource() {
  const configRel = 'config/realm-openapi-source.json';
  const config = JSON.parse(readText(configRel));
  if (process.env.NIMI_REALM_OPENAPI_PATH) {
    return {
      source_label: 'env:NIMI_REALM_OPENAPI_PATH',
      abs_path: path.resolve(process.env.NIMI_REALM_OPENAPI_PATH),
      config,
      config_rel: configRel,
    };
  }
  return {
    source_label: config.source_path,
    abs_path: path.resolve(repoRoot, config.source_path),
    config,
    config_rel: configRel,
  };
}

function openApiRefName(ref) {
  return typeof ref === 'string' ? ref.split('/').pop() : null;
}

function parseOpenApiSchema(schema) {
  if (!schema || typeof schema !== 'object') {
    return { kind: 'unknown' };
  }
  if (schema.$ref) {
    return { kind: 'ref', ref: schema.$ref, ref_name: openApiRefName(schema.$ref) };
  }
  if (schema.enum) {
    return { kind: 'enum', values: schema.enum.map(String) };
  }
  if (schema.type === 'array') {
    return { kind: 'array', items: parseOpenApiSchema(schema.items) };
  }
  if (schema.type === 'object' || schema.properties || schema.additionalProperties) {
    const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
    return {
      kind: 'object',
      properties: Object.entries(schema.properties || {}).map(([name, property]) => ({
        name,
        required: required.has(name),
        schema: parseOpenApiSchema(property),
      })),
      additional_properties: schema.additionalProperties ? parseOpenApiSchema(schema.additionalProperties) : null,
    };
  }
  if (schema.oneOf || schema.anyOf || schema.allOf) {
    const variants = schema.oneOf || schema.anyOf || schema.allOf;
    return { kind: 'union', variants: variants.map(parseOpenApiSchema) };
  }
  return {
    kind: 'scalar',
    type: schema.type || 'unknown',
    format: schema.format || null,
  };
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
  const sourcePaths = [source.config_rel];
  let sourceState = 'openapi_missing';
  let operations = [];
  let modelNames = [];
  let modelSchemas = [];

  if (existsSync(source.abs_path)) {
    sourceState = 'openapi_loaded';
    const spec = YAML.parse(readFileSync(source.abs_path, 'utf8'));
    operations = parseOpenApiOperations(spec);
    const schemas = spec?.components?.schemas || {};
    modelNames = Object.keys(schemas).sort();
    modelSchemas = modelNames.map((name) => ({
      name,
      schema: parseOpenApiSchema(schemas[name]),
    }));
  } else {
    const ruleCatalog = readYaml('.nimi/spec/realm/kernel/tables/rule-catalog.yaml');
    const alignmentMap = readYaml('.nimi/spec/realm/kernel/tables/open-spec-alignment-map.yaml');
    sourcePaths.push(
      '.nimi/spec/realm/kernel/tables/rule-catalog.yaml',
      '.nimi/spec/realm/kernel/tables/open-spec-alignment-map.yaml',
    );
    const alignedRules = new Set(
      (alignmentMap?.mappings || [])
        .filter((entry) => entry?.external_type === 'kernel_rule')
        .map((entry) => String(entry.external_id)),
    );
    operations = (ruleCatalog?.entries || [])
      .filter((ruleId) => alignedRules.has(String(ruleId)))
      .sort()
      .map((ruleId) => ({
        operation_id: String(ruleId),
        method: 'SPEC',
        path: null,
        service: String(ruleId).split('-').slice(0, 2).join('-'),
        tags: ['realm-spec-fallback'],
        request_schema_ref: null,
        response_schema_refs: [],
      }));
    modelNames = [];
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
    source_kind: sourceState === 'openapi_loaded' ? 'realm_openapi' : 'realm_spec_fallback',
    source_state: sourceState,
    source_label: source.source_label,
    source_paths: sourcePaths,
    authority_refs: source.config.authority_refs || ['.nimi/spec/sdks/kernel/realm-core-contract.md'],
    provenance: {
      source_rule: 'S-SURFACE-019',
      notes: [
        'Realm core operation truth is derived from Realm OpenAPI when available.',
        'Admitted Realm spec tables are used only when the configured OpenAPI file is unavailable in this worktree.',
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
