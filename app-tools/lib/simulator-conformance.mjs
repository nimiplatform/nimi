import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import {
  parseSimulatorManifest,
  SIMULATOR_MANIFEST_PATH,
  SIMULATOR_MODULE_PROTOCOL,
  SIMULATOR_OPERATION_PROTOCOL,
  SIMULATOR_INTERACTION_PROTOCOL,
  SIMULATOR_RENDERER_HOST_PROTOCOL,
  SimulatorConformanceError,
} from './simulator-manifest.mjs';
import {
  buildSimulatorSourceInventory,
  sha256Digest,
  stableJsonDigest,
} from './simulator-source.mjs';
import {
  assertAdapterMetadata,
  assertCanonicalFactoryMetadata,
  extractConformanceFixture,
  assertRendererMetadata,
} from './simulator-conformance-ast.mjs';
import {
  assertSimulatorFoundationEntry,
  buildSimulatorCssProfile,
} from './simulator-css-profile.mjs';
import {
  validateSimulatorProductionFoundationCss,
  validateSimulatorCssGlobalSymbols,
  validateSimulatorCssSelectors,
} from './simulator-conformance-css.mjs';
import {
  assertContainedFile,
  assertImportAllowed,
  assertRestrictedClosure,
  buildModuleGraph,
  canonicalRelative,
  reachable,
  resolveRelativeImport,
  isSimulatorStaticAssetPath,
} from './simulator-conformance-graph.mjs';

export { isSimulatorStaticAssetPath } from './simulator-conformance-graph.mjs';
import { SIMULATOR_EFFECT_POLICY } from './simulator-effect-policy.generated.mjs';
import { assertInvocationUsesCanonicalFactory } from './simulator-factory-use.mjs';

export const SIMULATOR_APP_TOOLS_REPORT_SCHEMA = 'nimi.simulator.app-tools-report/v1';

const APP_TOOLS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_TOOLS_PACKAGE = JSON.parse(readFileSync(path.join(APP_TOOLS_ROOT, 'package.json'), 'utf8'));

function fail(code, message, fieldPath = '') {
  throw new SimulatorConformanceError(code, message, fieldPath);
}

function packageNameFromSpecifier(specifier) {
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/');
  return specifier.split('/')[0];
}

