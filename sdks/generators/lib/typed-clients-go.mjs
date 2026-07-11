import { generatedBy, writeText } from './context.mjs';
import {
  goOpenApiFieldType,
  goOpenApiType,
  goProtoType,
  goZeroExpr,
  openApiSuccessSchema,
  pascalCase,
  quote,
  realmOperationTypeBase,
  runtimeEnumSchemas,
  runtimeMessageSchemas,
} from './types.mjs';

function resolveRealmSchema(schema, modelByName) {
  let current = schema;
  const visited = new Set();
  while (current?.kind === 'ref') {
    if (visited.has(current.ref_name)) throw new Error(`cyclic Realm model ref: ${current.ref_name}`);
    visited.add(current.ref_name);
    current = modelByName.get(current.ref_name);
    if (!current) throw new Error(`missing Realm model ref: ${schema.ref_name}`);
  }
  return current;
}

function realmSchemaAtPath(schema, segments, modelByName) {
  let current = schema;
  for (const segment of segments) {
    current = resolveRealmSchema(current, modelByName);
    if (current?.kind !== 'object') return null;
    current = (current.properties || []).find((property) => property.name === segment)?.schema;
    if (!current) return null;
  }
  return resolveRealmSchema(current, modelByName);
}

function realmUnionDescriptor(model, modelByName) {
  const variants = model.schema.variants || [];
  if (variants.length < 2 || variants.some((variant) => variant.kind !== 'ref')) {
    throw new Error(`Realm union ${model.name} must contain named variants`);
  }
  const discriminatorPath = String(model.schema.discriminator || 'kind').split('.').filter(Boolean);
  const resolvedVariants = variants.map((variant) => {
    const target = modelByName.get(variant.ref_name);
    const discriminator = realmSchemaAtPath(target, discriminatorPath, modelByName);
    if (discriminator?.kind !== 'enum' || discriminator.values?.length !== 1) {
      throw new Error(`Realm union ${model.name} variant ${variant.ref_name} has no single-value discriminator at ${discriminatorPath.join('.')}`);
    }
    return {
      typeName: variant.ref_name,
      fieldName: pascalCase(discriminator.values[0]),
      discriminatorValue: discriminator.values[0],
    };
  });
  if (new Set(resolvedVariants.map((variant) => variant.discriminatorValue)).size !== resolvedVariants.length) {
    throw new Error(`Realm union ${model.name} discriminator values are not unique`);
  }
  return { discriminatorPath, variants: resolvedVariants };
}

function renderGoProbeType(segments, depth = 0) {
  const segment = segments[depth];
  const fieldName = pascalCase(segment);
  const fieldType = depth === segments.length - 1
    ? 'string'
    : renderGoProbeType(segments, depth + 1);
  return `struct { ${fieldName} ${fieldType} \`json:"${segment}"\` }`;
}

function renderGoRealmUnion(model, modelByName) {
  const descriptor = realmUnionDescriptor(model, modelByName);
  const fields = descriptor.variants
    .map((variant) => `\t${variant.fieldName} *${variant.typeName} \`json:"-"\``)
    .join('\n');
  const marshalBranches = descriptor.variants.map((variant) => `\tif value.${variant.fieldName} != nil {
\t\tselected = value.${variant.fieldName}
\t\tselectedCount++
\t}`).join('\n');
  const unmarshalBranches = descriptor.variants.map((variant) => `\tcase ${quote(variant.discriminatorValue)}:
\t\tvar decoded ${variant.typeName}
\t\tif err := json.Unmarshal(data, &decoded); err != nil {
\t\t\treturn fmt.Errorf("decode ${model.name} ${variant.discriminatorValue}: %w", err)
\t\t}
\t\t*value = ${model.name}{${variant.fieldName}: &decoded}
\t\treturn nil`).join('\n');
  const probeAccess = ['probe', ...descriptor.discriminatorPath.map(pascalCase)].join('.');
  return `type ${model.name} struct {
${fields}
}

func (value ${model.name}) MarshalJSON() ([]byte, error) {
\tvar selected any
\tselectedCount := 0
${marshalBranches}
\tif selectedCount != 1 {
\t\treturn nil, fmt.Errorf("encode ${model.name}: exactly one typed variant is required")
\t}
\treturn json.Marshal(selected)
}

func (value *${model.name}) UnmarshalJSON(data []byte) error {
\tvar probe ${renderGoProbeType(descriptor.discriminatorPath)}
\tif err := json.Unmarshal(data, &probe); err != nil {
\t\treturn fmt.Errorf("decode ${model.name} discriminator: %w", err)
\t}
\tswitch ${probeAccess} {
${unmarshalBranches}
\tdefault:
\t\treturn fmt.Errorf("decode ${model.name}: unknown discriminator %q", ${probeAccess})
\t}
}`;
}

