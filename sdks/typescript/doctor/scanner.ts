import ts from 'typescript';
import type { NimiDoctorApiEntry, NimiDoctorFramework } from './map';

export interface NimiDoctorScanLocation {
  readonly file: string;
  readonly line: number;
}

export interface NimiDoctorScanHit {
  readonly frameworkId: string;
  readonly api: string;
  readonly location: NimiDoctorScanLocation;
  readonly optionKeys: readonly string[];
  readonly optionFunctionKeys: readonly string[];
  readonly optionsResolved: boolean;
  readonly heuristic: boolean;
}

export interface NimiDoctorUnknownApi {
  readonly frameworkId: string;
  readonly call: string;
  readonly location: NimiDoctorScanLocation;
}

export interface NimiDoctorUnboundCall {
  readonly frameworkId: string;
  readonly member: string;
  readonly location: NimiDoctorScanLocation;
}

export interface NimiDoctorDynamicImport {
  readonly frameworkId: string;
  readonly location: NimiDoctorScanLocation;
}

export interface NimiDoctorScanResult {
  readonly hits: readonly NimiDoctorScanHit[];
  readonly unknownApis: readonly NimiDoctorUnknownApi[];
  readonly unboundCalls: readonly NimiDoctorUnboundCall[];
  readonly dynamicImports: readonly NimiDoctorDynamicImport[];
  readonly detectedPendingFrameworks: readonly string[];
}

interface ImportBinding {
  readonly packageName: string;
  readonly importedName: string;
}

interface OptionExtraction {
  readonly keys: readonly string[];
  readonly functionKeys: readonly string[];
  readonly resolved: boolean;
}

