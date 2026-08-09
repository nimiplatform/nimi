import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

import { generatedBy, readYaml, writeText } from './context.mjs';
import { pascalCase, quote } from './types.mjs';

const carrierPaths = {
  account_auth: 'runtime/gen/realm/v1/account_auth_openapi.go',
  authn: 'runtime/gen/realm/v1/authn_openapi.go',
  source_materialization: 'runtime/gen/realm/v1/source_materialization_openapi.go',
};
const carrierProjection = 'generated_carrier';
const publicSdkDispositions = new Set(['retained', 'forbidden']);

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
  const table = readYaml('config/sdks-realm-private-operation-carriers.yaml');
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
    if (row.runtime_projection !== carrierProjection
      || !publicSdkDispositions.has(row.public_sdk_disposition)
      || !Object.hasOwn(carrierPaths, row.family)) {
      fail(`operation projection drift: ${row.operation_id}`);
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

function goType(schema, unionNames, valueNames = new Set()) {
  if (!schema || schema.kind === 'unknown') return 'any';
  if (schema.kind === 'ref') {
    return unionNames.has(schema.ref_name) || valueNames.has(schema.ref_name)
      ? schema.ref_name
      : `*${schema.ref_name}`;
  }
  if (schema.kind === 'enum') {
    if (schema.type === 'boolean') return 'bool';
    if (schema.type === 'integer') return 'int64';
    if (schema.type === 'number') return 'float64';
    return 'string';
  }
  if (schema.type === 'string' || schema.format === 'date-time') return 'string';
  if (schema.kind === 'array') return `[]${goType(schema.items, unionNames, valueNames).replace(/^\*/, '')}`;
  if (schema.kind === 'object') return 'map[string]any';
  if (schema.type === 'boolean') return 'bool';
  if (schema.type === 'integer') return 'int64';
  if (schema.type === 'number') return 'float64';
  return 'any';
}

function renderObjectModel(model, unionNames, valueNames = new Set()) {
  if (model.schema.kind !== 'object') fail(`request carrier model ${model.name} is not an object`);
  const fields = model.schema.properties.map((property) => {
    const suffix = property.required ? '' : ',omitempty';
    return `\t${pascalCase(property.name)}\t${goType(property.schema, unionNames, valueNames)}\t\`json:"${property.name}${suffix}"\``;
  });
  return `type ${model.name} struct {\n${fields.join('\n')}\n}`;
}

function renderEnumModel(model) {
  if (model.schema.kind !== 'enum') fail(`carrier enum ${model.name} is not an enum`);
  const type = goType({ ...model.schema, kind: 'scalar' }, new Set());
  const constants = (model.schema.values || []).map((value) =>
    `\t${model.name}${pascalCase(value)} ${model.name} = ${quote(value)}`,
  ).join('\n');
  return `type ${model.name} ${type}\n\nconst (\n${constants}\n)`;
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
  return new Set(operationPolicy(realm)
    .filter((row) => row.public_sdk_disposition === 'forbidden')
    .map((row) => row.operation_id));
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

function successfulResponse(row, required = true) {
  const successful = row.openapi.response_schemas.filter((response) => String(response.status).startsWith('2'));
  if (successful.length === 0 && !required) return null;
  if (successful.length !== 1 || !/^2[0-9]{2}$/.test(String(successful[0].status))) {
    fail(`operation must have one exact success status: ${row.operation_id}`);
  }
  return successful[0];
}

function renderOperationConstants(rows) {
  return rows.map((row) => {
    const base = pascalCase(row.operation_id);
    return [
      `\t${base}OperationID\t= ${quote(row.operation_id)}`,
      `\t${base}Method\t= ${quote(row.method)}`,
      `\t${base}Path\t= ${quote(row.path)}`,
    ].join('\n');
  }).join('\n');
}

function renderOperationDescriptors(rows) {
  return rows.map((row) => {
    const base = pascalCase(row.operation_id);
    const success = successfulResponse(row, row.operation_id !== 'oauthAuthorize');
    return `var ${base}Operation = OperationDescriptor{\n\toperationID: ${base}OperationID,\n\tmethod: ${base}Method,\n\tpath: ${base}Path,\n\trequestContentType: ${quote(row.openapi.request_content_type || '')},\n\tsuccessStatus: ${success ? Number(success.status) : 0},\n}`;
  }).join('\n\n');
}

function operationModelRoots(rows) {
  const roots = new Set();
  for (const row of rows) {
    if (row.openapi.request_schema?.kind === 'ref') roots.add(row.openapi.request_schema.ref_name);
    for (const response of row.openapi.response_schemas || []) {
      if (response.schema?.kind === 'ref') roots.add(response.schema.ref_name);
    }
  }
  return [...roots];
}

function renderModelSet(models) {
  const unionNames = new Set(models.filter((model) => model.schema.kind === 'union').map((model) => model.name));
  const valueNames = new Set(models.filter((model) => model.schema.kind === 'enum').map((model) => model.name));
  return models.map((model) => {
    if (model.schema.kind === 'union') return renderUnionModel(model);
    if (model.schema.kind === 'enum') return renderEnumModel(model);
    return renderObjectModel(model, unionNames, valueNames);
  })
    .join('\n\n');
}

export function claimUnownedModels(models, claimedNames) {
  return models.filter((model) => {
    if (claimedNames.has(model.name)) return false;
    claimedNames.add(model.name);
    return true;
  });
}

function renderValuesCarrier(name, properties, methodName) {
  const fields = properties.map((property) => {
    const suffix = property.required ? '' : ',omitempty';
    return `\t${pascalCase(property.name)}\tstring\t\`url:"${property.name}${suffix}"\``;
  }).join('\n');
  const setters = properties.map((property) => {
    const field = `carrier.${pascalCase(property.name)}`;
    return property.required
      ? `\tvalues.Set(${quote(property.name)}, ${field})`
      : `\tif ${field} != "" {\n\t\tvalues.Set(${quote(property.name)}, ${field})\n\t}`;
  }).join('\n');
  return `type ${name} struct {\n${fields}\n}\n\nfunc (carrier ${name}) ${methodName}() url.Values {\n\tvalues := url.Values{}\n${setters}\n\treturn values\n}`;
}

function promoteInlineObject(schema, name, models) {
  if (!schema || schema.kind !== 'object') return schema;
  const promoted = {
    ...schema,
    properties: (schema.properties || []).map((property) => {
      let propertySchema = property.schema;
      const childName = `${name}${pascalCase(property.name)}`;
      if (propertySchema?.kind === 'object') {
        promoteInlineObject(propertySchema, childName, models);
        propertySchema = { kind: 'ref', ref_name: childName };
      } else if (propertySchema?.kind === 'array' && propertySchema.items?.kind === 'object') {
        const itemName = `${childName}Item`;
        promoteInlineObject(propertySchema.items, itemName, models);
        propertySchema = { ...propertySchema, items: { kind: 'ref', ref_name: itemName } };
      }
      return { ...property, schema: propertySchema };
    }),
  };
  models.set(name, promoted);
  return { kind: 'ref', ref_name: name };
}

function writeAccountAuthCarrier(realm, rows, claimedModels) {
  const oauthAuthorize = rows.find((row) => row.operation_id === 'oauthAuthorize');
  const oauthToken = rows.find((row) => row.operation_id === 'oauthToken');
  const refreshToken = rows.find((row) => row.operation_id === 'refreshToken');
  if (!oauthAuthorize || !oauthToken || !refreshToken
    || oauthToken.openapi.request_content_type !== 'application/x-www-form-urlencoded'
    || oauthToken.openapi.request_schema?.ref_name !== 'OAuthTokenRequestDto'
    || refreshToken.openapi.request_content_type !== 'application/json'
    || refreshToken.openapi.request_schema?.ref_name !== 'RefreshTokenDto') {
    fail('account-auth request operation/schema/content-type is not admitted');
  }
  const models = claimUnownedModels(modelClosure(realm, operationModelRoots(rows)), claimedModels);
  const oauthTokenRequest = models.find((model) => model.name === 'OAuthTokenRequestDto');
  if (!oauthTokenRequest || oauthTokenRequest.schema.kind !== 'object') {
    fail('OAuthTokenRequestDto is unavailable');
  }
  const queryCarrier = renderValuesCarrier(
    'OauthAuthorizeQuery',
    oauthAuthorize.openapi.query_parameters,
    'Values',
  );
  const formCarrier = `func (request OAuthTokenRequestDto) FormValues() url.Values {\n\tvalues := url.Values{}\n${oauthTokenRequest.schema.properties.map((property) => `\tvalues.Set(${quote(property.name)}, request.${pascalCase(property.name)})`).join('\n')}\n\treturn values\n}`;
  writeText(carrierPaths.account_auth, formatGo(`// Code generated by ${generatedBy}; DO NOT EDIT.
// Source: config/realm-openapi/api-nimi.yaml and realm-private-operation-carriers.yaml.

package realmv1

import (
	"net/url"
	"strings"
)

const (
${renderOperationConstants(rows)}
)

type OperationDescriptor struct {
\toperationID string
\tmethod string
\tpath string
\trequestContentType string
\tsuccessStatus int
}

func (operation OperationDescriptor) OperationID() string { return operation.operationID }
func (operation OperationDescriptor) Method() string { return operation.method }
func (operation OperationDescriptor) Path() string { return operation.path }
func (operation OperationDescriptor) RequestContentType() string { return operation.requestContentType }
func (operation OperationDescriptor) SuccessStatus() int { return operation.successStatus }
func (operation OperationDescriptor) ResolveBaseURL(baseURL string) string {
	base, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil || (base.Scheme != "http" && base.Scheme != "https") || strings.TrimSpace(base.Hostname()) == "" || base.User != nil || base.Opaque != "" || base.RawQuery != "" || base.Fragment != "" {
		return ""
	}
	return base.ResolveReference(&url.URL{Path: operation.path}).String()
}

${renderOperationDescriptors(rows)}

${queryCarrier}

${renderModelSet(models)}

${formCarrier}
`));
}

function writeAuthnCarrier(realm, rows, claimedModels) {
  const jwks = rows.find((row) => row.operation_id === 'getAuthJwks');
  const introspection = rows.find((row) => row.operation_id === 'introspectSession');
  const jwksSuccess = jwks ? successfulResponse(jwks) : null;
  if (!jwks || !introspection || jwks.openapi.request_schema?.kind !== 'unknown'
    || jwksSuccess?.schema?.kind !== 'object') {
    fail('authn operation/schema is not admitted');
  }
  const models = claimUnownedModels(modelClosure(realm, operationModelRoots(rows)), claimedModels);
  const inlineModels = new Map();
  promoteInlineObject(jwksSuccess.schema, 'GetAuthJwksResponse', inlineModels);
  const rendered = renderModelSet([
    ...models,
    ...[...inlineModels.entries()].map(([name, schema]) => ({ name, schema })),
  ].sort((left, right) => left.name.localeCompare(right.name)));
  writeText(carrierPaths.authn, formatGo(`// Code generated by ${generatedBy}; DO NOT EDIT.
// Source: config/realm-openapi/api-nimi.yaml and realm-private-operation-carriers.yaml.

package realmv1

const (
${renderOperationConstants(rows)}
)

${renderOperationDescriptors(rows)}

${rendered}
`));
}

function writeSourceMaterializationCarrier(realm, rows, claimedModels) {
  const packet = rows.find((row) => row.operation_id === 'WorldCoreController_createSourceMaterializationPacket');
  const jwks = rows.find((row) => row.operation_id === 'getSourceMaterializationJwks');
  if (!packet || packet.openapi.request_schema?.ref_name !== 'CreateSourceMaterializationPacketV3Dto') {
    fail('packet request operation/schema is not admitted');
  }
  if (!jwks || jwks.openapi.request_schema?.kind !== 'unknown') {
    fail('current-JWKS operation is not admitted as a bodyless request');
  }
  const requestModels = claimUnownedModels(
    modelClosure(realm, [packet.openapi.request_schema.ref_name]),
    claimedModels,
  );
  const closureModels = modelClosure(realm, [
    packet.openapi.request_schema.ref_name,
    successfulResponse(packet)?.schema?.ref_name,
  ]);
  const fieldProjection = closedSchemaFieldProjection(closureModels);
  const closureDigest = crypto.createHash('sha256')
    .update(JSON.stringify(fieldProjection))
    .digest('hex');
  const responseObjectProjection = responseClosedObjectProjection(realm, rows);
  writeText(carrierPaths.source_materialization, formatGo(`// Code generated by ${generatedBy}; DO NOT EDIT.
// Source: config/realm-openapi/api-nimi.yaml and realm-private-operation-carriers.yaml.

package realmv1

import "strings"

const (
${renderOperationConstants(rows)}
\tMaterializationSchemaClosureSHA256\t= ${quote(closureDigest)}
)

${renderOperationDescriptors(rows)}

${renderModelSet(requestModels)}

${renderClosedSchemaFields(fieldProjection)}

${renderResponseClosedObjectProjection(responseObjectProjection)}
`));
}

export function writeRuntimeRealmCarrier(realm) {
  const policy = operationPolicy(realm);
  const byFamily = Object.fromEntries(Object.keys(carrierPaths).map((family) => [
    family,
    policy.filter((row) => row.family === family),
  ]));
  for (const [family, rows] of Object.entries(byFamily)) {
    if (rows.length === 0) fail(`operation family is empty: ${family}`);
  }
  const claimedModels = new Set();
  writeAccountAuthCarrier(realm, byFamily.account_auth, claimedModels);
  writeAuthnCarrier(realm, byFamily.authn, claimedModels);
  writeSourceMaterializationCarrier(realm, byFamily.source_materialization, claimedModels);
}
