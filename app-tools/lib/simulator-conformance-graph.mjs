import { readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { assertSimulatorStaticEffects } from './simulator-static-effects.mjs';
import { SimulatorConformanceError } from './simulator-manifest.mjs';

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.css'];
const STATIC_ASSET_EXTENSIONS = new Set(['.png']);
const FORBIDDEN_IMPORT_PATTERNS = [
  ['SIM_IMPORT_RUNTIME_PRIVATE', /(?:^|\/)runtime\/internal(?:\/|$)/],
  ['SIM_IMPORT_DESKTOP_PRIVATE', /(?:^|\/)apps\/desktop(?:\/|$)/],
  ['SIM_IMPORT_TAURI', /^@tauri-apps\//],
  ['SIM_IMPORT_ELECTRON', /^electron(?:\/|$)/],
  ['SIM_IMPORT_NODE_BUILTIN', /^(?:node:|fs(?:\/|$)|net(?:\/|$)|tls(?:\/|$)|child_process$|worker_threads$)/],
];
const FORBIDDEN_CALLS = new Map([
  ['createBrowserHistory', 'SIM_FACTORY_BROWSER_HISTORY'],
  ['createBrowserRouter', 'SIM_FACTORY_BROWSER_HISTORY'],
  ['createHashRouter', 'SIM_FACTORY_BROWSER_HISTORY'],
  ['createRoot', 'SIM_RENDERER_SELF_MOUNT'],
]);
const FACTORY_FORBIDDEN_BINDINGS = new Set([
  'environment',
  'hostKind',
  'isSimulator',
  'providerIdentity',
  'rawEpoch',
  'rawInstanceId',
  'rawModuleId',
  'shellMode',
]);
const MODULE_MUTATING_METHODS = new Set([
  'add',
  'clear',
  'copyWithin',
  'delete',
  'fill',
  'pop',
  'push',
  'reverse',
  'set',
  'shift',
  'sort',
  'splice',
  'unshift',
]);
const MODULE_RESOURCE_FACTORY_PATTERN = /^(?:build|configure|create|make|open)[A-Za-z0-9_$]*(?:Cache|Channel|Client|History|I18n|Instance|Loader|Pool|QueryClient|Registry|Router|Session|Store|Transport)$/u;
const MODULE_SCOPE_IMMUTABLE_CONSTRUCTORS = new Set(['Intl.DateTimeFormat']);
const IMPORT_META_GLOB_METHODS = new Set(['glob', 'globEager']);
const ADAPTER_FORBIDDEN_RUNTIME_IMPORTS = [
  /^react$/u,
  /^react\//u,
  /^react-dom$/u,
  /^react-dom\//u,
];
const ADAPTER_DOM_METHODS = new Set([
  'append',
  'appendChild',
  'before',
  'insertAdjacentElement',
  'insertAdjacentHTML',
  'insertAdjacentText',
  'insertBefore',
  'prepend',
  'querySelector',
  'querySelectorAll',
  'remove',
  'removeAttribute',
  'removeChild',
  'replaceChild',
  'replaceChildren',
  'setAttribute',
  'toggleAttribute',
]);
const ADAPTER_DOM_MUTABLE_PROPERTIES = new Set([
  'className',
  'innerHTML',
  'inert',
  'outerHTML',
  'textContent',
]);

function fail(code, message, fieldPath = '') {
  throw new SimulatorConformanceError(code, message, fieldPath);
}

export function canonicalRelative(rootDir, absolutePath) {
  return path.relative(rootDir, absolutePath).split(path.sep).join('/');
}

export function assertContainedFile(rootDir, relativePath, fieldPath) {
  const absoluteRoot = realpathSync(rootDir);
  const absolutePath = path.resolve(absoluteRoot, ...relativePath.split('/'));
  if (!absolutePath.startsWith(`${absoluteRoot}${path.sep}`)) {
    fail('SIM_SOURCE_PATH_ESCAPE', 'path escapes source root', fieldPath);
  }
  let stat;
  try {
    stat = statSync(absolutePath);
  } catch {
    fail('SIM_SOURCE_FILE_MISSING', `source file ${JSON.stringify(relativePath)} does not exist`, fieldPath);
  }
  if (!stat.isFile()) {
    fail('SIM_SOURCE_FILE_KIND', 'source path must resolve to a regular file', fieldPath);
  }
  const real = realpathSync(absolutePath);
  if (!real.startsWith(`${absoluteRoot}${path.sep}`)) {
    fail('SIM_SOURCE_PATH_ESCAPE', 'source file realpath escapes source root', fieldPath);
  }
  return real;
}

function sourceKind(filePath) {
  if (/\.[cm]?tsx?$/.test(filePath)) return ts.ScriptKind.TSX;
  if (/\.jsx$/.test(filePath)) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

function parseSourceFile(filePath) {
  const text = readFileSync(filePath, 'utf8');
  return parseSourceText(text, filePath);
}

function parseSourceText(text, filePath) {
  const source = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, sourceKind(filePath));
  const diagnostics = source.parseDiagnostics || [];
  if (diagnostics.length > 0) {
    fail(
      'SIM_SOURCE_PARSE',
      diagnostics.map((entry) => ts.flattenDiagnosticMessageText(entry.messageText, '\n')).join('; '),
      filePath,
    );
  }
  return source;
}

function tryFile(candidate) {
  try {
    return statSync(candidate).isFile() ? realpathSync(candidate) : null;
  } catch {
    return null;
  }
}

export function resolveRelativeImport(rootDir, importerPath, specifier) {
  const candidate = path.resolve(path.dirname(importerPath), specifier);
  const attempts = [candidate];
  const extension = path.extname(candidate);
  if (!extension) {
    attempts.push(...SOURCE_EXTENSIONS.map((sourceExtension) => `${candidate}${sourceExtension}`));
    attempts.push(...SOURCE_EXTENSIONS.map((sourceExtension) => path.join(candidate, `index${sourceExtension}`)));
  } else {
    const sourceExtensions = extension === '.js' || extension === '.jsx'
      ? ['.ts', '.tsx']
      : extension === '.mjs'
        ? ['.mts']
        : extension === '.cjs'
          ? ['.cts']
          : [];
    const stem = candidate.slice(0, -extension.length);
    attempts.push(...sourceExtensions.map((sourceExtension) => `${stem}${sourceExtension}`));
  }
  const resolved = attempts.map(tryFile).find(Boolean);
  if (!resolved) {
    fail('SIM_IMPORT_UNRESOLVED', `cannot resolve relative import ${JSON.stringify(specifier)}`, canonicalRelative(rootDir, importerPath));
  }
  const rootReal = realpathSync(rootDir);
  if (!resolved.startsWith(`${rootReal}${path.sep}`)) {
    fail('SIM_IMPORT_ESCAPE', `relative import ${JSON.stringify(specifier)} escapes source root`, canonicalRelative(rootDir, importerPath));
  }
  return resolved;
}

function isImportMetaProperty(node, propertyNames) {
  if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) return false;
  if (!ts.isMetaProperty(node.expression)
    || node.expression.keywordToken !== ts.SyntaxKind.ImportKeyword
    || node.expression.name.text !== 'meta') return false;
  const propertyName = ts.isPropertyAccessExpression(node)
    ? node.name.text
    : node.argumentExpression && (ts.isStringLiteral(node.argumentExpression)
      || ts.isNoSubstitutionTemplateLiteral(node.argumentExpression))
      ? node.argumentExpression.text
      : '';
  return propertyNames.has(propertyName);
}

function isTypeOnlyImportDeclaration(node) {
  const clause = node.importClause;
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  if (clause.name || !clause.namedBindings || ts.isNamespaceImport(clause.namedBindings)) return false;
  return clause.namedBindings.elements.length > 0
    && clause.namedBindings.elements.every((element) => element.isTypeOnly);
}

function importSpecifiers(source, relativePath) {
  const values = [];
  const visit = (node) => {
    if (ts.isImportEqualsDeclaration(node)) {
      fail('SIM_IMPORT_EQUALS', 'TypeScript import-equals/require loading is forbidden', relativePath);
    }
    if (ts.isImportDeclaration(node)
      && node.moduleSpecifier
      && ts.isStringLiteral(node.moduleSpecifier)
      && !isTypeOnlyImportDeclaration(node)) {
      values.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node)
      && node.moduleSpecifier
      && ts.isStringLiteral(node.moduleSpecifier)
      && !node.isTypeOnly) {
      values.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      if (node.arguments.length !== 1
        || (!ts.isStringLiteral(node.arguments[0]) && !ts.isNoSubstitutionTemplateLiteral(node.arguments[0]))) {
        fail('SIM_IMPORT_DYNAMIC_NON_LITERAL', 'dynamic import targets must be one exact string literal', relativePath);
      }
      values.push(node.arguments[0].text);
    } else if (ts.isCallExpression(node)
      && (isImportMetaProperty(node.expression, IMPORT_META_GLOB_METHODS)
        || (ts.isPropertyAccessExpression(node.expression)
          && isImportMetaProperty(node.expression.expression, IMPORT_META_GLOB_METHODS)))) {
      fail('SIM_IMPORT_META_GLOB', 'import.meta glob module discovery is forbidden', relativePath);
    } else if (ts.isCallExpression(node)
      && ((ts.isIdentifier(node.expression) && node.expression.text === 'require')
        || (ts.isPropertyAccessExpression(node.expression)
          && ((ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'require')
            || node.expression.name.text === 'require')))) {
      fail('SIM_IMPORT_REQUIRE', 'CommonJS require loading is forbidden', relativePath);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return values;
}

export function assertImportAllowed(specifier, importer) {
  for (const [code, pattern] of FORBIDDEN_IMPORT_PATTERNS) {
    if (pattern.test(specifier)) {
      fail(code, `forbidden import ${JSON.stringify(specifier)}`, importer);
    }
  }
  if (specifier.startsWith('/') || specifier.includes('\\') || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(specifier)) {
    fail('SIM_IMPORT_ABSOLUTE_OR_REMOTE', `absolute and remote import ${JSON.stringify(specifier)} is forbidden`, importer);
  }
  if (specifier.startsWith('#')) {
    fail('SIM_IMPORT_APP_CONDITION', `App-owned import condition ${JSON.stringify(specifier)} is forbidden`, importer);
  }
}

function exportedNames(source) {
  const names = new Set();
  for (const statement of source.statements) {
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) || [] : [];
    const isExported = modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (isExported) {
      if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) {
        names.add(statement.name.text);
      }
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
        }
      }
    }
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) names.add(element.name.text);
    }
    if (ts.isExportAssignment(statement)) names.add('default');
  }
  return names;
}

