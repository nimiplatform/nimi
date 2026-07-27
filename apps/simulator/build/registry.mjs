import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {
  validateSimulatorAppSource,
  assertSimulatorSourcePath,
  SimulatorConformanceError,
} from '@nimiplatform/app-tools/simulator-conformance';
import { materializeDescriptor } from './materialize.mjs';
import { resolveMandatorySingletons } from './resolver.mjs';
import { generateEffectCatalog } from './generate-effect-catalog.mjs';
import {
  assertScenarioMatchesQualified,
  runtimeScenarioProjection,
  scenarioWire,
} from './scenario-projection.mjs';

function fail(code, message, fieldPath = '') {
  throw new SimulatorConformanceError(code, message, fieldPath);
}

function ensureGeneratedRoot(simulatorRoot, generatedRoot) {
  const simulator = path.resolve(simulatorRoot);
  const generated = path.resolve(generatedRoot);
  const canonical = path.join(simulator, '.generated');
  const staged = path.dirname(generated) === simulator && path.basename(generated).startsWith('.generated-stage-');
  if (generated !== canonical && !staged) fail('SIM_GENERATED_ROOT', 'generated output must be canonical or a controlled sibling staging root');
  rmSync(generated, { recursive: true, force: true });
  mkdirSync(generated, { recursive: true });
}

function assertAppSourceResolverNeutral(source) {
  const sourcePaths = new Set(source.files.map((entry) => entry.path));
  for (const file of source.files) {
    const basename = path.posix.basename(file.path);
    if (['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb'].includes(basename)) {
      fail('SIM_APP_OWNED_LOCKFILE', `App-owned lockfile ${JSON.stringify(file.path)} is forbidden`);
    }
    if (basename !== 'package.json') continue;
    let packageJson;
    try {
      packageJson = JSON.parse(file.bytes.toString('utf8'));
    } catch (error) {
      fail('SIM_APP_PACKAGE_JSON', `invalid package.json: ${error instanceof Error ? error.message : String(error)}`, file.path);
    }
    if (Object.hasOwn(packageJson, 'imports')) fail('SIM_APP_OWNED_EXPORT_CONDITION', 'App-owned package imports/conditions are forbidden', file.path);
    if (Object.hasOwn(packageJson, 'exports')) {
      const exportsField = packageJson.exports;
      const entries = typeof exportsField === 'string'
        ? [['.', exportsField]]
        : exportsField && typeof exportsField === 'object' && !Array.isArray(exportsField)
          ? Object.entries(exportsField)
          : null;
      if (!entries
        || entries.length === 0
        || entries.some(([subpath, target]) =>
          (subpath !== '.' && (!subpath.startsWith('./') || subpath.includes('*')))
          || typeof target !== 'string')) {
        fail(
          'SIM_APP_OWNED_EXPORT_CONDITION',
          'App-owned exports must be an exact subpath-to-source string map without conditions, arrays, or wildcards',
          file.path,
        );
      }
      for (const [subpath, target] of entries) {
        if (!target.startsWith('./')) {
          fail('SIM_APP_OWNED_EXPORT_TARGET', `package export ${JSON.stringify(subpath)} must use a relative source target`, file.path);
        }
        const relativeTarget = target.slice(2);
        try {
          assertSimulatorSourcePath(relativeTarget, `package.json.exports.${subpath}`);
        } catch {
          fail('SIM_APP_OWNED_EXPORT_TARGET', `package export ${JSON.stringify(subpath)} has an invalid source target`, file.path);
        }
        if (!sourcePaths.has(relativeTarget)) {
          fail('SIM_APP_OWNED_EXPORT_TARGET', `package export ${JSON.stringify(subpath)} target is absent from the selected source`, file.path);
        }
      }
    }
    if (Object.hasOwn(packageJson, 'overrides') || Object.hasOwn(packageJson, 'resolutions') || packageJson.pnpm?.overrides) {
      fail('SIM_APP_OWNED_OVERRIDE', 'App-owned package overrides are forbidden', file.path);
    }
  }
}

