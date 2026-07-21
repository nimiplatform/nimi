import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { parse as parseYaml } from 'yaml';
import {
  sha256Digest,
  stableJsonDigest,
  SimulatorConformanceError,
} from '@nimiplatform/app-tools/simulator-conformance';

const CONDITIONS = Object.freeze({
  types: Object.freeze(['types', 'import', 'default']),
  runtime: Object.freeze(['browser', 'import', 'module', 'default']),
  style: Object.freeze(['style', 'browser', 'import', 'default']),
});
const EXACT_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function fail(code, message, fieldPath = '') {
  throw new SimulatorConformanceError(code, message, fieldPath);
}

function packagePathSegments(packageName) {
  return packageName.split('/');
}

function readJson(filePath, label) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    fail('SIM_RESOLVER_JSON', `${label} cannot be parsed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function packageDirectory(simulatorRoot, packageName) {
  const linkPath = path.join(simulatorRoot, 'node_modules', ...packagePathSegments(packageName));
  if (!existsSync(linkPath)) fail('SIM_RESOLVER_PACKAGE_MISSING', `mandatory singleton ${JSON.stringify(packageName)} is not installed`);
  const root = realpathSync(linkPath);
  const packageJsonPath = path.join(root, 'package.json');
  if (!existsSync(packageJsonPath)) fail('SIM_RESOLVER_PACKAGE_JSON', `package.json is missing for ${JSON.stringify(packageName)}`);
  const packageJson = readJson(packageJsonPath, `${packageName}/package.json`);
  if (packageJson.name !== packageName) {
    fail(
      'SIM_RESOLVER_PACKAGE_NAME',
      `installed package identity mismatch: expected ${JSON.stringify(packageName)}, got ${JSON.stringify(packageJson.name)}`,
    );
  }
  return { root, packageJsonPath, packageJson };
}

function substituteExportWildcard(value, matchedSegment) {
  if (typeof value === 'string') return value.replaceAll('*', matchedSegment);
  if (Array.isArray(value)) return value.map((entry) => substituteExportWildcard(entry, matchedSegment));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, substituteExportWildcard(entry, matchedSegment)]),
  );
}

function exportEntry(packageJson, subpath) {
  const exportsField = packageJson.exports;
  if (!exportsField) return null;
  if (typeof exportsField === 'string' || Array.isArray(exportsField)) return subpath === '.' ? exportsField : null;
  if (typeof exportsField !== 'object') return null;
  const keys = Object.keys(exportsField);
  if (!keys.some((key) => key.startsWith('.'))) return subpath === '.' ? exportsField : null;
  if (Object.hasOwn(exportsField, subpath)) return exportsField[subpath];
  for (const key of keys) {
    const wildcardIndex = key.indexOf('*');
    if (wildcardIndex < 0 || wildcardIndex !== key.lastIndexOf('*')) continue;
    const prefix = key.slice(0, wildcardIndex);
    const suffix = key.slice(wildcardIndex + 1);
    if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) continue;
    const matchedSegment = subpath.slice(prefix.length, subpath.length - suffix.length);
    return substituteExportWildcard(exportsField[key], matchedSegment);
  }
  return null;
}

function selectConditionalTarget(value, conditions) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const selected = selectConditionalTarget(entry, conditions);
      if (selected) return selected;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  for (const condition of conditions) {
    if (Object.hasOwn(value, condition)) {
      const selected = selectConditionalTarget(value[condition], conditions);
      if (selected) return selected;
    }
  }
  return null;
}

function explicitTypesTarget(packageJson, subpath) {
  const entry = exportEntry(packageJson, subpath);
  const selected = selectConditionalTarget(entry, CONDITIONS.types);
  if (selected && /\.d\.(?:ts|mts|cts)$/u.test(selected)) return selected;
  if (subpath === '.' && typeof packageJson.types === 'string') return packageJson.types;
  if (subpath === '.' && typeof packageJson.typings === 'string') return packageJson.typings;
  return null;
}

function defaultSubpath(packageName, phase) {
  if (packageName === '@nimiplatform/kit') return phase === 'style' ? './ui/styles.css' : './ui';
  return '.';
}

function explicitExportSubpaths(packageJson) {
  const exportsField = packageJson.exports;
  if (!exportsField || typeof exportsField !== 'object' || Array.isArray(exportsField)) return ['.'];
  const keys = Object.keys(exportsField);
  if (!keys.some((key) => key.startsWith('.'))) return ['.'];
  return keys.filter((key) => key === '.' || (key.startsWith('./') && !key.includes('*') && key !== './package.json'));
}

function supportedExportPhases(simulatorRoot, packageInfo, packageName, subpath, admittedPhases) {
  const phases = [];
  const entry = exportEntry(packageInfo.packageJson, subpath);
  if (admittedPhases.includes('types')) {
    if (explicitTypesTarget(packageInfo.packageJson, subpath)
      || (subpath === '.' && fallbackTypesTarget(simulatorRoot, packageName, subpath))) {
      phases.push('types');
    }
  }
  const runtimeTarget = selectConditionalTarget(entry, CONDITIONS.runtime)
    || (subpath === '.' ? packageInfo.packageJson.module || packageInfo.packageJson.main : null);
  if (admittedPhases.includes('runtime') && runtimeTarget && !/\.css(?:$|\?)/u.test(runtimeTarget)) {
    phases.push('runtime');
  }
  const styleTarget = selectConditionalTarget(entry, CONDITIONS.style);
  if (admittedPhases.includes('style') && styleTarget && /\.css(?:$|\?)/u.test(styleTarget)) {
    phases.push('style');
  }
  return phases;
}

function fallbackTypesTarget(simulatorRoot, packageName, subpath) {
  const typePackage = packageName === 'react'
    ? '@types/react'
    : packageName === 'react-dom'
      ? '@types/react-dom'
      : null;
  if (!typePackage) return null;
  const directory = packageDirectory(simulatorRoot, typePackage);
  const subpathTarget = packageName === 'react' && subpath !== '.'
    ? `${subpath.slice(2)}.d.ts`
    : packageName === 'react-dom' && subpath !== '.'
      ? `${subpath.slice(2)}.d.ts`
      : null;
  const relative = subpathTarget && existsSync(path.join(directory.root, subpathTarget))
    ? subpathTarget
    : directory.packageJson.types || directory.packageJson.typings || 'index.d.ts';
  return {
    absoluteTarget: realpathSync(path.resolve(directory.root, relative)),
    providerName: typePackage,
    providerVersion: directory.packageJson.version,
    providerRoot: directory.root,
  };
}

function resolveTarget(simulatorRoot, packageInfo, packageName, subpath, phase) {
  if (phase === 'types') {
    const explicit = explicitTypesTarget(packageInfo.packageJson, subpath);
    if (explicit) {
      const absoluteTarget = realpathSync(path.resolve(packageInfo.root, explicit));
      return { absoluteTarget, providerName: packageName, providerVersion: packageInfo.packageJson.version, providerRoot: packageInfo.root };
    }
    const fallback = fallbackTypesTarget(simulatorRoot, packageName, subpath);
    if (fallback) return fallback;
    fail('SIM_RESOLVER_TYPES_TARGET', `no canonical types target exists for ${JSON.stringify(packageName)} ${subpath}`);
  }
  const entry = exportEntry(packageInfo.packageJson, subpath);
  let relativeTarget = selectConditionalTarget(entry, CONDITIONS[phase]);
  if (!relativeTarget && subpath === '.') {
    relativeTarget = phase === 'runtime'
      ? packageInfo.packageJson.module
        || packageInfo.packageJson.main
        || (existsSync(path.join(packageInfo.root, 'index.js')) ? './index.js' : null)
      : null;
  }
  if (!relativeTarget) fail('SIM_RESOLVER_EXPORT', `cannot resolve ${phase} export ${JSON.stringify(`${packageName}${subpath === '.' ? '' : subpath.slice(1)}`)}`);
  const absoluteTarget = realpathSync(path.resolve(packageInfo.root, relativeTarget));
  if (!statSync(absoluteTarget).isFile()) fail('SIM_RESOLVER_TARGET_KIND', 'resolved package target is not a file', absoluteTarget);
  return { absoluteTarget, providerName: packageName, providerVersion: packageInfo.packageJson.version, providerRoot: packageInfo.root };
}

function serializedPackageRoot(packageName, version) {
  return `package/${packageName}@${version}/`;
}

function serializedTarget(target) {
  const relative = path.relative(target.providerRoot, target.absoluteTarget).split(path.sep).join('/');
  if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) {
    fail('SIM_RESOLVER_TARGET_ESCAPE', 'resolved target escapes its package root');
  }
  return `${serializedPackageRoot(target.providerName, target.providerVersion)}${relative}`;
}

function exactDependencySpecifier(packageJson, packageName) {
  const value = packageJson.dependencies?.[packageName] ?? packageJson.devDependencies?.[packageName];
  if (typeof value !== 'string') fail('SIM_RESOLVER_ROOT_DECLARATION', `Simulator package must declare ${JSON.stringify(packageName)}`);
  if (packageName.startsWith('@nimiplatform/')) {
    if (value !== 'workspace:*') fail('SIM_RESOLVER_WORKSPACE_SPECIFIER', `${packageName} must use workspace:*`);
  } else if (!EXACT_VERSION_PATTERN.test(value)) {
    fail('SIM_RESOLVER_EXACT_VERSION', `${packageName} must use an exact semantic version, got ${JSON.stringify(value)}`);
  }
  return value;
}

function importerLockRow(lockfile, packageName) {
  const importer = lockfile.importers?.['apps/simulator'];
  if (!importer) fail('SIM_RESOLVER_LOCK_IMPORTER', 'pnpm lockfile has no apps/simulator importer');
  const row = importer.dependencies?.[packageName] ?? importer.devDependencies?.[packageName];
  if (!row || typeof row.specifier !== 'string' || typeof row.version !== 'string') {
    fail('SIM_RESOLVER_LOCK_ENTRY', `pnpm lockfile has no exact importer row for ${JSON.stringify(packageName)}`);
  }
  return row;
}

function packageLockIdentity(lockfile, packageName, lockRow, packageInfo) {
  const packageKey = `${packageName}@${packageInfo.packageJson.version}`;
  const isWorkspace = lockRow.version.startsWith('link:');
  const packageRow = lockfile.packages?.[packageKey];
  const snapshotKey = `${packageName}@${lockRow.version}`;
  const snapshotRow = lockfile.snapshots?.[snapshotKey];
  if (!isWorkspace && (!packageRow || typeof packageRow !== 'object')) {
    fail('SIM_RESOLVER_LOCK_PACKAGE', `pnpm lockfile has no immutable package row for ${JSON.stringify(packageKey)}`);
  }
  if (!isWorkspace && (!snapshotRow || typeof snapshotRow !== 'object')) {
    fail('SIM_RESOLVER_LOCK_SNAPSHOT', `pnpm lockfile has no resolved snapshot row for ${JSON.stringify(snapshotKey)}`);
  }
  return stableJsonDigest('nimi-simulator-pnpm-lock-identity-v2', {
    lockfileVersion: lockfile.lockfileVersion,
    package: packageName,
    importer: lockRow,
    packageKey: isWorkspace ? null : packageKey,
    packageRow: isWorkspace ? null : packageRow,
    snapshotKey: isWorkspace ? null : snapshotKey,
    snapshotRow: isWorkspace ? null : snapshotRow,
    packageJsonDigest: sha256Digest(readFileSync(packageInfo.packageJsonPath)),
    packageVersion: packageInfo.packageJson.version,
  });
}

function packageSourceDigest(targets) {
  const hash = createHash('sha256');
  hash.update(Buffer.from('nimi-simulator-package-targets-v1\0', 'utf8'));
  for (const target of targets) {
    hash.update(Buffer.from(`${target.phase}\0${target.canonicalTarget}\0${target.fileDigest}\0`, 'utf8'));
  }
  return `sha256:${hash.digest('hex')}`;
}

function packageNameFromSpecifier(specifier) {
  return specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
}

function exportSubpathFromSpecifier(specifier, packageName) {
  return specifier === packageName ? '.' : `./${specifier.slice(packageName.length + 1)}`;
}

function phasesForSpecifier(specifier) {
  return /\.css(?:$|\?)/.test(specifier) ? ['style'] : ['types', 'runtime'];
}

function collectSimulatorPackageImports(simulatorRoot) {
  const imports = new Set();
  let hasTsx = false;
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (!entry.isFile() || !/\.[cm]?[jt]sx?$/u.test(entry.name)) continue;
      if (/\.[cm]?tsx$/u.test(entry.name)) hasTsx = true;
      const text = readFileSync(absolute, 'utf8');
      const source = ts.createSourceFile(
        absolute,
        text,
        ts.ScriptTarget.Latest,
        true,
        /\.[cm]?tsx$/u.test(entry.name) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      if (source.parseDiagnostics.length > 0) {
        fail('SIM_RESOLVER_SIMULATOR_SOURCE_PARSE', `cannot parse ${path.relative(simulatorRoot, absolute)}`);
      }
      const visit = (node) => {
        let specifier = null;
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
          && node.moduleSpecifier
          && ts.isStringLiteral(node.moduleSpecifier)) {
          specifier = node.moduleSpecifier.text;
        } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          if (node.arguments.length !== 1 || !ts.isStringLiteral(node.arguments[0])) {
            fail('SIM_RESOLVER_SIMULATOR_DYNAMIC_IMPORT', 'Simulator source dynamic imports must be string literals', path.relative(simulatorRoot, absolute));
          }
          specifier = node.arguments[0].text;
        }
        if (specifier && !specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.startsWith('virtual:')) {
          imports.add(specifier);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  };
  walk(path.join(simulatorRoot, 'src'));
  if (hasTsx) {
    imports.add('react/jsx-runtime');
    imports.add('react/jsx-dev-runtime');
  }
  return imports;
}

function requirementImportsPackage(requirement, packageName) {
  return (requirement.imports || []).some((specifier) => packageNameFromSpecifier(specifier) === packageName);
}

function assertSelectedSourceRequirements(moduleRequirements, packageName, resolvedVersion, role) {
  const importingModules = moduleRequirements.filter((requirement) => requirementImportsPackage(requirement, packageName));
  if (importingModules.length === 0) return;
  const prefix = role === 'app-specific' ? 'SIM_RESOLVER_APP_DEPENDENCY' : 'SIM_RESOLVER_MANDATORY_DEPENDENCY';
  const declarations = new Set(importingModules.map((requirement) => requirement.requirements?.[packageName]).filter(Boolean));
  if (declarations.size === 0) {
    fail(prefix, `${role} package ${JSON.stringify(packageName)} has no selected-source declaration`);
  }
  if (role === 'app-specific' && declarations.size !== 1) {
    fail(`${prefix}_CONFLICT`, `App-specific package ${JSON.stringify(packageName)} has conflicting declarations`);
  }
  for (const requirement of importingModules) {
    const declared = requirement.requirements?.[packageName];
    if (typeof declared !== 'string' || !declared) {
      fail(prefix, `module ${JSON.stringify(requirement.moduleId)} does not declare imported package ${JSON.stringify(packageName)}`);
    }
    if (declared === 'workspace:*') {
      const admittedWorkspaceDeclaration = role === 'mandatory-singleton'
        && packageName.startsWith('@nimiplatform/')
        && requirement.appSourceKind === 'workspace';
      if (!admittedWorkspaceDeclaration) {
        fail(`${prefix}_RANGE`, `module ${JSON.stringify(requirement.moduleId)} cannot use workspace:* for ${JSON.stringify(packageName)}`);
      }
      continue;
    }
    if (!EXACT_VERSION_PATTERN.test(declared)) {
      fail(`${prefix}_RANGE`, `module ${JSON.stringify(requirement.moduleId)} must declare one exact version of ${JSON.stringify(packageName)}`);
    }
    if (declared !== resolvedVersion) {
      fail(`${prefix}_VERSION`, `module ${JSON.stringify(requirement.moduleId)} declares ${packageName}@${declared}, final graph resolves ${resolvedVersion}`);
    }
  }
}

function assertFinalPackageIdentity(packageName, rootSpecifier, lockRow, packageInfo) {
  if (lockRow.specifier !== rootSpecifier) {
    fail('SIM_RESOLVER_LOCK_SPECIFIER', `${packageName} root declaration and lock importer specifier differ`);
  }
  if (rootSpecifier === 'workspace:*') return;
  if (packageInfo.packageJson.version !== rootSpecifier) {
    fail('SIM_RESOLVER_INSTALLED_VERSION', `${packageName} declares ${rootSpecifier}, installed package is ${packageInfo.packageJson.version}`);
  }
  if (lockRow.version !== rootSpecifier && !lockRow.version.startsWith(`${rootSpecifier}(`)) {
    fail('SIM_RESOLVER_LOCK_VERSION', `${packageName} lock importer does not resolve the declared exact version`);
  }
}

export function resolveMandatorySingletons({ repoRoot, simulatorRoot, moduleRequirements = [] }) {
  const policyPath = path.join(repoRoot, '.nimi/spec/platform/kernel/tables/simulator-mandatory-singletons.yaml');
  const policyBytes = readFileSync(policyPath);
  const policy = parseYaml(policyBytes.toString('utf8'));
  if (!Array.isArray(policy.packages) || !Array.isArray(policy.entries)) {
    fail('SIM_RESOLVER_POLICY', 'mandatory-singleton policy is invalid');
  }
  const policyPackageNames = policy.packages.map((row) => row?.name);
  if (JSON.stringify(policyPackageNames) !== JSON.stringify(policy.entries)) {
    fail('SIM_RESOLVER_POLICY_ORDER', 'mandatory-singleton package rows must exactly match the canonical catalog order');
  }
  for (const row of policy.packages) {
    if (
      !Array.isArray(row.phases)
      || row.phases.length === 0
      || new Set(row.phases).size !== row.phases.length
      || row.phases.some((phase) => !Object.hasOwn(CONDITIONS, phase))
    ) {
      fail('SIM_RESOLVER_POLICY_PHASE', `mandatory-singleton ${JSON.stringify(row.name)} has an invalid phase catalog`);
    }
  }
  const simulatorPackage = readJson(path.join(simulatorRoot, 'package.json'), 'apps/simulator/package.json');
  const lockfile = parseYaml(readFileSync(path.join(repoRoot, 'pnpm-lock.yaml'), 'utf8'));
  const rows = [];
  const tupleKeys = new Set();
  const importedSpecifiers = [...new Set([
    ...moduleRequirements.flatMap((entry) => entry.imports || []),
    ...collectSimulatorPackageImports(simulatorRoot),
  ])].sort();
  const mandatoryNames = new Set(policy.entries);
  const appSpecificNames = [...new Set(importedSpecifiers.map(packageNameFromSpecifier).filter((name) => !mandatoryNames.has(name)))].sort();
  const packagePlans = [
    ...policy.packages.map((policyRow) => ({ name: policyRow.name, role: 'mandatory-singleton', policyRow })),
    ...appSpecificNames.map((name) => ({ name, role: 'app-specific', policyRow: null })),
  ];
  for (const plan of packagePlans) {
    const packageName = plan.name;
    const rootSpecifier = exactDependencySpecifier(simulatorPackage, packageName);
    const lockRow = importerLockRow(lockfile, packageName);
    const packageInfo = packageDirectory(simulatorRoot, packageName);
    assertFinalPackageIdentity(packageName, rootSpecifier, lockRow, packageInfo);
    assertSelectedSourceRequirements(moduleRequirements, packageName, packageInfo.packageJson.version, plan.role);
    const targetPlans = [];
    const admittedPhases = plan.policyRow?.phases ?? ['types', 'runtime', 'style'];
    if (plan.policyRow) {
      for (const phase of plan.policyRow.phases) targetPlans.push({ phase, subpath: defaultSubpath(packageName, phase) });
    }
    if (plan.policyRow) {
      for (const subpath of explicitExportSubpaths(packageInfo.packageJson)) {
        for (const phase of supportedExportPhases(
          simulatorRoot,
          packageInfo,
          packageName,
          subpath,
          admittedPhases,
        )) {
          targetPlans.push({ phase, subpath });
        }
      }
    }
    for (const specifier of importedSpecifiers.filter((entry) => packageNameFromSpecifier(entry) === packageName)) {
      const subpath = exportSubpathFromSpecifier(specifier, packageName);
      for (const phase of phasesForSpecifier(specifier)) targetPlans.push({ phase, subpath });
    }
    const uniqueTargetPlans = [...new Map(targetPlans.map((entry) => [`${entry.phase}\0${entry.subpath}`, entry])).values()]
      .sort((left, right) => {
        const phaseOrder = ['types', 'runtime', 'style'];
        return phaseOrder.indexOf(left.phase) - phaseOrder.indexOf(right.phase) || left.subpath.localeCompare(right.subpath);
      });
    const targets = uniqueTargetPlans.map(({ phase, subpath }) => {
      const target = resolveTarget(simulatorRoot, packageInfo, packageName, subpath, phase);
      const canonicalTarget = serializedTarget(target);
      const orderedConditions = CONDITIONS[phase];
      const tuple = [
        serializedPackageRoot(packageName, packageInfo.packageJson.version),
        packageInfo.packageJson.version,
        lockRow.version,
        subpath,
        phase,
        orderedConditions,
        canonicalTarget,
      ];
      const tupleKey = JSON.stringify(tuple);
      if (tupleKeys.has(tupleKey)) fail('SIM_RESOLVER_DUPLICATE_TUPLE', `duplicate resolver tuple for ${packageName} ${phase}`);
      tupleKeys.add(tupleKey);
      return {
        exportSubpath: subpath,
        phase,
        orderedConditions: [...orderedConditions],
        canonicalTarget,
        typeProvider: target.providerName === packageName ? null : `${target.providerName}@${target.providerVersion}`,
        fileDigest: sha256Digest(readFileSync(target.absoluteTarget)),
      };
    });
    const lockIdentity = packageLockIdentity(lockfile, packageName, lockRow, packageInfo);
    const runtimeTargets = targets.filter((target) => target.phase === 'runtime');
    rows.push({
      name: packageName,
      version: packageInfo.packageJson.version,
      lockIdentity,
      packageJsonDigest: sha256Digest(readFileSync(packageInfo.packageJsonPath)),
      packageRootPath: serializedPackageRoot(packageName, packageInfo.packageJson.version),
      targets,
      role: plan.role,
      sourceDigest: packageSourceDigest(targets),
      runtimeIdentityDigest: runtimeTargets.length > 0
        ? stableJsonDigest('nimi-simulator-runtime-module-identity-v1', {
            packageRootPath: serializedPackageRoot(packageName, packageInfo.packageJson.version),
            version: packageInfo.packageJson.version,
            lockIdentity,
            targets: runtimeTargets.map((target) => ({
              exportSubpath: target.exportSubpath,
              orderedConditions: target.orderedConditions,
              canonicalTarget: target.canonicalTarget,
              fileDigest: target.fileDigest,
            })),
          })
        : null,
    });
  }
  return Object.freeze({
    catalog: {
      owner: policy.owner,
      version: String(policy.version),
      digest: sha256Digest(policyBytes),
    },
    packages: rows,
    tupleDigest: stableJsonDigest('nimi-simulator-resolver-tuples-v1', rows),
  });
}
