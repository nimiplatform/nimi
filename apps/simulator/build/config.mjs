import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { isAlias, isMap, isScalar, isSeq, parseDocument } from 'yaml';
import {
  assertSimulatorSourcePath,
  SimulatorConformanceError,
  stableJsonDigest,
} from '@nimiplatform/app-tools/simulator-conformance';

export const SELECTED_SOURCE_SCHEMA = 'nimi.simulator.selected-source/v1';
export const EXTERNAL_REPOSITORY_CATALOG_SCHEMA = 'nimi.simulator.external-repository-catalog/v1';
export const SIMULATOR_SCENARIO_SCHEMA = 'nimi.simulator.scenario/v1';

const MODULE_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const REPOSITORY_KEY_PATTERN = /^[a-z][a-z0-9]*(?:[-/][a-z0-9]+)*$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const CORE_TAGS = new Set([
  'tag:yaml.org,2002:map',
  'tag:yaml.org,2002:seq',
  'tag:yaml.org,2002:str',
  'tag:yaml.org,2002:null',
  'tag:yaml.org,2002:bool',
  'tag:yaml.org,2002:int',
  'tag:yaml.org,2002:float',
]);

function fail(code, message, fieldPath = '') {
  throw new SimulatorConformanceError(code, message, fieldPath);
}

function inspectNode(node, fieldPath = '<root>') {
  if (!node) return;
  if (isAlias(node)) fail('SIM_DESCRIPTOR_YAML_ALIAS', 'YAML aliases are forbidden', fieldPath);
  if (node.anchor) fail('SIM_DESCRIPTOR_YAML_ANCHOR', 'YAML anchors are forbidden', fieldPath);
  if (node.tag && !CORE_TAGS.has(node.tag)) fail('SIM_DESCRIPTOR_YAML_TAG', 'custom YAML tags are forbidden', fieldPath);
  if (isMap(node)) {
    const seen = new Set();
    for (const pair of node.items) {
      if (!isScalar(pair.key) || typeof pair.key.value !== 'string') {
        fail('SIM_DESCRIPTOR_YAML_KEY', 'mapping keys must be strings', fieldPath);
      }
      const key = pair.key.value;
      if (key === '<<') fail('SIM_DESCRIPTOR_YAML_MERGE', 'YAML merge keys are forbidden', fieldPath);
      if (seen.has(key)) fail('SIM_DESCRIPTOR_YAML_DUPLICATE', `duplicate key ${JSON.stringify(key)}`, fieldPath);
      seen.add(key);
      inspectNode(pair.value, `${fieldPath}.${key}`);
    }
  } else if (isSeq(node)) {
    node.items.forEach((item, index) => inspectNode(item, `${fieldPath}[${index}]`));
  }
}

export function parseStrictConfigYaml(text, label) {
  const document = parseDocument(text, {
    schema: 'core',
    uniqueKeys: true,
    maxAliasCount: 0,
    prettyErrors: false,
    strict: true,
  });
  if (document.errors.length > 0) {
    fail('SIM_DESCRIPTOR_YAML_PARSE', document.errors.map((error) => error.message).join('; '), label);
  }
  inspectNode(document.contents);
  return document.toJS({ maxAliasCount: 0, mapAsMap: false });
}

function assertObject(value, fieldPath) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('SIM_DESCRIPTOR_TYPE', 'must be a mapping', fieldPath);
}

function assertExact(value, keys, fieldPath) {
  assertObject(value, fieldPath);
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail('SIM_DESCRIPTOR_UNKNOWN_FIELD', `unknown field ${JSON.stringify(key)}`, fieldPath || '<root>');
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) fail('SIM_DESCRIPTOR_REQUIRED_FIELD', 'required field is missing', fieldPath ? `${fieldPath}.${key}` : key);
  }
}

