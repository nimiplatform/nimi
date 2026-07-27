import {
  isAlias,
  isMap,
  isScalar,
  isSeq,
  parseDocument,
} from 'yaml';

export const SIMULATOR_MODULE_PROTOCOL = 'nimi.simulator.module/v1';
export const SIMULATOR_OPERATION_PROTOCOL = 'nimi.simulator.operation/v1';
export const SIMULATOR_INTERACTION_PROTOCOL = 'nimi.simulator.interaction/v1';
export const SIMULATOR_RENDERER_HOST_PROTOCOL = 'nimi.renderer.host/v1';
export const SIMULATOR_MANIFEST_PATH = 'nimi.simulator.yaml';

const MODULE_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const COMMAND_EVENT_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9-]*){2,}$/;
// Kit/SDK catalog IDs retain their owner-defined casing (for example the
// canonical SDK method `nimi.ai.generateText`). App-owned command/event IDs
// remain separately constrained to the lower-case module namespace.
const CATALOG_ID_PATTERN = /^[a-z][A-Za-z0-9-]*(?:\.[a-z][A-Za-z0-9-]*)+$/;
const EXPORT_NAME_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const CORE_TAGS = new Set([
  'tag:yaml.org,2002:map',
  'tag:yaml.org,2002:seq',
  'tag:yaml.org,2002:str',
  'tag:yaml.org,2002:null',
  'tag:yaml.org,2002:bool',
  'tag:yaml.org,2002:int',
  'tag:yaml.org,2002:float',
]);
const GENERATED_PATH_SEGMENTS = new Set([
  '.next',
  '.pnpm',
  'build',
  'coverage',
  'dist',
  'dist-electron',
  'node_modules',
  'out',
]);

export class SimulatorConformanceError extends Error {
  constructor(code, message, fieldPath = '') {
    super(fieldPath ? `${fieldPath}: ${message}` : message);
    this.name = 'SimulatorConformanceError';
    this.code = code;
    this.fieldPath = fieldPath;
  }
}

function fail(code, message, fieldPath = '') {
  throw new SimulatorConformanceError(code, message, fieldPath);
}

function utf8Length(value) {
  return Buffer.byteLength(value, 'utf8');
}

function assertPlainObject(value, fieldPath) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('SIM_MANIFEST_TYPE', 'must be a mapping', fieldPath);
  }
}

function assertExactKeys(value, required, fieldPath) {
  assertPlainObject(value, fieldPath);
  const allowed = new Set(required);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      fail('SIM_MANIFEST_UNKNOWN_FIELD', `unknown field ${JSON.stringify(key)}`, fieldPath || '<root>');
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      fail('SIM_MANIFEST_REQUIRED_FIELD', 'required field is missing', fieldPath ? `${fieldPath}.${key}` : key);
    }
  }
}

function assertString(value, fieldPath, { minBytes = 1, maxBytes = 4096, pattern = null } = {}) {
  if (typeof value !== 'string') {
    fail('SIM_MANIFEST_TYPE', 'must be a string', fieldPath);
  }
  const length = utf8Length(value);
  if (length < minBytes || length > maxBytes) {
    fail('SIM_MANIFEST_STRING_LENGTH', `must contain ${minBytes}-${maxBytes} UTF-8 bytes`, fieldPath);
  }
  if (value !== value.normalize('NFC')) {
    fail('SIM_MANIFEST_NON_NFC', 'must be NFC-normalized', fieldPath);
  }
  if (pattern && !pattern.test(value)) {
    fail('SIM_MANIFEST_IDENTIFIER', 'has invalid identifier syntax', fieldPath);
  }
  return value;
}

function assertStringArray(value, fieldPath, options = {}) {
  if (!Array.isArray(value)) {
    fail('SIM_MANIFEST_TYPE', 'must be a sequence', fieldPath);
  }
  if (options.nonEmpty && value.length === 0) {
    fail('SIM_MANIFEST_EMPTY_SET', 'must not be empty', fieldPath);
  }
  const seen = new Set();
  return value.map((entry, index) => {
    const checked = assertString(entry, `${fieldPath}[${index}]`, options.string || {});
    if (seen.has(checked)) {
      fail('SIM_MANIFEST_DUPLICATE_VALUE', `duplicate value ${JSON.stringify(checked)}`, fieldPath);
    }
    seen.add(checked);
    return checked;
  });
}

export function assertSimulatorSourcePath(value, fieldPath = 'path') {
  assertString(value, fieldPath, { maxBytes: 4096 });
  if (value.startsWith('/') || value.startsWith('./')) {
    fail('SIM_MANIFEST_PATH', 'must be a source-root-relative POSIX path', fieldPath);
  }
  if (value.includes('\\') || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) || value.startsWith('//')) {
    fail('SIM_MANIFEST_PATH', 'URL, authority, drive, and backslash paths are forbidden', fieldPath);
  }
  if (/[?#*{}\[\]!]/.test(value)) {
    fail('SIM_MANIFEST_CONDITIONAL_PATH', 'conditional and glob paths are forbidden', fieldPath);
  }
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    fail('SIM_MANIFEST_PATH', 'empty, dot, and parent path segments are forbidden', fieldPath);
  }
  if (segments.some((segment) => GENERATED_PATH_SEGMENTS.has(segment))) {
    fail('SIM_MANIFEST_GENERATED_PATH', 'package-cache and generated bundle paths are forbidden', fieldPath);
  }
  if (/\.(?:bundle|min)\.(?:[cm]?js|css)$/i.test(value)) {
    fail('SIM_MANIFEST_PREBUILT_PATH', 'prebuilt JavaScript and CSS artifacts are forbidden', fieldPath);
  }
  return value;
}

