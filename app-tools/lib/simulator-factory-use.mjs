import ts from 'typescript';
import { SimulatorConformanceError } from './simulator-manifest.mjs';
import {
  canonicalRelative,
  resolveRelativeImport,
} from './simulator-conformance-graph.mjs';

function fail(code, message, fieldPath = '') {
  throw new SimulatorConformanceError(code, message, fieldPath);
}

function reachableModulePaths(graph, entryPath) {
  const queue = [entryPath];
  const seen = new Set();
  while (queue.length > 0) {
    const current = queue.shift();
    if (seen.has(current)) continue;
    seen.add(current);
    queue.push(...(graph.nodes.get(current)?.imports || []));
  }
  return [...seen];
}

function canonicalBindings(rootDir, filePath, source, factoryPath, factoryExport) {
  const direct = new Set();
  const namespaces = new Set();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)
      || !statement.importClause
      || statement.importClause.isTypeOnly
      || !ts.isStringLiteral(statement.moduleSpecifier)
      || !statement.moduleSpecifier.text.startsWith('.')) continue;
    const resolved = resolveRelativeImport(rootDir, filePath, statement.moduleSpecifier.text);
    if (resolved !== factoryPath) continue;
    const bindings = statement.importClause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
      continue;
    }
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if (element.isTypeOnly) continue;
      const imported = element.propertyName?.text ?? element.name.text;
      if (imported === factoryExport) direct.add(element.name.text);
    }
  }
  return { direct, namespaces };
}

function isImportBindingIdentifier(node) {
  return (ts.isImportSpecifier(node.parent) && node.parent.name === node)
    || (ts.isNamespaceImport(node.parent) && node.parent.name === node);
}

function isDeclarationIdentifier(node) {
  const parent = node.parent;
  return (ts.isVariableDeclaration(parent) && parent.name === node)
    || (ts.isParameter(parent) && parent.name === node)
    || (ts.isBindingElement(parent) && parent.name === node)
    || ((ts.isFunctionDeclaration(parent) || ts.isClassDeclaration(parent)) && parent.name === node)
    || (ts.isCatchClause(parent) && parent.variableDeclaration?.name === node);
}

function assertUnshadowed(source, names, relativePath) {
  const visit = (node) => {
    if (ts.isIdentifier(node)
      && names.has(node.text)
      && !isImportBindingIdentifier(node)
      && isDeclarationIdentifier(node)) {
      fail(
        'SIM_CANONICAL_FACTORY_BINDING_SHADOWED',
        `canonical factory import binding ${JSON.stringify(node.text)} cannot be shadowed`,
        relativePath,
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

function directFactoryCall(call, direct, namespaces, factoryExport) {
  if (!ts.isPropertyAccessExpression(call.expression)
    || call.expression.name.text !== 'createInstance') return false;
  const owner = call.expression.expression;
  if (ts.isIdentifier(owner)) return direct.has(owner.text);
  return ts.isPropertyAccessExpression(owner)
    && ts.isIdentifier(owner.expression)
    && namespaces.has(owner.expression.text)
    && owner.name.text === factoryExport;
}

function externalPackageBindings(source) {
  const bindings = new Set();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)
      || !statement.importClause
      || statement.importClause.isTypeOnly
      || !ts.isStringLiteral(statement.moduleSpecifier)
      || statement.moduleSpecifier.text.startsWith('.')) continue;
    const clause = statement.importClause;
    if (clause.name) bindings.add(clause.name.text);
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      bindings.add(clause.namedBindings.name.text);
    }
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        if (!element.isTypeOnly) bindings.add(element.name.text);
      }
    }
  }
  return bindings;
}

function callOwnerRoot(call) {
  if (!ts.isPropertyAccessExpression(call.expression)) return null;
  let owner = call.expression.expression;
  while (ts.isPropertyAccessExpression(owner) || ts.isElementAccessExpression(owner)) {
    owner = owner.expression;
  }
  return ts.isIdentifier(owner) ? owner.text : null;
}

/**
 * Proves that an invocation closure does not merely reach the canonical factory
 * module: one exact runtime import binding must call its createInstance method.
 * Indirection and shadowing are intentionally rejected because they make the
 * selected-source proof dependent on control-flow interpretation.
 */
export function assertInvocationUsesCanonicalFactory({
  rootDir,
  graph,
  entryPath,
  factoryPath,
  factoryExport,
  code,
  fieldPath,
}) {
  const calls = [];
  for (const filePath of reachableModulePaths(graph, entryPath)) {
    const node = graph.nodes.get(filePath);
    if (!node || node.type !== 'module') continue;
    const bindings = canonicalBindings(rootDir, filePath, node.source, factoryPath, factoryExport);
    const packageBindings = externalPackageBindings(node.source);
    const relativePath = canonicalRelative(rootDir, filePath);
    if (bindings.direct.size > 0 || bindings.namespaces.size > 0) {
      assertUnshadowed(node.source, new Set([...bindings.direct, ...bindings.namespaces]), relativePath);
    }
    const visit = (astNode) => {
      if (ts.isCallExpression(astNode)
        && ts.isPropertyAccessExpression(astNode.expression)
        && astNode.expression.name.text === 'createInstance') {
        if (!directFactoryCall(astNode, bindings.direct, bindings.namespaces, factoryExport)) {
          const ownerRoot = callOwnerRoot(astNode);
          if (ownerRoot && packageBindings.has(ownerRoot)) {
            ts.forEachChild(astNode, visit);
            return;
          }
          fail(
            code,
            'invocation closure calls createInstance through a non-canonical factory binding',
            relativePath,
          );
        }
        calls.push({ path: relativePath, offset: astNode.getStart(node.source) });
      }
      ts.forEachChild(astNode, visit);
    };
    visit(node.source);
  }
  if (calls.length === 0) {
    fail(
      code,
      `invocation closure must directly call ${factoryExport}.createInstance through its exact runtime import binding`,
      fieldPath,
    );
  }
  return Object.freeze(calls.sort((left, right) =>
    left.path.localeCompare(right.path) || left.offset - right.offset));
}
