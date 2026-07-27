import ts from 'typescript';
import {
  SIMULATOR_MODULE_PROTOCOL,
  SimulatorConformanceError,
} from './simulator-manifest.mjs';

function fail(code, message, fieldPath = '') {
  throw new SimulatorConformanceError(code, message, fieldPath);
}

function propertyNameText(name) {
  if (!name) return '';
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return String(name.text);
  }
  return '';
}

function findExportedVariable(source, exportName) {
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const modifiers = ts.getModifiers(statement) || [];
    if (!modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === exportName) {
        return declaration.initializer || null;
      }
    }
  }
  return null;
}

function unwrapExpression(node) {
  let current = node;
  while (
    current
    && (ts.isAsExpression(current)
      || ts.isSatisfiesExpression(current)
      || ts.isParenthesizedExpression(current)
      || ts.isTypeAssertionExpression(current))
  ) {
    current = current.expression;
  }
  return current;
}

function objectLiteral(node) {
  let expression = unwrapExpression(node);
  if (expression
    && ts.isCallExpression(expression)
    && ts.isPropertyAccessExpression(expression.expression)
    && expression.expression.expression.getText() === 'Object'
    && expression.expression.name.text === 'freeze'
    && expression.arguments.length === 1) {
    expression = unwrapExpression(expression.arguments[0]);
  }
  return expression && ts.isObjectLiteralExpression(expression) ? expression : null;
}

function objectProperties(node) {
  const expression = objectLiteral(node);
  if (!expression) return new Map();
  const result = new Map();
  for (const [index, property] of expression.properties.entries()) {
    if (ts.isPropertyAssignment(property)
      || ts.isMethodDeclaration(property)
      || ts.isShorthandPropertyAssignment(property)) {
      const name = propertyNameText(property.name);
      if (name && !result.has(name)) {
        result.set(name, property);
        continue;
      }
    }
    // Exact metadata objects must not hide spread, computed, duplicate, accessor,
    // or otherwise ambiguous members behind the recognized field set.
    result.set(Symbol(`ambiguous-object-member-${index}`), property);
  }
  return result;
}

function assertExactPropertySet(properties, expected, code, message, fieldPath) {
  const exact = new Set(expected);
  if (properties.size !== exact.size || [...properties.keys()].some((key) => !exact.has(key))) {
    fail(code, message, fieldPath);
  }
}

function literalPropertyValue(property) {
  if (!property || !ts.isPropertyAssignment(property)) return null;
  const initializer = unwrapExpression(property.initializer);
  return initializer && ts.isStringLiteral(initializer) ? initializer.text : null;
}

function isFunctionPropertyAssignment(property) {
  if (!ts.isPropertyAssignment(property)) return false;
  const initializer = unwrapExpression(property.initializer);
  return Boolean(initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)));
}

function functionPropertyNode(property) {
  if (ts.isMethodDeclaration(property)) {
    return property;
  }
  if (isFunctionPropertyAssignment(property)) return unwrapExpression(property.initializer);
  return null;
}

function assertSynchronousFunction(property, code, label, fieldPath) {
  const functionNode = functionPropertyNode(property);
  const modifiers = functionNode && ts.canHaveModifiers(functionNode) ? ts.getModifiers(functionNode) || [] : [];
  if (!functionNode
    || modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)
    || functionNode.asteriskToken) {
    fail(code, `${label} must be a synchronous non-generator function`, fieldPath);
  }
  return functionNode;
}

function isConditionalReturnExpression(expression) {
  return ts.isConditionalExpression(expression)
    || (ts.isBinaryExpression(expression)
      && [
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.QuestionQuestionToken,
      ].includes(expression.operatorToken.kind))
    || Boolean(expression.questionDotToken);
}