function assertString(value, fieldPath, { pattern = null, min = 1, max = 4096 } = {}) {
  if (typeof value !== 'string') fail('SIM_DESCRIPTOR_TYPE', 'must be a string', fieldPath);
  const bytes = Buffer.byteLength(value, 'utf8');
  if (bytes < min || bytes > max || value !== value.normalize('NFC')) {
    fail('SIM_DESCRIPTOR_STRING', `must be NFC text with ${min}-${max} UTF-8 bytes`, fieldPath);
  }
  if (pattern && !pattern.test(value)) fail('SIM_DESCRIPTOR_VALUE', 'has invalid syntax', fieldPath);
  return value;
}

function assertDigest(value, fieldPath) {
  return assertString(value, fieldPath, { pattern: DIGEST_PATTERN, min: 71, max: 71 });
}

function assertBoolean(value, fieldPath) {
  if (typeof value !== 'boolean') fail('SIM_SCENARIO_TYPE', 'must be a boolean', fieldPath);
  return value;
}

function assertJsonValue(value, fieldPath, ancestors = new Set()) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      fail('SIM_SCENARIO_JSON', 'must be a finite JSON number other than negative zero', fieldPath);
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) fail('SIM_SCENARIO_JSON', 'cyclic arrays are forbidden', fieldPath);
    ancestors.add(value);
    const output = value.map((entry, index) => assertJsonValue(entry, `${fieldPath}[${index}]`, ancestors));
    ancestors.delete(value);
    return output;
  }
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    if (ancestors.has(value)) fail('SIM_SCENARIO_JSON', 'cyclic objects are forbidden', fieldPath);
    ancestors.add(value);
    const output = {};
    for (const [key, entry] of Object.entries(value)) {
      assertString(key, `${fieldPath}.[key]`, { min: 1, max: 512 });
      output[key] = assertJsonValue(entry, `${fieldPath}.${key}`, ancestors);
    }
    ancestors.delete(value);
    return output;
  }
  fail('SIM_SCENARIO_JSON', 'must be an ordinary JSON value', fieldPath);
}

function assertUniqueStrings(value, fieldPath) {
  if (!Array.isArray(value)) fail('SIM_SCENARIO_TYPE', 'must be a sequence', fieldPath);
  const entries = value.map((entry, index) => assertString(entry, `${fieldPath}[${index}]`, {
    pattern: /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/,
    min: 2,
    max: 224,
  }));
  if (new Set(entries).size !== entries.length) fail('SIM_SCENARIO_DUPLICATE', 'entries must be unique', fieldPath);
  const ordered = [...entries].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  if (JSON.stringify(entries) !== JSON.stringify(ordered)) {
    fail('SIM_SCENARIO_ORDER', 'entries must use Unicode code-point order', fieldPath);
  }
  return entries;
}

function assertPrimaryControl(value, fieldPath) {
  assertExact(value, ['semantic_id', 'aria_role', 'accessible_name'], fieldPath);
  return {
    semantic_id: assertString(value.semantic_id, `${fieldPath}.semantic_id`, { min: 2, max: 256 }),
    aria_role: assertString(value.aria_role, `${fieldPath}.aria_role`, {
      pattern: /^[a-z][a-z0-9-]*$/,
      min: 2,
      max: 64,
    }),
    accessible_name: assertString(value.accessible_name, `${fieldPath}.accessible_name`, { min: 1, max: 512 }),
  };
}

function assertJsonPointer(value, fieldPath) {
  assertString(value, fieldPath, { min: 0, max: 2048 });
  if (value !== '' && (!value.startsWith('/') || /~(?:[^01]|$)/u.test(value))) {
    fail('SIM_SCENARIO_JSON_POINTER', 'must be an RFC 6901 JSON Pointer', fieldPath);
  }
  return value;
}