function trySourceModule(candidate) {
  const extension = path.extname(candidate);
  const sourceExtensions = extension === '.js' || extension === '.jsx'
    ? ['.ts', '.tsx']
    : extension === '.mjs'
      ? ['.mts']
      : extension === '.cjs'
        ? ['.cts']
        : [];
  const attempts = extension
    ? [candidate, ...sourceExtensions.map((sourceExtension) => `${candidate.slice(0, -extension.length)}${sourceExtension}`)]
    : [
        candidate,
        ...['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.css'].map((extension) => `${candidate}${extension}`),
        ...['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.css'].map((extension) => path.join(candidate, `index${extension}`)),
      ];
  for (const attempt of attempts) {
    try {
      readFileSync(attempt);
      return attempt;
    } catch {
      // Continue through the closed source extension list.
    }
  }
  return null;
}

function sourceImports(filePath) {
  if (filePath.endsWith('.css')) {
    const text = readFileSync(filePath, 'utf8');
    return [...text.matchAll(/@import\s+(?:url\(\s*)?['"]([^'"]+)['"]/g)].map((match) => match[1]);
  }
  const text = readFileSync(filePath, 'utf8');
  const source = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, /\.[cm]?tsx?$/.test(filePath) ? ts.ScriptKind.TSX : ts.ScriptKind.JS);
  if (source.parseDiagnostics.length > 0) fail('SIM_HOST_SOURCE_PARSE', 'host invocation source cannot be parsed', filePath);
  const imports = [];
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      if (ts.isExportDeclaration(node) && node.isTypeOnly) return;
      if (ts.isImportDeclaration(node) && node.importClause) {
        if (node.importClause.isTypeOnly) return;
        const bindings = node.importClause.namedBindings;
        if (!node.importClause.name
          && bindings
          && ts.isNamedImports(bindings)
          && bindings.elements.length > 0
          && bindings.elements.every((entry) => entry.isTypeOnly)) return;
      }
      imports.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1
      && ts.isStringLiteral(node.arguments[0])
    ) {
      imports.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return imports;
}

function runtimeFactoryBindingUsed(filePath, packageSpecifier, factoryExport) {
  const text = readFileSync(filePath, 'utf8');
  const source = ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    /\.[cm]?tsx?$/u.test(filePath) ? ts.ScriptKind.TSX : ts.ScriptKind.JS,
  );
  const direct = new Set();
  const namespaces = new Set();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)
      || !ts.isStringLiteral(statement.moduleSpecifier)
      || statement.moduleSpecifier.text !== packageSpecifier
      || !statement.importClause
      || statement.importClause.isTypeOnly) continue;
    const bindings = statement.importClause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
    } else if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if (element.isTypeOnly) continue;
        if ((element.propertyName?.text ?? element.name.text) === factoryExport) direct.add(element.name.text);
      }
    }
  }
  let used = false;
  const visit = (node, inType = false) => {
    const nextInType = inType || ts.isTypeNode(node);
    if (!nextInType && ts.isIdentifier(node) && (direct.has(node.text) || namespaces.has(node.text))) {
      const parent = node.parent;
      const importBinding = (ts.isImportSpecifier(parent) && parent.name === node)
        || (ts.isNamespaceImport(parent) && parent.name === node);
      const shadow = (ts.isVariableDeclaration(parent) && parent.name === node)
        || (ts.isParameter(parent) && parent.name === node)
        || (ts.isBindingElement(parent) && parent.name === node)
        || ((ts.isFunctionDeclaration(parent) || ts.isClassDeclaration(parent)) && parent.name === node);
      if (!importBinding && shadow) {
        fail('SIM_HOST_FACTORY_BINDING_SHADOWED', 'cross-source canonical factory binding cannot be shadowed', filePath);
      }
    }
    if (!nextInType && ts.isIdentifier(node) && direct.has(node.text)) {
      const parent = node.parent;
      const declaration = (ts.isImportSpecifier(parent) && parent.name === node)
        || (ts.isVariableDeclaration(parent) && parent.name === node)
        || (ts.isParameter(parent) && parent.name === node)
        || (ts.isBindingElement(parent) && parent.name === node);
      const propertyName = ts.isPropertyAccessExpression(parent) && parent.name === node;
      if (!declaration && !propertyName) used = true;
    }
    if (!nextInType
      && ts.isPropertyAccessExpression(node)
      && ts.isIdentifier(node.expression)
      && namespaces.has(node.expression.text)
      && node.name.text === factoryExport) used = true;
    ts.forEachChild(node, (child) => visit(child, nextInType));
  };
  visit(source);
  return used;
}

