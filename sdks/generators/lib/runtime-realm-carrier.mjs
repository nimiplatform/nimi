import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

import { generatedBy, readYaml, writeText } from './context.mjs';
import { pascalCase, quote } from './types.mjs';

const carrierPath = 'runtime/gen/realm/v1/source_materialization_openapi.go';
const carrierProjection = 'runtime_private_generated_carrier';

function fail(message) {
  throw new Error(`Runtime Realm carrier generation failed: ${message}`);
}

function formatGo(source) {
  const result = spawnSync('gofmt', [], {
    encoding: 'utf8',
    input: source,
    windowsHide: true,
  });
  if (result.status !== 0 || result.error) {
    fail(`gofmt failed: ${result.error?.message || result.stderr || `exit ${result.status}`}`);
  }
  return result.stdout;
}

function operationPolicy(realm) {
  const table = readYaml('.nimi/spec/sdks/kernel/tables/realm-private-operation-carriers.yaml');
  if (table?.protocol_id !== 'sdk_realm_private_operation_carriers') {
    fail('private-operation table identity drift');
  }
  const rows = Array.isArray(table.operations) ? table.operations : [];
  if (rows.length === 0) fail('private-operation table is empty');
  const ids = rows.map((row) => row.operation_id);
  if (new Set(ids).size !== ids.length) fail('private-operation table contains duplicate operation ids');
  if (JSON.stringify(table.surfaces) !== JSON.stringify(ids)) {
    fail('private-operation surfaces must exactly match operation row order');
  }
  const openApiOperations = new Map(realm.operations.map((operation) => [operation.operation_id, operation]));
  for (const row of rows) {
    const operation = openApiOperations.get(row.operation_id);
    if (!operation) fail(`OpenAPI operation is missing: ${row.operation_id}`);
    if (row.projection !== carrierProjection || row.public_sdk_method !== 'forbidden') {
      fail(`private operation exposure drift: ${row.operation_id}`);
    }
    if (operation.method !== row.method || operation.path !== row.path) {
      fail(`private operation method/path drift: ${row.operation_id}`);
    }
  }
  return rows.map((row) => ({ ...row, openapi: openApiOperations.get(row.operation_id) }));
}

function collectSchemaRefs(schema, refs) {
  if (!schema || typeof schema !== 'object') return;
  if (schema.kind === 'ref') {
    refs.add(schema.ref_name);
    return;
  }
  if (schema.kind === 'array') {
    collectSchemaRefs(schema.items, refs);
    return;
  }
  if (schema.kind === 'union') {
    for (const variant of schema.variants || []) collectSchemaRefs(variant, refs);
    return;
  }
  if (schema.kind === 'object') {
    for (const property of schema.properties || []) collectSchemaRefs(property.schema, refs);
    collectSchemaRefs(schema.additional_properties, refs);
  }
}

function modelClosure(realm, roots) {
  const modelByName = new Map(realm.model_schemas.map((model) => [model.name, model.schema]));
  const pending = [...roots];
  const selected = new Set();
  while (pending.length > 0) {
    const name = pending.shift();
    if (!name || selected.has(name)) continue;
    const schema = modelByName.get(name);
    if (!schema) fail(`model closure is missing ${name}`);
    selected.add(name);
    const refs = new Set();
    collectSchemaRefs(schema, refs);
    pending.push(...[...refs].filter((ref) => !selected.has(ref)).sort());
  }
  return [...selected].sort().map((name) => ({ name, schema: modelByName.get(name) }));
}

function goType(schema, unionNames) {
  if (!schema || schema.kind === 'unknown') return 'any';
  if (schema.kind === 'ref') {
    return unionNames.has(schema.ref_name) ? schema.ref_name : `*${schema.ref_name}`;
  }
  if (schema.kind === 'enum' || schema.type === 'string' || schema.format === 'date-time') return 'string';
  if (schema.kind === 'array') return `[]${goType(schema.items, unionNames).replace(/^\*/, '')}`;
  if (schema.kind === 'object') return 'map[string]any';
  if (schema.type === 'boolean') return 'bool';
  if (schema.type === 'integer') return 'int64';
  if (schema.type === 'number') return 'float64';
  return 'any';
}