export function validateSimulatorScenario(value, label = 'config/simulator/scenario.yaml') {
  assertExact(value, [
    'schema',
    'scenario_id',
    'scenario_revision',
    'seed',
    'initial_logical_time',
    'state',
    'module_data',
    'enabled_capabilities',
    'launch',
    'readiness',
  ], '');
  if (value.schema !== SIMULATOR_SCENARIO_SCHEMA) {
    fail('SIM_SCENARIO_SCHEMA', `must equal ${SIMULATOR_SCENARIO_SCHEMA}`, 'schema');
  }
  const scenarioId = assertString(value.scenario_id, 'scenario_id', {
    pattern: MODULE_ID_PATTERN,
    min: 2,
    max: 128,
  });
  const scenarioRevision = assertString(value.scenario_revision, 'scenario_revision', {
    pattern: /^[a-z0-9][a-z0-9.-]*$/,
    min: 1,
    max: 128,
  });
  const seed = assertString(value.seed, 'seed', { pattern: /^[0-9a-f]{64}$/, min: 64, max: 64 });
  if (/^0{64}$/u.test(seed)) fail('SIM_SCENARIO_SEED', 'all-zero seed is forbidden', 'seed');
  if (!Number.isSafeInteger(value.initial_logical_time) || value.initial_logical_time < 0) {
    fail('SIM_SCENARIO_LOGICAL_TIME', 'must be a non-negative safe integer', 'initial_logical_time');
  }

  assertExact(value.state, ['scenario', 'ecosystem', 'shell'], 'state');
  const state = {
    scenario: assertJsonValue(value.state.scenario, 'state.scenario'),
    ecosystem: assertJsonValue(value.state.ecosystem, 'state.ecosystem'),
    shell: assertJsonValue(value.state.shell, 'state.shell'),
  };

  if (!Array.isArray(value.module_data)) fail('SIM_SCENARIO_TYPE', 'must be a sequence', 'module_data');
  const moduleIds = new Set();
  const moduleData = value.module_data.map((entry, index) => {
    const fieldPath = `module_data[${index}]`;
    assertExact(entry, ['module_id', 'data'], fieldPath);
    const moduleId = assertString(entry.module_id, `${fieldPath}.module_id`, {
      pattern: MODULE_ID_PATTERN,
      min: 2,
      max: 64,
    });
    if (moduleIds.has(moduleId)) fail('SIM_SCENARIO_DUPLICATE', `duplicate module ${JSON.stringify(moduleId)}`, fieldPath);
    moduleIds.add(moduleId);
    return { module_id: moduleId, data: assertJsonValue(entry.data, `${fieldPath}.data`) };
  });

  if (!Array.isArray(value.launch)) fail('SIM_SCENARIO_TYPE', 'must be a sequence', 'launch');
  const launchIds = new Set();
  const launch = value.launch.map((entry, index) => {
    const fieldPath = `launch[${index}]`;
    assertExact(entry, ['launch_id', 'module_id', 'surface_id', 'activate'], fieldPath);
    const launchId = assertString(entry.launch_id, `${fieldPath}.launch_id`, {
      pattern: MODULE_ID_PATTERN,
      min: 2,
      max: 64,
    });
    if (launchIds.has(launchId)) fail('SIM_SCENARIO_DUPLICATE', `duplicate launch ID ${JSON.stringify(launchId)}`, fieldPath);
    launchIds.add(launchId);
    return {
      launch_id: launchId,
      module_id: assertString(entry.module_id, `${fieldPath}.module_id`, { pattern: MODULE_ID_PATTERN, min: 2, max: 64 }),
      surface_id: assertString(entry.surface_id, `${fieldPath}.surface_id`, { pattern: MODULE_ID_PATTERN, min: 2, max: 64 }),
      activate: assertBoolean(entry.activate, `${fieldPath}.activate`),
    };
  });

  if (!Array.isArray(value.readiness)) fail('SIM_SCENARIO_TYPE', 'must be a sequence', 'readiness');
  const readinessKeys = new Set();
  const readiness = value.readiness.map((entry, index) => {
    const fieldPath = `readiness[${index}]`;
    assertExact(entry, [
      'module_id',
      'surface_id',
      'contract_id',
      'root_content_semantic_id',
      'primary_control',
      'projection',
      'blocking',
    ], fieldPath);
    const moduleId = assertString(entry.module_id, `${fieldPath}.module_id`, { pattern: MODULE_ID_PATTERN, min: 2, max: 64 });
    const surfaceId = assertString(entry.surface_id, `${fieldPath}.surface_id`, { pattern: MODULE_ID_PATTERN, min: 2, max: 64 });
    const key = `${moduleId}/${surfaceId}`;
    if (readinessKeys.has(key)) fail('SIM_SCENARIO_DUPLICATE', `duplicate readiness row ${JSON.stringify(key)}`, fieldPath);
    readinessKeys.add(key);
    assertExact(entry.projection, ['kind', 'json_pointer', 'expected'], `${fieldPath}.projection`);
    if (entry.projection.kind !== 'json_pointer_equals') {
      fail('SIM_SCENARIO_PREDICATE', 'projection kind must equal json_pointer_equals', `${fieldPath}.projection.kind`);
    }
    assertExact(entry.blocking, ['kind'], `${fieldPath}.blocking`);
    if (entry.blocking.kind !== 'no_active_overlay_lease') {
      fail('SIM_SCENARIO_PREDICATE', 'blocking kind must equal no_active_overlay_lease', `${fieldPath}.blocking.kind`);
    }
    return {
      module_id: moduleId,
      surface_id: surfaceId,
      contract_id: assertString(entry.contract_id, `${fieldPath}.contract_id`, { min: 2, max: 256 }),
      root_content_semantic_id: assertString(entry.root_content_semantic_id, `${fieldPath}.root_content_semantic_id`, { min: 2, max: 256 }),
      primary_control: assertPrimaryControl(entry.primary_control, `${fieldPath}.primary_control`),
      projection: {
        kind: 'json_pointer_equals',
        json_pointer: assertJsonPointer(entry.projection.json_pointer, `${fieldPath}.projection.json_pointer`),
        expected: assertJsonValue(entry.projection.expected, `${fieldPath}.projection.expected`),
      },
      blocking: { kind: 'no_active_overlay_lease' },
    };
  });

  const wire = {
    schema: SIMULATOR_SCENARIO_SCHEMA,
    scenario_id: scenarioId,
    scenario_revision: scenarioRevision,
    seed,
    initial_logical_time: value.initial_logical_time,
    state,
    module_data: moduleData,
    enabled_capabilities: assertUniqueStrings(value.enabled_capabilities, 'enabled_capabilities'),
    launch,
    readiness,
  };
  return Object.freeze({
    ...wire,
    digest: stableJsonDigest('nimi-simulator-scenario-v1', wire),
    descriptor_label: label,
  });
}

