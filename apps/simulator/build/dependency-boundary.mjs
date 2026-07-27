import { readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

import {
  sha256Digest,
  validateSimulatorSelectedDependencyModule,
  SimulatorConformanceError,
} from '@nimiplatform/app-tools/simulator-conformance';

const SOURCE_EXTENSION = /\.[cm]?[jt]sx?$/u;

function fail(code, message, fieldPath = '') {
  throw new SimulatorConformanceError(code, message, fieldPath);
}

function stripQuery(id) {
  return id.split(/[?#]/u, 1)[0];
}

function packageRoot(simulatorRoot, name) {
  return realpathSync(path.join(simulatorRoot, 'node_modules', ...name.split('/')));
}

function isWithin(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function canonicalFilePath(owner, absolutePath) {
  const relative = path.relative(owner.root, absolutePath).split(path.sep).join('/');
  if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) {
    fail('SIM_DEPENDENCY_FILE_ESCAPE', 'selected dependency file escapes its qualified package root');
  }
  return `${owner.canonicalRoot}${relative}`;
}

function assertPackageIdentity(owner) {
  const packagePath = path.join(owner.root, 'package.json');
  const bytes = readFileSync(packagePath);
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    fail('SIM_DEPENDENCY_PACKAGE_JSON', `selected dependency ${JSON.stringify(owner.name)} has invalid package.json`);
  }
  if (value.name !== owner.name || value.version !== owner.version) {
    fail(
      'SIM_DEPENDENCY_PACKAGE_IDENTITY',
      `selected dependency package identity differs from resolver input for ${JSON.stringify(owner.name)}`,
    );
  }
  if (sha256Digest(bytes) !== owner.packageJsonDigest) {
    fail('SIM_DEPENDENCY_PACKAGE_DRIFT', `selected dependency package.json drifted for ${JSON.stringify(owner.name)}`);
  }
}

function normalizedFile(id) {
  const clean = stripQuery(id);
  try {
    return realpathSync(clean);
  } catch {
    return path.resolve(clean);
  }
}

export function createSelectedDependencyQualifier({ simulatorRoot, resolver }) {
  const owners = resolver.packages.map((row) => Object.freeze({
    name: row.name,
    version: row.version,
    role: row.role,
    packageJsonDigest: row.packageJsonDigest,
    canonicalRoot: `package/${row.name}@${row.version}/`,
    root: packageRoot(simulatorRoot, row.name),
  }));
  for (const owner of owners) assertPackageIdentity(owner);
  const ownersByName = new Map(owners.map((owner) => [owner.name, owner]));
  const taintedFiles = new Map();
  const scannedFiles = new Map();
  const requiredPackages = new Set();

  const ownerForFile = (absolutePath) => owners
    .filter((owner) => isWithin(owner.root, absolutePath))
    .sort((left, right) => right.root.length - left.root.length)[0] ?? null;

  const scanFile = (absolute, owner, code) => {
    const diskBytes = readFileSync(absolute);
    const transformBytes = Buffer.from(code, 'utf8');
    if (diskBytes.length !== transformBytes.length
      || sha256Digest(diskBytes) !== sha256Digest(transformBytes)) {
      fail('SIM_DEPENDENCY_TRANSFORM_DRIFT', 'dependency scan input differs from selected package bytes', canonicalFilePath(owner, absolute));
    }
    if (SOURCE_EXTENSION.test(absolute)) {
      validateSimulatorSelectedDependencyModule(code, canonicalFilePath(owner, absolute));
    } else if (absolute.endsWith('.json')) {
      try {
        JSON.parse(code);
      } catch {
        fail('SIM_DEPENDENCY_JSON', 'selected dependency JSON module cannot be parsed', canonicalFilePath(owner, absolute));
      }
    } else {
      fail(
        'SIM_SELECTED_DEPENDENCY_RESOURCE',
        'selected dependency closure contains an unadmitted runtime resource kind',
        canonicalFilePath(owner, absolute),
      );
    }
    const scanned = Object.freeze({
      owner,
      path: canonicalFilePath(owner, absolute),
      bytes: diskBytes.length,
      digest: sha256Digest(diskBytes),
    });
    scannedFiles.set(absolute, scanned);
    return scanned;
  };

  const markFile = (absolutePath, expectedOwner = null) => {
    const actual = normalizedFile(absolutePath);
    const stat = statSync(actual);
    if (!stat.isFile()) fail('SIM_DEPENDENCY_FILE_KIND', 'selected dependency runtime edge must resolve to a file', actual);
    const owner = ownerForFile(actual);
    if (!owner) {
      fail(
        'SIM_DEPENDENCY_TRANSITIVE_PACKAGE',
        'selected dependency reached a package absent from the final qualified resolver graph',
        actual,
      );
    }
    if (owner.role === 'mandatory-singleton') return false;
    if (expectedOwner && owner.name !== expectedOwner.name) {
      fail('SIM_DEPENDENCY_TARGET_OWNER', 'resolver target resolved into a different package identity', actual);
    }
    taintedFiles.set(actual, owner);
    requiredPackages.add(owner.name);
    scanFile(actual, owner, readFileSync(actual, 'utf8'));
    return true;
  };

  const markPackageTarget = (packageName, absolutePath, importerSelected) => {
    const owner = ownersByName.get(packageName);
    if (!owner) fail('SIM_DEPENDENCY_RESOLVER_ROW', `resolver package row is absent for ${JSON.stringify(packageName)}`);
    if (owner.role !== 'app-specific' || !importerSelected) return false;
    return markFile(absolutePath, owner);
  };

  const isTaintedImporter = (importer) => Boolean(importer && taintedFiles.has(normalizedFile(importer)));

  const markResolvedEdge = (importer, resolvedId) => {
    if (!isTaintedImporter(importer)) return false;
    return markFile(resolvedId);
  };

  const validateTransform = (code, id) => {
    const absolute = normalizedFile(id);
    const owner = taintedFiles.get(absolute);
    if (!owner) return false;
    scanFile(absolute, owner, code);
    return true;
  };

  const finalize = () => {
    for (const [absolute, owner] of taintedFiles) {
      const transformed = scannedFiles.get(absolute);
      if (!transformed) {
        fail('SIM_DEPENDENCY_UNSCANNED_FILE', 'resolved selected dependency file was not statically scanned', canonicalFilePath(owner, absolute));
      }
      const bytes = readFileSync(absolute);
      if (bytes.length !== transformed.bytes || sha256Digest(bytes) !== transformed.digest) {
        fail('SIM_DEPENDENCY_FILE_DRIFT', 'selected dependency file changed during final build', transformed.path);
      }
    }
    for (const name of requiredPackages) {
      if (![...scannedFiles.values()].some((entry) => entry.owner.name === name)) {
        fail('SIM_DEPENDENCY_EMPTY_CLOSURE', `selected dependency ${JSON.stringify(name)} has no runtime closure`);
      }
    }
  };

  return Object.freeze({
    isTaintedImporter,
    markPackageTarget,
    markResolvedEdge,
    validateTransform,
    finalize,
  });
}