export function scanSource(input: {
  readonly fileName: string;
  readonly sourceText: string;
  readonly frameworks: readonly NimiDoctorFramework[];
}): NimiDoctorScanResult {
  const sourceFile = ts.createSourceFile(input.fileName, input.sourceText, ts.ScriptTarget.Latest, true);
  const frameworkByPackage = buildPackageIndex(input.frameworks);

  const importBindings = collectImportBindings(sourceFile, frameworkByPackage);
  const detectedFrameworkIds = new Set<string>();
  for (const binding of importBindings.values()) {
    const framework = frameworkByPackage.get(binding.packageName);
    if (framework) {
      detectedFrameworkIds.add(framework.id);
    }
  }

  const dynamicImports: NimiDoctorDynamicImport[] = [];
  collectDynamicImports(sourceFile, frameworkByPackage, input.fileName, (frameworkId, location) => {
    detectedFrameworkIds.add(frameworkId);
    dynamicImports.push({ frameworkId, location });
  });

  const instanceTable = collectInstanceTable(sourceFile, importBindings);
  const optionVariableTable = collectOptionVariableTable(sourceFile);
  const memberNameIndex = buildMemberNameIndex(input.frameworks);

  const hits: NimiDoctorScanHit[] = [];
  const unknownApis: NimiDoctorUnknownApi[] = [];
  const unboundCalls: NimiDoctorUnboundCall[] = [];

  const recordHit = (framework: NimiDoctorFramework, entry: NimiDoctorApiEntry, node: ts.Node, options: OptionExtraction) => {
    hits.push({
      frameworkId: framework.id,
      api: entry.api,
      location: locate(sourceFile, node, input.fileName),
      optionKeys: options.keys,
      optionFunctionKeys: options.functionKeys,
      optionsResolved: options.resolved,
      heuristic: entry.detection.kind === 'member-name',
    });
  };

  const matchConstructorEntry = (
    framework: NimiDoctorFramework,
    binding: ImportBinding,
    localName: string,
    node: ts.NewExpression,
  ): void => {
    const entry = framework.apiEntries.find(
      (candidate) =>
        candidate.detection.kind === 'constructor'
        && candidate.detection.package === binding.packageName
        && candidate.detection.symbol === binding.importedName,
    );
    if (entry) {
      recordHit(framework, entry, node, extractOptions(node.arguments, optionVariableTable));
    } else {
      unknownApis.push({
        frameworkId: framework.id,
        call: `new ${localName}`,
        location: locate(sourceFile, node, input.fileName),
      });
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isNewExpression(node)) {
      if (ts.isIdentifier(node.expression)) {
        const binding = importBindings.get(node.expression.text);
        const framework = binding ? frameworkByPackage.get(binding.packageName) : undefined;
        if (binding && framework && framework.status === 'mapped') {
          matchConstructorEntry(framework, binding, node.expression.text, node);
        }
      } else if (ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression)) {
        // new ns.Ctor(...) through a namespace import.
        const namespaceBinding = importBindings.get(node.expression.expression.text);
        if (namespaceBinding?.importedName === '*') {
          const framework = frameworkByPackage.get(namespaceBinding.packageName);
          if (framework && framework.status === 'mapped') {
            const syntheticBinding: ImportBinding = {
              packageName: namespaceBinding.packageName,
              importedName: node.expression.name.text,
            };
            matchConstructorEntry(framework, syntheticBinding, node.expression.name.text, node);
          }
        }
      }
    }

    if (ts.isCallExpression(node)) {
      dispatchCall(node);
    }

    ts.forEachChild(node, visit);
  };

  const dispatchCall = (node: ts.CallExpression): void => {
    const options = extractOptions(node.arguments, optionVariableTable);

    if (ts.isIdentifier(node.expression)) {
      const binding = importBindings.get(node.expression.text);
      const framework = binding ? frameworkByPackage.get(binding.packageName) : undefined;
      if (binding && framework && framework.status === 'mapped') {
        const entry = framework.apiEntries.find(
          (candidate) =>
            candidate.detection.kind === 'import-call'
            && candidate.detection.package === binding.packageName
            && candidate.detection.symbol === binding.importedName,
        );
        if (entry) {
          recordHit(framework, entry, node, options);
        } else {
          unknownApis.push({
            frameworkId: framework.id,
            call: binding.importedName,
            location: locate(sourceFile, node, input.fileName),
          });
        }
      }
      return;
    }

    if (ts.isPropertyAccessExpression(node.expression)) {
      const chain = flattenPropertyChain(node.expression);
      if (!chain) {
        matchMemberNameOrUnbound(node, options);
        return;
      }
      const namespaceBinding = importBindings.get(chain.rootName);
      if (namespaceBinding?.importedName === '*' && chain.members.length === 1) {
        const framework = frameworkByPackage.get(namespaceBinding.packageName);
        if (framework && framework.status === 'mapped') {
          const memberSymbol = chain.members[0]!;
          const entry = framework.apiEntries.find(
            (candidate) =>
              candidate.detection.kind === 'import-call'
              && candidate.detection.package === namespaceBinding.packageName
              && candidate.detection.symbol === memberSymbol,
          );
          if (entry) {
            recordHit(framework, entry, node, options);
          } else {
            unknownApis.push({
              frameworkId: framework.id,
              call: memberSymbol,
              location: locate(sourceFile, node, input.fileName),
            });
          }
          return;
        }
      }
      const instance = instanceTable.get(chain.rootName);
      if (instance) {
        const framework = frameworkByPackage.get(instance.packageName);
        if (framework && framework.status === 'mapped') {
          const memberPath = chain.members.join('.');
          const entry = framework.apiEntries.find((candidate) => {
            if (candidate.detection.kind === 'member-call') {
              return candidate.detection.package === instance.packageName
                && candidate.detection.constructor === instance.importedName
                && chain.members.length === 1
                && candidate.detection.member === memberPath;
            }
            if (candidate.detection.kind === 'member-chain') {
              return candidate.detection.package === instance.packageName
                && candidate.detection.constructor === instance.importedName
                && candidate.detection.chain === memberPath;
            }
            return false;
          });
          if (entry) {
            recordHit(framework, entry, node, options);
          } else {
            unknownApis.push({
              frameworkId: framework.id,
              call: `${instance.importedName}.${memberPath}`,
              location: locate(sourceFile, node, input.fileName),
            });
          }
          return;
        }
      }
      matchMemberNameOrUnbound(node, options);
    }
  };

  // A member call whose receiver cannot be statically bound must not vanish:
  // when the member name belongs to a detected framework's mapped member
  // surface, it is reported as an unbound call instead of being dropped.
  const matchMemberNameOrUnbound = (node: ts.CallExpression, options: OptionExtraction): void => {
    if (!ts.isPropertyAccessExpression(node.expression)) {
      return;
    }
    const memberName = node.expression.name.text;
    let matched = false;
    for (const framework of input.frameworks) {
      if (framework.status !== 'mapped' || !detectedFrameworkIds.has(framework.id)) {
        continue;
      }
      const entry = framework.apiEntries.find(
        (candidate) => candidate.detection.kind === 'member-name' && candidate.detection.member === memberName,
      );
      if (entry) {
        recordHit(framework, entry, node, options);
        matched = true;
        continue;
      }
      if (memberNameIndex.get(framework.id)?.has(memberName)) {
        unboundCalls.push({
          frameworkId: framework.id,
          member: memberName,
          location: locate(sourceFile, node, input.fileName),
        });
        matched = true;
      }
    }
    void matched;
  };

  visit(sourceFile);

  const detectedPendingFrameworks = input.frameworks
    .filter((framework) => framework.status === 'pending-upstream-binding' && detectedFrameworkIds.has(framework.id))
    .map((framework) => framework.id);

  return { hits, unknownApis, unboundCalls, dynamicImports, detectedPendingFrameworks };
}

