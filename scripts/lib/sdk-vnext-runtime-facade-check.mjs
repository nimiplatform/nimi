import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export const RUNTIME_FACADE_PATHS = Object.freeze({
  facade: 'sdks/typescript/runtime/index.ts',
  modules: 'sdks/typescript/runtime/runtime-method-modules.ts',
  methodGroups: 'config/sdks-runtime-method-groups.yaml',
  exportMap: 'config/sdks-typescript-target-export-map.yaml',
  postureShards: Object.freeze([
    'config/spec-frozen/runtime/tables/runtime-rpc-auth-posture/identity-access.yaml',
    'config/spec-frozen/runtime/tables/runtime-rpc-auth-posture/agent-ai-cognition.yaml',
    'config/spec-frozen/runtime/tables/runtime-rpc-auth-posture/local-connector-model.yaml',
    'config/spec-frozen/runtime/tables/runtime-rpc-auth-posture/audit-artifact-workflow.yaml',
  ]),
});

export const GROUP_TO_FACADE_ARRAYS = Object.freeze([
  { groups: ['ai_service_projection'], arrays: ['RUNTIME_AI_METHODS'] },
  { groups: ['ai_scheduling_projection'], arrays: ['RUNTIME_SCHEDULING_METHODS'] },
  { groups: ['connector_service_projection'], arrays: ['RUNTIME_CONNECTOR_METHODS'] },
  { groups: ['ai_realtime_service_projection'], arrays: ['RUNTIME_REALTIME_METHODS'] },
  { groups: ['local_service_projection'], arrays: ['RUNTIME_LOCAL_METHODS'] },
  { groups: ['auth_service_projection'], arrays: ['RUNTIME_AUTH_METHODS'] },
  { groups: ['external_agent_service_projection'], arrays: ['RUNTIME_EXTERNAL_AGENT_METHODS'] },
  { groups: ['account_service_projection'], arrays: ['RUNTIME_ACCOUNT_METHODS'] },
  { groups: ['health_monitoring_projection', 'audit_service_projection'], arrays: ['RUNTIME_AUDIT_METHODS'] },
  { groups: ['knowledge_service_projection'], arrays: ['RUNTIME_KNOWLEDGE_METHODS'] },
  { groups: ['app_service_projection'], arrays: ['RUNTIME_APP_MESSAGE_METHODS'] },
  { groups: ['app_lifecycle_service_projection'], arrays: ['RUNTIME_APP_LIFECYCLE_METHODS'] },
  { groups: ['artifact_service_projection'], arrays: ['RUNTIME_ARTIFACT_METHODS'] },
  { groups: ['memory_service_projection'], arrays: ['RUNTIME_MEMORY_METHODS'] },
  {
    groups: ['agent_service_projection', 'agent_participation_projection'],
    arrays: ['RUNTIME_AGENT_METHODS', 'RUNTIME_ROOT_AGENT_FACADE_METHODS'],
  },
]);

const ROOT_AGENT_FACADE_ARRAY = 'RUNTIME_ROOT_AGENT_FACADE_METHODS';
const GENERATED_AGENT_ARRAY = 'RUNTIME_AGENT_METHODS';

const DEFERRED_GROUPS = Object.freeze([
  'workflow_service_projection',
  'model_service_projection',
]);

const NATIVE_CONTROL_METHODS = new Set([
  'OpenDesktopSession',
  'OpenLocalAppSession',
  'RenewLocalAppSession',
  'GetLocalAppPermissionStatus',
  'RequestLocalAppPermission',
  'PrepareLocalAppLaunch',
  'BindLocalAppProcess',
]);

function issue(code, target, reason) {
  return { code, target, reason };
}