export function parseSimulatorScenario(text, label = 'config/simulator/scenario.yaml') {
  return validateSimulatorScenario(parseStrictConfigYaml(text, label), label);
}

function assertAuthorityRefs(value, fieldPath) {
  if (!Array.isArray(value) || value.length === 0) fail('SIM_DESCRIPTOR_AUTHORITY_REFS', 'must be a non-empty sequence', fieldPath);
  return value.map((entry, index) => {
    const itemPath = `${fieldPath}[${index}]`;
    assertExact(entry, ['owner', 'rule_id'], itemPath);
    return {
      owner: assertString(entry.owner, `${itemPath}.owner`, { pattern: MODULE_ID_PATTERN, min: 2, max: 64 }),
      rule_id: assertString(entry.rule_id, `${itemPath}.rule_id`, { pattern: /^[A-Z][A-Z0-9-]*-\d+$/, min: 3, max: 128 }),
    };
  });
}

function assertSourceLocation(value, index) {
  const fieldPath = `sources[${index}]`;
  assertExact(value, [
    'id',
    'kind',
    'repository_key',
    'object_format',
    'object_id',
    'root',
    'expected_digest',
    'authority_refs',
    'authority_index_digest',
  ], fieldPath);
  const id = assertString(value.id, `${fieldPath}.id`, { pattern: MODULE_ID_PATTERN, min: 2, max: 64 });
  if (!['workspace', 'external-repository'].includes(value.kind)) {
    fail('SIM_DESCRIPTOR_SOURCE_KIND', 'must be workspace or external-repository', `${fieldPath}.kind`);
  }
  const repositoryKey = assertString(value.repository_key, `${fieldPath}.repository_key`, {
    pattern: REPOSITORY_KEY_PATTERN,
    min: 2,
    max: 128,
  });
  if (!['git-sha1', 'git-sha256'].includes(value.object_format)) {
    fail('SIM_DESCRIPTOR_OBJECT_FORMAT', 'must be git-sha1 or git-sha256', `${fieldPath}.object_format`);
  }
  const objectLength = value.object_format === 'git-sha1' ? 40 : 64;
  assertString(value.object_id, `${fieldPath}.object_id`, {
    pattern: new RegExp(`^[0-9a-f]{${objectLength}}$`),
    min: objectLength,
    max: objectLength,
  });
  assertSimulatorSourcePath(value.root, `${fieldPath}.root`);
  assertDigest(value.expected_digest, `${fieldPath}.expected_digest`);
  const authorityRefs = assertAuthorityRefs(value.authority_refs, `${fieldPath}.authority_refs`);
  assertDigest(value.authority_index_digest, `${fieldPath}.authority_index_digest`);
  return {
    id,
    kind: value.kind,
    repository_key: repositoryKey,
    object_format: value.object_format,
    object_id: value.object_id,
    root: value.root,
    expected_digest: value.expected_digest,
    authority_refs: authorityRefs,
    authority_index_digest: value.authority_index_digest,
  };
}