function renderObjectModel(model, unionNames) {
  if (model.schema.kind !== 'object') fail(`request carrier model ${model.name} is not an object`);
  const fields = model.schema.properties.map((property) => {
    const suffix = property.required ? '' : ',omitempty';
    return `\t${pascalCase(property.name)}\t${goType(property.schema, unionNames)}\t\`json:"${property.name}${suffix}"\``;
  });
  return `type ${model.name} struct {\n${fields.join('\n')}\n}`;
}

function renderUnionModel(model) {
  if (model.schema.kind !== 'union' || model.schema.variants.some((variant) => variant.kind !== 'ref')) {
    fail(`request carrier union ${model.name} must contain only named variants`);
  }
  const marker = `is${model.name}`;
  return [
    `type ${model.name} interface {`,
    `\t${marker}()`,
    '}',
    '',
    ...model.schema.variants.flatMap((variant) => [
      `func (*${variant.ref_name}) ${marker}() {}`,
      '',
    ]),
  ].join('\n').trimEnd();
}

function closedSchemaFieldProjection(models) {
  return models
    .filter((model) => model.schema.kind === 'object' && model.schema.closed === true)
    .map((model) => ({
      name: model.name,
      required: [...(model.schema.required_properties || [])].sort(),
      optional: (model.schema.properties || [])
        .filter((property) => property.required !== true)
        .map((property) => property.name)
        .sort(),
    }));
}

function renderClosedSchemaFields(fields) {
  const entries = fields.map((entry) => `\t${quote(entry.name)}: {\n\t\tRequired: []string{${entry.required.map(quote).join(', ')}},\n\t\tOptional: []string{${entry.optional.map(quote).join(', ')}},\n\t},`).join('\n');
  return `type ClosedSchemaFields struct {
\tRequired []string
\tOptional []string
}

var materializationClosedSchemaFields = map[string]ClosedSchemaFields{
${entries}
}

func MaterializationClosedSchemaFields(name string) (ClosedSchemaFields, bool) {
\tfields, ok := materializationClosedSchemaFields[name]
\tif !ok {
\t\treturn ClosedSchemaFields{}, false
\t}
\tfields.Required = append([]string(nil), fields.Required...)
\tfields.Optional = append([]string(nil), fields.Optional...)
\treturn fields, true
}`;
}

function responseClosedObjectProjection(realm, policy) {
  const modelByName = new Map(realm.model_schemas.map((model) => [model.name, model.schema]));
  const entries = new Map();

  const addCandidate = (operationId, path, schema) => {
    if (schema.kind !== 'object' || schema.closed !== true) return;
    const required = [...(schema.required_properties || [])].sort();
    const optional = (schema.properties || [])
      .filter((property) => property.required !== true)
      .map((property) => property.name)
      .sort();
    const key = `${operationId}\0${path}`;
    const candidates = entries.get(key) || new Map();
    const signature = JSON.stringify([required, optional]);
    candidates.set(signature, { required, optional });
    entries.set(key, candidates);
  };

  const visit = (operationId, schema, path, activeRefs) => {
    if (!schema || schema.kind === 'unknown') return;
    if (schema.kind === 'ref') {
      if (activeRefs.has(schema.ref_name)) return;
      const target = modelByName.get(schema.ref_name);
      if (!target) fail(`response closure is missing ${schema.ref_name}`);
      const nextRefs = new Set(activeRefs);
      nextRefs.add(schema.ref_name);
      visit(operationId, target, path, nextRefs);
      return;
    }
    if (schema.kind === 'union') {
      for (const variant of schema.variants || []) visit(operationId, variant, path, activeRefs);
      return;
    }
    if (schema.kind === 'array') {
      visit(operationId, schema.items, `${path}[]`, activeRefs);
      return;
    }
    if (schema.kind !== 'object') return;
    addCandidate(operationId, path, schema);
    for (const property of schema.properties || []) {
      visit(operationId, property.schema, `${path}.${property.name}`, activeRefs);
    }
    if (schema.additional_properties) {
      visit(operationId, schema.additional_properties, `${path}.*`, activeRefs);
    }
  };

  for (const row of policy) {
    for (const response of row.openapi.response_schemas || []) {
      if (String(response.status).startsWith('2')) {
        visit(row.operation_id, response.schema, '$', new Set());
      }
    }
  }
  return [...entries.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, candidates]) => ({ key, candidates: [...candidates.values()] }));
}