function selectPackageExport(value, conditions = ['browser', 'import', 'default']) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const selected = selectPackageExport(entry, conditions);
      if (selected) return selected;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  for (const condition of conditions) {
    if (Object.hasOwn(value, condition)) {
      const selected = selectPackageExport(value[condition], conditions);
      if (selected) return selected;
    }
  }
  return null;
}

function packageExportTarget(packageJson, specifier) {
  const packageName = packageJson.name;
  if (specifier !== packageName && !specifier.startsWith(`${packageName}/`)) return null;
  const subpath = specifier === packageName ? '.' : `./${specifier.slice(packageName.length + 1)}`;
  const exportsField = packageJson.exports;
  if (!exportsField) return null;
  let entry;
  if (typeof exportsField === 'string' || Array.isArray(exportsField)) entry = subpath === '.' ? exportsField : null;
  else if (Object.keys(exportsField).some((key) => key.startsWith('.'))) entry = exportsField[subpath];
  else entry = subpath === '.' ? exportsField : null;
  const target = selectPackageExport(entry);
  if (!target || !target.startsWith('./')) return null;
  return target.slice(2);
}

function assertCrossSourceHostGraph(descriptor, materialized, manifest, host, location, appLocation) {
  let packageJson;
  try {
    packageJson = JSON.parse(readFileSync(path.join(appLocation.targetRoot, 'package.json'), 'utf8'));
  } catch {
    fail('SIM_HOST_APP_PACKAGE_EXPORT', 'cross-source host proof requires an App package.json with canonical source exports', host.id);
  }
  if (typeof packageJson.name !== 'string' || !packageJson.name) {
    fail('SIM_HOST_APP_PACKAGE_EXPORT', 'App package.json must declare its package name', host.id);
  }
  const entryPath = path.resolve(location.targetRoot, ...host.entry.split('/'));
  const queue = [entryPath];
  const seen = new Set();
  let factoryReached = false;
  let factoryUsed = false;
  let styleReached = false;
  while (queue.length > 0) {
    const current = queue.shift();
    if (seen.has(current)) continue;
    seen.add(current);
    for (const specifier of sourceImports(current)) {
      if (specifier.startsWith('.')) {
        const resolved = trySourceModule(path.resolve(path.dirname(current), specifier));
        if (!resolved || !resolved.startsWith(`${path.resolve(location.targetRoot)}${path.sep}`)) {
          fail('SIM_HOST_IMPORT_ESCAPE', `host import ${JSON.stringify(specifier)} is unresolved or escapes its selected source`, host.id);
        }
        queue.push(resolved);
        continue;
      }
      const target = packageExportTarget(packageJson, specifier);
      if (target === manifest.composition.factory_entry) {
        factoryReached = true;
        factoryUsed = factoryUsed || runtimeFactoryBindingUsed(
          current,
          specifier,
          manifest.composition.factory_export,
        );
      }
      if (target === manifest.composition.style_entry) styleReached = true;
      if (specifier.startsWith(packageJson.name) && !target) {
        fail('SIM_HOST_APP_PACKAGE_EXPORT', `host import ${JSON.stringify(specifier)} is not an exact App package export`, host.id);
      }
    }
  }
  if (!factoryReached || !factoryUsed || !styleReached) {
    fail(
      'SIM_HOST_CANONICAL_GRAPH',
      `cross-source host invocation must use the exact factory runtime binding and reach the exact style export (factory=${factoryReached}, factoryUse=${factoryUsed}, style=${styleReached})`,
      host.id,
    );
  }
}

