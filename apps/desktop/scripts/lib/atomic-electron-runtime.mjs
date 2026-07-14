import {
  cpSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import path from 'node:path';

/**
 * Publishes a fully prepared Electron runtime without exposing the unsigned
 * role executable. The initial directory publication is one rename. For an
 * existing Electron-version directory, resources are filled first and the
 * signed role executable is replaced by one same-volume rename.
 */
export function publishPreparedElectronRuntime(input) {
  const stagingRoot = requireAbsoluteDirectory(input?.stagingRoot, 'stagingRoot');
  const candidateRoot = requireAbsolutePath(input?.candidateRoot, 'candidateRoot');
  const roleExecutableName = requireRoleExecutableName(input?.roleExecutableName);
  requireSiblingRoots(stagingRoot, candidateRoot);

  const stagedExecutable = path.join(stagingRoot, roleExecutableName);
  requireRegularFile(stagedExecutable, 'staged role executable');
  mkdirSync(path.dirname(candidateRoot), { recursive: true });

  if (!existsSync(candidateRoot)) {
    renameSync(stagingRoot, candidateRoot);
    return path.join(candidateRoot, roleExecutableName);
  }
  if (!statSync(candidateRoot).isDirectory()) {
    throw new Error(`Electron runtime candidate root is not a directory: ${candidateRoot}`);
  }

  // The directory is version-scoped, so existing resources are immutable for
  // this Electron version. Fill only missing files; never remove a still-good
  // published candidate while preparing its replacement.
  cpSync(stagingRoot, candidateRoot, {
    recursive: true,
    force: false,
    errorOnExist: false,
    filter: (source) => comparablePath(source) !== comparablePath(stagedExecutable),
  });
  const publishedExecutable = path.join(candidateRoot, roleExecutableName);
  renameSync(stagedExecutable, publishedExecutable);
  rmSync(stagingRoot, { recursive: true, force: true });
  return publishedExecutable;
}

function requireAbsoluteDirectory(value, field) {
  const resolved = requireAbsolutePath(value, field);
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    throw new Error(`${field} must be an existing directory: ${resolved}`);
  }
  return resolved;
}

function requireAbsolutePath(value, field) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || !path.isAbsolute(normalized)) {
    throw new Error(`${field} must be an absolute path`);
  }
  return path.resolve(normalized);
}

function requireRoleExecutableName(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || path.basename(normalized) !== normalized) {
    throw new Error('roleExecutableName must be one file name');
  }
  return normalized;
}

function requireSiblingRoots(stagingRoot, candidateRoot) {
  if (comparablePath(stagingRoot) === comparablePath(candidateRoot)
    || comparablePath(path.dirname(stagingRoot)) !== comparablePath(path.dirname(candidateRoot))) {
    throw new Error('Electron runtime staging and candidate roots must be distinct siblings');
  }
}

function requireRegularFile(filePath, label) {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    throw new Error(`${label} is missing: ${filePath}`);
  }
}

function comparablePath(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}
