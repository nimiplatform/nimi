import { createRequire } from 'node:module';
import { existsSync, readFileSync, realpathSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
import ts from 'typescript';

import { SimulatorConformanceError } from './simulator-manifest.mjs';

export const SIMULATOR_CSS_PROFILE_PROTOCOL = 'nimi.simulator.css-profile/v1';
export const SIMULATOR_CSS_PROFILE_REVISION = 'tailwind-v4-canonical-closure-1';
export const SIMULATOR_CSS_COMPILER_VERSION = '4.3.0';
export const SIMULATOR_KIT_FOUNDATION_CSS_EXPORTS = Object.freeze([
  '@nimiplatform/kit/ui/styles.css',
  '@nimiplatform/kit/ui/themes/light.css',
  '@nimiplatform/kit/ui/themes/dark.css',
  '@nimiplatform/kit/ui/themes/nimi-accent.css',
  '@nimiplatform/kit/ui/themes/nimi-density-compact.css',
  '@nimiplatform/kit/auth/styles.css',
]);

const SCANNER_EXTENSIONS = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
const KIT_SCANNER_EXTENSIONS = new Set(['.cjs', '.js', '.mjs']);
const DYNAMIC_UTILITY_PREFIX = /(?:^|\s)(?:-?(?:m|p)[trblxy]?|w|h|min-w|max-w|min-h|max-h|bg|text|border|rounded|grid|flex|gap|space-[xy]|inset|top|right|bottom|left|z|opacity|shadow|ring|translate-[xy]|scale|rotate|duration|delay|ease|animate|backdrop-[a-z-]+|overflow|object|items|justify|content|place-[a-z-]+|col|row|font|leading|tracking)-$/u;

function fail(code, message, fieldPath = '') {
  throw new SimulatorConformanceError(code, message, fieldPath);
}

function relativePath(rootDir, absolutePath) {
  return path.relative(rootDir, absolutePath).split(path.sep).join('/');
}

function reachableFiles(graph, entry) {
  const queue = [entry];
  const seen = new Set();
  while (queue.length > 0) {
    const current = queue.shift();
    if (seen.has(current)) continue;
    seen.add(current);
    queue.push(...(graph.nodes.get(current)?.imports || []));
  }
  return [...seen];
}

function assertNoDynamicUtilityInterpolation(source, sourcePath) {
  const visit = (node) => {
    if (ts.isTemplateExpression(node)) {
      let preceding = node.head.text;
      for (const span of node.templateSpans) {
        if (DYNAMIC_UTILITY_PREFIX.test(preceding)) {
          fail(
            'SIM_CSS_DYNAMIC_UTILITY',
            'Tailwind utility names must be complete literal tokens; dynamic interpolation is forbidden',
            sourcePath,
          );
        }
        preceding = span.literal.text;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

function inputInventory(rootDir, graph, files) {
  return files
    .filter((filePath) => SCANNER_EXTENSIONS.has(path.extname(filePath)))
    .map((filePath) => {
      const node = graph.nodes.get(filePath);
      const relative = relativePath(rootDir, filePath);
      if (!node || node.type !== 'module') fail('SIM_CSS_SCANNER_GRAPH', 'scanner input is absent from the canonical module graph', relative);
      assertNoDynamicUtilityInterpolation(node.source, relative);
      return { path: relative };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

export function buildSimulatorCssProfile(input) {
  const compositionInputs = inputInventory(
    input.rootDir,
    input.graph,
    reachableFiles(input.graph, input.factoryPath),
  );
  if (compositionInputs.length === 0) {
    fail('SIM_CSS_SCANNER_EMPTY', 'canonical factory closure has no scanner inputs', input.factoryEntry);
  }
  const scanner = {
    inputs: compositionInputs,
  };
  const foundation = {
    theme_layer: 'simulator.foundation.preflight',
    kit_layer: 'simulator.foundation.kit',
    utility_emission: 'shared-once',
  };
  const utility = {
    owner: input.moduleId,
    layer: `simulator.module.${input.moduleId}`,
    root_class: input.rootClass,
    source: 'canonical-composition-closure',
  };
  const profile = {
    protocol: SIMULATOR_CSS_PROFILE_PROTOCOL,
    revision: SIMULATOR_CSS_PROFILE_REVISION,
    compiler: {
      package: 'tailwindcss',
      version: SIMULATOR_CSS_COMPILER_VERSION,
    },
    scanner,
    foundation,
    utility,
    style: {
      entry: input.styleEntry,
      inputs: input.styleInputs,
      root_class: input.rootClass,
      global_prefix: input.globalPrefix,
    },
  };
  return Object.freeze({
    entry: input.styleEntry,
    inputs: input.styleInputs,
    rootClass: input.rootClass,
    globalPrefix: input.globalPrefix,
    profile: Object.freeze(profile),
  });
}

function walkFiles(rootDir, extensions) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && extensions.has(path.extname(entry.name))) files.push(absolute);
      else if (!entry.isFile()) fail('SIM_CSS_FOUNDATION_FILE_KIND', 'Kit foundation contains an unsupported filesystem entry', absolute);
    }
  };
  visit(rootDir);
  return files;
}

function packageRootFromEntry(entryPath, packageName) {
  let directory = path.dirname(realpathSync(entryPath));
  while (directory !== path.dirname(directory)) {
    const packagePath = path.join(directory, 'package.json');
    if (existsSync(packagePath)) {
      const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
      if (packageJson.name === packageName) return directory;
    }
    directory = path.dirname(directory);
  }
  fail('SIM_CSS_PACKAGE_ROOT', `cannot locate installed package root for ${JSON.stringify(packageName)}`);
}

function resolveInstalledPackage(require, packageName) {
  let packageRoot;
  try {
    packageRoot = path.dirname(realpathSync(require.resolve(`${packageName}/package.json`)));
  } catch {
    try {
      packageRoot = packageRootFromEntry(require.resolve(packageName), packageName);
    } catch {
      const candidate = (require.resolve.paths(packageName) || [])
        .map((modulesRoot) => path.join(modulesRoot, ...packageName.split('/')))
        .find((root) => existsSync(path.join(root, 'package.json')));
      if (!candidate) fail('SIM_CSS_PACKAGE_ROOT', `cannot resolve installed package ${JSON.stringify(packageName)}`);
      packageRoot = realpathSync(candidate);
    }
  }
  const packagePath = path.join(packageRoot, 'package.json');
  const bytes = readFileSync(packagePath);
  const packageJson = JSON.parse(bytes.toString('utf8'));
  return {
    packageRoot,
    packageJson,
  };
}

function cssExportTargets(packageRoot, packageJson) {
  const targets = [];
  for (const [specifier, value] of Object.entries(packageJson.exports || {})) {
    if (typeof value !== 'string' || !value.endsWith('.css')) continue;
    const absolute = realpathSync(path.resolve(packageRoot, value));
    const relative = relativePath(packageRoot, absolute);
    if (relative.startsWith('../')) fail('SIM_CSS_KIT_EXPORT_ESCAPE', 'Kit CSS export escapes its package root', specifier);
    const closure = kitCssClosure(packageRoot, absolute, specifier);
    targets.push({
      specifier,
      target: relative,
      closure,
    });
  }
  return targets.sort((left, right) => left.specifier.localeCompare(right.specifier));
}

function cssImportSpecifier(params) {
  return params.trim().match(/^(?:url\(\s*)?['"]([^'"]+)['"]\s*\)?/u)?.[1] || '';
}

function kitCssImportSpecifier(params, fieldPath) {
  const trimmed = params.trim();
  const match = trimmed.match(/^(['"])([^'"]+)\1$/u)
    ?? trimmed.match(/^url\(\s*(['"])([^'"]+)\1\s*\)$/u);
  if (!match) {
    fail('SIM_CSS_KIT_IMPORT', 'Kit CSS imports must be exact static quoted paths without conditions or modifiers', fieldPath);
  }
  const specifier = match[2];
  if (
    !specifier.startsWith('./')
    && !specifier.startsWith('../')
  ) {
    fail('SIM_CSS_KIT_IMPORT', 'Kit CSS imports must be relative package-local paths', fieldPath);
  }
  if (specifier.includes('?') || specifier.includes('#') || path.extname(specifier) !== '.css') {
    fail('SIM_CSS_KIT_IMPORT', 'Kit CSS imports must resolve directly to a CSS file', fieldPath);
  }
  return specifier;
}

function kitCssClosure(packageRoot, entryPath, exportSpecifier) {
  const absoluteRoot = realpathSync(packageRoot);
  const queue = [realpathSync(entryPath)];
  const seen = new Set();
  const rows = [];
  while (queue.length > 0) {
    const current = queue.shift();
    if (seen.has(current)) continue;
    seen.add(current);
    const relative = relativePath(absoluteRoot, current);
    if (relative.startsWith('../') || path.isAbsolute(relative)) {
      fail('SIM_CSS_KIT_EXPORT_ESCAPE', 'Kit CSS closure escapes its package root', exportSpecifier);
    }
    const code = readFileSync(current, 'utf8');
    rows.push({ path: relative });
    const css = postcss.parse(code, { from: current });
    css.walkAtRules('import', (rule) => {
      const imported = kitCssImportSpecifier(rule.params, `${exportSpecifier}:${relative}`);
      let target;
      try {
        target = realpathSync(path.resolve(path.dirname(current), imported));
      } catch {
        fail('SIM_CSS_KIT_IMPORT_MISSING', 'Kit CSS import target does not exist', `${exportSpecifier}:${relative}`);
      }
      const targetRelative = relativePath(absoluteRoot, target);
      if (targetRelative.startsWith('../') || path.isAbsolute(targetRelative)) {
        fail('SIM_CSS_KIT_EXPORT_ESCAPE', 'Kit CSS import escapes its package root', `${exportSpecifier}:${relative}`);
      }
      queue.push(target);
    });
  }
  return rows.sort((left, right) => left.path.localeCompare(right.path));
}

function resolveKitCssExports(kitRoot) {
  const absoluteRoot = realpathSync(kitRoot);
  const packageJson = JSON.parse(readFileSync(path.join(absoluteRoot, 'package.json'), 'utf8'));
  return Object.freeze(cssExportTargets(absoluteRoot, packageJson));
}

export function assertSimulatorFoundationEntry(code, filePath) {
  const css = postcss.parse(code, { from: filePath });
  const imports = [];
  css.walkAtRules('import', (rule) => {
    if (rule.parent !== css) {
      fail('SIM_CSS_FOUNDATION_IMPORTS', 'foundation imports must be top-level', filePath);
    }
    imports.push({ specifier: cssImportSpecifier(rule.params), params: rule.params.trim() });
  });
  const expectedSpecifiers = [...SIMULATOR_KIT_FOUNDATION_CSS_EXPORTS, 'tailwindcss'];
  const actualSpecifiers = imports.map((entry) => entry.specifier);
  if (JSON.stringify(actualSpecifiers) !== JSON.stringify(expectedSpecifiers)) {
    fail('SIM_CSS_FOUNDATION_IMPORTS', 'foundation entry must contain only the exact protocol-owned CSS import sequence', filePath);
  }
  for (const [index, specifier] of SIMULATOR_KIT_FOUNDATION_CSS_EXPORTS.entries()) {
    if (![JSON.stringify(specifier), `'${specifier}'`].includes(imports[index].params)) {
      fail('SIM_CSS_FOUNDATION_IMPORTS', 'Kit foundation imports cannot carry conditions or layer modifiers', filePath);
    }
  }
  const tailwindImport = imports.at(-1);
  if (!tailwindImport
    || !["'tailwindcss' source(none)", '"tailwindcss" source(none)'].includes(tailwindImport.params)) {
    fail('SIM_CSS_FOUNDATION_TAILWIND', 'foundation entry must import tailwindcss source(none) exactly once', filePath);
  }
}

function resolveSimulatorCssCompiler(compilerRoot) {
  const require = createRequire(path.join(path.resolve(compilerRoot), 'package.json'));
  const tailwind = resolveInstalledPackage(require, 'tailwindcss');
  const packageRoot = tailwind.packageRoot;
  const packageJson = tailwind.packageJson;
  const themePath = path.join(packageRoot, 'theme.css');
  const themeBytes = readFileSync(themePath);
  if (packageJson.version !== SIMULATOR_CSS_COMPILER_VERSION) {
    fail('SIM_CSS_COMPILER_VERSION', `CSS profile requires tailwindcss@${SIMULATOR_CSS_COMPILER_VERSION}`);
  }
  return Object.freeze({
    themeReference: themeBytes.toString('utf8').replace('@theme default {', '@theme reference {'),
  });
}

function findKitFoundationScannerInputs(kitRoot) {
  const absoluteRoot = realpathSync(kitRoot);
  const distRoot = path.join(absoluteRoot, 'dist');
  if (!existsSync(distRoot) || !statSync(distRoot).isDirectory()) {
    fail('SIM_CSS_KIT_DIST', 'Kit dist is required before CSS profile construction');
  }
  const inputs = walkFiles(distRoot, KIT_SCANNER_EXTENSIONS)
    .map((filePath) => ({ path: relativePath(absoluteRoot, filePath) }));
  return Object.freeze({
    inputs,
  });
}

function sourceDirective(fromFile, targetFile) {
  let relative = path.relative(path.dirname(fromFile), targetFile).split(path.sep).join('/');
  if (!relative.startsWith('.')) relative = `./${relative}`;
  return `@source ${JSON.stringify(relative)};`;
}

function stripQuery(id) {
  return id.split('?', 1)[0];
}

function cssAssetSource(asset) {
  if (typeof asset.source === 'string') return asset.source;
  return Buffer.from(asset.source).toString('utf8');
}

function moduleSelectorRows(root, style) {
  const rootClass = style.rootClass;
  const globalPrefix = style.globalPrefix;
  const rootScope = `(.${rootClass})`;
  const rows = [];
  root.walkRules((rule) => {
    const atRules = [];
    let parent = rule.parent;
    let insideRootScope = false;
    let insideKeyframes = false;
    while (parent) {
      if (parent.type === 'atrule') {
        const name = parent.name.toLowerCase();
        if (/keyframes$/u.test(name)) insideKeyframes = true;
        if (name === 'scope' && parent.params.trim() === rootScope) insideRootScope = true;
        atRules.push(`@${name}${parent.params.trim() ? ` ${parent.params.trim()}` : ''}`);
      }
      parent = parent.parent;
    }
    if (insideKeyframes) return;
    const context = atRules.reverse();
    selectorParser((selectors) => {
      selectors.each((selector) => {
        const classes = [];
        selector.walkClasses((classNode) => classes.push(classNode.value));
        const moduleOwned = insideRootScope
          || classes.includes(rootClass)
          || classes.some((className) => className.startsWith(globalPrefix));
        if (moduleOwned) rows.push({ context, selector: selector.toString() });
      });
    }).processSync(rule.selector);
  });
  const unique = new Map(rows.map((row) => [JSON.stringify(row), row]));
  return [...unique.values()].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function postprocessSimulatorCssBundle(bundle, profileEntries) {
  const cssAssets = [];
  for (const output of Object.values(bundle)) {
    if (output.type !== 'asset' || !output.fileName.endsWith('.css')) continue;
    cssAssets.push({ output, root: postcss.parse(cssAssetSource(output), { from: output.fileName }) });
  }
  const assigned = new Map();
  for (const { style } of profileEntries) {
    const layer = style.profile.utility.layer;
    const matches = cssAssets.filter(({ root }) => {
      let found = false;
      root.walkAtRules('layer', (rule) => {
        if (rule.params.trim() === layer) found = true;
      });
      return found;
    });
    if (matches.length !== 1) {
      fail('SIM_CSS_MODULE_ASSET', `CSS profile ${JSON.stringify(layer)} must resolve to exactly one lazy asset`);
    }
    assigned.set(style.profile.utility.owner, matches[0]);
  }
  const moduleAssets = new Set(assigned.values());
  if (moduleAssets.size !== assigned.size) {
    fail('SIM_CSS_MODULE_ASSET_SHARED', 'each App CSS profile must resolve to its own lazy asset');
  }
  const foundationProperties = new Set();
  for (const asset of cssAssets) {
    if (moduleAssets.has(asset)) continue;
    asset.root.walkAtRules('property', (rule) => {
      const name = rule.params.trim();
      if (name.startsWith('--tw-')) foundationProperties.add(name);
    });
  }
  for (const { style } of profileEntries) {
    const moduleId = style.profile.utility.owner;
    const asset = assigned.get(moduleId);
    const properties = new Set();
    asset.root.walkAtRules('property', (rule) => {
      const name = rule.params.trim();
      if (name.startsWith('--tw-')) properties.add(name);
    });
    const missing = [...properties].filter((name) => !foundationProperties.has(name)).sort();
    if (missing.length > 0) {
      fail(
        'SIM_CSS_FOUNDATION_PROPERTY_MISSING',
        `module ${JSON.stringify(moduleId)} requires Tailwind properties absent from the shared foundation: ${missing.join(', ')}`,
      );
    }
    asset.root.walkAtRules('layer', (rule) => {
      if (rule.params.trim() === 'properties') rule.remove();
    });
    asset.root.walkAtRules('property', (rule) => {
      if (rule.params.trim().startsWith('--tw-')) rule.remove();
    });
    const layer = style.profile.utility.layer;
    const rootScope = `(.${style.rootClass})`;
    asset.root.walkAtRules('layer', (layerRule) => {
      if (layerRule.params.trim() !== layer) return;
      layerRule.walkRules((rule) => {
        let parent = rule.parent;
        let scoped = false;
        while (parent && parent !== layerRule) {
          if (parent.type === 'atrule' && parent.name === 'scope' && parent.params.trim() === rootScope) scoped = true;
          parent = parent.parent;
        }
        if (!scoped) fail('SIM_CSS_UTILITY_SCOPE', `generated utility selector ${JSON.stringify(rule.selector)} is outside ${rootScope}`);
      });
    });
    const output = asset.root.toString();
    asset.output.source = output;
    const selectorsOutsideCanonicalAsset = cssAssets
      .filter((candidate) => candidate !== asset)
      .flatMap((candidate) => moduleSelectorRows(candidate.root, style));
    if (selectorsOutsideCanonicalAsset.length > 0) {
      fail(
        'SIM_CSS_MODULE_SELECTOR_SPLIT',
        `module ${JSON.stringify(moduleId)} selectors escaped the canonical CSS asset`,
      );
    }
  }
}

export function createSimulatorCssProfileVitePlugin(options) {
  const compiler = resolveSimulatorCssCompiler(options.compilerRoot);
  const kitRoot = realpathSync(path.join(options.compilerRoot, 'node_modules', '@nimiplatform', 'kit'));
  const foundation = findKitFoundationScannerInputs(kitRoot);
  const foundationEntry = realpathSync(options.foundationEntry);
  const kitCssRoot = path.join(kitRoot, 'dist');
  const kitCssInputs = new Map();
  for (const exported of resolveKitCssExports(kitRoot)) {
    for (const input of exported.closure) {
      const absolute = realpathSync(path.join(kitRoot, ...input.path.split('/')));
      kitCssInputs.set(absolute, input);
    }
  }
  const profiles = new Map();
  for (const entry of options.apps) {
    const rootDir = realpathSync(entry.rootDir);
    const style = entry.style;
    const stylePath = realpathSync(path.join(rootDir, ...style.entry.split('/')));
    profiles.set(stylePath, { rootDir, style });
    for (const input of style.inputs) {
      const absolute = realpathSync(path.join(rootDir, ...input.path.split('/')));
      if (absolute !== rootDir && !absolute.startsWith(`${rootDir}${path.sep}`)) {
        fail('SIM_CSS_APP_INPUT_ESCAPE', 'App CSS input escapes its source root', input.path);
      }
    }
  }
  const profileEntries = [...profiles.values()].map(({ style }) => ({ style }));
  return {
    name: 'nimi-simulator-css-profile',
    enforce: 'pre',
    transform(code, id) {
      const filePath = stripQuery(id);
      let real;
      try {
        real = realpathSync(filePath);
      } catch {
        return null;
      }
      if (real.startsWith(`${kitCssRoot}${path.sep}`) && real.endsWith('.css')) {
        const input = kitCssInputs.get(real);
        if (!input) {
          fail('SIM_CSS_KIT_INPUT_UNQUALIFIED', 'build reached Kit CSS outside the canonical export closure', relativePath(kitRoot, real));
        }
        const css = postcss.parse(code, { from: real });
        css.walkAtRules('source', (rule) => rule.remove());
        return { code: css.toString(), map: null };
      }
      if (real === foundationEntry) {
        assertSimulatorFoundationEntry(code, real);
        const directives = foundation.inputs.map((input) => sourceDirective(
          real,
          path.join(kitRoot, ...input.path.split('/')),
        ));
        return {
          code: `${code}\n/* ${SIMULATOR_CSS_PROFILE_PROTOCOL} Kit foundation */\n${directives.join('\n')}\n`,
          map: null,
        };
      }
      const profile = profiles.get(real);
      if (!profile) return null;
      const { style, rootDir } = profile;
      const directives = style.profile.scanner.inputs.map((input) => sourceDirective(
        real,
        path.join(rootDir, ...input.path.split('/')),
      ));
      const layer = style.profile.utility.layer;
      const rootClass = style.rootClass;
      const generated = [
        `/* ${SIMULATOR_CSS_PROFILE_PROTOCOL} */`,
        compiler.themeReference,
        ...directives,
        `@layer ${layer} {`,
        `  @scope (.${rootClass}) {`,
        '    @tailwind utilities source(none);',
        '  }',
        '}',
      ].join('\n');
      return { code: `${code}\n${generated}\n`, map: null };
    },
    generateBundle(_outputOptions, bundle) {
      postprocessSimulatorCssBundle(bundle, profileEntries);
    },
  };
}