function assertHostInventoryMaterialized(descriptor, materialized, manifest = null) {
  const byId = new Map(materialized.sourceLocations.map((entry) => [entry.sourceId, entry]));
  const appLocation = byId.get('app');
  for (const host of descriptor.host_invocations.entries) {
    const location = byId.get(host.source_id);
    if (!location) fail('SIM_HOST_SOURCE_MISSING', `host invocation ${JSON.stringify(host.id)} has no materialized source`);
    const absolute = path.resolve(location.targetRoot, ...host.entry.split('/'));
    if (!absolute.startsWith(`${path.resolve(location.targetRoot)}${path.sep}`)) {
      fail('SIM_HOST_PATH_ESCAPE', `host invocation ${JSON.stringify(host.id)} escapes its source location`);
    }
    try {
      if (!readFileSync(absolute)) fail('SIM_HOST_ENTRY_MISSING', `host invocation entry ${JSON.stringify(host.entry)} is missing`);
    } catch {
      fail('SIM_HOST_ENTRY_MISSING', `host invocation entry ${JSON.stringify(host.entry)} is missing`);
    }
    if (manifest && host.source_id !== 'app') {
      assertCrossSourceHostGraph(descriptor, materialized, manifest, host, location, appLocation);
    }
  }
}

function sourceBuildPath(moduleId, sourceId, relativePath = '') {
  return `source/${moduleId}/${sourceId}/${relativePath}`;
}

const SOURCE_RESOLUTION_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.d.ts', '.js', '.jsx', '.mjs', '.cjs', '.css', '.json', '.png'];

function importedRelativeSpecifiers(source, filePath) {
  const scriptKind = filePath.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const parsed = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, scriptKind);
  const specifiers = [];
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier
      && ts.isStringLiteral(node.moduleSpecifier)
      && node.moduleSpecifier.text.startsWith('.')) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1
      && (ts.isStringLiteral(node.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(node.arguments[0]))
      && node.arguments[0].text.startsWith('.')) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return specifiers;
}

function resolveSelectedRelativeImport(sourceFiles, importerPath, specifier) {
  const candidate = path.posix.normalize(path.posix.join(path.posix.dirname(importerPath), specifier));
  if (candidate.startsWith('../') || path.posix.isAbsolute(candidate)) return null;
  const extension = path.posix.extname(candidate);
  const attempts = [candidate];
  if (!extension) {
    attempts.push(...SOURCE_RESOLUTION_EXTENSIONS.map((suffix) => `${candidate}${suffix}`));
    attempts.push(...SOURCE_RESOLUTION_EXTENSIONS.map((suffix) => `${candidate}/index${suffix}`));
  } else if (extension === '.js' || extension === '.jsx') {
    const stem = candidate.slice(0, -extension.length);
    attempts.push(`${stem}.ts`, `${stem}.tsx`);
  } else if (extension === '.mjs') {
    attempts.push(`${candidate.slice(0, -extension.length)}.mts`);
  } else if (extension === '.cjs') {
    attempts.push(`${candidate.slice(0, -extension.length)}.cts`);
  }
  return attempts.find((attempt) => sourceFiles.has(attempt)) ?? null;
}

