import ts from 'typescript';
import { SIMULATOR_EFFECT_POLICY } from './simulator-effect-policy.generated.mjs';
import { SimulatorConformanceError } from './simulator-manifest.mjs';

const ABSTRACT_SURFACES = new Set([
  'global_aria_state',
  'global_scroll_lock',
  'portal_into_assigned_overlay_root',
]);
const SPECIAL_SURFACES = new Set(['new_Date_without_explicit_value']);
const GLOBAL_ROOTS = new Set([
  'crypto',
  'Date',
  'document',
  'globalThis',
  'HTMLFormElement',
  'HTMLElement',
  'location',
  'Math',
  'MessagePort',
  'navigator',
  'performance',
  'window',
]);
const TERMINAL_SURFACES = new Map([
  ['inert', 'HTMLElement.inert'],
  ['postMessage', 'MessagePort.postMessage'],
  ['submit', 'HTMLFormElement.submit'],
]);
const SURFACE_ALIASES = new Map([
  ['fetch', 'globalThis.fetch'],
]);
const GLOBAL_PROPERTY_SURFACES = new Map([
  ['caches', 'globalThis.caches'],
  ['fetch', 'globalThis.fetch'],
  ['open', 'window.open'],
  ['postMessage', 'window.postMessage'],
]);

function fail(code, message, fieldPath = '') {
  throw new SimulatorConformanceError(code, message, fieldPath);
}

function unwrap(node) {
  let current = node;
  while (current
    && (ts.isAsExpression(current)
      || ts.isSatisfiesExpression(current)
      || ts.isParenthesizedExpression(current)
      || ts.isTypeAssertionExpression(current)
      || ts.isNonNullExpression(current))) {
    current = current.expression;
  }
  return current;
}

function staticElementName(node) {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : null;
}

function staticMemberPath(node) {
  const expression = unwrap(node);
  if (!expression) return null;
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) {
    const prefix = staticMemberPath(expression.expression);
    return prefix ? `${prefix}.${expression.name.text}` : null;
  }
  if (ts.isElementAccessExpression(expression)) {
    const prefix = staticMemberPath(expression.expression);
    const name = staticElementName(expression.argumentExpression);
    return prefix && name ? `${prefix}.${name}` : null;
  }
  return null;
}

function rootOfPath(memberPath) {
  return memberPath?.split('.')[0] || '';
}

function globalPathCandidates(memberPath) {
  const candidates = [];
  let current = memberPath;
  while (current) {
    candidates.push(current);
    if (current.startsWith('globalThis.')) current = current.slice('globalThis.'.length);
    else if (current.startsWith('window.')) current = current.slice('window.'.length);
    else break;
  }
  return candidates;
}

function governedRootIdentity(memberPath) {
  return globalPathCandidates(memberPath).find((candidate) => GLOBAL_ROOTS.has(candidate)) || null;
}

function effectSurfaceForPath(memberPath, effects) {
  for (const [index, candidate] of globalPathCandidates(memberPath).entries()) {
    if (effects.has(candidate)) return candidate;
    const globalSurface = index > 0 ? GLOBAL_PROPERTY_SURFACES.get(candidate) : null;
    if (globalSurface && effects.has(globalSurface)) return globalSurface;
  }
  return null;
}

function isIdentifierReference(node) {
  const parent = node.parent;
  if (!parent) return true;
  if ((ts.isPropertyAccessExpression(parent) && parent.name === node)
    || (ts.isPropertyAssignment(parent) && parent.name === node)
    || (ts.isMethodDeclaration(parent) && parent.name === node)
    || (ts.isPropertyDeclaration(parent) && parent.name === node)
    || (ts.isParameter(parent) && parent.name === node)
    || (ts.isVariableDeclaration(parent) && parent.name === node)
    || ts.isImportClause(parent)
    || ts.isImportSpecifier(parent)
    || ts.isNamespaceImport(parent)
    || ts.isExportSpecifier(parent)
    || (ts.isJsxAttribute(parent) && parent.name === node)
    || (ts.isJsxOpeningElement(parent) && parent.tagName === node)
    || (ts.isJsxClosingElement(parent) && parent.tagName === node)
    || (ts.isJsxSelfClosingElement(parent) && parent.tagName === node)
    || (ts.isBindingElement(parent) && (parent.name === node || parent.propertyName === node))
    || ts.isTypeReferenceNode(parent)
    || ts.isExpressionWithTypeArguments(parent)
    || ts.isQualifiedName(parent)
    || ts.isTypeAliasDeclaration(parent)
    || ts.isInterfaceDeclaration(parent)) {
    return false;
  }
  return true;
}

function isDynamicGovernedAccess(node) {
  if (!ts.isElementAccessExpression(node) || staticElementName(node.argumentExpression) !== null) return false;
  const ownerPath = staticMemberPath(node.expression);
  return ownerPath !== null && GLOBAL_ROOTS.has(rootOfPath(ownerPath));
}

function isRootAliasEscape(node, memberPath) {
  const rootIdentity = governedRootIdentity(memberPath);
  if (!rootIdentity) return false;
  if (ts.isIdentifier(node) && !isIdentifierReference(node)) return false;
  let parent = node.parent;
  let expression = node;
  while (parent
    && (ts.isAsExpression(parent)
      || ts.isSatisfiesExpression(parent)
      || ts.isParenthesizedExpression(parent)
      || ts.isTypeAssertionExpression(parent)
      || ts.isNonNullExpression(parent))) {
    expression = parent;
    parent = parent.parent;
  }
  if ((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent))
    && parent.expression === expression) {
    return false;
  }
  if (rootIdentity === 'Date'
    && ts.isNewExpression(parent)
    && parent.expression === expression
    && (parent.arguments?.length || 0) > 0) {
    return false;
  }
  return true;
}