function directReturnExpression(property, code, label, fieldPath) {
  const functionNode = assertSynchronousFunction(property, code, label, fieldPath);
  const body = functionNode.body;
  if (!body) fail(code, `${label} must have an implementation body`, fieldPath);
  if (!ts.isBlock(body)) {
    const expression = unwrapExpression(body);
    if (!expression || isConditionalReturnExpression(expression)) {
      fail(code, `${label} must have one unconditional return expression`, fieldPath);
    }
    return expression;
  }
  const returns = [];
  const visit = (node) => {
    if (node !== body
      && (ts.isFunctionDeclaration(node)
        || ts.isFunctionExpression(node)
        || ts.isArrowFunction(node)
        || ts.isMethodDeclaration(node)
        || ts.isGetAccessorDeclaration(node)
        || ts.isSetAccessorDeclaration(node))) return;
    if (ts.isReturnStatement(node)) returns.push(node);
    ts.forEachChild(node, visit);
  };
  visit(body);
  const directReturns = body.statements.filter(ts.isReturnStatement);
  if (returns.length !== 1
    || directReturns.length !== 1
    || returns[0] !== directReturns[0]
    || !directReturns[0].expression) {
    fail(code, `${label} must have exactly one direct unconditional return`, fieldPath);
  }
  const expression = unwrapExpression(directReturns[0].expression);
  if (!expression || isConditionalReturnExpression(expression)) {
    fail(code, `${label} must have one unconditional return expression`, fieldPath);
  }
  return expression;
}

function literalJson(node, fieldPath, depth = 0) {
  if (depth > 32) fail('SIM_FIXTURE_LITERAL_DEPTH', 'fixture literal exceeds maximum depth', fieldPath);
  const expression = unwrapExpression(node);
  if (!expression) fail('SIM_FIXTURE_LITERAL', 'fixture value must be a static JSON literal', fieldPath);
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text;
  if (ts.isNumericLiteral(expression)) return Number(expression.text);
  if (expression.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (expression.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isPrefixUnaryExpression(expression)
    && expression.operator === ts.SyntaxKind.MinusToken
    && ts.isNumericLiteral(expression.operand)) {
    return -Number(expression.operand.text);
  }
  if (ts.isArrayLiteralExpression(expression)) {
    return expression.elements.map((entry, index) => literalJson(entry, `${fieldPath}[${index}]`, depth + 1));
  }
  const objectExpression = objectLiteral(expression);
  if (objectExpression) {
    const result = {};
    for (const property of objectExpression.properties) {
      const key = propertyNameText(property.name);
      if (!ts.isPropertyAssignment(property) || !key || Object.hasOwn(result, key)) {
        fail('SIM_FIXTURE_LITERAL', 'fixture objects require unique explicit property assignments', fieldPath);
      }
      result[key] = literalJson(property.initializer, `${fieldPath}.${key}`, depth + 1);
    }
    return result;
  }
  fail('SIM_FIXTURE_LITERAL', 'fixture value must be a static JSON literal', fieldPath);
}

function assertFixtureRecord(value, fieldPath, expectedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('SIM_FIXTURE_SHAPE', 'must be an object', fieldPath);
  }
  const keys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    fail('SIM_FIXTURE_FIELDS', `must expose exactly ${expected.join(', ')}`, fieldPath);
  }
}

function assertFiniteInteger(value, fieldPath, { minimum = 0 } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    fail('SIM_FIXTURE_SCHEMA', `must be a safe integer >= ${minimum}`, fieldPath);
  }
}