function addRelativeImportClosure(retainedPaths, conformance) {
  const sourceFiles = new Map(conformance.source.files.map((file) => [file.path, file]));
  const queue = [...retainedPaths];
  const visited = new Set();
  while (queue.length > 0) {
    const filePath = queue.shift();
    if (visited.has(filePath)) continue;
    visited.add(filePath);
    const file = sourceFiles.get(filePath);
    if (!file || !/\.[cm]?[jt]sx?$/u.test(filePath)) continue;
    for (const specifier of importedRelativeSpecifiers(file.bytes.toString('utf8'), filePath)) {
      const resolved = resolveSelectedRelativeImport(sourceFiles, filePath, specifier);
      if (!resolved) {
        fail('SIM_RUNTIME_SOURCE_IMPORT', `cannot retain relative import ${JSON.stringify(specifier)}`, filePath);
      }
      if (!retainedPaths.has(resolved)) {
        retainedPaths.add(resolved);
        queue.push(resolved);
      }
    }
  }
}

function retainRuntimeSourceClosure(materialized, conformance) {
  const appLocation = materialized.sourceLocations.find((entry) => entry.sourceId === 'app');
  if (!appLocation) fail('SIM_APP_SOURCE_MISSING', 'materialized descriptor has no app source');
  const appRoot = path.resolve(appLocation.targetRoot);
  const retainedPaths = new Set(
    [...conformance.graph.nodes.keys()].map((absolutePath) => (
      path.relative(appRoot, absolutePath).split(path.sep).join('/')
    )),
  );
  const addStyleInputs = (rows) => {
    for (const row of rows ?? []) retainedPaths.add(row.path);
  };
  addStyleInputs(conformance.style.inputs);
  addStyleInputs(conformance.style.profile?.composition?.inputs);
  addStyleInputs(conformance.style.profile?.style?.inputs);
  addStyleInputs(conformance.style.production?.hostFoundationInputs);
  addRelativeImportClosure(retainedPaths, conformance);

  const selectedFiles = new Map(appLocation.files.map((file) => [file.path, file]));
  for (const retainedPath of retainedPaths) {
    if (!selectedFiles.has(retainedPath)) {
      fail('SIM_RUNTIME_SOURCE_CLOSURE', 'validated runtime source is absent from selected materialization', retainedPath);
    }
  }
  for (const location of materialized.sourceLocations) {
    if (location.sourceId !== 'app') {
      rmSync(location.targetRoot, { recursive: true, force: true });
      continue;
    }
    for (const file of location.files) {
      if (retainedPaths.has(file.path)) continue;
      const absolute = path.resolve(appRoot, ...file.path.split('/'));
      if (!absolute.startsWith(`${appRoot}${path.sep}`)) {
        fail('SIM_RUNTIME_SOURCE_CLOSURE', 'selected source path escapes its materialized root', file.path);
      }
      rmSync(absolute, { force: true });
    }
  }
}

function buildResolvedRow(descriptor, validation, orderingKey) {
  const { manifest } = validation;
  return Object.freeze({
    moduleId: descriptor.module_id,
    orderingKey,
    rendererExport: manifest.renderer.export,
    adapterExport: manifest.renderer.adapter_export,
    surfaces: manifest.renderer.surfaces.map((surface) => ({
      id: surface.id,
      factorySurface: surface.factory_surface,
      label: surface.label,
      initialRoute: surface.initial_route,
      readinessContractId: surface.readiness_contract,
      lazyImportId: `virtual:nimi-simulator/${descriptor.module_id}/renderer`,
    })),
    requirements: {
      kitCapabilities: [...manifest.requires.kit_capabilities],
      sdkMethods: [...manifest.requires.sdk_methods],
      commands: [...manifest.requires.simulator_commands],
      events: [...manifest.requires.simulator_events],
    },
  });
}

function assertRootIndependent(value, repoRoot) {
  const text = JSON.stringify(value);
  if (text.includes(path.resolve(repoRoot)) || /"\/(?:Users|home)\//u.test(text)) {
    fail('SIM_REGISTRY_ABSOLUTE_PATH', 'generated registry contains a host-absolute path');
  }
}