function buildPackageIndex(frameworks: readonly NimiDoctorFramework[]): Map<string, NimiDoctorFramework> {
  const index = new Map<string, NimiDoctorFramework>();
  for (const framework of frameworks) {
    index.set(framework.upstreamPackage, framework);
    for (const entry of framework.apiEntries) {
      index.set(entry.detection.package, framework);
    }
  }
  return index;
}

function buildMemberNameIndex(frameworks: readonly NimiDoctorFramework[]): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const framework of frameworks) {
    const members = new Set<string>();
    for (const entry of framework.apiEntries) {
      if (entry.detection.kind === 'member-call') {
        members.add(entry.detection.member);
      } else if (entry.detection.kind === 'member-chain') {
        const tail = entry.detection.chain.split('.').pop();
        if (tail) {
          members.add(tail);
        }
      }
    }
    index.set(framework.id, members);
  }
  return index;
}

function collectImportBindings(
  sourceFile: ts.SourceFile,
  frameworkByPackage: Map<string, NimiDoctorFramework>,
): Map<string, ImportBinding> {
  const bindings = new Map<string, ImportBinding>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const packageName = resolvePackageName(statement.moduleSpecifier.text, frameworkByPackage);
    if (!packageName || !statement.importClause) {
      continue;
    }
    const { importClause } = statement;
    if (importClause.name) {
      bindings.set(importClause.name.text, { packageName, importedName: 'default' });
    }
    if (importClause.namedBindings) {
      if (ts.isNamedImports(importClause.namedBindings)) {
        for (const element of importClause.namedBindings.elements) {
          const importedName = element.propertyName?.text ?? element.name.text;
          bindings.set(element.name.text, { packageName, importedName });
        }
      } else if (ts.isNamespaceImport(importClause.namedBindings)) {
        bindings.set(importClause.namedBindings.name.text, { packageName, importedName: '*' });
      }
    }
  }
  return bindings;
}