function assertSimulatorSchema(value, fieldPath, depth = 0) {
  if (depth > 24) fail('SIM_FIXTURE_SCHEMA', 'schema exceeds maximum depth', fieldPath);
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.kind !== 'string') {
    fail('SIM_FIXTURE_SCHEMA', 'must be a Simulator schema object', fieldPath);
  }
  const exact = (keys) => assertFixtureRecord(value, fieldPath, keys);
  if (value.kind === 'null' || value.kind === 'boolean' || value.kind === 'number' || value.kind === 'json') {
    exact(['kind']);
    return;
  }
  if (value.kind === 'integer') {
    const keys = ['kind'];
    if (Object.hasOwn(value, 'minimum')) {
      assertFiniteInteger(value.minimum, `${fieldPath}.minimum`, { minimum: Number.MIN_SAFE_INTEGER });
      keys.push('minimum');
    }
    if (Object.hasOwn(value, 'maximum')) {
      assertFiniteInteger(value.maximum, `${fieldPath}.maximum`, { minimum: Number.MIN_SAFE_INTEGER });
      keys.push('maximum');
    }
    exact(keys);
    if (value.minimum !== undefined && value.maximum !== undefined && value.minimum > value.maximum) {
      fail('SIM_FIXTURE_SCHEMA', 'minimum cannot exceed maximum', fieldPath);
    }
    return;
  }
  if (value.kind === 'string') {
    const keys = ['kind'];
    for (const name of ['minLength', 'maxLength']) {
      if (Object.hasOwn(value, name)) {
        assertFiniteInteger(value[name], `${fieldPath}.${name}`);
        keys.push(name);
      }
    }
    exact(keys);
    if (value.minLength !== undefined && value.maxLength !== undefined && value.minLength > value.maxLength) {
      fail('SIM_FIXTURE_SCHEMA', 'minLength cannot exceed maxLength', fieldPath);
    }
    return;
  }
  if (value.kind === 'stringEnum') {
    exact(['kind', 'values']);
    if (!Array.isArray(value.values) || value.values.length === 0
      || value.values.some((entry) => typeof entry !== 'string')
      || new Set(value.values).size !== value.values.length) {
      fail('SIM_FIXTURE_SCHEMA', 'stringEnum values must be non-empty unique strings', `${fieldPath}.values`);
    }
    return;
  }
  if (value.kind === 'array') {
    const keys = ['items', 'kind'];
    for (const name of ['minItems', 'maxItems']) {
      if (Object.hasOwn(value, name)) {
        assertFiniteInteger(value[name], `${fieldPath}.${name}`);
        keys.push(name);
      }
    }
    exact(keys);
    assertSimulatorSchema(value.items, `${fieldPath}.items`, depth + 1);
    if (value.minItems !== undefined && value.maxItems !== undefined && value.minItems > value.maxItems) {
      fail('SIM_FIXTURE_SCHEMA', 'minItems cannot exceed maxItems', fieldPath);
    }
    return;
  }
  if (value.kind === 'object') {
    const keys = ['kind', 'properties'];
    if (Object.hasOwn(value, 'required')) keys.push('required');
    exact(keys);
    if (!value.properties || typeof value.properties !== 'object' || Array.isArray(value.properties)) {
      fail('SIM_FIXTURE_SCHEMA', 'object properties must be a mapping', `${fieldPath}.properties`);
    }
    for (const [key, schema] of Object.entries(value.properties)) {
      if (!key) fail('SIM_FIXTURE_SCHEMA', 'property names must be non-empty', `${fieldPath}.properties`);
      assertSimulatorSchema(schema, `${fieldPath}.properties.${key}`, depth + 1);
    }
    if (value.required !== undefined) {
      if (!Array.isArray(value.required)
        || value.required.some((entry) => typeof entry !== 'string' || !Object.hasOwn(value.properties, entry))
        || new Set(value.required).size !== value.required.length) {
        fail('SIM_FIXTURE_SCHEMA', 'required must contain unique declared property names', `${fieldPath}.required`);
      }
    }
    return;
  }
  if (value.kind === 'union') {
    exact(['kind', 'variants']);
    if (!Array.isArray(value.variants) || value.variants.length === 0) {
      fail('SIM_FIXTURE_SCHEMA', 'union variants must be non-empty', `${fieldPath}.variants`);
    }
    value.variants.forEach((variant, index) => assertSimulatorSchema(variant, `${fieldPath}.variants[${index}]`, depth + 1));
    return;
  }
  fail('SIM_FIXTURE_SCHEMA', `unknown schema kind ${JSON.stringify(value.kind)}`, `${fieldPath}.kind`);
}

function assertExactStringSet(actual, expected, code, fieldPath) {
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) {
    fail(code, 'must be a mapping', fieldPath);
  }
  const left = Object.keys(actual).sort();
  const right = [...expected].sort();
  if (left.length !== right.length || left.some((entry, index) => entry !== right[index])) {
    fail(code, `must match Manifest set ${JSON.stringify(right)}`, fieldPath);
  }
}