export function appProductionInventoryDigest(appProduction) {
  return stableJsonDigest('nimi-simulator-app-production-inventory-v1', appProduction.entries);
}

export function hostInvocationInventoryDigest(hostInvocations) {
  return stableJsonDigest('nimi-simulator-host-invocation-inventory-v1', hostInvocations.entries);
}

export function validateSelectedSourceDescriptor(value, label = 'selected-source') {
  const required = ['schema', 'module_id', 'sources', 'app_production', 'host_invocations', 'manifest'];
  const allowed = Object.hasOwn(value || {}, 'source_app_id_ref') ? [...required, 'source_app_id_ref'] : required;
  assertExact(value, allowed, '');
  if (value.schema !== SELECTED_SOURCE_SCHEMA) fail('SIM_DESCRIPTOR_SCHEMA', `must equal ${SELECTED_SOURCE_SCHEMA}`, 'schema');
  const moduleId = assertString(value.module_id, 'module_id', { pattern: MODULE_ID_PATTERN, min: 2, max: 64 });
  const sourceAppIdRef = Object.hasOwn(value, 'source_app_id_ref') ? value.source_app_id_ref : null;
  if (sourceAppIdRef !== null) assertString(sourceAppIdRef, 'source_app_id_ref', { min: 2, max: 128 });
  if (!Array.isArray(value.sources) || value.sources.length === 0) fail('SIM_DESCRIPTOR_SOURCES', 'must be a non-empty sequence', 'sources');
  const sources = value.sources.map(assertSourceLocation);
  const sourceIds = new Set();
  for (const source of sources) {
    if (sourceIds.has(source.id)) fail('SIM_DESCRIPTOR_DUPLICATE_SOURCE', `duplicate source ID ${JSON.stringify(source.id)}`, 'sources');
    sourceIds.add(source.id);
  }
  if (!sourceIds.has('app')) fail('SIM_DESCRIPTOR_APP_SOURCE', 'exactly one source must have id app', 'sources');

  assertExact(value.app_production, ['source_id', 'entries', 'inventory_digest', 'inventory_authority_refs'], 'app_production');
  if (value.app_production.source_id !== 'app') fail('SIM_DESCRIPTOR_APP_SOURCE', 'source_id must equal app', 'app_production.source_id');
  if (!Array.isArray(value.app_production.entries) || value.app_production.entries.length === 0) {
    fail('SIM_DESCRIPTOR_APP_ENTRIES', 'must be a non-empty sequence', 'app_production.entries');
  }
  const appEntries = value.app_production.entries.map((entry, index) => {
    assertSimulatorSourcePath(entry, `app_production.entries[${index}]`);
    return entry;
  });
  if (new Set(appEntries).size !== appEntries.length) fail('SIM_DESCRIPTOR_DUPLICATE_ENTRY', 'App production entries must be unique', 'app_production.entries');
  assertDigest(value.app_production.inventory_digest, 'app_production.inventory_digest');
  const appAuthorityRefs = assertAuthorityRefs(value.app_production.inventory_authority_refs, 'app_production.inventory_authority_refs');
  const appProduction = {
    source_id: 'app',
    entries: appEntries,
    inventory_digest: value.app_production.inventory_digest,
    inventory_authority_refs: appAuthorityRefs,
  };
  if (appProductionInventoryDigest(appProduction) !== appProduction.inventory_digest) {
    fail('SIM_DESCRIPTOR_APP_INVENTORY_DIGEST', 'App production inventory digest mismatch', 'app_production.inventory_digest');
  }

  assertExact(value.host_invocations, ['entries', 'inventory_digest', 'inventory_authority_refs'], 'host_invocations');
  if (!Array.isArray(value.host_invocations.entries)) fail('SIM_DESCRIPTOR_HOST_ENTRIES', 'must be a sequence', 'host_invocations.entries');
  const hostIds = new Set();
  const hostEntries = value.host_invocations.entries.map((entry, index) => {
    const fieldPath = `host_invocations.entries[${index}]`;
    assertExact(entry, ['id', 'source_id', 'entry', 'authority_refs'], fieldPath);
    const id = assertString(entry.id, `${fieldPath}.id`, { pattern: MODULE_ID_PATTERN, min: 2, max: 64 });
    if (hostIds.has(id)) fail('SIM_DESCRIPTOR_DUPLICATE_HOST', `duplicate host invocation ID ${JSON.stringify(id)}`, `${fieldPath}.id`);
    hostIds.add(id);
    const sourceId = assertString(entry.source_id, `${fieldPath}.source_id`, { pattern: MODULE_ID_PATTERN, min: 2, max: 64 });
    if (!sourceIds.has(sourceId)) fail('SIM_DESCRIPTOR_HOST_SOURCE', `unknown source ID ${JSON.stringify(sourceId)}`, `${fieldPath}.source_id`);
    assertSimulatorSourcePath(entry.entry, `${fieldPath}.entry`);
    return { id, source_id: sourceId, entry: entry.entry, authority_refs: assertAuthorityRefs(entry.authority_refs, `${fieldPath}.authority_refs`) };
  });
  assertDigest(value.host_invocations.inventory_digest, 'host_invocations.inventory_digest');
  const hostAuthorityRefs = assertAuthorityRefs(value.host_invocations.inventory_authority_refs, 'host_invocations.inventory_authority_refs');
  const hostInvocations = {
    entries: hostEntries,
    inventory_digest: value.host_invocations.inventory_digest,
    inventory_authority_refs: hostAuthorityRefs,
  };
  if (hostInvocationInventoryDigest(hostInvocations) !== hostInvocations.inventory_digest) {
    fail('SIM_DESCRIPTOR_HOST_INVENTORY_DIGEST', 'host invocation inventory digest mismatch', 'host_invocations.inventory_digest');
  }

  assertExact(value.manifest, ['source_id', 'path'], 'manifest');
  if (value.manifest.source_id !== 'app' || value.manifest.path !== 'nimi.simulator.yaml') {
    fail('SIM_DESCRIPTOR_MANIFEST', 'Manifest must be nimi.simulator.yaml in the app source', 'manifest');
  }
  return Object.freeze({
    schema: SELECTED_SOURCE_SCHEMA,
    module_id: moduleId,
    source_app_id_ref: sourceAppIdRef,
    sources,
    app_production: appProduction,
    host_invocations: hostInvocations,
    manifest: { source_id: 'app', path: 'nimi.simulator.yaml' },
    descriptor_label: label,
  });
}

