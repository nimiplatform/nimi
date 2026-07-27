import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { isAlias, isMap, isScalar, isSeq, parseDocument } from 'yaml';
import {
  assertSimulatorSourcePath,
  SimulatorConformanceError,
} from '@nimiplatform/app-tools/simulator-conformance';

export const SIMULATOR_SCENARIO_SCHEMA = 'nimi.simulator.scenario/v1';

const MODULE_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
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
  };
  return Object.freeze({
    ...wire,
    descriptor_label: label,
  });
}

export function parseSimulatorScenario(text, label = 'config/simulator/scenario.yaml') {
  return validateSimulatorScenario(parseStrictConfigYaml(text, label), label);
}

export function validateSelectedSourceDescriptor(value, label = 'selected-source') {
  assertExact(value, ['module_id', 'root'], '');
  const moduleId = assertString(value.module_id, 'module_id', { pattern: MODULE_ID_PATTERN, min: 2, max: 64 });
  assertSimulatorSourcePath(value.root, 'root');
  return Object.freeze({
    module_id: moduleId,
    root: value.root,
    descriptor_label: label,
  });
}

export function parseSelectedSourceDescriptor(text, label) {
  return validateSelectedSourceDescriptor(parseStrictConfigYaml(text, label), label);
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
  const scenarioPath = path.join(configRoot, 'scenario.yaml');
  const scenario = parseSimulatorScenario(
    readFileSync(scenarioPath, 'utf8'),
    'config/simulator/scenario.yaml',
  );
  return { descriptors, scenario };
}
