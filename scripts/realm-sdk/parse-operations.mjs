import { OPERATION_METHODS } from './constants.mjs';
import { normalizeMethodName, normalizeOperationId } from './legacy-normalization.mjs';
import { normalizeTagToService, toLowerCamel } from './operation-naming.mjs';
import { mergeOperationParameters } from './operation-parameters.mjs';
import { resolveOperationRequestBody } from './operation-request-body.mjs';

function isFilteredPath(pathName) {
  return /^\/api\/admin(?:\/|$)/i.test(pathName);
}

function resolveMethodName(serviceMethodCounts, service, operationId) {
  const baseMethodName = normalizeMethodName(service, toLowerCamel(operationId));
  const serviceMethodKey = `${service}:${baseMethodName}`;
  const duplicateIndex = Number(serviceMethodCounts.get(serviceMethodKey) || 0);
  serviceMethodCounts.set(serviceMethodKey, duplicateIndex + 1);
  return duplicateIndex > 0
    ? `${baseMethodName}${duplicateIndex + 1}`
    : baseMethodName;
}

export function parseRealmOperations(spec) {
  const paths = spec?.paths;
  if (!paths || typeof paths !== 'object') {
    throw new Error('Invalid OpenAPI spec: missing paths');
  }

  const operations = [];
  const serviceMethodCounts = new Map();
  let operationCounter = 0;

  for (const [pathName, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== 'object' || isFilteredPath(pathName)) {
      continue;
    }

    for (const rawMethod of OPERATION_METHODS) {
      const operation = pathItem[rawMethod];
      if (!operation || typeof operation !== 'object') {
        continue;
      }

      operationCounter += 1;
      const operationIdRaw = String(operation.operationId || '').trim() || `operation_${operationCounter}`;
      const tags = Array.isArray(operation.tags) ? operation.tags.filter(Boolean) : [];
      const primaryTag = String(tags[0] || 'Misc').trim() || 'Misc';
      const service = normalizeTagToService(primaryTag);
      const operationId = normalizeOperationId(operationIdRaw);
      const methodName = resolveMethodName(serviceMethodCounts, service, operationId);
      const parameters = mergeOperationParameters(spec, pathName, pathItem, operation);
      const bodyDescriptor = resolveOperationRequestBody(spec, operation);
      const operationKey = `${service}.${methodName}`;

      operations.push({
        operationKey,
        operationId,
        method: rawMethod.toUpperCase(),
        path: pathName,
        service,
        methodName,
        tag: primaryTag,
        parameters,
        hasBody: bodyDescriptor.hasBody,
        bodyRequired: bodyDescriptor.bodyRequired,
        requestBodyContentType: bodyDescriptor.requestBodyContentType,
      });
    }
  }

  operations.sort((left, right) => left.operationKey.localeCompare(right.operationKey));
  return operations;
}