function inspectYamlNode(node, fieldPath = '<root>') {
  if (!node) {
    return;
  }
  if (isAlias(node)) {
    fail('SIM_MANIFEST_YAML_ALIAS', 'YAML aliases are forbidden', fieldPath);
  }
  if (node.anchor) {
    fail('SIM_MANIFEST_YAML_ANCHOR', 'YAML anchors are forbidden', fieldPath);
  }
  if (node.tag && !CORE_TAGS.has(node.tag)) {
    fail('SIM_MANIFEST_YAML_CUSTOM_TAG', `custom YAML tag ${JSON.stringify(node.tag)} is forbidden`, fieldPath);
  }
  if (isMap(node)) {
    const seen = new Set();
    for (const pair of node.items) {
      if (!isScalar(pair.key) || typeof pair.key.value !== 'string') {
        fail('SIM_MANIFEST_YAML_KEY', 'mapping keys must be strings', fieldPath);
      }
      const key = pair.key.value;
      if (key === '<<') {
        fail('SIM_MANIFEST_YAML_MERGE', 'YAML merge keys are forbidden', fieldPath);
      }
      if (seen.has(key)) {
        fail('SIM_MANIFEST_YAML_DUPLICATE_KEY', `duplicate key ${JSON.stringify(key)}`, fieldPath);
      }
      seen.add(key);
      inspectYamlNode(pair.key, `${fieldPath}.${key}`);
      inspectYamlNode(pair.value, `${fieldPath}.${key}`);
    }
    return;
  }
  if (isSeq(node)) {
    node.items.forEach((item, index) => inspectYamlNode(item, `${fieldPath}[${index}]`));
  }
}

function parseStrictYaml(text, label) {
  if (typeof text !== 'string') {
    fail('SIM_MANIFEST_TYPE', 'manifest source must be a UTF-8 string', label);
  }
  const document = parseDocument(text, {
    schema: 'core',
    uniqueKeys: true,
    maxAliasCount: 0,
    prettyErrors: false,
    strict: true,
  });
  if (document.errors.length > 0) {
    const duplicate = document.errors.some((error) => /unique keys|must be unique|already set|duplicate/i.test(error.message));
    fail(
      duplicate ? 'SIM_MANIFEST_YAML_DUPLICATE_KEY' : 'SIM_MANIFEST_YAML_PARSE',
      document.errors.map((error) => error.message).join('; '),
      label,
    );
  }
  inspectYamlNode(document.contents);
  let value;
  try {
    value = document.toJS({ maxAliasCount: 0, mapAsMap: false });
  } catch (error) {
    fail('SIM_MANIFEST_YAML_PARSE', error instanceof Error ? error.message : String(error), label);
  }
  return value;
}

function validateModuleId(value, fieldPath = 'module_id') {
  assertString(value, fieldPath, { minBytes: 2, maxBytes: 64, pattern: MODULE_ID_PATTERN });
  return value;
}

function validateExportName(value, fieldPath) {
  return assertString(value, fieldPath, { maxBytes: 128, pattern: EXPORT_NAME_PATTERN });
}

function validateCatalogIds(values, fieldPath) {
  return assertStringArray(values, fieldPath, {
    string: { maxBytes: 128, pattern: CATALOG_ID_PATTERN },
  });
}

function validateCommandEventIds(values, fieldPath, moduleId) {
  const checked = assertStringArray(values, fieldPath, {
    string: { maxBytes: 128, pattern: COMMAND_EVENT_PATTERN },
  });
  for (const value of checked) {
    if (value.startsWith('simulator.') || !value.startsWith(`${moduleId}.`)) {
      fail(
        'SIM_MANIFEST_INTERACTION_NAMESPACE',
        `must use the App-owned ${JSON.stringify(`${moduleId}.`)} namespace`,
        fieldPath,
      );
    }
  }
  return checked;
}

