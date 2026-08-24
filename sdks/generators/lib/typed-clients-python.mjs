import { generatedBy, writeText } from './context.mjs';
import {
  openApiSuccessSchema,
  pyFieldName,
  pyOpenApiType,
  pyProtoType,
  quote,
  realmOperationTypeBase,
  runtimeEnumSchemas,
  runtimeMessageSchemas,
  snakeCase,
} from './types.mjs';

function pythonOptionalType(type) {
  return type.split(' | ').includes('None') ? type : `${type} | None`;
}

export function writePythonTypedClients(runtime, realm) {
  const runtimeEnums = runtimeEnumSchemas(runtime)
    .map((schema) => `${schema.name} = Literal[${schema.values.length ? schema.values.map(quote).join(', ') : '"__unspecified__"'}]`)
    .join('\n');
  const runtimeTypes = runtimeMessageSchemas(runtime)
    .map((schema) => {
      const fields = schema.fields.map((field) => {
        const type = pyProtoType(field, runtime);
        if (field.type === 'map') return `    ${pyFieldName(field.name)}: ${type} = field(default_factory=dict)`;
        if (field.repeated) return `    ${pyFieldName(field.name)}: ${type} = field(default_factory=tuple)`;
        return `    ${pyFieldName(field.name)}: ${type} | None = None`;
      }).join('\n') || '    pass';
      return `@dataclass(frozen=True)
class ${schema.name}:
${fields}`;
    })
    .join('\n\n');
  const runtimeMethods = runtime.codec_maps.map((method) => {
    const name = snakeCase(method.method);
    if (method.kind === 'unary') {
      return `    async def ${name}(self, request: ${method.request_type}, *, metadata: Mapping[str, str] | None = None, timeout_ms: int | None = None) -> ${method.response_type}:
        raw: object = await self._core.unary(CoreUnaryRequest(method_id=${quote(method.method_id)}, body=_model_body(request), metadata=metadata, timeout_ms=timeout_ms))
        return _decode_model(${method.response_type}, raw)`;
    }
    if (method.kind === 'server_stream') {
      return `    def ${name}(self, request: ${method.request_type}, *, metadata: Mapping[str, str] | None = None, timeout_ms: int | None = None) -> AsyncIterator[${method.response_type}]:
        return self._stream(${quote(method.method_id)}, _model_body(request), ${method.response_type}, metadata=metadata, timeout_ms=timeout_ms)`;
    }
    return `    async def ${name}(self, request: ${method.request_type}, *, metadata: Mapping[str, str] | None = None, timeout_ms: int | None = None) -> ${method.response_type}:
        raise RuntimeError(${quote(`SDK_RUNTIME_METHOD_UNAVAILABLE: Runtime method kind is not supported by the unary/server-stream core transport: ${method.method_id}`)})`;
  }).join('\n\n');
  const renderRealmModel = (model) => {
    if (model.schema.kind !== 'object') return `${model.name} = ${pyOpenApiType(model.schema)}`;
    const orderedProperties = [
      ...model.schema.properties.filter((property) => property.required),
      ...model.schema.properties.filter((property) => !property.required),
    ];
    const fields = orderedProperties.map((property) => {
      const type = pyOpenApiType(property.schema);
      if (property.required) return `    ${pyFieldName(property.name)}: ${type}`;
      if (property.schema.kind === 'array') return `    ${pyFieldName(property.name)}: ${type} = field(default_factory=tuple)`;
      if (property.schema.kind === 'object') return `    ${pyFieldName(property.name)}: ${type} = field(default_factory=dict)`;
      return `    ${pyFieldName(property.name)}: ${pythonOptionalType(type)} = None`;
    }).join('\n') || '    pass';
    return `@dataclass(frozen=True)
class ${model.name}:
${fields}`;
  };
  const realmModels = [
    ...(realm.model_schemas || []).filter((model) => model.schema.kind !== 'union'),
    // Python evaluates a type-alias RHS eagerly even under future annotations.
    // Emit closed materialization unions after every referenced dataclass so
    // Character/Persona aliases cannot fail import with NameError.
    ...(realm.model_schemas || []).filter((model) => model.schema.kind === 'union'),
  ].map(renderRealmModel).join('\n\n');
  const realmTypes = realm.operations.map((operation) => {
    const base = realmOperationTypeBase(operation.operation_id);
    const pathFields = (operation.path_parameters || []).map((parameter) => {
      const type = pyOpenApiType(parameter.schema);
      return `    ${pyFieldName(parameter.name)}: ${parameter.required ? type : `${pythonOptionalType(type)} = None`}`;
    }).join('\n') || '    pass';
    const queryFields = (operation.query_parameters || []).map((parameter) => `    ${pyFieldName(parameter.name)}: ${pythonOptionalType(pyOpenApiType(parameter.schema))} = None`).join('\n') || '    pass';
    const headerFields = (operation.header_parameters || []).map((parameter) => `    ${snakeCase(parameter.name)}: ${pythonOptionalType(pyOpenApiType(parameter.schema))} = None`).join('\n') || '    pass';
    return `@dataclass(frozen=True)
class ${base}Path:
${pathFields}


@dataclass(frozen=True)
class ${base}Query:
${queryFields}


@dataclass(frozen=True)
class ${base}Headers:
${headerFields}


@dataclass(frozen=True)
class ${base}Request:
    path: ${base}Path
    query: ${base}Query | None = None
    headers: ${base}Headers | None = None
    body: ${pyOpenApiType(operation.request_schema)} | None = None`;
  }).join('\n\n');
  const realmMethods = realm.operations.map((operation) => {
    const base = realmOperationTypeBase(operation.operation_id);
    return `    async def ${snakeCase(operation.operation_id)}(self, request: ${base}Request, *, metadata: Mapping[str, str] | None = None, timeout_ms: int | None = None) -> ${base}Response:
        envelope: dict[str, object] = {
            "path": _model_body(request.path),
            "query": _model_body(request.query),
            "headers": _model_body(request.headers),
            "body": _model_body(request.body),
        }
        raw: object = await self._core.unary(CoreUnaryRequest(method_id=${quote(operation.operation_id)}, body=envelope, metadata=metadata, timeout_ms=timeout_ms))
        return _decode_model(${pyOpenApiType(openApiSuccessSchema(operation))}, raw)`;
  }).join('\n\n');
  writeText('sdks/python/core_generated/runtime_typed_client.py', `# @generated by ${generatedBy}
# DO NOT EDIT MANUALLY.

from __future__ import annotations
from collections.abc import AsyncIterator, Mapping
from dataclasses import asdict, dataclass, field, fields, is_dataclass
from typing import Literal, TypeVar

from sdks.python.core_client import CoreClient
from sdks.python.types import CoreStreamRequest, CoreUnaryRequest

_T = TypeVar("_T")


def _model_body(value: object) -> object:
    if value is None:
        return {}
    if is_dataclass(value):
        return asdict(value)
    if isinstance(value, Mapping):
        return dict(value)
    return value


def _decode_model(model_type: type[_T], value: object) -> _T:
    if not is_dataclass(model_type):
        return value  # type: ignore[return-value]
    if not isinstance(value, Mapping):
        error = RuntimeError("SDK_RUNTIME_RESPONSE_DECODE_FAILED: generated Runtime response must be a mapping")
        setattr(error, "code", "SDK_RUNTIME_RESPONSE_DECODE_FAILED")
        setattr(error, "reason_code", "SDK_RUNTIME_RESPONSE_DECODE_FAILED")
        raise error
    source = dict(value)
    names = {field.name for field in fields(model_type)}
    decoded = model_type(**{key: val for key, val in source.items() if key in names})
    _validate_companion_participation_response(model_type.__name__, decoded)
    return decoded


def _runtime_decode_error(message: str) -> RuntimeError:
    error = RuntimeError(f"SDK_RUNTIME_RESPONSE_DECODE_FAILED: {message}")
    setattr(error, "code", "SDK_RUNTIME_RESPONSE_DECODE_FAILED")
    setattr(error, "reason_code", "SDK_RUNTIME_RESPONSE_DECODE_FAILED")
    return error


def _validate_companion_participation_response(model_name: str, decoded: object) -> None:
    if model_name not in {
        "GetCompanionParticipationProjectionResponse",
        "RequestCompanionParticipationResponse",
        "CancelCompanionParticipationResponse",
        "OpenCompanionParticipationReplayResponse",
    }:
        return
    projection = getattr(decoded, "projection", None)
    if projection is None:
        raise _runtime_decode_error("companion participation projection is missing")
    required = ("projection_id", "agent_id", "profile_ref", "audit_ref", "conversation_anchor_id")
    if any(not str(getattr(projection, field_name, "") or "").strip() for field_name in required):
        raise _runtime_decode_error("companion participation projection is missing required refs")
    if getattr(projection, "surface_kind", None) not in {
        "COMPANION_PARTICIPATION_SURFACE_KIND_AVATAR_COMPANION",
        "COMPANION_PARTICIPATION_SURFACE_KIND_DESKTOP_COMPANION_PANEL",
        "COMPANION_PARTICIPATION_SURFACE_KIND_AVATAR_DEBUG_WORKBENCH",
    }:
        raise _runtime_decode_error("companion participation projection has unsupported surface_kind")
    if getattr(projection, "trigger_source", None) not in {
        "COMPANION_PARTICIPATION_TRIGGER_SOURCE_USER_EXPLICIT",
        "COMPANION_PARTICIPATION_TRIGGER_SOURCE_SCHEDULED_PROACTIVE",
        "COMPANION_PARTICIPATION_TRIGGER_SOURCE_DOMAIN_EVENT",
    }:
        raise _runtime_decode_error("companion participation projection has unsupported trigger_source")
    status = getattr(projection, "status", None)
    if status == "COMPANION_PARTICIPATION_STATUS_CANDIDATE_READY" and not str(getattr(projection, "candidate_ref", "") or "").strip():
        raise _runtime_decode_error("companion participation candidate_ready projection missing candidate_ref")
    if status == "COMPANION_PARTICIPATION_STATUS_COMMITTED_BY_OWNER" and not str(getattr(projection, "commit_ref", "") or "").strip():
        raise _runtime_decode_error("companion participation committed_by_owner projection missing commit_ref")
    if status not in {
        "COMPANION_PARTICIPATION_STATUS_IDLE",
        "COMPANION_PARTICIPATION_STATUS_ADMISSION_PENDING",
        "COMPANION_PARTICIPATION_STATUS_BLOCKED",
        "COMPANION_PARTICIPATION_STATUS_RUNNING",
        "COMPANION_PARTICIPATION_STATUS_CANDIDATE_READY",
        "COMPANION_PARTICIPATION_STATUS_COMMITTED_BY_OWNER",
        "COMPANION_PARTICIPATION_STATUS_FAILED",
        "COMPANION_PARTICIPATION_STATUS_CANCELED",
    }:
        raise _runtime_decode_error("companion participation projection has unsupported status")


${runtimeEnums}

${runtimeTypes}


class RuntimeTypedClient:
    def __init__(self, core: CoreClient) -> None:
        self._core = core

    async def _stream(self, method_id: str, body: object, response_type: type[_T], *, metadata: Mapping[str, str] | None = None, timeout_ms: int | None = None) -> AsyncIterator[_T]:
        async for event in self._core.server_stream(CoreStreamRequest(method_id=method_id, body=body, metadata=metadata, timeout_ms=timeout_ms)):
            yield _decode_model(response_type, event)

${runtimeMethods}
`);
  writeText('sdks/python/core_generated/realm_typed_client.py', `# @generated by ${generatedBy}
# DO NOT EDIT MANUALLY.

from __future__ import annotations
from collections.abc import Mapping
from dataclasses import MISSING, asdict, dataclass, field, fields, is_dataclass
import types
from typing import Literal, Union, get_args, get_origin, get_type_hints

from sdks.python.core_client import CoreClient
from sdks.python.types import CoreUnaryRequest


def _model_body(value: object) -> object:
    if value is None:
        return {}
    if is_dataclass(value):
        return asdict(value)
    if isinstance(value, Mapping):
        return dict(value)
    return value


def _decode_model(model_type, value: object):
    return _decode_realm_value(model_type, value, "$")


def _decode_realm_value(model_type, value: object, path: str):
    origin = get_origin(model_type)
    args = get_args(model_type)
    if origin is Literal:
        if value not in args:
            raise _realm_decode_error(path, "enum value is not admitted")
        return value
    if origin in (types.UnionType, Union):
        if value is None and type(None) in args:
            return None
        for candidate in (item for item in args if item is not type(None)):
            try:
                return _decode_realm_value(candidate, value, path)
            except RuntimeError:
                pass
        raise _realm_decode_error(path, "no union variant matched")
    if origin is tuple:
        if not isinstance(value, (list, tuple)):
            raise _realm_decode_error(path, "expected array")
        item_type = args[0] if args else object
        return tuple(_decode_realm_value(item_type, item, f"{path}[{index}]") for index, item in enumerate(value))
    if origin in (dict, Mapping):
        if not isinstance(value, Mapping):
            raise _realm_decode_error(path, "expected object")
        value_type = args[1] if len(args) > 1 else object
        return {str(key): _decode_realm_value(value_type, item, f"{path}.{key}") for key, item in value.items()}
    if is_dataclass(model_type):
        if not isinstance(value, Mapping):
            raise _realm_decode_error(path, "expected object")
        source = dict(value)
        hints = get_type_hints(model_type, globals(), locals())
        decoded = {}
        for descriptor in fields(model_type):
            if descriptor.name not in source:
                if descriptor.default is MISSING and descriptor.default_factory is MISSING:
                    raise _realm_decode_error(f"{path}.{descriptor.name}", "required field is missing")
                continue
            decoded[descriptor.name] = _decode_realm_value(
                hints.get(descriptor.name, object), source[descriptor.name], f"{path}.{descriptor.name}",
            )
        return model_type(**decoded)
    if model_type is str and not isinstance(value, str):
        raise _realm_decode_error(path, "expected string")
    if model_type is bool and type(value) is not bool:
        raise _realm_decode_error(path, "expected boolean")
    if model_type is int and (type(value) is not int):
        raise _realm_decode_error(path, "expected integer")
    if model_type is float and (not isinstance(value, (int, float)) or isinstance(value, bool)):
        raise _realm_decode_error(path, "expected number")
    return value


def _realm_decode_error(path: str, reason: str) -> RuntimeError:
    error = RuntimeError(f"SDK_REALM_RESPONSE_DECODE_FAILED: malformed success at {path}: {reason}")
    setattr(error, "code", "SDK_REALM_RESPONSE_DECODE_FAILED")
    setattr(error, "reason_code", "SDK_REALM_RESPONSE_DECODE_FAILED")
    return error


${realmModels}

${realmTypes}


class RealmTypedClient:
    def __init__(self, core: CoreClient) -> None:
        self._core = core

${realmMethods}
`);
}
