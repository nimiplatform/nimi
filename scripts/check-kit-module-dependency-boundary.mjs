#!/usr/bin/env node

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import YAML from 'yaml';

const repoRoot = process.cwd();
const kitRoot = path.join(repoRoot, 'kit');
const registryPath = path.join(repoRoot, 'config', 'platform-nimi-kit-registry.yaml');
const packageJsonPath = path.join(kitRoot, 'package.json');
const requireFromKit = createRequire(path.join(kitRoot, 'package.json'));
const kitPackagePrefix = '@nimiplatform/kit/';
const sdkContractSpecifier = '@nimiplatform/kit/core/sdk-contract';
const sdkContractPath = path.join(kitRoot, 'core', 'src', 'sdk-contract.ts');
const ignoredDirectories = new Set(['.cache', 'dist', 'gen', 'generated', 'node_modules']);
const checkedExtensions = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx']);
const violations = [];

let ts;
try {
  ts = requireFromKit('typescript');
} catch (error) {
  process.stderr.write(`Kit module dependency boundary check failed: unable to load kit TypeScript dependency (${error.message})\n`);
  process.exit(1);
}

function rel(absPath) {
  return path.relative(repoRoot, absPath).split(path.sep).join('/');
}

function readJson(absPath) {
  return JSON.parse(fs.readFileSync(absPath, 'utf8'));
}

function sourceRootForModule(subpath) {
  const directDir = path.join(kitRoot, subpath);
  if (fs.existsSync(directDir) && fs.statSync(directDir).isDirectory()) {
    return directDir;
  }

  if (subpath.startsWith('core/')) {
    return path.join(kitRoot, 'core', 'src', subpath.replace(/^core\//u, ''));
  }
  if (subpath.startsWith('shell/renderer')) {
    return path.join(kitRoot, 'shell', 'renderer', 'src');
  }
  if (subpath.startsWith('telemetry')) {
    return path.join(kitRoot, 'telemetry', 'src');
  }

  return directDir;
}

function collectRegistryModules() {
  const registry = YAML.parse(fs.readFileSync(registryPath, 'utf8'));
  const modules = [];
  for (const row of Array.isArray(registry?.modules) ? registry.modules : []) {
    const id = String(row?.id || '').trim();
    const subpath = String(row?.subpath || '').trim().replace(/^\//u, '');
    if (!id || !subpath) continue;
    const rawDependencies = Array.isArray(row?.dependencies)
      ? row.dependencies.map((item) => String(item || '').trim()).filter(Boolean)
      : [];

    modules.push({
      id,
      subpath,
      sourceRoot: sourceRootForModule(subpath),
      rawDependencies,
      dependencies: new Set(rawDependencies),
      exports: Array.isArray(row?.exports) ? row.exports.map((item) => String(item || '').trim()).filter(Boolean) : [],
    });
  }
  return modules;
}

function walkFiles(root, files = []) {
  if (!fs.existsSync(root)) return files;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) continue;
      walkFiles(absPath, files);
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name.endsWith('.d.ts')) continue;
    if (!checkedExtensions.has(path.extname(entry.name))) continue;
    files.push(absPath);
  }
  return files;
}

function scriptKindForPath(filePath) {
  switch (path.extname(filePath)) {
    case '.cjs':
    case '.js':
    case '.mjs':
      return ts.ScriptKind.JS;
    case '.jsx':
      return ts.ScriptKind.JSX;
    case '.tsx':
      return ts.ScriptKind.TSX;
    default:
      return ts.ScriptKind.TS;
  }
}