export function extractConformanceFixture(source, manifest) {
  const initializer = findExportedVariable(source, 'simulatorConformanceFixture');
  if (!initializer) {
    fail('SIM_FIXTURE_EXPORT', 'fixture must export simulatorConformanceFixture as a static object', manifest.fixtures.conformance);
  }
  const fixture = literalJson(initializer, 'simulatorConformanceFixture');
  assertFixtureRecord(fixture, 'simulatorConformanceFixture', ['protocol', 'moduleId', 'catalog', 'lifecycle']);
  if (fixture.protocol !== SIMULATOR_MODULE_PROTOCOL || fixture.moduleId !== manifest.module_id) {
    fail('SIM_FIXTURE_IDENTITY', 'fixture protocol/moduleId must match the Manifest', manifest.fixtures.conformance);
  }
  assertFixtureRecord(fixture.catalog, 'simulatorConformanceFixture.catalog', ['commandSchemas', 'eventSchemas', 'moduleData']);
  assertExactStringSet(
    fixture.catalog.commandSchemas,
    manifest.requires.simulator_commands,
    'SIM_FIXTURE_COMMAND_SCHEMAS',
    'simulatorConformanceFixture.catalog.commandSchemas',
  );
  assertExactStringSet(
    fixture.catalog.eventSchemas,
    manifest.requires.simulator_events,
    'SIM_FIXTURE_EVENT_SCHEMAS',
    'simulatorConformanceFixture.catalog.eventSchemas',
  );
  for (const [type, schema] of Object.entries(fixture.catalog.commandSchemas)) {
    assertSimulatorSchema(schema, `simulatorConformanceFixture.catalog.commandSchemas.${type}`);
  }
  for (const [type, schema] of Object.entries(fixture.catalog.eventSchemas)) {
    assertSimulatorSchema(schema, `simulatorConformanceFixture.catalog.eventSchemas.${type}`);
  }
  if (JSON.stringify(fixture.lifecycle) !== JSON.stringify(['prepare', 'activate', 'deactivate', 'dispose'])) {
    fail('SIM_FIXTURE_LIFECYCLE', 'lifecycle must declare prepare, activate, deactivate, dispose in order', 'simulatorConformanceFixture.lifecycle');
  }
  return Object.freeze(fixture);
}

export function assertRendererMetadata(source, manifest) {
  const initializer = findExportedVariable(source, manifest.renderer.export);
  if (!initializer) {
    fail(
      'SIM_RENDERER_EXPORT',
      `renderer export ${JSON.stringify(manifest.renderer.export)} must be an exported object`,
      'renderer.export',
    );
  }
  const properties = objectProperties(initializer);
  assertExactPropertySet(
    properties,
    ['protocol', 'moduleId', 'factory'],
    'SIM_RENDERER_FIELDS',
    'renderer metadata must expose exactly protocol, moduleId, and factory',
    manifest.renderer.entry,
  );
  if (literalPropertyValue(properties.get('protocol')) !== SIMULATOR_MODULE_PROTOCOL) {
    fail(
      'SIM_RENDERER_PROTOCOL',
      `renderer protocol must equal ${SIMULATOR_MODULE_PROTOCOL}`,
      manifest.renderer.entry,
    );
  }
  if (literalPropertyValue(properties.get('moduleId')) !== manifest.module_id) {
    fail('SIM_RENDERER_MODULE_ID', 'renderer moduleId must equal Manifest module_id', manifest.renderer.entry);
  }
  const factoryProperty = properties.get('factory');
  if (!factoryProperty || !ts.isPropertyAssignment(factoryProperty)) {
    fail('SIM_RENDERER_FACTORY', 'renderer factory field must bind the canonical factory export', manifest.renderer.entry);
  }
  const factoryExpression = unwrapExpression(factoryProperty.initializer);
  if (!factoryExpression
    || !ts.isIdentifier(factoryExpression)
    || factoryExpression.text !== manifest.composition.factory_export) {
    fail(
      'SIM_RENDERER_FACTORY',
      `renderer factory must bind ${JSON.stringify(manifest.composition.factory_export)}`,
      manifest.renderer.entry,
    );
  }
}