export function parseSelectedSourceDescriptor(text, label) {
  return validateSelectedSourceDescriptor(parseStrictConfigYaml(text, label), label);
}

function assertCredentialFreeUri(value, fieldPath, { allowFileUri = false } = {}) {
  assertString(value, fieldPath, { min: 8, max: 2048 });
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail('SIM_REPOSITORY_URI', 'must be an absolute credential-free URI', fieldPath);
  }
  const acceptedProtocols = allowFileUri ? ['https:', 'file:'] : ['https:'];
  if (!acceptedProtocols.includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    fail('SIM_REPOSITORY_URI', `only credential-free ${allowFileUri ? 'HTTPS or test-only file' : 'HTTPS'} URIs without query/fragment are allowed`, fieldPath);
  }
  return parsed.href;
}

export function validateExternalRepositoryCatalog(value, { allowFileUri = false } = {}) {
  assertExact(value, ['schema', 'repositories'], '');
  if (value.schema !== EXTERNAL_REPOSITORY_CATALOG_SCHEMA) {
    fail('SIM_REPOSITORY_SCHEMA', `must equal ${EXTERNAL_REPOSITORY_CATALOG_SCHEMA}`, 'schema');
  }
  if (!Array.isArray(value.repositories)) fail('SIM_REPOSITORY_ENTRIES', 'must be a sequence', 'repositories');
  const keys = new Set();
  const repositories = value.repositories.map((entry, index) => {
    const fieldPath = `repositories[${index}]`;
    assertExact(entry, ['key', 'object_format', 'canonical_fetch_uri', 'allowed_mirrors'], fieldPath);
    const key = assertString(entry.key, `${fieldPath}.key`, { pattern: REPOSITORY_KEY_PATTERN, min: 2, max: 128 });
    if (keys.has(key)) fail('SIM_REPOSITORY_DUPLICATE', `duplicate repository key ${JSON.stringify(key)}`, `${fieldPath}.key`);
    keys.add(key);
    if (!['git-sha1', 'git-sha256'].includes(entry.object_format)) {
      fail('SIM_REPOSITORY_OBJECT_FORMAT', 'must be git-sha1 or git-sha256', `${fieldPath}.object_format`);
    }
    if (!Array.isArray(entry.allowed_mirrors)) fail('SIM_REPOSITORY_MIRRORS', 'must be a sequence', `${fieldPath}.allowed_mirrors`);
    const mirrors = entry.allowed_mirrors.map((uri, mirrorIndex) => assertCredentialFreeUri(uri, `${fieldPath}.allowed_mirrors[${mirrorIndex}]`, { allowFileUri }));
    if (new Set(mirrors).size !== mirrors.length) fail('SIM_REPOSITORY_MIRRORS', 'mirrors must be unique', `${fieldPath}.allowed_mirrors`);
    return {
      key,
      object_format: entry.object_format,
      canonical_fetch_uri: assertCredentialFreeUri(entry.canonical_fetch_uri, `${fieldPath}.canonical_fetch_uri`, { allowFileUri }),
      allowed_mirrors: mirrors,
    };
  });
  return Object.freeze({ schema: EXTERNAL_REPOSITORY_CATALOG_SCHEMA, repositories });
}