function validateRoute(value, fieldPath) {
  assertString(value, fieldPath, { maxBytes: 512 });
  if (!value.startsWith('/') || value.startsWith('//')) {
    fail('SIM_MANIFEST_ROUTE', 'must begin with exactly one slash', fieldPath);
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) || value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) {
    fail('SIM_MANIFEST_ROUTE', 'scheme, backslash, and control characters are forbidden', fieldPath);
  }
  const pathOnly = value.split(/[?#]/, 1)[0];
  if (pathOnly.split('/').some((segment) => segment === '..')) {
    fail('SIM_MANIFEST_ROUTE', 'parent route segments are forbidden', fieldPath);
  }
  return value;
}

export function validateSimulatorManifest(value) {
  assertExactKeys(value, ['schema', 'module_id', 'composition', 'renderer', 'requires', 'fixtures'], '');
  if (value.schema !== SIMULATOR_MODULE_PROTOCOL) {
    fail('SIM_MANIFEST_PROTOCOL', `must equal ${SIMULATOR_MODULE_PROTOCOL}`, 'schema');
  }
  const moduleId = validateModuleId(value.module_id);

  assertExactKeys(
    value.composition,
    ['factory_entry', 'factory_export', 'style_entry'],
    'composition',
  );
  assertSimulatorSourcePath(value.composition.factory_entry, 'composition.factory_entry');
  validateExportName(value.composition.factory_export, 'composition.factory_export');
  assertSimulatorSourcePath(value.composition.style_entry, 'composition.style_entry');
  if (value.composition.factory_entry.startsWith('src/simulator/')) {
    fail('SIM_MANIFEST_ALTERNATE_FACTORY', 'the canonical production factory cannot be Simulator-only source', 'composition.factory_entry');
  }
  if (value.composition.style_entry.startsWith('src/simulator/')) {
    fail('SIM_MANIFEST_ALTERNATE_STYLE', 'the canonical production style cannot be Simulator-only source', 'composition.style_entry');
  }

  assertExactKeys(value.renderer, ['entry', 'export', 'adapter_entry', 'adapter_export', 'surfaces'], 'renderer');
  assertSimulatorSourcePath(value.renderer.entry, 'renderer.entry');
  validateExportName(value.renderer.export, 'renderer.export');
  assertSimulatorSourcePath(value.renderer.adapter_entry, 'renderer.adapter_entry');
  validateExportName(value.renderer.adapter_export, 'renderer.adapter_export');
  if (!value.renderer.entry.startsWith('src/simulator/')) {
    fail('SIM_MANIFEST_RENDERER_LOCATION', 'Simulator renderer entry must be under src/simulator/', 'renderer.entry');
  }
  if (!value.renderer.adapter_entry.startsWith('src/simulator/')) {
    fail('SIM_MANIFEST_ADAPTER_LOCATION', 'Simulator Adapter must be under src/simulator/', 'renderer.adapter_entry');
  }
  if (!Array.isArray(value.renderer.surfaces) || value.renderer.surfaces.length === 0) {
    fail('SIM_MANIFEST_SURFACES', 'must be a non-empty sequence', 'renderer.surfaces');
  }
  const surfaceIds = new Set();
  let mainCount = 0;
  for (const [index, surface] of value.renderer.surfaces.entries()) {
    const fieldPath = `renderer.surfaces[${index}]`;
    assertExactKeys(surface, ['id', 'factory_surface', 'label', 'initial_route'], fieldPath);
    assertString(surface.id, `${fieldPath}.id`, { minBytes: 2, maxBytes: 64, pattern: MODULE_ID_PATTERN });
    if (surfaceIds.has(surface.id)) {
      fail('SIM_MANIFEST_DUPLICATE_SURFACE', `duplicate surface ${JSON.stringify(surface.id)}`, `${fieldPath}.id`);
    }
    surfaceIds.add(surface.id);
    if (surface.id === 'main') {
      mainCount += 1;
    }
    assertString(surface.factory_surface, `${fieldPath}.factory_surface`, { maxBytes: 128, pattern: MODULE_ID_PATTERN });
    assertString(surface.label, `${fieldPath}.label`, { maxBytes: 128 });
    validateRoute(surface.initial_route, `${fieldPath}.initial_route`);
  }
  if (mainCount !== 1) {
    fail('SIM_MANIFEST_MAIN_SURFACE', 'exactly one surface must have id main', 'renderer.surfaces');
  }

  assertExactKeys(
    value.requires,
    ['kit_capabilities', 'sdk_methods', 'simulator_commands', 'simulator_events'],
    'requires',
  );
  validateCatalogIds(value.requires.kit_capabilities, 'requires.kit_capabilities');
  validateCatalogIds(value.requires.sdk_methods, 'requires.sdk_methods');
  validateCommandEventIds(value.requires.simulator_commands, 'requires.simulator_commands', moduleId);
  validateCommandEventIds(value.requires.simulator_events, 'requires.simulator_events', moduleId);

  assertExactKeys(value.fixtures, ['conformance'], 'fixtures');
  assertSimulatorSourcePath(value.fixtures.conformance, 'fixtures.conformance');
  if (!value.fixtures.conformance.startsWith('src/simulator/')) {
    fail('SIM_MANIFEST_FIXTURE_LOCATION', 'conformance fixture must be under src/simulator/', 'fixtures.conformance');
  }

  return Object.freeze(value);
}

export function parseSimulatorManifest(text, options = {}) {
  const label = options.label || SIMULATOR_MANIFEST_PATH;
  return validateSimulatorManifest(parseStrictYaml(text, label));
}

export const simulatorManifestInternals = Object.freeze({
  parseStrictYaml,
});