function isStringLiteralLike(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

function importDeclarationHasValue(declaration) {
  const clause = declaration.importClause;
  if (!clause) return true;
  if (clause.isTypeOnly) return false;
  if (clause.name) return true;
  const namedBindings = clause.namedBindings;
  if (!namedBindings) return false;
  if (ts.isNamespaceImport(namedBindings)) return true;
  return namedBindings.elements.some((element) => !element.isTypeOnly);
}

function exportDeclarationHasValue(declaration) {
  if (declaration.isTypeOnly) return false;
  const clause = declaration.exportClause;
  if (!clause) return true;
  if (ts.isNamespaceExport(clause)) return true;
  return clause.elements.some((element) => !element.isTypeOnly);
}

function isDynamicImportCall(node) {
  return node.expression.kind === ts.SyntaxKind.ImportKeyword;
}

function isRequireCall(node) {
  return (
    ts.isIdentifier(node.expression)
    && node.expression.text === 'require'
  );
}

function collectValueModuleSpecifiers(filePath, source) {
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, scriptKindForPath(filePath));
  const specifiers = [];

  function record(node) {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    specifiers.push({
      specifier: node.text,
      line: line + 1,
      column: character + 1,
    });
  }

  function visit(node) {
    if (ts.isImportDeclaration(node) && node.moduleSpecifier && isStringLiteralLike(node.moduleSpecifier) && importDeclarationHasValue(node)) {
      record(node.moduleSpecifier);
    }

    if (ts.isExportDeclaration(node) && node.moduleSpecifier && isStringLiteralLike(node.moduleSpecifier) && exportDeclarationHasValue(node)) {
      record(node.moduleSpecifier);
    }

    if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly && ts.isExternalModuleReference(node.moduleReference) && isStringLiteralLike(node.moduleReference.expression)) {
      record(node.moduleReference.expression);
    }

    if (ts.isCallExpression(node) && node.arguments.length > 0 && (isDynamicImportCall(node) || isRequireCall(node))) {
      const [argument] = node.arguments;
      if (isStringLiteralLike(argument)) {
        record(argument);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return specifiers;
}

function resolveRelativeSource(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null;
  const resolved = path.resolve(path.dirname(fromFile), specifier);
  const candidates = specifier.endsWith('.js')
    ? [resolved.replace(/\.js$/u, '.ts'), resolved.replace(/\.js$/u, '.tsx')]
    : [
        `${resolved}.ts`,
        `${resolved}.tsx`,
        `${resolved}.js`,
        `${resolved}.jsx`,
        `${resolved}.mjs`,
        `${resolved}.cjs`,
        path.join(resolved, 'index.ts'),
        path.join(resolved, 'index.tsx'),
        path.join(resolved, 'index.js'),
      ];

  return candidates.find((candidate) => candidate.startsWith(kitRoot) && fs.existsSync(candidate)) || null;
}

function ownerForPath(filePath, moduleRoots) {
  let best = null;
  for (const module of moduleRoots) {
    const relative = path.relative(module.sourceRoot, filePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) continue;
    if (!best || module.sourceRoot.length > best.sourceRoot.length) {
      best = module;
    }
  }
  return best;
}

function buildExportOwnerMap(modules) {
  const owners = new Map();
  for (const module of modules) {
    for (const exportKey of module.exports) {
      owners.set(exportKey, module.id);
    }
  }
  return owners;
}

function dependencyFromKitSpecifier(specifier, exportOwners) {
  if (specifier === sdkContractSpecifier) return 'sdk';
  if (!specifier.startsWith(kitPackagePrefix)) return null;

  const exportKey = `./${specifier.slice(kitPackagePrefix.length)}`;
  const sortedExports = [...exportOwners.keys()].sort((a, b) => b.length - a.length);
  for (const key of sortedExports) {
    if (exportKey === key || exportKey.startsWith(`${key}/`)) {
      return exportOwners.get(key);
    }
  }
  violations.push(`unknown @nimiplatform/kit import target: ${specifier}`);
  return null;
}

function dependencyForSpecifier(importerPath, specifier, moduleRoots, exportOwners) {
  if (specifier === '@nimiplatform/sdk' || specifier.startsWith('@nimiplatform/sdk/')) {
    return 'sdk';
  }

  const packageDependency = dependencyFromKitSpecifier(specifier, exportOwners);
  if (packageDependency) return packageDependency;

  const relativeSource = resolveRelativeSource(importerPath, specifier);
  if (!relativeSource) return null;

  if (path.normalize(relativeSource) === path.normalize(sdkContractPath)) {
    return 'sdk';
  }

  return ownerForPath(relativeSource, moduleRoots)?.id || null;
}

const kitPackage = readJson(packageJsonPath);
const modules = collectRegistryModules();
const moduleById = new Map(modules.map((module) => [module.id, module]));
const moduleRoots = modules
  .filter((module) => fs.existsSync(module.sourceRoot))
  .sort((a, b) => b.sourceRoot.length - a.sourceRoot.length);
const exportOwners = buildExportOwnerMap(modules);
const packageExports = new Set(Object.keys(kitPackage.exports || {}));

for (const module of modules) {
  const duplicateDependencies = module.rawDependencies.filter((dependency, index) => module.rawDependencies.indexOf(dependency) !== index);
  if (duplicateDependencies.length > 0) {
    violations.push(`nimi-kit-registry.yaml ${module.id}: dependencies must be unique (${[...new Set(duplicateDependencies)].join(', ')})`);
  }

  for (const dependency of module.dependencies) {
    if (dependency === 'sdk') continue;
    if (!dependency.startsWith('kit.')) continue;
    if (!moduleById.has(dependency)) {
      violations.push(`nimi-kit-registry.yaml ${module.id}: dependency ${dependency} is not a registered kit module or sdk`);
    }
  }
  for (const exportKey of module.exports) {
    if (!packageExports.has(exportKey)) {
      violations.push(`nimi-kit-registry.yaml ${module.id}: export ${exportKey} missing from kit/package.json`);
    }
  }
}

for (const filePath of walkFiles(kitRoot)) {
  const owner = ownerForPath(filePath, moduleRoots);
  if (!owner) continue;

  const source = fs.readFileSync(filePath, 'utf8');
  const fileRel = rel(filePath);
  for (const { specifier, line, column } of collectValueModuleSpecifiers(filePath, source)) {
    const dependency = dependencyForSpecifier(filePath, specifier, moduleRoots, exportOwners);
    if (!dependency || dependency === owner.id) continue;

    if (!owner.dependencies.has(dependency)) {
      violations.push(`${fileRel}:${line}:${column}: ${owner.id} value-imports ${dependency} via ${specifier}, but registry dependencies are [${[...owner.dependencies].join(', ')}]`);
    }
  }
}

if (violations.length > 0) {
  process.stderr.write(`Kit module dependency boundary check failed:\n${violations.map((item) => `- ${item}`).join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('Kit module dependency boundary check passed\n');
}
