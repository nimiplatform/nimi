import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {
  stableJson,
  stableJsonDigest,
  sha256Digest,
  validateSimulatorAppSource,
  assertSimulatorSourcePath,
  SimulatorConformanceError,
} from '@nimiplatform/app-tools/simulator-conformance';
import { buildSimulatorEffectiveCssIdentity } from '@nimiplatform/app-tools/simulator-css-profile';
import { materializeDescriptor } from './materialize.mjs';
import { resolveMandatorySingletons } from './resolver.mjs';
import { generateEffectCatalog } from './generate-effect-catalog.mjs';

function fail(code, message, fieldPath = '') {
  throw new SimulatorConformanceError(code, message, fieldPath);
}

function ensureGeneratedRoot(simulatorRoot, generatedRoot) {
  const simulator = path.resolve(simulatorRoot);
  const generated = path.resolve(generatedRoot);
  if (generated !== path.join(simulator, '.generated')) {
    fail('SIM_GENERATED_ROOT', 'generated output must be apps/simulator/.generated');
  }
  rmSync(generated, { recursive: true, force: true });
  mkdirSync(generated, { recursive: true });
}

function readPolicyIdentity(repoRoot, relativePath) {
  const bytes = readFileSync(path.join(repoRoot, relativePath));
  const firstLines = bytes.toString('utf8').split('\n').slice(0, 12).join('\n');
  const owner = firstLines.match(/^owner:\s*([^\s#]+)\s*$/m)?.[1] || 'platform';
  const version = firstLines.match(/^version:\s*([^\s#]+)\s*$/m)?.[1] || '1';
  return { owner, version: String(version), digest: sha256Digest(bytes) };
}

function policyCatalogs(repoRoot, mandatorySingleton) {
  return {
    mandatorySingleton,
    browserEffect: readPolicyIdentity(repoRoot, '.nimi/spec/platform/kernel/tables/simulator-browser-effects.yaml'),
    hostBindings: [
      readPolicyIdentity(repoRoot, '.nimi/spec/platform/kernel/tables/simulator-module-contract.yaml'),
    ],
    listenerFamilies: readPolicyIdentity(repoRoot, '.nimi/spec/platform/kernel/tables/simulator-listener-families.yaml'),
  };
}

function reportWithoutDigest(report) {
  const { report_digest: ignored, ...rest } = report || {};
  return rest;
}

export function assertFreshAppToolsReport(supplied, fresh) {
  if (!supplied || typeof supplied !== 'object') fail('SIM_APP_TOOLS_REPORT_MISSING', 'App-tools conformance report is required');
  const calculated = stableJsonDigest('nimi-simulator-app-tools-report-v1', reportWithoutDigest(supplied));
  if (calculated !== supplied.report_digest) {
    fail('SIM_APP_TOOLS_REPORT_FORGED', 'App-tools report digest is invalid');
  }
  if (supplied.source?.app_source_digest !== fresh.source.app_source_digest) {
    fail('SIM_APP_TOOLS_REPORT_STALE', 'App-tools report source digest does not match materialized source');
  }
  if (stableJson(supplied) !== stableJson(fresh)) {
    fail('SIM_APP_TOOLS_REPORT_REVALIDATION', 'App-tools report differs from independent Simulator revalidation');
  }
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

function buildResolvedRow(descriptor, materialized, report, resolver, catalogs, cssIdentity, orderingKey) {
  const appLocation = materialized.sourceLocations.find((entry) => entry.sourceId === 'app');
  if (!appLocation) fail('SIM_APP_SOURCE_MISSING', 'materialized descriptor has no app source');
  if (report.source.app_source_digest !== appLocation.sourceDigest) {
    fail('SIM_APP_SOURCE_DIGEST', 'App-tools source digest differs from selected source digest');
  }
  if (stableJson(report.composition.app_production_inventory.entries) !== stableJson(descriptor.app_production.entries)) {
    fail('SIM_APP_PRODUCTION_INVENTORY_MISMATCH', 'Manifest and Simulator App production inventories differ');
  }
  if (report.composition.app_production_inventory.digest !== descriptor.app_production.inventory_digest) {
    fail('SIM_APP_PRODUCTION_INVENTORY_DIGEST', 'App-tools and Simulator App production inventory digests differ');
  }
  if (
    !report.composition.host_invocation_inventory.provided
    || report.composition.host_invocation_inventory.digest !== descriptor.host_invocations.inventory_digest
    || stableJson(report.composition.host_invocation_inventory.entries) !== stableJson(descriptor.host_invocations.entries)
  ) {
    fail('SIM_HOST_INVENTORY_MISMATCH', 'App-tools report does not bind the complete Simulator host-invocation inventory');
  }
  const manifest = report.__manifest;
  if (!manifest) fail('SIM_INTERNAL_MANIFEST_PROJECTION', 'internal validated Manifest projection is missing');
  const zStart = 1000 + orderingKey * 100;
  const row = {
    protocol: report.manifest.module_protocol,
    moduleId: descriptor.module_id,
    sourceAppIdRef: descriptor.source_app_id_ref,
    sourceLocations: materialized.sourceLocations.map((entry) => ({
      id: entry.sourceId,
      kind: entry.kind,
      repositoryKey: entry.repositoryKey,
      objectFormat: entry.objectFormat,
      objectId: entry.objectId,
      root: entry.root,
      sourceDigest: entry.sourceDigest,
      authorityRefs: entry.authorityRefs,
      authorityIndexDigest: entry.authorityIndexDigest,
    })),
    appProductionEntries: descriptor.app_production.entries.map((entry) => ({ sourceId: 'app', path: sourceBuildPath(descriptor.module_id, 'app', entry) })),
    appProductionInventoryAuthorityRefs: descriptor.app_production.inventory_authority_refs,
    appProductionInventoryDigest: descriptor.app_production.inventory_digest,
    hostInvocations: descriptor.host_invocations.entries.map((entry) => ({
      id: entry.id,
      sourceId: entry.source_id,
      path: sourceBuildPath(descriptor.module_id, entry.source_id, entry.entry),
      authorityRefs: entry.authority_refs,
    })),
    hostInvocationInventoryAuthorityRefs: descriptor.host_invocations.inventory_authority_refs,
    hostInvocationInventoryDigest: descriptor.host_invocations.inventory_digest,
    canonicalFactoryGraphProofDigest: stableJsonDigest('nimi-simulator-canonical-factory-graph-proof-v1', {
      appProductionInventoryDigest: descriptor.app_production.inventory_digest,
      hostInvocationInventoryDigest: descriptor.host_invocations.inventory_digest,
      appGraphDigest: report.composition.graph_digest,
      factory: [report.composition.factory_entry, report.composition.factory_export],
      canonicalStyleInputDigest: cssIdentity.digest,
      resolverTupleDigest: resolver.tupleDigest,
    }),
    factoryPath: sourceBuildPath(descriptor.module_id, 'app', report.composition.factory_entry),
    factoryExport: report.composition.factory_export,
    rendererPath: sourceBuildPath(descriptor.module_id, 'app', report.composition.renderer_entry),
    rendererExport: report.composition.renderer_export,
    adapterPath: sourceBuildPath(descriptor.module_id, 'app', report.composition.adapter_entry),
    adapterExport: report.composition.adapter_export,
    stylePath: sourceBuildPath(descriptor.module_id, 'app', report.style.entry),
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
    resolvedPackages: resolver.packages,
    cssNamespace: report.style.global_prefix,
    canonicalStyleInputDigest: cssIdentity.digest,
    zIndexRange: { start: zStart, end: zStart + 99 },
    orderingKey,
    policyCatalogs: catalogs,
    appToolsReportDigest: report.report_digest,
  };
  return Object.freeze(row);
}

function attachInternalManifest(report, manifest) {
  return Object.freeze({ ...report, __manifest: manifest });
}

function publicReport(report) {
  const { __manifest: ignored, ...rest } = report;
  return rest;
}

function assertRootIndependent(value, repoRoot) {
  const text = JSON.stringify(value);
  if (text.includes(path.resolve(repoRoot)) || /\/(?:Users|home)\//.test(text)) {
    fail('SIM_REGISTRY_ABSOLUTE_PATH', 'generated registry contains a host-absolute path');
  }
}

function serializeMaterializationLocation(entry) {
  const {
    targetRoot: ignoredTargetRoot,
    fetchIdentity,
    canonicalFetchIdentity,
    actualMirrorUsed,
    ...facts
  } = entry;
  void ignoredTargetRoot;
  return {
    ...facts,
    fetchSelection: actualMirrorUsed ? 'mirror' : 'canonical',
    fetchIdentityDigest: stableJsonDigest('nimi-simulator-fetch-identity-v1', fetchIdentity),
    canonicalFetchIdentityDigest: stableJsonDigest('nimi-simulator-fetch-identity-v1', canonicalFetchIdentity),
    actualMirrorIdentityDigest: actualMirrorUsed
      ? stableJsonDigest('nimi-simulator-fetch-identity-v1', actualMirrorUsed)
      : null,
  };
}

function buildStaticModuleCatalog(report, orderingKey) {
  return Object.freeze({
    moduleId: report.source.module_id,
    orderingKey,
    commandSchemas: report.fixture.catalog.commandSchemas,
    eventSchemas: report.fixture.catalog.eventSchemas,
    queries: {},
    selectSharedProjection: null,
  });
}

function buildReadinessDeclarations(qualified) {
  const declarations = {};
  for (const { descriptor, report } of qualified) {
    for (const declaration of report.fixture.readiness) {
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
  materializationEvidence,
  appToolsReports,
  cssProfiles,
  moduleCatalogs,
  readinessDeclarations,
}) {
  const moduleCatalogDigest = stableJsonDigest('nimi-simulator-module-catalogs-v1', moduleCatalogs);
  const readinessDeclarationDigest = stableJsonDigest(
    'nimi-simulator-readiness-declarations-v1',
    readinessDeclarations,
  );
  const registry = {
    schema: 'nimi.simulator.resolved-registry/v1',
    modules: rows,
    moduleCount: rows.length,
    resolverTupleDigest: resolver.tupleDigest,
    moduleCatalogDigest,
    readinessDeclarationDigest,
    digest: stableJsonDigest('nimi-simulator-resolved-registry-v1', {
      modules: rows,
      moduleCatalogDigest,
      readinessDeclarationDigest,
    }),
  };
  assertRootIndependent(registry, repoRoot);
  assertRootIndependent(buildMap, repoRoot);
  assertRootIndependent(resolver, repoRoot);
  assertRootIndependent(materializationEvidence, repoRoot);
  assertRootIndependent(cssProfiles, repoRoot);
  assertRootIndependent(moduleCatalogs, repoRoot);
  assertRootIndependent(readinessDeclarations, repoRoot);
  mkdirSync(path.join(generatedRoot, 'evidence', 'app-tools'), { recursive: true });
  mkdirSync(path.join(generatedRoot, 'evidence', 'css-profile'), { recursive: true });
  writeFileSync(path.join(generatedRoot, 'registry.json'), `${JSON.stringify(registry, null, 2)}\n`);
  writeFileSync(path.join(generatedRoot, 'build-map.json'), `${JSON.stringify(buildMap, null, 2)}\n`);
  writeFileSync(path.join(generatedRoot, 'evidence', 'resolver.json'), `${JSON.stringify(resolver, null, 2)}\n`);
  writeFileSync(path.join(generatedRoot, 'evidence', 'materialization.json'), `${JSON.stringify(materializationEvidence, null, 2)}\n`);
  for (const [moduleId, report] of Object.entries(appToolsReports)) {
    writeFileSync(path.join(generatedRoot, 'evidence', 'app-tools', `${moduleId}.json`), `${JSON.stringify(report, null, 2)}\n`);
  }
  for (const [moduleId, evidence] of Object.entries(cssProfiles)) {
    writeFileSync(path.join(generatedRoot, 'evidence', 'css-profile', `${moduleId}.json`), `${JSON.stringify(evidence, null, 2)}\n`);
  }
  const generatedRows = rows.map((row) => {
    const literal = JSON.stringify(row);
    const rendererId = JSON.stringify(`virtual:nimi-simulator/${row.moduleId}/renderer`);
    const adapterId = JSON.stringify(`virtual:nimi-simulator/${row.moduleId}/adapter`);
    const rendererExport = JSON.stringify(row.rendererExport);
    const adapterExport = JSON.stringify(row.adapterExport);
    return `  { metadata: ${literal}, loadRenderer: () => import(${rendererId}).then((module) => (module as unknown as Record<string, unknown>)[${rendererExport}]), loadAdapter: () => import(${adapterId}).then((module) => (module as unknown as Record<string, unknown>)[${adapterExport}]), loadStyle: () => import(${JSON.stringify(`virtual:nimi-simulator/${row.moduleId}/style`)}) },`;
  });
  const typescript = [
    '// Generated by apps/simulator/build/registry.mjs. Do not edit.',
    `export const simulatorResolvedRegistryDigest = ${JSON.stringify(registry.digest)} as const;`,
    'export const simulatorResolvedModules = [',
    ...generatedRows,
    '] as const;',
    '',
  ].join('\n');
  writeFileSync(path.join(generatedRoot, 'registry.ts'), typescript);
  const runtimeCatalogs = [
    '// Generated by apps/simulator/build/registry.mjs. Do not edit.',
    '// Static data only: this file never imports or evaluates an App fixture or Adapter graph.',
    `export const simulatorResolvedModuleCatalogs = ${JSON.stringify(moduleCatalogs)} as const;`,
    `export const simulatorResolvedReadinessDeclarations = ${JSON.stringify(readinessDeclarations)} as const;`,
    '',
  ].join('\n');
  writeFileSync(path.join(generatedRoot, 'runtime-catalogs.ts'), runtimeCatalogs);
  return registry;
}

export function qualifySelectedModules({
  descriptors,
  repositoryCatalog,
  repoRoot,
  simulatorRoot,
  generatedRoot,
  release = true,
  workspaceRoot = repoRoot,
  workspaceRepositoryKey = 'nimi',
  reportProvider = null,
}) {
  ensureGeneratedRoot(simulatorRoot, generatedRoot);
  const qualified = [];
  const buildMap = {};
  const materializationEvidence = [];
  const appToolsReports = {};
  const cssProfiles = {};
  const sorted = [...descriptors].sort((left, right) => left.module_id.localeCompare(right.module_id));
  for (const [orderingKey, descriptor] of sorted.entries()) {
    const materialized = materializeDescriptor(descriptor, repositoryCatalog, {
      workspaceRoot,
      workspaceRepositoryKey,
      stagingRoot: path.join(generatedRoot, 'materialized'),
      release,
    });
    assertHostInventoryMaterialized(descriptor, materialized);
    const conformance = validateSimulatorAppSource(materialized.appRoot, {
      expectedModuleId: descriptor.module_id,
      appProductionEntries: descriptor.app_production.entries,
      hostInvocations: descriptor.host_invocations.entries,
    });
    assertHostInventoryMaterialized(descriptor, materialized, conformance.manifest);
    assertAppSourceResolverNeutral(conformance.source);
    const freshReport = attachInternalManifest(conformance.report, conformance.manifest);
    const supplied = reportProvider ? reportProvider(descriptor, publicReport(freshReport)) : publicReport(freshReport);
    assertFreshAppToolsReport(supplied, publicReport(freshReport));
    const report = attachInternalManifest(supplied, conformance.manifest);
    qualified.push({ descriptor, materialized, conformance, report, orderingKey });
    const appLocation = materialized.sourceLocations.find((entry) => entry.sourceId === 'app');
    buildMap[`virtual:nimi-simulator/${descriptor.module_id}/renderer`] = sourceBuildPath(
      descriptor.module_id,
      'app',
      conformance.manifest.renderer.entry,
    );
    buildMap[`virtual:nimi-simulator/${descriptor.module_id}/adapter`] = sourceBuildPath(
      descriptor.module_id,
      'app',
      conformance.manifest.renderer.adapter_entry,
    );
    buildMap[`virtual:nimi-simulator/${descriptor.module_id}/style`] = sourceBuildPath(
      descriptor.module_id,
      'app',
      conformance.manifest.composition.style_entry,
    );
    materializationEvidence.push({
      moduleId: descriptor.module_id,
      sourceLocations: materialized.sourceLocations.map(serializeMaterializationLocation),
    });
    appToolsReports[descriptor.module_id] = supplied;
  }
  const resolver = resolveMandatorySingletons({
    repoRoot,
    simulatorRoot,
    moduleRequirements: qualified.map(({ descriptor, report }) => ({
      moduleId: descriptor.module_id,
      appSourceKind: descriptor.sources.find((source) => source.id === 'app')?.kind,
      imports: report.dependencies.imports,
      requirements: report.dependencies.requirements,
    })),
  });
  const catalogs = policyCatalogs(repoRoot, resolver.catalog);
  const rows = qualified.map(({ descriptor, materialized, report, orderingKey }) => {
    const cssIdentity = buildSimulatorEffectiveCssIdentity(simulatorRoot, report);
    cssProfiles[descriptor.module_id] = {
      schema: 'nimi.simulator.css-qualification-evidence/v1',
      module_id: descriptor.module_id,
      canonical_style_input_digest: cssIdentity.digest,
      identity: cssIdentity,
      resolver_tuple_digest: resolver.tupleDigest,
    };
    return buildResolvedRow(descriptor, materialized, report, resolver, catalogs, cssIdentity, orderingKey);
  });
  const moduleCatalogs = qualified.map(({ report, orderingKey }) => buildStaticModuleCatalog(report, orderingKey));
  const readinessDeclarations = buildReadinessDeclarations(qualified);
  // The effect catalog shares the generated workspace lifecycle: every
  // registry regeneration re-emits it after the wipe.
  generateEffectCatalog({ write: true, generatedRoot });
  return generateRegistryFiles({
    generatedRoot,
    repoRoot,
    rows,
    buildMap,
    resolver,
    materializationEvidence,
    appToolsReports,
    cssProfiles,
    moduleCatalogs,
    readinessDeclarations,
  });
}