function collectDynamicImports(
  sourceFile: ts.SourceFile,
  frameworkByPackage: Map<string, NimiDoctorFramework>,
  fileName: string,
  record: (frameworkId: string, location: NimiDoctorScanLocation) => void,
): void {
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const specifier = node.arguments[0];
      if (specifier && ts.isStringLiteral(specifier)) {
        const packageName = resolvePackageName(specifier.text, frameworkByPackage);
        const framework = packageName ? frameworkByPackage.get(packageName) : undefined;
        if (framework) {
          record(framework.id, locate(sourceFile, node, fileName));
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function resolvePackageName(specifier: string, frameworkByPackage: Map<string, NimiDoctorFramework>): string | undefined {
  if (frameworkByPackage.has(specifier)) {
    return specifier;
  }
  for (const packageName of frameworkByPackage.keys()) {
    if (specifier.startsWith(`${packageName}/`)) {
      return packageName;
    }
  }
  return undefined;
}

interface InstanceBinding {
  readonly packageName: string;
  readonly importedName: string;
}

function collectInstanceTable(sourceFile: ts.SourceFile, importBindings: Map<string, ImportBinding>): Map<string, InstanceBinding> {
  const instances = new Map<string, InstanceBinding>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
      const init = unwrapAwait(node.initializer);
      if (ts.isNewExpression(init) && ts.isIdentifier(init.expression)) {
        const binding = importBindings.get(init.expression.text);
        if (binding) {
          instances.set(node.name.text, { packageName: binding.packageName, importedName: binding.importedName });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return instances;
}

function collectOptionVariableTable(sourceFile: ts.SourceFile): Map<string, ts.ObjectLiteralExpression> {
  const table = new Map<string, ts.ObjectLiteralExpression>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
      const init = unwrapAwait(node.initializer);
      if (ts.isObjectLiteralExpression(init)) {
        table.set(node.name.text, init);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return table;
}

function unwrapAwait(node: ts.Expression): ts.Expression {
  return ts.isAwaitExpression(node) ? node.expression : node;
}

function flattenPropertyChain(expression: ts.PropertyAccessExpression): { rootName: string; members: string[] } | undefined {
  const members: string[] = [];
  let current: ts.Expression = expression;
  while (ts.isPropertyAccessExpression(current)) {
    members.unshift(current.name.text);
    current = current.expression;
  }
  if (ts.isIdentifier(current)) {
    return { rootName: current.text, members };
  }
  return undefined;
}

function extractOptions(
  args: ts.NodeArray<ts.Expression> | undefined,
  optionVariableTable: Map<string, ts.ObjectLiteralExpression>,
): OptionExtraction {
  if (!args || args.length === 0) {
    return { keys: [], functionKeys: [], resolved: true };
  }
  const keys = new Set<string>();
  const functionKeys = new Set<string>();
  let sawResolvedObject = false;
  let sawUnresolvableArg = false;
  let sawSpread = false;
  for (const arg of args) {
    let literal: ts.ObjectLiteralExpression | undefined;
    if (ts.isObjectLiteralExpression(arg)) {
      literal = arg;
    } else if (ts.isIdentifier(arg)) {
      literal = optionVariableTable.get(arg.text);
      if (!literal) {
        sawUnresolvableArg = true;
        continue;
      }
    } else if (isPrimitiveArgument(arg)) {
      continue;
    } else {
      sawUnresolvableArg = true;
      continue;
    }
    sawResolvedObject = true;
    for (const property of literal.properties) {
      if (ts.isSpreadAssignment(property)) {
        sawSpread = true;
        continue;
      }
      const name = property.name;
      if (name && (ts.isIdentifier(name) || ts.isStringLiteral(name))) {
        keys.add(name.text);
        if (ts.isPropertyAssignment(property) && isFunctionExpression(property.initializer)) {
          functionKeys.add(name.text);
        }
        if (ts.isMethodDeclaration(property)) {
          functionKeys.add(name.text);
        }
      }
    }
  }
  // Options are conventionally the sole object-shaped argument: once one
  // resolves, remaining non-object arguments (prompts, ids) do not poison
  // resolution. Without any resolved object, an unresolvable argument means
  // unmet conditions cannot be disproven. A spread always taints resolution.
  const resolved = !sawSpread && (sawResolvedObject || !sawUnresolvableArg);
  return { keys: [...keys], functionKeys: [...functionKeys], resolved };
}

function isPrimitiveArgument(arg: ts.Expression): boolean {
  return ts.isStringLiteralLike(arg)
    || ts.isNumericLiteral(arg)
    || ts.isArrayLiteralExpression(arg)
    || arg.kind === ts.SyntaxKind.TrueKeyword
    || arg.kind === ts.SyntaxKind.FalseKeyword
    || arg.kind === ts.SyntaxKind.NullKeyword;
}

function isFunctionExpression(expression: ts.Expression): boolean {
  return ts.isArrowFunction(expression) || ts.isFunctionExpression(expression);
}

function locate(sourceFile: ts.SourceFile, node: ts.Node, fileName: string): NimiDoctorScanLocation {
  const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return { file: fileName, line: line + 1 };
}