function buildStaticModuleCatalog(validation, orderingKey) {
  return Object.freeze({
    moduleId: validation.manifest.module_id,
    orderingKey,
    commandSchemas: validation.fixture.catalog.commandSchemas,
    eventSchemas: validation.fixture.catalog.eventSchemas,
    queries: {},
    selectSharedProjection: null,
  });
}

function buildReadinessDeclarations(qualified) {
  const declarations = {};
  for (const { descriptor, validation } of qualified) {
    for (const declaration of validation.fixture.readiness) {
      const key = `${descriptor.module_id}/${declaration.surfaceId}`;
      if (Object.hasOwn(declarations, key)) {
        fail('SIM_READINESS_DECLARATION_DUPLICATE', `duplicate readiness declaration ${JSON.stringify(key)}`);
      }
      declarations[key] = declaration;
    }
  }
  return Object.freeze(declarations);
}
export function generateRegistryFiles({
  generatedRoot,
  repoRoot,
  rows,
  buildMap,
  resolver,
  styleInputs,
  moduleCatalogs,
  readinessDeclarations,
  scenario,
}) {
  const registry = {
    modules: rows,
    moduleCount: rows.length,
  };
  assertRootIndependent(registry, repoRoot);
  assertRootIndependent(buildMap, repoRoot);
  assertRootIndependent(resolver, repoRoot);
  assertRootIndependent(styleInputs, repoRoot);
  assertRootIndependent(moduleCatalogs, repoRoot);
  assertRootIndependent(readinessDeclarations, repoRoot);
  assertRootIndependent(scenarioWire(scenario), repoRoot);
  mkdirSync(path.join(generatedRoot, 'style-inputs'), { recursive: true });
  writeFileSync(path.join(generatedRoot, 'build-map.json'), `${JSON.stringify(buildMap, null, 2)}\n`);
  writeFileSync(path.join(generatedRoot, 'resolver.json'), `${JSON.stringify(resolver, null, 2)}\n`);
  for (const [moduleId, input] of Object.entries(styleInputs)) {
    writeFileSync(path.join(generatedRoot, 'style-inputs', `${moduleId}.json`), `${JSON.stringify(input, null, 2)}\n`);
  }
  const generatedRows = rows.map((row) => {
    const metadata = JSON.stringify({
      moduleId: row.moduleId,
      orderingKey: row.orderingKey,
      surfaces: row.surfaces,
      requirements: row.requirements,
    });
    const rendererId = JSON.stringify(`virtual:nimi-simulator/${row.moduleId}/renderer`);
    const adapterId = JSON.stringify(`virtual:nimi-simulator/${row.moduleId}/adapter`);
    const rendererExport = JSON.stringify(row.rendererExport);
    const adapterExport = JSON.stringify(row.adapterExport);
    return `  { metadata: ${metadata}, loadRenderer: () => import(${rendererId}).then((module) => (module as unknown as Record<string, unknown>)[${rendererExport}]), loadAdapter: () => import(${adapterId}).then((module) => (module as unknown as Record<string, unknown>)[${adapterExport}]), loadStyle: () => import(${JSON.stringify(`virtual:nimi-simulator/${row.moduleId}/style`)}) },`;
  });
  const typescript = [
    '// Generated by apps/simulator/build/registry.mjs. Do not edit.',
    'export const simulatorResolvedModules = [',
    ...generatedRows,
    '] as const;',
    '',
  ].join('\n');
  writeFileSync(path.join(generatedRoot, 'registry.ts'), typescript);
  const runtimeCatalogs = [
    '// Generated by apps/simulator/build/registry.mjs. Do not edit.',
    `export const simulatorResolvedModuleCatalogs = ${JSON.stringify(moduleCatalogs)} as const;`,
    `export const simulatorResolvedReadinessDeclarations = ${JSON.stringify(readinessDeclarations)} as const;`,
    '',
  ].join('\n');
  writeFileSync(path.join(generatedRoot, 'runtime-catalogs.ts'), runtimeCatalogs);
  const scenarioProjection = runtimeScenarioProjection(scenario);
  const scenarioTypescript = [
    '// Generated by apps/simulator/build/registry.mjs. Do not edit.',
    `export const simulatorResolvedScenario = ${JSON.stringify(scenarioProjection)} as const;`,
    '',
  ].join('\n');
  writeFileSync(path.join(generatedRoot, 'scenario.ts'), scenarioTypescript);
  return registry;
}