function unwrapTsExpression(node) {
  let current = node;
  while (current
    && (ts.isAsExpression(current)
      || ts.isSatisfiesExpression(current)
      || ts.isParenthesizedExpression(current)
      || ts.isTypeAssertionExpression(current))) {
    current = current.expression;
  }
  return current;
}

function bindingIdentifiers(name, result = new Set()) {
  if (ts.isIdentifier(name)) {
    result.add(name.text);
    return result;
  }
  for (const element of name.elements || []) {
    if (ts.isBindingElement(element)) bindingIdentifiers(element.name, result);
  }
  return result;
}

function expressionRootIdentifier(node) {
  let current = unwrapTsExpression(node);
  while (current && (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current))) {
    current = unwrapTsExpression(current.expression);
  }
  return current && ts.isIdentifier(current) ? current.text : null;
}

function assignmentOperator(kind) {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

function callName(node) {
  const expression = unwrapTsExpression(node.expression);
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return '';
}

function hasModifier(node, kind) {
  return (ts.canHaveModifiers(node) ? ts.getModifiers(node) || [] : [])
    .some((modifier) => modifier.kind === kind);
}

function functionLikeInitializer(node) {
  const initializer = unwrapTsExpression(node);
  return initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
    ? initializer
    : null;
}

function assertNoModuleEvaluationResources(node, source, relativePath) {
  const visit = (current) => {
    const expression = unwrapTsExpression(current);
    if (!expression) return;
    if (isFunctionLikeNode(expression)) return;
    if (ts.isCallExpression(expression) && functionLikeInitializer(expression.expression)) {
      fail('SIM_MODULE_SCOPE_IIFE', 'module-evaluation IIFEs are forbidden in the canonical local closure', relativePath);
    }
    if (ts.isCallExpression(expression) && MODULE_RESOURCE_FACTORY_PATTERN.test(callName(expression))) {
      fail(
        'SIM_MODULE_SCOPE_RESOURCE',
        `module-scope resource factory ${JSON.stringify(callName(expression))} must run per renderer instance`,
        relativePath,
      );
    }
    if (ts.isNewExpression(expression)) {
      const constructorName = expression.expression.getText(source);
      if (!MODULE_SCOPE_IMMUTABLE_CONSTRUCTORS.has(constructorName)) {
        fail(
          'SIM_MODULE_SCOPE_RESOURCE',
          `module-scope constructed resource ${JSON.stringify(constructorName)} must be created per renderer instance`,
          relativePath,
        );
      }
    }
    ts.forEachChild(expression, (child) => visit(child));
  };
  visit(node);
}

function isFunctionLikeNode(node) {
  return ts.isFunctionDeclaration(node)
    || ts.isFunctionExpression(node)
    || ts.isArrowFunction(node)
    || ts.isMethodDeclaration(node)
    || ts.isGetAccessorDeclaration(node)
    || ts.isSetAccessorDeclaration(node)
    || ts.isConstructorDeclaration(node);
}

function mutatedParameterIndexes(functionNode) {
  const parameters = new Map();
  for (const [index, parameter] of functionNode.parameters.entries()) {
    if (ts.isIdentifier(parameter.name)) parameters.set(parameter.name.text, index);
  }
  const mutated = new Set();
  const recordRoot = (expression) => {
    const index = parameters.get(expressionRootIdentifier(expression));
    if (index !== undefined) mutated.add(index);
  };
  const visit = (node) => {
    if (node !== functionNode && isFunctionLikeNode(node)) return;
    if (ts.isBinaryExpression(node) && assignmentOperator(node.operatorToken.kind)) recordRoot(node.left);
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
      && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)) {
      recordRoot(node.operand);
    }
    if (ts.isDeleteExpression(node)) recordRoot(node.expression);
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      if (MODULE_MUTATING_METHODS.has(node.expression.name.text)) recordRoot(node.expression.expression);
      if (ts.isIdentifier(node.expression.expression)
        && ['Object', 'Reflect'].includes(node.expression.expression.text)
        && ['assign', 'defineProperties', 'defineProperty', 'set'].includes(node.expression.name.text)
        && node.arguments.length > 0) {
        recordRoot(node.arguments[0]);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(functionNode.body);
  return mutated;
}

function assertNoThisMutation(node, relativePath) {
  const rootedAtThis = (expression) => {
    let current = unwrapTsExpression(expression);
    while (current && (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current))) {
      current = unwrapTsExpression(current.expression);
    }
    return current?.kind === ts.SyntaxKind.ThisKeyword;
  };
  const visit = (current) => {
    if (ts.isBinaryExpression(current)
      && assignmentOperator(current.operatorToken.kind)
      && rootedAtThis(current.left)) {
      fail('SIM_MODULE_SCOPE_MUTATION', 'module-scope object mutates shared state through this', relativePath);
    }
    if ((ts.isPrefixUnaryExpression(current) || ts.isPostfixUnaryExpression(current))
      && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(current.operator)
      && rootedAtThis(current.operand)) {
      fail('SIM_MODULE_SCOPE_MUTATION', 'module-scope object mutates shared state through this', relativePath);
    }
    if (ts.isDeleteExpression(current) && rootedAtThis(current.expression)) {
      fail('SIM_MODULE_SCOPE_MUTATION', 'module-scope object mutates shared state through this', relativePath);
    }
    if (ts.isCallExpression(current)
      && ts.isPropertyAccessExpression(current.expression)
      && MODULE_MUTATING_METHODS.has(current.expression.name.text)
      && rootedAtThis(current.expression.expression)) {
      fail('SIM_MODULE_SCOPE_MUTATION', 'module-scope object mutates shared state through this', relativePath);
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
}

function moduleObjectLiteral(node) {
  const expression = unwrapTsExpression(node);
  if (ts.isObjectLiteralExpression(expression)) return expression;
  if (ts.isCallExpression(expression)
    && staticMemberName(expression.expression) === 'Object.freeze'
    && expression.arguments.length === 1) {
    const argument = unwrapTsExpression(expression.arguments[0]);
    return ts.isObjectLiteralExpression(argument) ? argument : null;
  }
  return null;
}

function staticMemberName(node) {
  const expression = unwrapTsExpression(node);
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) {
    const owner = staticMemberName(expression.expression);
    return owner ? `${owner}.${expression.name.text}` : '';
  }
  return '';
}

function assertModuleScopeResources(source, relativePath) {
  const moduleBindings = new Set();
  const mutatingHelpers = new Map();
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && statement.importClause) {
      if (statement.importClause.name) moduleBindings.add(statement.importClause.name.text);
      const bindings = statement.importClause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) moduleBindings.add(bindings.name.text);
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) moduleBindings.add(element.name.text);
      }
      continue;
    }
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
      const indexes = mutatedParameterIndexes(statement);
      if (indexes.size > 0) mutatingHelpers.set(statement.name.text, indexes);
      continue;
    }
    if (ts.isClassDeclaration(statement)) {
      for (const member of statement.members) {
        if (ts.isClassStaticBlockDeclaration(member)
          || (ts.isPropertyDeclaration(member) && hasModifier(member, ts.SyntaxKind.StaticKeyword))) {
          fail('SIM_MODULE_SCOPE_RESOURCE', 'class static state is forbidden in the canonical local closure', relativePath);
        }
      }
      continue;
    }
    if (ts.isExpressionStatement(statement)) {
      assertNoModuleEvaluationResources(statement.expression, source, relativePath);
      continue;
    }
    if (!ts.isVariableStatement(statement)) continue;
    if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) {
      fail('SIM_MODULE_SCOPE_MUTABLE', 'canonical local closure cannot declare module-scope let/var state', relativePath);
    }
    for (const declaration of statement.declarationList.declarations) {
      bindingIdentifiers(declaration.name, moduleBindings);
      const initializer = unwrapTsExpression(declaration.initializer);
      if (!initializer) continue;
      const functionInitializer = functionLikeInitializer(initializer);
      if (functionInitializer && ts.isIdentifier(declaration.name)) {
        const indexes = mutatedParameterIndexes(functionInitializer);
        if (indexes.size > 0) mutatingHelpers.set(declaration.name.text, indexes);
      }
      assertNoModuleEvaluationResources(initializer, source, relativePath);
      const sharedObject = moduleObjectLiteral(initializer);
      if (sharedObject) assertNoThisMutation(sharedObject, relativePath);
      if (ts.isClassExpression(initializer)) {
        for (const member of initializer.members) {
          if (ts.isClassStaticBlockDeclaration(member)
            || (ts.isPropertyDeclaration(member) && hasModifier(member, ts.SyntaxKind.StaticKeyword))) {
            fail('SIM_MODULE_SCOPE_RESOURCE', 'class static state is forbidden in the canonical local closure', relativePath);
          }
        }
      }
    }
  }

  const visit = (node) => {
    if (ts.isBinaryExpression(node)
      && assignmentOperator(node.operatorToken.kind)
      && moduleBindings.has(expressionRootIdentifier(node.left))) {
      fail('SIM_MODULE_SCOPE_MUTATION', 'canonical local closure mutates a module-scope binding', relativePath);
    }
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
      && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)
      && moduleBindings.has(expressionRootIdentifier(node.operand))) {
      fail('SIM_MODULE_SCOPE_MUTATION', 'canonical local closure mutates a module-scope binding', relativePath);
    }
    if (ts.isDeleteExpression(node) && moduleBindings.has(expressionRootIdentifier(node.expression))) {
      fail('SIM_MODULE_SCOPE_MUTATION', 'canonical local closure deletes from a module-scope binding', relativePath);
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const root = expressionRootIdentifier(node.expression.expression);
      if (root && moduleBindings.has(root) && MODULE_MUTATING_METHODS.has(node.expression.name.text)) {
        fail(
          'SIM_MODULE_SCOPE_MUTATION',
          `canonical local closure calls mutating method ${JSON.stringify(node.expression.name.text)} on module binding ${JSON.stringify(root)}`,
          relativePath,
        );
      }
      if (ts.isIdentifier(node.expression.expression)
        && ['Object', 'Reflect'].includes(node.expression.expression.text)
        && ['assign', 'defineProperties', 'defineProperty', 'set'].includes(node.expression.name.text)
        && node.arguments.length > 0
        && moduleBindings.has(expressionRootIdentifier(node.arguments[0]))) {
        fail('SIM_MODULE_SCOPE_MUTATION', 'canonical local closure mutates a module-scope binding through Object/Reflect', relativePath);
      }
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const indexes = mutatingHelpers.get(node.expression.text);
      if (indexes && [...indexes].some((index) => moduleBindings.has(expressionRootIdentifier(node.arguments[index])))) {
        fail(
          'SIM_MODULE_SCOPE_MUTATION',
          `helper ${JSON.stringify(node.expression.text)} mutates a module-scope binding through a parameter`,
          relativePath,
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

function assertAstRestrictions(source, relativePath) {
  const visit = (node) => {
    if (ts.isPropertyAccessExpression(node)) {
      if (FACTORY_FORBIDDEN_BINDINGS.has(node.name.text)) {
        fail('SIM_FACTORY_HOST_DISCRIMINATOR', `host discriminator ${JSON.stringify(node.name.text)} is forbidden`, relativePath);
      }
    }
    if (ts.isElementAccessExpression(node)
      && node.argumentExpression
      && ts.isStringLiteral(node.argumentExpression)
      && FACTORY_FORBIDDEN_BINDINGS.has(node.argumentExpression.text)) {
      fail(
        'SIM_FACTORY_HOST_DISCRIMINATOR',
        `host discriminator ${JSON.stringify(node.argumentExpression.text)} is forbidden`,
        relativePath,
      );
    }
    if (ts.isCallExpression(node)) {
      const name = ts.isIdentifier(node.expression)
        ? node.expression.text
        : ts.isPropertyAccessExpression(node.expression)
          ? node.expression.name.text
          : '';
      const code = FORBIDDEN_CALLS.get(name);
      if (code) fail(code, `forbidden call ${JSON.stringify(name)}`, relativePath);
      if (name === 'eval' || name === 'Function') {
        fail('SIM_DYNAMIC_CODE', 'dynamic code evaluation is forbidden in the canonical local closure', relativePath);
      }
    }
    if (ts.isNewExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'Function') {
      fail('SIM_DYNAMIC_CODE', 'dynamic code evaluation is forbidden in the canonical local closure', relativePath);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

function assertAdapterRestrictions(source, relativePath, specifiers) {
  for (const specifier of specifiers) {
    if (ADAPTER_FORBIDDEN_RUNTIME_IMPORTS.some((pattern) => pattern.test(specifier))) {
      fail('SIM_ADAPTER_UI_IMPORT', `Adapter closure cannot import UI runtime ${JSON.stringify(specifier)}`, relativePath);
    }
  }
  const visit = (node) => {
    if (ts.isTypeNode(node)) return;
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
      fail('SIM_ADAPTER_UI', 'Adapter closure cannot create renderer UI', relativePath);
    }
    if (ts.isIdentifier(node)
      && ['document', 'window'].includes(node.text)
      && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)) {
      fail('SIM_ADAPTER_DOM', `Adapter closure cannot access ${node.text}`, relativePath);
    }
    if (ts.isCallExpression(node)) {
      const name = callName(node);
      if (ADAPTER_DOM_METHODS.has(name)) {
        fail('SIM_ADAPTER_DOM', `Adapter closure cannot call DOM method ${JSON.stringify(name)}`, relativePath);
      }
      if (MODULE_RESOURCE_FACTORY_PATTERN.test(name)) {
        fail(
          'SIM_ADAPTER_RESOURCE_FACTORY',
          `Adapter closure cannot reconstruct renderer resource ${JSON.stringify(name)}`,
          relativePath,
        );
      }
    }
    if (ts.isBinaryExpression(node) && assignmentOperator(node.operatorToken.kind)) {
      const target = node.left.getText(source);
      const terminal = ts.isPropertyAccessExpression(node.left) ? node.left.name.text : '';
      if (ADAPTER_DOM_MUTABLE_PROPERTIES.has(terminal)
        || /\.(?:classList|dataset|style)(?:\.|\[)/u.test(target)) {
        fail('SIM_ADAPTER_DOM', 'Adapter closure cannot mutate DOM state', relativePath);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

export function buildModuleGraph(rootDir, entryPaths) {
  const queue = entryPaths.map((entry) => assertContainedFile(rootDir, entry.path, entry.fieldPath));
  const nodes = new Map();
  const packages = new Set();
  while (queue.length > 0) {
    const absolutePath = queue.shift();
    if (nodes.has(absolutePath)) continue;
    if (absolutePath.endsWith('.css')) {
      nodes.set(absolutePath, { type: 'css', imports: [] });
      continue;
    }
    const relativePath = canonicalRelative(rootDir, absolutePath);
    if (STATIC_ASSET_EXTENSIONS.has(path.extname(absolutePath).toLowerCase())) {
      nodes.set(absolutePath, { type: 'asset', imports: [] });
      continue;
    }
    if (!SOURCE_EXTENSIONS.includes(path.extname(absolutePath).toLowerCase())) {
      fail('SIM_IMPORT_ASSET_TYPE', 'imported static asset type is not admitted', relativePath);
    }
    const source = parseSourceFile(absolutePath);
    const localImports = [];
    const specifiers = importSpecifiers(source, relativePath);
    for (const specifier of specifiers) {
      if (specifier.startsWith('.')) {
        const resolved = resolveRelativeImport(rootDir, absolutePath, specifier);
        localImports.push(resolved);
        queue.push(resolved);
      } else {
        packages.add(specifier);
      }
    }
    nodes.set(absolutePath, {
      type: 'module',
      imports: localImports,
      specifiers,
      source,
      exports: exportedNames(source),
    });
  }
  return { nodes, packages: [...packages].sort() };
}

export function assertRestrictedClosure(rootDir, graph, entries) {
  const queue = entries.map((entry) => ({ ...entry, rootOwner: entry.owner }));
  const seen = new Set();
  const packages = new Set();
  while (queue.length > 0) {
    const { path: current, owner, rootOwner } = queue.shift();
    const seenKey = `${rootOwner}:${current}`;
    if (seen.has(seenKey)) continue;
    seen.add(seenKey);
    const node = graph.nodes.get(current);
    if (!node) continue;
    const relativePath = canonicalRelative(rootDir, current);
    if (node.type === 'asset') continue;
    if (node.type === 'css') {
      fail('SIM_CSS_OUTSIDE_CANONICAL_STYLE', 'restricted module closure cannot import CSS outside the canonical style identity', relativePath);
    }
    for (const specifier of node.specifiers) {
      assertImportAllowed(specifier, relativePath);
      if (/\.css(?:$|[?#])/u.test(specifier)) {
        fail('SIM_CSS_OUTSIDE_CANONICAL_STYLE', 'restricted module closure cannot import CSS outside the canonical style identity', relativePath);
      }
      if (!specifier.startsWith('.')) packages.add(specifier);
    }
    assertModuleScopeResources(node.source, relativePath);
    assertAstRestrictions(node.source, relativePath);
    if (rootOwner === 'app_adapter') assertAdapterRestrictions(node.source, relativePath, node.specifiers);
    assertSimulatorStaticEffects(node.source, relativePath, owner);
    queue.push(...node.imports.map((entry) => ({
      path: entry,
      owner: owner === 'conformance_fixture' ? owner : 'selected_dependency',
      rootOwner,
    })));
  }
  return [...packages].sort();
}

export function validateSimulatorSelectedDependencyModule(code, canonicalPath) {
  const source = parseSourceText(code, canonicalPath);
  const specifiers = importSpecifiers(source, canonicalPath);
  for (const specifier of specifiers) {
    assertImportAllowed(specifier, canonicalPath);
    if (/\.css(?:$|[?#])/u.test(specifier)) {
      fail(
        'SIM_SELECTED_DEPENDENCY_RESOURCE',
        'selected dependency runtime closure cannot import CSS outside the canonical style identity',
        canonicalPath,
      );
    }
  }
  assertModuleScopeResources(source, canonicalPath);
  assertAstRestrictions(source, canonicalPath);
  assertSimulatorStaticEffects(source, canonicalPath, 'selected_dependency');
  return Object.freeze({ specifiers: Object.freeze([...specifiers]) });
}

export function reachable(graph, entry, target) {
  const queue = [entry];
  const seen = new Set();
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === target) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    queue.push(...(graph.nodes.get(current)?.imports || []));
  }
  return false;
}