export function loadSimulatorConfig(configRoot) {
  const selectedDir = path.join(configRoot, 'selected-sources');
  const descriptors = readdirSync(selectedDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.yaml'))
    .map((entry) => {
      const filePath = path.join(selectedDir, entry.name);
      return parseSelectedSourceDescriptor(readFileSync(filePath, 'utf8'), `config/simulator/selected-sources/${entry.name}`);
    })
    .sort((left, right) => left.module_id.localeCompare(right.module_id));
  const moduleIds = new Set();
  for (const descriptor of descriptors) {
    if (moduleIds.has(descriptor.module_id)) fail('SIM_DESCRIPTOR_DUPLICATE_MODULE', `duplicate selected module ${JSON.stringify(descriptor.module_id)}`);
    moduleIds.add(descriptor.module_id);
  }
  const repositoryPath = path.join(configRoot, 'external-repositories.yaml');
  const repositoryCatalog = validateExternalRepositoryCatalog(
    parseStrictConfigYaml(readFileSync(repositoryPath, 'utf8'), 'config/simulator/external-repositories.yaml'),
  );
  const scenarioPath = path.join(configRoot, 'scenario.yaml');
  const scenario = parseSimulatorScenario(
    readFileSync(scenarioPath, 'utf8'),
    'config/simulator/scenario.yaml',
  );
  return { descriptors, repositoryCatalog, scenario };
}