export function qualifySelectedModules({
  descriptors,
  repositoryCatalog,
  scenario,
  repoRoot,
  simulatorRoot,
  generatedRoot,
  workspaceRoot = repoRoot,
  workspaceRepositoryKey = 'nimi',
  supportedScenarioCapabilities = new Set(),
}) {
  ensureGeneratedRoot(simulatorRoot, generatedRoot);
  const qualified = [];
  const buildMap = {};
  const styleInputs = {};
  const sorted = [...descriptors].sort((left, right) => left.module_id.localeCompare(right.module_id));
  for (const [orderingKey, descriptor] of sorted.entries()) {
    const materialized = materializeDescriptor(descriptor, repositoryCatalog, {
      workspaceRoot,
      workspaceRepositoryKey,
      stagingRoot: path.join(generatedRoot, 'materialized'),
    });
    assertHostInventoryMaterialized(descriptor, materialized);
    const validation = validateSimulatorAppSource(materialized.appRoot, {
      expectedModuleId: descriptor.module_id,
      appProductionEntries: descriptor.app_production.entries,
      hostInvocations: descriptor.host_invocations.entries,
    });
    assertHostInventoryMaterialized(descriptor, materialized, validation.manifest);
    assertAppSourceResolverNeutral(validation.source);
    retainRuntimeSourceClosure(materialized, validation);
    qualified.push({ descriptor, materialized, validation, orderingKey });
    const appLocation = materialized.sourceLocations.find((entry) => entry.sourceId === 'app');
    buildMap[`virtual:nimi-simulator/${descriptor.module_id}/renderer`] = sourceBuildPath(
      descriptor.module_id,
      'app',
      validation.manifest.renderer.entry,
    );
    buildMap[`virtual:nimi-simulator/${descriptor.module_id}/adapter`] = sourceBuildPath(
      descriptor.module_id,
      'app',
      validation.manifest.renderer.adapter_entry,
    );
    buildMap[`virtual:nimi-simulator/${descriptor.module_id}/style`] = sourceBuildPath(
      descriptor.module_id,
      'app',
      validation.manifest.composition.style_entry,
    );
    styleInputs[descriptor.module_id] = { style: validation.style };
  }
  const resolver = resolveMandatorySingletons({
    repoRoot,
    simulatorRoot,
    moduleRequirements: qualified.map(({ descriptor, validation }) => ({
      moduleId: descriptor.module_id,
      appSourceKind: descriptor.sources.find((source) => source.id === 'app')?.kind,
      imports: validation.dependencies.imports,
      requirements: validation.dependencies.requirements,
    })),
  });
  const rows = qualified.map(({ descriptor, validation, orderingKey }) => (
    buildResolvedRow(descriptor, validation, orderingKey)
  ));
  const moduleCatalogs = qualified.map(({ validation, orderingKey }) => buildStaticModuleCatalog(validation, orderingKey));
  const readinessDeclarations = buildReadinessDeclarations(qualified);
  assertScenarioMatchesQualified(scenario, rows, readinessDeclarations, supportedScenarioCapabilities);
  // The effect catalog shares the generated workspace lifecycle: every
  // registry regeneration re-emits it after the wipe.
  generateEffectCatalog({ write: true, generatedRoot });
  return generateRegistryFiles({
    generatedRoot,
    repoRoot,
    rows,
    buildMap,
    resolver,
    styleInputs,
    moduleCatalogs,
    readinessDeclarations,
    scenario,
  });
}