function renderResponseClosedObjectProjection(entries) {
  const rows = entries.map((entry) => {
    const candidates = entry.candidates.map((candidate) =>
      `{Required: []string{${candidate.required.map(quote).join(', ')}}, Optional: []string{${candidate.optional.map(quote).join(', ')}}}`,
    ).join(', ');
    return `\t${quote(entry.key)}: {${candidates}},`;
  }).join('\n');
  return `var materializationResponseClosedObjectFields = map[string][]ClosedSchemaFields{
${rows}
}

// ValidateMaterializationResponseObjectFields verifies one closed response
// object against the exact field closure generated from Realm OpenAPI.
// known=false denotes an intentionally open or scalar response path.
func ValidateMaterializationResponseObjectFields(operationID, path string, fields []string) (known, valid bool) {
\tcandidates, known := materializationResponseClosedObjectFields[operationID+"\\x00"+path]
\tif !known {
\t\tprefix := operationID + "\\x00"
\t\tfor key, projected := range materializationResponseClosedObjectFields {
\t\t\tif strings.HasPrefix(key, prefix) && materializationResponsePathMatches(key[len(prefix):], path) {
\t\t\t\tcandidates = projected
\t\t\t\tknown = true
\t\t\t\tbreak
\t\t\t}
\t\t}
\t\tif !known {
\t\t\treturn false, false
\t\t}
\t}
\tactual := make(map[string]struct{}, len(fields))
\tfor _, field := range fields {
\t\tif _, duplicate := actual[field]; duplicate {
\t\t\treturn true, false
\t\t}
\t\tactual[field] = struct{}{}
\t}
\tfor _, candidate := range candidates {
\t\tallowed := make(map[string]struct{}, len(candidate.Required)+len(candidate.Optional))
\t\tmatch := true
\t\tfor _, field := range candidate.Required {
\t\t\tallowed[field] = struct{}{}
\t\t\tif _, present := actual[field]; !present {
\t\t\t\tmatch = false
\t\t\t}
\t\t}
\t\tfor _, field := range candidate.Optional {
\t\t\tallowed[field] = struct{}{}
\t\t}
\t\tif !match {
\t\t\tcontinue
\t\t}
\t\tfor field := range actual {
\t\t\tif _, admitted := allowed[field]; !admitted {
\t\t\t\tmatch = false
\t\t\t\tbreak
\t\t\t}
\t\t}
\t\tif match {
\t\t\treturn true, true
\t\t}
\t}
\treturn true, false
}

func materializationResponsePathMatches(pattern, actual string) bool {
\tpatternSegments := strings.Split(pattern, ".")
\tactualSegments := strings.Split(actual, ".")
\tif len(patternSegments) != len(actualSegments) {
\t\treturn false
\t}
\tfor index, segment := range patternSegments {
\t\tif segment != "*" && segment != actualSegments[index] {
\t\t\treturn false
\t\t}
\t}
\treturn true
}`;
}

export function runtimePrivateRealmOperationIds(realm) {
  return new Set(operationPolicy(realm).map((row) => row.operation_id));
}