function lowerCamel(value) {
  return `${value.slice(0, 1).toLowerCase()}${value.slice(1)}`;
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function parseYaml(text, target, issues) {
  try {
    return YAML.parse(text);
  } catch (error) {
    issues.push(issue('RUNTIME_FACADE_INPUT_INVALID', target, `YAML parse failed: ${error.message}`));
    return {};
  }
}

export function parseRuntimeFacadeArrays(source) {
  const arrays = new Map();
  const pattern = /export const (RUNTIME_[A-Z_]+_METHODS) = \[([\s\S]*?)\] as const/gu;
  for (const match of source.matchAll(pattern)) {
    arrays.set(match[1], [...match[2].matchAll(/'([^']+)'/gu)].map((method) => method[1]));
  }
  return arrays;
}

function parseRuntimeRootFacadeMethods(source) {
  const classStart = source.indexOf('export class Runtime {');
  const classEnd = source.indexOf('\n}\n\nexport function createRuntime', classStart);
  if (classStart < 0 || classEnd < 0) return new Set();
  const classSource = source.slice(classStart, classEnd);
  return new Set(
    [...classSource.matchAll(/^ {2}(?:async\s+)?([a-z][A-Za-z0-9]*)\s*\(/gmu)]
      .map((match) => match[1]),
  );
}

function parseGroups(document) {
  const groups = new Map();
  for (const row of Array.isArray(document?.groups) ? document.groups : []) {
    const group = String(row?.group ?? '').trim();
    if (!group) continue;
    const methods = (Array.isArray(row?.methods) ? row.methods : []).map((method) => lowerCamel(String(method)));
    const excluded = [
      ...(Array.isArray(row?.excluded) ? row.excluded : []).map((item) => lowerCamel(String(item?.name ?? ''))),
      ...(Array.isArray(row?.excluded_methods) ? row.excluded_methods : []).map((item) => lowerCamel(String(item?.method ?? ''))),
    ].filter(Boolean);
    groups.set(group, {
      group,
      service: String(row?.service ?? ''),
      status: String(row?.status ?? ''),
      carrierScope: String(row?.carrier_scope ?? ''),
      methods: uniqueSorted(methods),
      excluded: uniqueSorted(excluded),
    });
  }
  return groups;
}

function parsePostureIndex(documents) {
  const byMethod = new Map();
  for (const document of documents) {
    for (const row of Array.isArray(document?.methods) ? document.methods : []) {
      const methodId = String(row?.method_id ?? '');
      const method = methodId.split('/').at(-1) ?? '';
      if (!method) continue;
      const current = byMethod.get(method) ?? [];
      current.push({ ...row, method_id: methodId });
      byMethod.set(method, current);
    }
  }
  return byMethod;
}

function selectPosture(postures, group, method) {
  const candidates = postures.get(method) ?? [];
  if (candidates.length === 1) return candidates[0];
  const exactService = candidates.filter((row) => row.method_id.includes(`.${group.service}/`));
  if (exactService.length === 1) return exactService[0];
  return undefined;
}

function nativeCarrierOnly(method) {
  return NATIVE_CONTROL_METHODS.has(method);
}

function facadeDisposition(method, posture) {
  if (!posture) return 'method-group-admitted';
  if (posture.transport_disposition === 'deny_all') return 'deny-all';
  if (posture.posture === 'unavailable_by_authority' || posture.posture === 'blocked_pending_authority') {
    return 'authority-unavailable';
  }
  if (nativeCarrierOnly(method)) return 'native-carrier-only';
  return 'admitted';
}

function validateExportMap(exportMap, issues) {
  const target = RUNTIME_FACADE_PATHS.exportMap;
  const entries = new Map((Array.isArray(exportMap?.entries) ? exportMap.entries : []).map((row) => [row?.id, row]));
  const required = [
    ['runtime', /Browser-safe Runtime SDK projection facade[\s\S]*no raw generated DTO/iu],
    ['runtime-generated', /Explicit low-level generated Runtime core boundary/iu],
    ['runtime-wire-types', /0K excludes immutable-package mutation, job, and positive-readiness vocabulary/iu],
    ['app', /no install\/import\/update\/repair lifecycle surface/iu],
  ];
  for (const [id, pattern] of required) {
    const semantics = String(entries.get(id)?.semantics ?? '');
    if (!pattern.test(semantics)) {
      issues.push(issue(
        'RUNTIME_FACADE_EXPORT_MAP_INVALID',
        `${target}#${id}`,
        `TypeScript export map entry ${id} no longer preserves the public/generated/immutable-package boundary.`,
      ));
    }
  }
}

export function validateSdkVnextRuntimeFacadeCandidate(input) {
  const issues = [];
  const methodGroups = parseYaml(input.methodGroups ?? '', RUNTIME_FACADE_PATHS.methodGroups, issues);
  const exportMap = parseYaml(input.exportMap ?? '', RUNTIME_FACADE_PATHS.exportMap, issues);
  const postureDocuments = RUNTIME_FACADE_PATHS.postureShards.map((relative) => (
    parseYaml(input.postures?.get(relative) ?? '', relative, issues)
  ));
  const groups = parseGroups(methodGroups);
  const postures = parsePostureIndex(postureDocuments);
  const arrays = parseRuntimeFacadeArrays(`${input.facade ?? ''}\n${input.modules ?? ''}`);
  const highLevelMethods = [];

  validateExportMap(exportMap, issues);

  for (const mapping of GROUP_TO_FACADE_ARRAYS) {
    const expected = [];
    const excluded = [];
    for (const groupName of mapping.groups) {
      const group = groups.get(groupName);
      if (!group) {
        issues.push(issue('RUNTIME_FACADE_METHOD_GROUP_MISSING', `${RUNTIME_FACADE_PATHS.methodGroups}#${groupName}`, `Missing Runtime method group ${groupName}.`));
        continue;
      }
      if (group.status !== 'active') {
        issues.push(issue('RUNTIME_FACADE_METHOD_GROUP_INVALID', `${RUNTIME_FACADE_PATHS.methodGroups}#${groupName}`, `Mapped Runtime method group must be active, got ${group.status}.`));
        continue;
      }
      for (const method of group.methods) {
        const protoMethod = `${method.slice(0, 1).toUpperCase()}${method.slice(1)}`;
        const posture = selectPosture(postures, group, protoMethod);
        const disposition = facadeDisposition(protoMethod, posture);
        if (disposition === 'admitted' || disposition === 'method-group-admitted') {
          expected.push(method);
        } else {
          excluded.push(method);
        }
      }
      excluded.push(...group.excluded);
    }

    const actual = uniqueSorted(mapping.arrays.flatMap((arrayName) => {
      const methods = arrays.get(arrayName);
      if (!methods) {
        issues.push(issue('RUNTIME_FACADE_ARRAY_MISSING', `${RUNTIME_FACADE_PATHS.modules}#${arrayName}`, `Runtime facade is missing ${arrayName}.`));
        return [];
      }
      return methods;
    }));
    highLevelMethods.push(...actual);
    const admitted = uniqueSorted(expected);
    const missing = admitted.filter((method) => !actual.includes(method));
    const extra = actual.filter((method) => !admitted.includes(method));
    if (missing.length > 0) {
      issues.push(issue(
        'RUNTIME_FACADE_PORTABLE_METHOD_MISSING',
        `${RUNTIME_FACADE_PATHS.modules}#${mapping.arrays.join('+')}`,
        `Public facade omitted admitted typed methods: ${missing.join(', ')}.`,
      ));
    }
    if (extra.length > 0) {
      issues.push(issue(
        'RUNTIME_FACADE_NONPUBLIC_METHOD_EXPOSED',
        `${RUNTIME_FACADE_PATHS.modules}#${mapping.arrays.join('+')}`,
        `Public facade exposed native-only, unavailable, denied, or ungrouped methods: ${extra.join(', ')}.`,
      ));
    }
    const explicitlyExcluded = uniqueSorted(excluded).filter((method) => actual.includes(method));
    if (explicitlyExcluded.length > 0 && extra.length === 0) {
      issues.push(issue(
        'RUNTIME_FACADE_EXCLUDED_METHOD_EXPOSED',
        `${RUNTIME_FACADE_PATHS.modules}#${mapping.arrays.join('+')}`,
        `Public facade exposed methods excluded by authority: ${explicitlyExcluded.join(', ')}.`,
      ));
    }
  }

  const rootAgentFacadeMethods = uniqueSorted(arrays.get(ROOT_AGENT_FACADE_ARRAY) ?? []);
  const generatedAgentMethods = new Set(arrays.get(GENERATED_AGENT_ARRAY) ?? []);
  const implementedRootMethods = parseRuntimeRootFacadeMethods(String(input.facade ?? ''));
  const missingRootImplementations = rootAgentFacadeMethods.filter(
    (method) => !implementedRootMethods.has(method),
  );
  if (missingRootImplementations.length > 0) {
    issues.push(issue(
      'RUNTIME_FACADE_ROOT_METHOD_IMPLEMENTATION_MISSING',
      `${RUNTIME_FACADE_PATHS.facade}#Runtime`,
      `Root facade registry methods are not implemented on Runtime: ${missingRootImplementations.join(', ')}.`,
    ));
  }
  const rawAgentExposure = rootAgentFacadeMethods.filter((method) => generatedAgentMethods.has(method));
  if (rawAgentExposure.length > 0) {
    issues.push(issue(
      'RUNTIME_FACADE_ROOT_METHOD_RAW_EXPOSED',
      `${RUNTIME_FACADE_PATHS.modules}#${GENERATED_AGENT_ARRAY}`,
      `Root-only high-level methods must not also expose generated request DTOs through runtime.agents: ${rawAgentExposure.join(', ')}.`,
    ));
  }

  for (const groupName of DEFERRED_GROUPS) {
    const group = groups.get(groupName);
    if (!group || group.status !== 'deferred') {
      issues.push(issue(
        'RUNTIME_FACADE_DEFERRED_GROUP_INVALID',
        `${RUNTIME_FACADE_PATHS.methodGroups}#${groupName}`,
        `${groupName} must remain deferred.`,
      ));
      continue;
    }
    const leaked = group.methods.filter((method) => highLevelMethods.includes(method));
    if (leaked.length > 0) {
      issues.push(issue(
        'RUNTIME_FACADE_DEFERRED_METHOD_EXPOSED',
        `${RUNTIME_FACADE_PATHS.modules}#${groupName}`,
        `Public facade exposed deferred methods: ${leaked.join(', ')}.`,
      ));
    }
  }

  const facadeSource = String(input.facade ?? '');
  if (facadeSource.includes('generate(input') || facadeSource.includes('stream(input')) {
    issues.push(issue(
      'RUNTIME_FACADE_UNADMITTED_CONVENIENCE',
      RUNTIME_FACADE_PATHS.facade,
      'Runtime facade must not add high-level generate()/stream() convenience.',
    ));
  }
  return issues;
}

export function loadSdkVnextRuntimeFacadeCandidate(root) {
  const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
  return {
    facade: read(RUNTIME_FACADE_PATHS.facade),
    modules: read(RUNTIME_FACADE_PATHS.modules),
    methodGroups: read(RUNTIME_FACADE_PATHS.methodGroups),
    exportMap: read(RUNTIME_FACADE_PATHS.exportMap),
    postures: new Map(RUNTIME_FACADE_PATHS.postureShards.map((relative) => [relative, read(relative)])),
  };
}