export function writeGoTypedClients(runtime, realm) {
  const realmModelByName = new Map((realm.model_schemas || []).map((model) => [model.name, model.schema]));
  const runtimeEnums = runtimeEnumSchemas(runtime)
    .map((schema) => `type ${schema.name} string\n\nconst (\n${schema.values.map((value) => `	${pascalCase(value)} ${schema.name} = ${quote(value)}`).join('\n')}\n)`)
    .join('\n\n');
  const runtimeTypes = runtimeMessageSchemas(runtime)
    .map((schema) => {
      const fields = schema.fields.map((field) => `	${pascalCase(field.name)} ${goProtoType(field, runtime)} \`json:"${field.name},omitempty"\``).join('\n');
      return `type ${schema.name} struct {\n${fields}\n}`;
    })
    .join('\n\n');
  const runtimeMethods = runtime.codec_maps.map((method) => {
    if (method.kind === 'unary') {
      return `func (c RuntimeTypedClient) ${pascalCase(method.method)}(ctx context.Context, request ${method.request_type}, metadata sdkstypes.CoreMetadata, timeoutMS int64) (${method.response_type}, error) {
	raw, err := c.callTyped(ctx, ${quote(method.method_id)}, request, metadata, timeoutMS)
	if err != nil {
		return ${method.response_type}{}, err
	}
	return decodeRuntimeTypedResponse[${method.response_type}](raw, ${quote(method.response_type)})
}`;
    }
    if (method.kind === 'server_stream') {
      return `func (c RuntimeTypedClient) ${pascalCase(method.method)}(ctx context.Context, request ${method.request_type}, metadata sdkstypes.CoreMetadata, timeoutMS int64) (*RuntimeTypedStream[${method.response_type}], error) {
	reader, err := c.streamTyped(ctx, ${quote(method.method_id)}, request, metadata, timeoutMS)
	if err != nil {
		return nil, err
	}
	return &RuntimeTypedStream[${method.response_type}]{reader: reader}, nil
}`;
    }
    return `func (c RuntimeTypedClient) ${pascalCase(method.method)}(context.Context, ${method.request_type}, sdkstypes.CoreMetadata, int64) (${method.response_type}, error) {
	return ${method.response_type}{}, fmt.Errorf("SDK_RUNTIME_METHOD_UNAVAILABLE: Runtime method kind is not supported by the unary/server-stream core transport: ${method.method_id}")
}`;
  }).join('\n\n');
  const realmModels = (realm.model_schemas || []).map((model) => {
    if (model.schema.kind === 'union') return renderGoRealmUnion(model, realmModelByName);
    if (model.schema.kind !== 'object') return `type ${model.name} ${goOpenApiType(model.schema)}`;
    const fields = model.schema.properties.map((property) => `	${pascalCase(property.name)} ${goOpenApiFieldType(property.schema)} \`json:"${property.name},omitempty"\``).join('\n');
    return `type ${model.name} struct {\n${fields}\n}`;
  }).join('\n\n');
  const realmTypes = realm.operations.map((operation) => {
    const base = realmOperationTypeBase(operation.operation_id);
    const pathFields = (operation.path_parameters || []).map((parameter) => `	${pascalCase(parameter.name)} ${goOpenApiType(parameter.schema)} \`json:"${parameter.name},omitempty"\``).join('\n');
    const queryFields = (operation.query_parameters || []).map((parameter) => `	${pascalCase(parameter.name)} ${goOpenApiType(parameter.schema)} \`json:"${parameter.name},omitempty"\``).join('\n');
    const headerFields = (operation.header_parameters || []).map((parameter) => `	${pascalCase(parameter.name)} ${goOpenApiType(parameter.schema)} \`json:"${parameter.name},omitempty"\``).join('\n');
    return `type ${base}Path struct {\n${pathFields}\n}

type ${base}Query struct {\n${queryFields}\n}

type ${base}Headers struct {\n${headerFields}\n}

type ${base}Request struct {
	Path    ${base}Path \`json:"path,omitempty"\`
	Query   ${base}Query \`json:"query,omitempty"\`
	Headers ${base}Headers \`json:"headers,omitempty"\`
	Body    ${goOpenApiType(operation.request_schema)} \`json:"body,omitempty"\`
}`;
  }).join('\n\n');
  const realmMethods = realm.operations.map((operation) => {
    const base = realmOperationTypeBase(operation.operation_id);
    const responseType = goOpenApiType(openApiSuccessSchema(operation));
    return `func (c RealmTypedClient) ${pascalCase(operation.operation_id)}(ctx context.Context, request ${base}Request, metadata sdkstypes.CoreMetadata, timeoutMS int64) (${responseType}, error) {
	raw, err := c.operationTyped(ctx, ${quote(operation.operation_id)}, request, metadata, timeoutMS)
	if err != nil {
		return ${goZeroExpr(responseType)}, err
	}
	return decodeTypedResponse[${responseType}](raw)
}`;
  }).join('\n\n');
  writeText('sdks/go/coregenerated/typed_clients.go', `// Code generated by ${generatedBy}; DO NOT EDIT.

package coregenerated

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/nimiplatform/nimi/sdks/go/coreclient"
	sdkstypes "github.com/nimiplatform/nimi/sdks/go/types"
)

${runtimeEnums}

${runtimeTypes}

type RuntimeTypedClient struct {
	core coreclient.Client
}

func NewRuntimeTypedClient(core coreclient.Client) RuntimeTypedClient {
	return RuntimeTypedClient{core: core}
}

func (c RuntimeTypedClient) callTyped(ctx context.Context, methodID string, request any, metadata sdkstypes.CoreMetadata, timeoutMS int64) ([]byte, error) {
	encoded, err := json.Marshal(request)
	if err != nil {
		return nil, err
	}
	return c.core.Unary(ctx, sdkstypes.CoreUnaryRequest{Context: ctx, MethodID: methodID, Metadata: metadata, Body: encoded, TimeoutMS: timeoutMS})
}

func (c RuntimeTypedClient) streamTyped(ctx context.Context, methodID string, request any, metadata sdkstypes.CoreMetadata, timeoutMS int64) (coreclient.StreamReader, error) {
	encoded, err := json.Marshal(request)
	if err != nil {
		return nil, err
	}
	return c.core.ServerStream(ctx, sdkstypes.CoreStreamRequest{Context: ctx, MethodID: methodID, Metadata: metadata, Body: encoded, TimeoutMS: timeoutMS})
}

type RuntimeTypedStream[T any] struct {
	reader coreclient.StreamReader
}

func (s *RuntimeTypedStream[T]) Recv(ctx context.Context) (T, error) {
	raw, err := s.reader.Recv(ctx)
	if err != nil {
		var zero T
		return zero, err
	}
	return decodeTypedResponse[T](raw)
}

func (s *RuntimeTypedStream[T]) Close() error {
	return s.reader.Close()
}

func decodeTypedResponse[T any](raw []byte) (T, error) {
	var out T
	if err := json.Unmarshal(raw, &out); err != nil {
		return out, err
	}
	return out, nil
}

func decodeRuntimeTypedResponse[T any](raw []byte, responseType string) (T, error) {
	out, err := decodeTypedResponse[T](raw)
	if err != nil {
		return out, err
	}
	if err := validateCompanionParticipationResponse(responseType, any(out)); err != nil {
		return out, err
	}
	return out, nil
}

func validateCompanionParticipationResponse(responseType string, value any) error {
	switch responseType {
	case "GetCompanionParticipationProjectionResponse":
		return validateCompanionParticipationProjection(value.(GetCompanionParticipationProjectionResponse).Projection)
	case "RequestCompanionParticipationResponse":
		return validateCompanionParticipationProjection(value.(RequestCompanionParticipationResponse).Projection)
	case "CancelCompanionParticipationResponse":
		return validateCompanionParticipationProjection(value.(CancelCompanionParticipationResponse).Projection)
	case "OpenCompanionParticipationReplayResponse":
		return validateCompanionParticipationProjection(value.(OpenCompanionParticipationReplayResponse).Projection)
	default:
		return nil
	}
}

func validateCompanionParticipationProjection(projection *CompanionParticipationProjection) error {
	if projection == nil {
		return fmt.Errorf("SDK_RUNTIME_AGENT_RESPONSE_INVALID: companion participation projection is missing")
	}
	if projection.ProjectionId == "" || projection.AgentId == "" || projection.ProfileRef == "" || projection.RoomOrchestrationRef == "" || projection.AuditRef == "" || projection.ConversationAnchorId == "" {
		return fmt.Errorf("SDK_RUNTIME_AGENT_RESPONSE_INVALID: companion participation projection is missing required refs")
	}
	switch projection.SurfaceKind {
	case COMPANIONPARTICIPATIONSURFACEKINDAVATARCOMPANION, COMPANIONPARTICIPATIONSURFACEKINDDESKTOPCOMPANIONPANEL, COMPANIONPARTICIPATIONSURFACEKINDAVATARDEBUGWORKBENCH:
	default:
		return fmt.Errorf("SDK_RUNTIME_AGENT_RESPONSE_INVALID: companion participation projection has unsupported surface_kind")
	}
	switch projection.TriggerSource {
	case COMPANIONPARTICIPATIONTRIGGERSOURCEUSEREXPLICIT, COMPANIONPARTICIPATIONTRIGGERSOURCESCHEDULEDPROACTIVE, COMPANIONPARTICIPATIONTRIGGERSOURCEDOMAINEVENT:
	default:
		return fmt.Errorf("SDK_RUNTIME_AGENT_RESPONSE_INVALID: companion participation projection has unsupported trigger_source")
	}
	switch projection.Status {
	case COMPANIONPARTICIPATIONSTATUSIDLE, COMPANIONPARTICIPATIONSTATUSADMISSIONPENDING, COMPANIONPARTICIPATIONSTATUSBLOCKED, COMPANIONPARTICIPATIONSTATUSRUNNING, COMPANIONPARTICIPATIONSTATUSFAILED, COMPANIONPARTICIPATIONSTATUSCANCELED:
	case COMPANIONPARTICIPATIONSTATUSCANDIDATEREADY:
		if projection.CandidateRef == "" {
			return fmt.Errorf("SDK_RUNTIME_AGENT_RESPONSE_INVALID: companion participation candidate_ready projection missing candidate_ref")
		}
	case COMPANIONPARTICIPATIONSTATUSCOMMITTEDBYOWNER:
		if projection.CommitRef == "" {
			return fmt.Errorf("SDK_RUNTIME_AGENT_RESPONSE_INVALID: companion participation committed_by_owner projection missing commit_ref")
		}
	default:
		return fmt.Errorf("SDK_RUNTIME_AGENT_RESPONSE_INVALID: companion participation projection has unsupported status")
	}
	return nil
}

${runtimeMethods}

${realmModels}

${realmTypes}

type RealmTypedClient struct {
	core coreclient.Client
}

func NewRealmTypedClient(core coreclient.Client) RealmTypedClient {
	return RealmTypedClient{core: core}
}

func (c RealmTypedClient) operationTyped(ctx context.Context, operationID string, request any, metadata sdkstypes.CoreMetadata, timeoutMS int64) ([]byte, error) {
	encoded, err := json.Marshal(request)
	if err != nil {
		return nil, err
	}
	return c.core.Unary(ctx, sdkstypes.CoreUnaryRequest{Context: ctx, MethodID: operationID, Metadata: metadata, Body: encoded, TimeoutMS: timeoutMS})
}

${realmMethods}
`);
}