export function projectRealmForPublicSdks(realm) {
  const privateOperationIds = runtimePrivateRealmOperationIds(realm);
  const keepOperation = (operationId) => !privateOperationIds.has(operationId);
  return {
    ...realm,
    operations: realm.operations.filter((operation) => keepOperation(operation.operation_id)),
    operation_maps: realm.operation_maps.filter((operation) => keepOperation(operation.operation_id)),
    service_registry: realm.service_registry
      .map((service) => ({
        ...service,
        operation_ids: service.operation_ids.filter(keepOperation),
      }))
      .filter((service) => service.operation_ids.length > 0),
  };
}

export function writeRuntimeRealmCarrier(realm) {
  const policy = operationPolicy(realm);
  const packet = policy.find((row) => row.operation_id === 'WorldCoreController_createSourceMaterializationPacket');
  const jwks = policy.find((row) => row.operation_id === 'getSourceMaterializationJwks');
  if (!packet || packet.openapi.request_schema?.ref_name !== 'CreateSourceMaterializationPacketV3Dto') {
    fail('packet request operation/schema is not admitted');
  }
  if (!jwks || jwks.openapi.request_schema?.kind !== 'unknown') {
    fail('current-JWKS operation is not admitted as a bodyless request');
  }

  const requestModels = modelClosure(realm, [packet.openapi.request_schema.ref_name]);
  const unionNames = new Set(requestModels.filter((model) => model.schema.kind === 'union').map((model) => model.name));
  const renderedModels = requestModels
    .map((model) => model.schema.kind === 'union'
      ? renderUnionModel(model)
      : renderObjectModel(model, unionNames))
    .join('\n\n');

  const closureModels = modelClosure(realm, [
    packet.openapi.request_schema.ref_name,
    packet.openapi.response_schemas.find((response) => String(response.status).startsWith('2'))?.schema?.ref_name,
  ]);
  const fieldProjection = closedSchemaFieldProjection(closureModels);
  const closureDigest = crypto.createHash('sha256')
    .update(JSON.stringify(fieldProjection))
    .digest('hex');

  const operationConstants = policy.map((row) => {
    const base = pascalCase(row.operation_id);
    return [
      `\t${base}OperationID\t= ${quote(row.operation_id)}`,
      `\t${base}Method\t= ${quote(row.method)}`,
      `\t${base}Path\t= ${quote(row.path)}`,
    ].join('\n');
  }).join('\n');

  const operationDescriptors = policy.map((row) => {
    const base = pascalCase(row.operation_id);
    const successful = row.openapi.response_schemas.filter((response) => String(response.status).startsWith('2'));
    if (successful.length !== 1 || !/^2[0-9]{2}$/.test(String(successful[0].status))) {
      fail(`private operation must have one exact success status: ${row.operation_id}`);
    }
    return `var ${base}Operation = PrivateOperation{\n\toperationID: ${base}OperationID,\n\tmethod: ${base}Method,\n\tpath: ${base}Path,\n\tsuccessStatus: ${Number(successful[0].status)},\n}`;
  }).join('\n\n');
  const responseObjectProjection = responseClosedObjectProjection(realm, policy);

  writeText(carrierPath, formatGo(`// Code generated by ${generatedBy}; DO NOT EDIT.
// Source: config/realm-openapi/api-nimi.yaml and realm-private-operation-carriers.yaml.

package realmv1

import "strings"

const (
${operationConstants}
\tMaterializationSchemaClosureSHA256\t= ${quote(closureDigest)}
)

type PrivateOperation struct {
\toperationID string
\tmethod string
\tpath string
\tsuccessStatus int
}

func (operation PrivateOperation) OperationID() string { return operation.operationID }
func (operation PrivateOperation) Method() string { return operation.method }
func (operation PrivateOperation) Path() string { return operation.path }
func (operation PrivateOperation) SuccessStatus() int { return operation.successStatus }

${operationDescriptors}

${renderedModels}

${renderClosedSchemaFields(fieldProjection)}

${renderResponseClosedObjectProjection(responseObjectProjection)}
`));
}
