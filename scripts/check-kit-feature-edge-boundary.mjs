#!/usr/bin/env node

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import YAML from 'yaml';

const repoRoot = process.cwd();
const kitRoot = path.join(repoRoot, 'kit');
const featuresRoot = path.join(kitRoot, 'features');
const registryPath = path.join(repoRoot, '.nimi', 'spec', 'platform', 'kernel', 'tables', 'nimi-kit-registry.yaml');
const requireFromKit = createRequire(path.join(kitRoot, 'package.json'));
const packageFeaturePrefix = '@nimiplatform/kit/features';
const ignoredDirectories = new Set(['.cache', 'dist', 'gen', 'generated', 'node_modules']);
const checkedExtensions = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx']);
const violations = [];

let ts;
try {
  ts = requireFromKit('typescript');
} catch (error) {
  process.stderr.write(`Kit feature edge boundary check failed: unable to load kit TypeScript dependency (${error.message})\n`);
  process.exit(1);
}

function rel(absPath) {
  return path.relative(repoRoot, absPath).split(path.sep).join('/');
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

function discoverFeatures() {
  if (!fs.existsSync(featuresRoot)) return new Set();
  return new Set(
    fs.readdirSync(featuresRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !ignoredDirectories.has(entry.name))
      .map((entry) => entry.name),
  );
}

function parseRegistryFeatureEdges(knownFeatures) {
  const registry = YAML.parse(fs.readFileSync(registryPath, 'utf8'));
  const edges = new Map();
  const modules = Array.isArray(registry?.modules) ? registry.modules : [];
  const registryFeatures = new Set();

  for (const row of modules) {
    const id = String(row?.id || '').trim();
    if (id.startsWith('kit.features.')) {
      registryFeatures.add(id.slice('kit.features.'.length));
    }
  }

  for (const row of modules) {
    const id = String(row?.id || '').trim();
    if (!id.startsWith('kit.features.')) continue;

    const source = id.slice('kit.features.'.length);
    if (!knownFeatures.has(source)) {
      violations.push(`nimi-kit-registry.yaml ${id}: registered feature is missing on disk at kit/features/${source}`);
    }

    const dependencies = Array.isArray(row?.dependencies) ? row.dependencies : [];
    for (const dependency of dependencies) {
      const dep = String(dependency || '').trim();
      if (!dep.startsWith('kit.features.')) continue;

      const target = dep.slice('kit.features.'.length);
      if (!registryFeatures.has(target)) {
        violations.push(`nimi-kit-registry.yaml ${id}: dependency ${dep} is not a registered feature module`);
      }
      if (!knownFeatures.has(target)) {
        violations.push(`nimi-kit-registry.yaml ${id}: dependency ${dep} is missing on disk at kit/features/${target}`);
      }
      if (!edges.has(source)) {
        edges.set(source, new Set());
      }
      edges.get(source).add(target);
    }
  }

  return edges;
}

function featureForFile(absPath) {
  const relative = path.relative(featuresRoot, absPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  const [feature] = relative.split(path.sep);
  return feature || null;
}

function targetFeatureFromPackageSpecifier(specifier) {
  if (specifier === packageFeaturePrefix) {
    return { kind: 'aggregate', feature: null };
  }
  if (!specifier.startsWith(`${packageFeaturePrefix}/`)) {
    return null;
  }
  const [feature] = specifier.slice(packageFeaturePrefix.length + 1).split('/');
  return feature ? { kind: 'feature', feature } : { kind: 'aggregate', feature: null };
}

function targetFeatureFromRelativeSpecifier(importerPath, specifier) {
  if (!specifier.startsWith('.')) return null;
  const resolved = path.resolve(path.dirname(importerPath), specifier);
  const relative = path.relative(featuresRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  const [feature] = relative.split(path.sep);
  return feature ? { kind: 'feature', feature } : { kind: 'aggregate', feature: null };
}

function targetFeatureForSpecifier(importerPath, specifier) {
  return targetFeatureFromPackageSpecifier(specifier) || targetFeatureFromRelativeSpecifier(importerPath, specifier);
}

function formatAdmittedEdges() {
  return [...admittedFeatureEdges.entries()]
    .flatMap(([source, targets]) => [...targets].map((target) => `${source} -> ${target}`))
    .join(', ');
}

function isStringLiteralLike(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
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

function isDynamicImportCall(node) {
  return node.expression.kind === ts.SyntaxKind.ImportKeyword;
}

function isRequireCall(node) {
  if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
    return true;
  }
  return (
    ts.isPropertyAccessExpression(node.expression)
    && ts.isIdentifier(node.expression.expression)
    && node.expression.expression.text === 'require'
    && node.expression.name.text === 'resolve'
  );
}

function collectModuleSpecifiers(filePath, source) {
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
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && isStringLiteralLike(node.moduleSpecifier)) {
      record(node.moduleSpecifier);
    }

    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && isStringLiteralLike(node.moduleReference.expression)) {
      record(node.moduleReference.expression);
    }

    if (ts.isImportTypeNode(node)) {
      const argument = node.argument;
      if (ts.isLiteralTypeNode(argument) && isStringLiteralLike(argument.literal)) {
        record(argument.literal);
      }
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

const features = discoverFeatures();
const admittedFeatureEdges = parseRegistryFeatureEdges(features);
const admittedEdgeSummary = formatAdmittedEdges();

for (const filePath of walkFiles(featuresRoot)) {
  const sourceFeature = featureForFile(filePath);
  if (!sourceFeature) continue;

  const fileRel = rel(filePath);
  const source = fs.readFileSync(filePath, 'utf8');
  for (const { specifier, line, column } of collectModuleSpecifiers(filePath, source)) {
    const target = targetFeatureForSpecifier(filePath, specifier);
    if (!target) continue;

    if (target.kind === 'aggregate') {
      violations.push(`${fileRel}:${line}:${column}: feature source must not import the kit feature aggregate (${specifier})`);
      continue;
    }

    if (!features.has(target.feature)) {
      violations.push(`${fileRel}:${line}:${column}: imports unknown kit feature ${target.feature} (${specifier})`);
      continue;
    }

    if (target.feature === sourceFeature) continue;
    if (admittedFeatureEdges.get(sourceFeature)?.has(target.feature)) continue;

    violations.push(
      `${fileRel}:${line}:${column}: ${sourceFeature} imports unadmitted kit feature ${target.feature} (${specifier}); admitted edges: ${admittedEdgeSummary}`,
    );
  }
}

if (violations.length > 0) {
  process.stderr.write(`Kit feature edge boundary check failed:\n${violations.map((item) => `- ${item}`).join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('Kit feature edge boundary check passed\n');
}
