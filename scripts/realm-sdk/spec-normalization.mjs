import { normalizeOperationId } from './legacy-normalization.mjs';
import { normalizeTagToService } from './operation-naming.mjs';

const ORIGINAL_OPERATION_ID_FIELD = 'x-nimi-sdk-original-operation-id';
const RETIRED_CONTROL_PATH_PREFIX = ['api', 'creator', 'mods'].join('/');
const RETIRED_CONTROL_SCHEMA = /^Creator(?:Mod|Mods)(?:Controller|Control)/u;

function resolveServiceName(operation) {
  const tags = Array.isArray(operation?.tags) ? operation.tags.filter(Boolean) : [];
  const primaryTag = String(tags[0] || 'Misc').trim() || 'Misc';
  return normalizeTagToService(primaryTag);
}

function collectOperations(spec) {
  const operations = [];
  const paths = spec?.paths;
  if (!paths || typeof paths !== 'object') {
    return operations;
  }

  for (const [pathName, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== 'object') {
      continue;
    }
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!operation || typeof operation !== 'object') {
        continue;
      }
      operations.push({ pathName, method, operation });
    }
  }
  return operations;
}

function buildUniqueOperationId(baseId, service, index) {
  return index === 0
    ? `${service}_${baseId}`
    : `${service}_${baseId}_${index + 1}`;
}

export function normalizeRealmOpenApiSpec(spec) {
  removeRetiredModsControlPlane(spec);
  const operations = collectOperations(spec);
  const groups = new Map();

  for (const entry of operations) {
    const rawOperationId = String(entry.operation.operationId || '').trim();
    const normalizedOperationId = normalizeOperationId(rawOperationId);
    entry.originalOperationId = normalizedOperationId;
    entry.service = resolveServiceName(entry.operation);
    const group = groups.get(normalizedOperationId) || [];
    group.push(entry);
    groups.set(normalizedOperationId, group);
  }

  for (const group of groups.values()) {
    if (group.length <= 1) {
      continue;
    }

    const usedIds = new Set();
    for (const [index, entry] of group.entries()) {
      entry.operation[ORIGINAL_OPERATION_ID_FIELD] = entry.originalOperationId;
      let nextId = buildUniqueOperationId(entry.originalOperationId, entry.service, index);
      let dedupeIndex = index;
      while (usedIds.has(nextId)) {
        dedupeIndex += 1;
        nextId = buildUniqueOperationId(entry.originalOperationId, entry.service, dedupeIndex);
      }
      usedIds.add(nextId);
      entry.operation.operationId = nextId;
    }
  }

  return spec;
}

function removeRetiredModsControlPlane(spec) {
  const paths = spec?.paths;
  if (paths && typeof paths === 'object') {
    for (const pathName of Object.keys(paths)) {
      if (pathName.slice(1).startsWith(RETIRED_CONTROL_PATH_PREFIX)) {
        delete paths[pathName];
      }
    }
  }

  const schemas = spec?.components?.schemas;
  if (schemas && typeof schemas === 'object') {
    for (const schemaName of Object.keys(schemas)) {
      if (RETIRED_CONTROL_SCHEMA.test(schemaName)) {
        delete schemas[schemaName];
      }
    }
  }
}