export function assertCanonicalFactoryMetadata(source, manifest) {
  const initializer = findExportedVariable(source, manifest.composition.factory_export);
  if (!initializer) {
    fail(
      'SIM_FACTORY_EXPORT',
      `canonical factory export ${JSON.stringify(manifest.composition.factory_export)} must be an exported object`,
      'composition.factory_export',
    );
  }
  const properties = objectProperties(initializer);
  assertExactPropertySet(
    properties,
    ['factoryId', 'createInstance'],
    'SIM_FACTORY_FIELDS',
    'canonical factory must expose exactly factoryId and createInstance',
    manifest.composition.factory_entry,
  );
  const factoryId = literalPropertyValue(properties.get('factoryId'));
  if (!factoryId || factoryId !== factoryId.trim()) {
    fail(
      'SIM_FACTORY_ID',
      'canonical factoryId must be a non-empty exact string literal',
      manifest.composition.factory_entry,
    );
  }
  const createInstance = properties.get('createInstance');
  if (!createInstance
    || (!ts.isMethodDeclaration(createInstance)
      && !isFunctionPropertyAssignment(createInstance))) {
    fail(
      'SIM_FACTORY_CREATE_INSTANCE',
      'canonical factory must define createInstance directly',
      manifest.composition.factory_entry,
    );
  }
  directReturnExpression(
    createInstance,
    'SIM_FACTORY_CREATE_INSTANCE_CONTROL_FLOW',
    'canonical createInstance',
    manifest.composition.factory_entry,
  );
}

export function assertAdapterMetadata(source, manifest) {
  const initializer = findExportedVariable(source, manifest.renderer.adapter_export);
  if (!initializer) {
    fail(
      'SIM_ADAPTER_EXPORT',
      `Adapter export ${JSON.stringify(manifest.renderer.adapter_export)} must be an exported object`,
      'renderer.adapter_export',
    );
  }
  const properties = objectProperties(initializer);
  assertExactPropertySet(
    properties,
    ['protocol', 'moduleId', 'behavior', 'create'],
    'SIM_ADAPTER_FIELDS',
    'Adapter factory must expose exactly protocol, moduleId, behavior, and create',
    manifest.renderer.adapter_entry,
  );
  if (literalPropertyValue(properties.get('protocol')) !== SIMULATOR_MODULE_PROTOCOL) {
    fail(
      'SIM_ADAPTER_PROTOCOL',
      `Adapter protocol must equal ${SIMULATOR_MODULE_PROTOCOL}`,
      manifest.renderer.adapter_entry,
    );
  }
  if (literalPropertyValue(properties.get('moduleId')) !== manifest.module_id) {
    fail('SIM_ADAPTER_MODULE_ID', 'Adapter moduleId must equal Manifest module_id', manifest.renderer.adapter_entry);
  }
  const create = properties.get('create');
  if (!create || (!ts.isMethodDeclaration(create) && !isFunctionPropertyAssignment(create))) {
    fail('SIM_ADAPTER_CREATE', 'Adapter factory must define create directly', manifest.renderer.adapter_entry);
  }
  const instanceProperties = objectProperties(directReturnExpression(
    create,
    'SIM_ADAPTER_CREATE_CONTROL_FLOW',
    'Adapter create',
    manifest.renderer.adapter_entry,
  ));
  for (const required of ['prepare', 'activate', 'deactivate', 'dispose']) {
    const method = instanceProperties.get(required);
    if (!method || (!ts.isMethodDeclaration(method) && !isFunctionPropertyAssignment(method))) {
      fail(
        'SIM_ADAPTER_LIFECYCLE',
        `Adapter instance is missing lifecycle method ${JSON.stringify(required)}`,
        manifest.renderer.adapter_entry,
      );
    }
  }
  assertExactPropertySet(
    instanceProperties,
    ['prepare', 'activate', 'deactivate', 'dispose'],
    'SIM_ADAPTER_INSTANCE_FIELDS',
    'Adapter instance must expose exactly prepare, activate, deactivate, and dispose',
    manifest.renderer.adapter_entry,
  );
}