function declaredPackageRequirements(rootDir, imports) {
  if (imports.length === 0) return {};
  const packagePath = path.join(rootDir, 'package.json');
  let packageJson;
  try {
    packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
  } catch {
    fail('SIM_DEPENDENCY_MANIFEST', 'canonical Simulator closure imports packages but source root has no valid package.json');
  }
  const result = {};
  for (const specifier of imports) {
    const packageName = packageNameFromSpecifier(specifier);
    const declared = packageJson.dependencies?.[packageName]
      ?? packageJson.peerDependencies?.[packageName]
      ?? packageJson.optionalDependencies?.[packageName];
    if (typeof declared !== 'string' || !declared) {
      fail('SIM_DEPENDENCY_UNDECLARED', `canonical closure import ${JSON.stringify(specifier)} has no package declaration`, packageName);
    }
    result[packageName] = declared;
  }
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

function assertEntryReachability(rootDir, graph, manifest) {
  const factoryPath = assertContainedFile(rootDir, manifest.composition.factory_entry, 'composition.factory_entry');
  const stylePath = assertContainedFile(rootDir, manifest.composition.style_entry, 'composition.style_entry');
  const rendererPath = assertContainedFile(rootDir, manifest.renderer.entry, 'renderer.entry');
  const factoryNode = graph.nodes.get(factoryPath);
  if (!factoryNode?.exports.has(manifest.composition.factory_export)) {
    fail('SIM_FACTORY_EXPORT', `canonical factory export ${JSON.stringify(manifest.composition.factory_export)} was not found`, 'composition.factory_export');
  }
  assertCanonicalFactoryMetadata(factoryNode.source, manifest);
  if (!reachable(graph, rendererPath, factoryPath)) {
    fail('SIM_RENDERER_FACTORY_REACHABILITY', 'renderer entry does not reach the canonical factory module', manifest.renderer.entry);
  }
  assertRendererMetadata(graph.nodes.get(rendererPath).source, manifest);
  const productionFactoryUses = [];
  for (const [index, entry] of manifest.composition.app_production_entries.entries()) {
    const entryPath = assertContainedFile(rootDir, entry, `composition.app_production_entries[${index}]`);
    if (!reachable(graph, entryPath, factoryPath)) {
      fail('SIM_PRODUCTION_FACTORY_REACHABILITY', 'production entry does not reach the canonical factory module', entry);
    }
    if (!reachable(graph, entryPath, stylePath)) {
      fail('SIM_PRODUCTION_STYLE_REACHABILITY', 'production entry does not reach the canonical style entry', entry);
    }
    productionFactoryUses.push(...assertInvocationUsesCanonicalFactory({
      rootDir,
      graph,
      entryPath,
      factoryPath,
      factoryExport: manifest.composition.factory_export,
      code: 'SIM_PRODUCTION_FACTORY_USE',
      fieldPath: entry,
    }));
    const visited = [entryPath];
    const seen = new Set();
    while (visited.length > 0) {
      const current = visited.shift();
      if (seen.has(current)) continue;
      seen.add(current);
      const relative = canonicalRelative(rootDir, current);
      if (relative.startsWith('src/simulator/')) {
        fail('SIM_PRODUCTION_SIMULATOR_EDGE', 'production graph reaches Simulator-only source', relative);
      }
      visited.push(...(graph.nodes.get(current)?.imports || []));
    }
  }
  return { factoryPath, stylePath, rendererPath, productionFactoryUses };
}

function validateAdapterAndFixture(rootDir, graph, manifest) {
  const adapterPath = assertContainedFile(rootDir, manifest.renderer.adapter_entry, 'renderer.adapter_entry');
  const fixturePath = assertContainedFile(rootDir, manifest.fixtures.conformance, 'fixtures.conformance');
  const adapter = graph.nodes.get(adapterPath);
  if (!adapter?.exports.has(manifest.renderer.adapter_export)) {
    fail('SIM_ADAPTER_EXPORT', `Adapter export ${JSON.stringify(manifest.renderer.adapter_export)} was not found`, 'renderer.adapter_export');
  }
  assertAdapterMetadata(adapter.source, manifest);
  const fixture = graph.nodes.get(fixturePath);
  if (!fixture || fixture.exports.size === 0) {
    fail('SIM_FIXTURE_EXPORT', 'conformance fixture must expose at least one named export', manifest.fixtures.conformance);
  }
  const declaration = extractConformanceFixture(fixture.source, manifest);
  return { adapterPath, fixturePath, declaration };
}

function extractCssImport(params) {
  const match = params.trim().match(/^(?:url\(\s*)?['"]([^'"]+)['"]\s*\)?/);
  return match ? match[1] : '';
}

function buildStyleClosure(rootDir, styleEntry, moduleId) {
  const entry = assertContainedFile(rootDir, styleEntry, 'composition.style_entry');
  const queue = [entry];
  const seen = new Set();
  const inputs = [];
  const packageImports = new Set();
  const rootClass = `nimi-ui-module--${moduleId}`;
  const globalPrefix = `nimi-ui-module-${moduleId}-`;
  let rootClassSeen = false;
  while (queue.length > 0) {
    const current = queue.shift();
    if (seen.has(current)) continue;
    seen.add(current);
    const relative = canonicalRelative(rootDir, current);
    const bytes = readFileSync(current);
    let css;
    try {
      css = postcss.parse(bytes.toString('utf8'), { from: relative });
    } catch (error) {
      fail('SIM_CSS_PARSE', error instanceof Error ? error.message : String(error), relative);
    }
    rootClassSeen = validateSimulatorCssSelectors(css, relative, rootClass, globalPrefix) || rootClassSeen;
    validateSimulatorCssGlobalSymbols(css, relative, globalPrefix);
    css.walkAtRules('import', (rule) => {
      const specifier = extractCssImport(rule.params);
      if (!specifier) fail('SIM_CSS_IMPORT', 'CSS @import must use a static quoted target', relative);
      assertImportAllowed(specifier, relative);
      if (specifier.startsWith('.')) {
        const resolved = resolveRelativeImport(rootDir, current, specifier);
        if (!resolved.endsWith('.css')) fail('SIM_CSS_IMPORT', 'CSS @import target must be CSS', relative);
        queue.push(resolved);
      } else {
        fail('SIM_CSS_DEPENDENCY_UNDECLARED', 'package CSS requires a Manifest-declared dependency-CSS export', relative);
      }
    });
    css.walkAtRules('source', () => {
      fail('SIM_CSS_SOURCE_DIRECTIVE', 'canonical App CSS scanner inputs are generated by the protocol profile', relative);
    });
    css.walkAtRules('tailwind', () => {
      fail('SIM_CSS_FOUNDATION_DUPLICATE', 'canonical App CSS cannot emit Tailwind foundation or utilities directly', relative);
    });
    inputs.push({ path: relative, digest: sha256Digest(bytes), bytes: bytes.length });
  }
  if (!rootClassSeen) {
    fail('SIM_CSS_ROOT_CLASS', `canonical style closure must contain .${rootClass}`, styleEntry);
  }
  inputs.sort((left, right) => left.path.localeCompare(right.path));
  return {
    entry: styleEntry,
    rootClass,
    globalPrefix,
    inputs,
    packageImports: [...packageImports].sort(),
  };
}

function productionGraphFiles(graph, entries) {
  const queue = [...entries];
  const seen = new Set();
  while (queue.length > 0) {
    const current = queue.shift();
    if (seen.has(current)) continue;
    seen.add(current);
    queue.push(...(graph.nodes.get(current)?.imports || []));
  }
  return [...seen];
}

function validateProductionCssOwnership(rootDir, graph, manifest, styleClosure) {
  const productionEntries = manifest.composition.app_production_entries.map((entry, index) =>
    assertContainedFile(rootDir, entry, `composition.app_production_entries[${index}]`));
  const productionFiles = productionGraphFiles(graph, productionEntries);
  const canonicalStylePaths = new Set(styleClosure.inputs.map((input) =>
    realpathSync(path.join(rootDir, ...input.path.split('/')))));
  for (const filePath of productionFiles) {
    const node = graph.nodes.get(filePath);
    if (!node || node.type !== 'module') continue;
    const packageCssImport = node.specifiers.find((specifier) =>
      !specifier.startsWith('.') && /\.css(?:$|[?#])/u.test(specifier));
    if (packageCssImport) {
      fail(
        'SIM_CSS_PRODUCTION_PACKAGE_IMPORT',
        `production package CSS ${JSON.stringify(packageCssImport)} must be owned by the validated host foundation entry`,
        canonicalRelative(rootDir, filePath),
      );
    }
  }
  const foundationPaths = productionFiles
    .filter((filePath) => graph.nodes.get(filePath)?.type === 'css' && !canonicalStylePaths.has(filePath))
    .sort((left, right) => canonicalRelative(rootDir, left).localeCompare(canonicalRelative(rootDir, right)));
  if (foundationPaths.length > 1) {
    fail(
      'SIM_CSS_PRODUCTION_FOUNDATION_COUNT',
      'production invocation graph must have at most one non-canonical host foundation stylesheet',
    );
  }
  const inputs = foundationPaths.map((filePath) => {
    const relativePath = canonicalRelative(rootDir, filePath);
    const bytes = readFileSync(filePath);
    const code = bytes.toString('utf8');
    assertSimulatorFoundationEntry(code, relativePath);
    let css;
    try {
      css = postcss.parse(code, { from: relativePath });
    } catch (error) {
      fail('SIM_CSS_PARSE', error instanceof Error ? error.message : String(error), relativePath);
    }
    const selectors = validateSimulatorProductionFoundationCss(css, relativePath);
    return Object.freeze({
      path: relativePath,
      digest: sha256Digest(bytes),
      bytes: bytes.length,
      selectors,
    });
  });
  const evidence = {
    owner: 'app-production-host',
    host_foundation_inputs: inputs,
    app_selector_count_outside_canonical: 0,
  };
  return Object.freeze({
    ...evidence,
    digest: stableJsonDigest('nimi-simulator-production-css-ownership-v1', evidence),
  });
}

function compareStringSets(actual, expected, code, label) {
  const left = [...actual].sort();
  const right = [...expected].sort();
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    fail(code, `${label} mismatch: expected ${JSON.stringify(right)}, got ${JSON.stringify(left)}`);
  }
}

function makeCheck(evidence) {
  return Object.freeze({ result: 'pass', evidence: Object.freeze([...evidence]) });
}

function assertSourceInventoryCovers(rootDir, source, absolutePaths) {
  const inventory = new Set(source.files.map((entry) => realpathSync(entry.absolutePath)));
  for (const absolutePath of absolutePaths) {
    const real = realpathSync(absolutePath);
    if (!inventory.has(real)) {
      fail(
        'SIM_SOURCE_GRAPH_UNBOUND',
        'every resolved graph and canonical style input must be bound by the source inventory digest',
        canonicalRelative(rootDir, real),
      );
    }
  }
}

export function validateSimulatorAppSource(rootDir, options = {}) {
  const absoluteRoot = realpathSync(path.resolve(rootDir));
  const manifestPath = assertContainedFile(absoluteRoot, SIMULATOR_MANIFEST_PATH, SIMULATOR_MANIFEST_PATH);
  const manifestBytes = readFileSync(manifestPath);
  const manifest = parseSimulatorManifest(manifestBytes.toString('utf8'), { label: SIMULATOR_MANIFEST_PATH });
  if (options.expectedModuleId && options.expectedModuleId !== manifest.module_id) {
    fail('SIM_MODULE_ID_MISMATCH', `expected module_id ${JSON.stringify(options.expectedModuleId)}`, 'module_id');
  }
  if (options.appProductionEntries) {
    compareStringSets(
      manifest.composition.app_production_entries,
      options.appProductionEntries,
      'SIM_APP_PRODUCTION_INVENTORY_MISMATCH',
      'App production-entry inventory',
    );
  }
  const source = buildSimulatorSourceInventory(absoluteRoot);
  const hostInvocations = Array.isArray(options.hostInvocations) ? options.hostInvocations : [];
  const appSourceHostInvocations = hostInvocations.filter((entry) => !entry.source_id || entry.source_id === 'app');
  const graphEntries = [
    ...manifest.composition.app_production_entries.map((entry, index) => ({
      path: entry,
      fieldPath: `composition.app_production_entries[${index}]`,
    })),
    { path: manifest.composition.factory_entry, fieldPath: 'composition.factory_entry' },
    { path: manifest.composition.style_entry, fieldPath: 'composition.style_entry' },
    { path: manifest.renderer.entry, fieldPath: 'renderer.entry' },
    { path: manifest.renderer.adapter_entry, fieldPath: 'renderer.adapter_entry' },
    { path: manifest.fixtures.conformance, fieldPath: 'fixtures.conformance' },
    ...appSourceHostInvocations.map((entry, index) => ({
      path: entry.entry,
      fieldPath: `host_invocations[${index}].entry`,
    })),
  ];
  const graph = buildModuleGraph(absoluteRoot, graphEntries);
  assertSourceInventoryCovers(absoluteRoot, source, graph.nodes.keys());
  const identity = assertEntryReachability(absoluteRoot, graph, manifest);
  for (const [index, host] of appSourceHostInvocations.entries()) {
    const hostPath = assertContainedFile(absoluteRoot, host.entry, `host_invocations[${index}].entry`);
    if (!reachable(graph, hostPath, identity.factoryPath)) {
      fail('SIM_HOST_FACTORY_REACHABILITY', 'host invocation does not reach the canonical factory module', host.entry);
    }
    if (!reachable(graph, hostPath, identity.stylePath)) {
      fail('SIM_HOST_STYLE_REACHABILITY', 'host invocation does not reach the canonical style entry', host.entry);
    }
    assertInvocationUsesCanonicalFactory({
      rootDir: absoluteRoot,
      graph,
      entryPath: hostPath,
      factoryPath: identity.factoryPath,
      factoryExport: manifest.composition.factory_export,
      code: 'SIM_HOST_FACTORY_USE',
      fieldPath: host.entry,
    });
  }
  const simulatorParts = validateAdapterAndFixture(absoluteRoot, graph, manifest);
  const restrictedImports = assertRestrictedClosure(absoluteRoot, graph, [
    { path: identity.factoryPath, owner: 'canonical_renderer' },
    { path: identity.rendererPath, owner: 'canonical_renderer' },
    { path: simulatorParts.adapterPath, owner: 'app_adapter' },
    { path: simulatorParts.fixturePath, owner: 'conformance_fixture' },
  ]);
  const styleClosure = buildStyleClosure(absoluteRoot, manifest.composition.style_entry, manifest.module_id);
  assertSourceInventoryCovers(
    absoluteRoot,
    source,
    styleClosure.inputs.map((entry) => path.resolve(absoluteRoot, ...entry.path.split('/'))),
  );
  const productionStyle = validateProductionCssOwnership(
    absoluteRoot,
    graph,
    manifest,
    styleClosure,
  );
  const finalPackageImports = [...new Set([...restrictedImports, ...styleClosure.packageImports])].sort();
  const packageRequirements = declaredPackageRequirements(absoluteRoot, finalPackageImports);
  const style = buildSimulatorCssProfile({
    rootDir: absoluteRoot,
    graph,
    factoryPath: identity.factoryPath,
    factoryEntry: manifest.composition.factory_entry,
    moduleId: manifest.module_id,
    styleEntry: styleClosure.entry,
    styleInputs: styleClosure.inputs,
    rootClass: styleClosure.rootClass,
    globalPrefix: styleClosure.globalPrefix,
    packageImports: styleClosure.packageImports,
    packageRequirements,
  });
  const hostEvidence = hostInvocations.map((entry) => ({
    id: entry.id,
    source_id: entry.source_id,
    entry: entry.entry,
    authority_refs: entry.authority_refs,
  }));
  const authorityRefs = Object.freeze([
    { owner: 'platform', rule_id: 'P-SIM-004' },
    { owner: 'platform', rule_id: 'P-SIM-006' },
    { owner: 'platform', rule_id: 'P-SIM-007' },
    { owner: 'platform', rule_id: 'P-SIM-020' },
  ]);
  const report = {
    schema: SIMULATOR_APP_TOOLS_REPORT_SCHEMA,
    tool: {
      package: APP_TOOLS_PACKAGE.name,
      version: APP_TOOLS_PACKAGE.version,
    },
    source: {
      module_id: manifest.module_id,
      app_source_digest: source.digest,
      app_authority_index_digest: stableJsonDigest('nimi-simulator-app-conformance-authority-v1', authorityRefs),
      authority_refs: authorityRefs,
      file_count: source.files.length,
    },
    manifest: {
      path: SIMULATOR_MANIFEST_PATH,
      digest: sha256Digest(manifestBytes),
      module_protocol: SIMULATOR_MODULE_PROTOCOL,
      operation_protocol: SIMULATOR_OPERATION_PROTOCOL,
      interaction_protocol: SIMULATOR_INTERACTION_PROTOCOL,
      renderer_host_protocol: SIMULATOR_RENDERER_HOST_PROTOCOL,
    },
    composition: {
      factory_entry: manifest.composition.factory_entry,
      factory_export: manifest.composition.factory_export,
      renderer_entry: manifest.renderer.entry,
      renderer_export: manifest.renderer.export,
      adapter_entry: manifest.renderer.adapter_entry,
      adapter_export: manifest.renderer.adapter_export,
      app_production_inventory: {
        entries: [...manifest.composition.app_production_entries],
        digest: stableJsonDigest('nimi-simulator-app-production-inventory-v1', manifest.composition.app_production_entries),
      },
      host_invocation_inventory: {
        owner: 'simulator',
        provided: Boolean(options.hostInvocations),
        entries: hostEvidence,
        digest: options.hostInvocations
          ? stableJsonDigest('nimi-simulator-host-invocation-inventory-v1', hostEvidence)
          : null,
      },
      graph_digest: stableJsonDigest('nimi-simulator-app-graph-v1', [...graph.nodes.keys()].map((entry) => canonicalRelative(absoluteRoot, entry)).sort()),
    },
    style: {
      entry: style.entry,
      digest: style.digest,
      root_class: style.rootClass,
      global_prefix: style.globalPrefix,
      inputs: style.inputs,
      package_imports: style.packageImports,
      profile: style.profile,
      production: productionStyle,
    },
    dependencies: {
      imports: finalPackageImports,
      requirements: packageRequirements,
    },
    fixture: simulatorParts.declaration,
    checks: {
      app_production_entry_set: makeCheck(manifest.composition.app_production_entries),
      host_neutral_factory_contract: makeCheck([canonicalRelative(absoluteRoot, identity.factoryPath)]),
      canonical_instance_factory: makeCheck([manifest.composition.factory_export]),
      app_production_factory_use: makeCheck(identity.productionFactoryUses.map((entry) => entry.path)),
      canonical_bindings: makeCheck([SIMULATOR_RENDERER_HOST_PROTOCOL]),
      main_surface: makeCheck(['main']),
      adapter: makeCheck([canonicalRelative(absoluteRoot, simulatorParts.adapterPath)]),
      dependencies: makeCheck(finalPackageImports),
      imports: makeCheck([...graph.nodes.keys()].map((entry) => canonicalRelative(absoluteRoot, entry)).sort()),
      canonical_style_inputs: makeCheck(style.inputs.map((entry) => entry.path)),
      canonical_style_scanner: makeCheck(style.profile.scanner.inputs.map((entry) => entry.path)),
      production_css_ownership: makeCheck(productionStyle.host_foundation_inputs.map((entry) => entry.path)),
      css: makeCheck([style.rootClass, style.globalPrefix]),
      globals_and_effects: makeCheck([
        SIMULATOR_EFFECT_POLICY.source.path,
        SIMULATOR_EFFECT_POLICY.source.digest,
      ]),
      dom_identity_scope: makeCheck([style.rootClass]),
      lifecycle_fixture: makeCheck([canonicalRelative(absoluteRoot, simulatorParts.fixturePath)]),
      readiness_fixture: makeCheck(manifest.renderer.surfaces.map((surface) => surface.readiness_contract)),
    },
    result: 'pass',
  };
  return Object.freeze({
    manifest,
    source,
    graph,
    report: Object.freeze({
      ...report,
      report_digest: stableJsonDigest('nimi-simulator-app-tools-report-v1', report),
    }),
  });
}

export function renderSimulatorConformanceFailure(error, rootDir) {
  const normalized = error instanceof SimulatorConformanceError
    ? error
    : new SimulatorConformanceError('SIM_CONFORMANCE_INTERNAL', error instanceof Error ? error.message : String(error));
  return {
    schema: SIMULATOR_APP_TOOLS_REPORT_SCHEMA,
    tool: { package: APP_TOOLS_PACKAGE.name, version: APP_TOOLS_PACKAGE.version },
    source: { root: path.basename(path.resolve(rootDir || '.')) },
    result: 'fail',
    diagnostics: [{
      code: normalized.code,
      path: normalized.fieldPath || null,
      message: normalized.message,
    }],
  };
}

export {
  computeSourceDigestV1,
  collectSimulatorSourceFiles,
  buildSimulatorSourceInventory,
  sha256Digest,
  stableJson,
  stableJsonDigest,
} from './simulator-source.mjs';
export {
  parseSimulatorManifest,
  validateSimulatorManifest,
  assertSimulatorSourcePath,
  SimulatorConformanceError,
} from './simulator-manifest.mjs';
export { validateSimulatorSelectedDependencyModule } from './simulator-conformance-graph.mjs';
