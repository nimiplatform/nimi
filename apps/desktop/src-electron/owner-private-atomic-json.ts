import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  rm,
} from 'node:fs/promises';
import path from 'node:path';

export async function writeOwnerPrivateAtomicJson(
  targetPath: string,
  value: unknown,
  reasonPrefix: string,
): Promise<void> {
  const parent = path.dirname(targetPath);
  await rejectSymlinkAncestry(parent, reasonPrefix);
  await rejectSymlinkIfExists(targetPath, reasonPrefix);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  await rejectSymlinkAncestry(parent, reasonPrefix);
  await rejectDescriptorTempSymlinks(parent, targetPath, reasonPrefix);
  await setOwnerOnlyDirectory(parent);

  const tempPath = path.join(
    parent,
    `${path.basename(targetPath)}.${randomBytes(12).toString('base64url')}.tmp`,
  );
  await rejectSymlinkIfExists(tempPath, reasonPrefix);
  const noFollow = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW;
  const handle = await open(
    tempPath,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
    0o600,
  );
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
  await handle.close();
  try {
    await setOwnerOnlyFile(tempPath);
    await rename(tempPath, targetPath);
    await setOwnerOnlyFile(targetPath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function rejectDescriptorTempSymlinks(
  parent: string,
  targetPath: string,
  reasonPrefix: string,
): Promise<void> {
  const prefix = `${path.basename(targetPath)}.`;
  for (const entry of await readdir(parent, { withFileTypes: true })) {
    if (entry.name.startsWith(prefix) && entry.name.endsWith('.tmp') && entry.isSymbolicLink()) {
      throw new Error(`${reasonPrefix}-temp-must-not-be-symlink`);
    }
  }
}

async function rejectSymlinkIfExists(candidate: string, reasonPrefix: string): Promise<void> {
  try {
    if ((await lstat(candidate)).isSymbolicLink()) {
      throw new Error(`${reasonPrefix}-must-not-be-symlink`);
    }
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error;
  }
}

async function rejectSymlinkAncestry(candidate: string, reasonPrefix: string): Promise<void> {
  const resolved = path.resolve(candidate);
  const parsed = path.parse(resolved);
  let current = parsed.root;
  const segments = resolved.slice(parsed.root.length).split(path.sep).filter(Boolean);
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new Error(`${reasonPrefix}-parent-must-not-be-symlink`);
      }
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error;
    }
  }
}

async function setOwnerOnlyDirectory(directory: string): Promise<void> {
  if (process.platform !== 'win32') await chmod(directory, 0o700);
}

async function setOwnerOnlyFile(filePath: string): Promise<void> {
  if (process.platform !== 'win32') await chmod(filePath, 0o600);
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}