function isObjectBindingAlias(node) {
  if (!ts.isVariableDeclaration(node) || !ts.isObjectBindingPattern(node.name) || !node.initializer) return false;
  const memberPath = staticMemberPath(node.initializer);
  return memberPath !== null && GLOBAL_ROOTS.has(rootOfPath(memberPath));
}

function isPortalCall(node, portalBindings, portalNamespaces) {
  if (!ts.isCallExpression(node)) return false;
  const memberPath = staticMemberPath(node.expression);
  if (memberPath && portalBindings.has(memberPath)) return true;
  const [namespace, member, extra] = memberPath?.split('.') || [];
  return !extra && member === 'createPortal' && portalNamespaces.has(namespace);
}

function isNoArgDateConstruction(node) {
  return ((ts.isNewExpression(node) && (node.arguments?.length || 0) === 0)
      || ts.isCallExpression(node))
    && governedRootIdentity(staticMemberPath(node.expression)) === 'Date';
}

function collectPortalBindings(source) {
  const portalBindings = new Set();
  const portalNamespaces = new Set();
  const visit = (node) => {
    if (ts.isImportDeclaration(node)
      && ts.isStringLiteral(node.moduleSpecifier)
      && /^react-dom(?:\/|$)/u.test(node.moduleSpecifier.text)
      && node.importClause?.namedBindings) {
      const bindings = node.importClause.namedBindings;
      if (ts.isNamespaceImport(bindings)) portalNamespaces.add(bindings.name.text);
      if (ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if ((element.propertyName?.text || element.name.text) === 'createPortal') {
            portalBindings.add(element.name.text);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { portalBindings, portalNamespaces };
}

function policyIndex(owner) {
  const index = new Map();
  for (const entry of SIMULATOR_EFFECT_POLICY.entries) {
    if (entry.classification === 'pure_read' || !entry.governedOwners.includes(owner)) continue;
    for (const surface of entry.surfaces) index.set(surface, entry);
  }
  return index;
}

function assertProjectionCoverage() {
  for (const entry of SIMULATOR_EFFECT_POLICY.entries) {
    for (const surface of entry.surfaces) {
      if (ABSTRACT_SURFACES.has(surface) || SPECIAL_SURFACES.has(surface)) continue;
      if (!/^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/u.test(surface)) {
        throw new Error(`unsupported Simulator browser-effect surface ${JSON.stringify(surface)}`);
      }
    }
  }
}

assertProjectionCoverage();

export function assertSimulatorStaticEffects(source, relativePath, owner) {
  const effects = policyIndex(owner);
  if (effects.size === 0) return;
  const {
    portalBindings,
    portalNamespaces,
  } = collectPortalBindings(source);

  const reject = (entry, surface) => fail(
    'SIMULATOR_EFFECT_FORBIDDEN',
    `${entry.classification} browser effect ${JSON.stringify(surface)} (${entry.id}) is forbidden for ${owner}`,
    relativePath,
  );

  const visit = (node) => {
    if (ts.isTypeNode(node)) return;
    if (isDynamicGovernedAccess(node)) {
      fail(
        'SIM_EFFECT_DYNAMIC_BROWSER_ACCESS',
        'computed browser-global access cannot be proven against the closed effect catalog',
        relativePath,
      );
    }
    if (isObjectBindingAlias(node)) {
      fail(
        'SIM_EFFECT_ALIAS_BROWSER_ACCESS',
        'browser-global destructuring cannot be proven against the closed effect catalog',
        relativePath,
      );
    }
    if (isNoArgDateConstruction(node)) {
      const entry = effects.get('new_Date_without_explicit_value');
      if (entry) reject(entry, 'new_Date_without_explicit_value');
    }
    if (isPortalCall(node, portalBindings, portalNamespaces)) {
      const entry = effects.get('portal_into_assigned_overlay_root');
      if (entry) reject(entry, 'portal_into_assigned_overlay_root');
    }

    const memberPath = staticMemberPath(node);
    if (memberPath && isRootAliasEscape(node, memberPath)) {
      fail(
        'SIM_EFFECT_ALIAS_BROWSER_ACCESS',
        'browser-global aliases cannot be proven against the closed effect catalog',
        relativePath,
      );
    }
    const exactSurface = memberPath && (!ts.isIdentifier(node) || isIdentifierReference(node))
      ? effectSurfaceForPath(memberPath, effects)
      : null;
    if (exactSurface) reject(effects.get(exactSurface), exactSurface);

    if (ts.isIdentifier(node) && isIdentifierReference(node)) {
      const aliasedSurface = SURFACE_ALIASES.get(node.text);
      const entry = effects.get(node.text) || (aliasedSurface && effects.get(aliasedSurface));
      if (entry) reject(entry, effects.has(node.text) ? node.text : aliasedSurface);
    }
    if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))) {
      const terminalName = ts.isPropertyAccessExpression(node)
        ? node.name.text
        : staticElementName(node.argumentExpression);
      const terminalSurface = terminalName && TERMINAL_SURFACES.get(terminalName);
      const entry = terminalSurface && effects.get(terminalSurface);
      if (entry) reject(entry, terminalSurface);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

export const simulatorStaticEffectInternals = Object.freeze({
  ABSTRACT_SURFACES,
  SPECIAL_SURFACES,
  staticMemberPath,
});
