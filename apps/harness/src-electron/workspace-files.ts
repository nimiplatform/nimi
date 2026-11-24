import { constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, readdir, realpath, rmdir, stat, unlink, type FileHandle } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isSensitivePath, validateRawWorkspacePathInput } from './security-policy.js';

const importLimit = 32 * 1024 * 1024;
const previewLimit = 128 * 1024;
const textExtensions = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json',
  '.md', '.markdown', '.txt', '.css', '.scss', '.html', '.xml',
  '.yaml', '.yml', '.toml', '.py', '.go', '.rs', '.java',
  '.c', '.cpp', '.h', '.sh', '.zsh', '.sql', '.csv', '.log', '.gitignore',
]);
const textBasenames = new Set(['.gitignore', '.gitattributes', 'dockerfile', 'makefile', 'license', 'readme']);
const imageTypes = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
]);

function isPreviewableText(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  if (ext && textExtensions.has(ext)) return true;
  return textBasenames.has(basename(filePath).toLowerCase());
}

function pathsOverlapCaseAware(a: string, b: string): boolean {
  const normA = process.platform === 'win32' || process.platform === 'darwin'
    ? resolve(a).toLowerCase()
    : resolve(a);
  const normB = process.platform === 'win32' || process.platform === 'darwin'
    ? resolve(b).toLowerCase()
    : resolve(b);
  if (normA === normB) return true;
  const prefA = normA.endsWith(sep) ? normA : normA + sep;
  const prefB = normB.endsWith(sep) ? normB : normB + sep;
  return normA.startsWith(prefB) || normB.startsWith(prefA);
}

function isForbiddenSystemWorkspaceRoot(realDir: string): boolean {
  // Reject filesystem roots such as "/" or "C:\".
  if (dirname(realDir) === realDir) return true;
  if (process.platform === 'win32') {
    const lower = realDir.toLowerCase().replace(/\\+$/, '');
    const sysRoot = (process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows').toLowerCase().replace(/\\+$/, '');
    const programFiles = (process.env.ProgramFiles || 'C:\\Program Files').toLowerCase().replace(/\\+$/, '');
    const programFilesX86 = (process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)').toLowerCase().replace(/\\+$/, '');
    for (const blocked of [sysRoot, programFiles, programFilesX86]) {
      if (lower === blocked || lower.startsWith(`${blocked}\\`)) return true;
    }
    return false;
  }
  const normalized = realDir.replace(/\/+$/, '');
  for (const blocked of ['/system', '/etc', '/usr', '/bin', '/sbin', '/dev', '/proc', '/sys', '/library']) {
    if (normalized.toLowerCase() === blocked || normalized.toLowerCase().startsWith(`${blocked}/`)) {
      return true;
    }
  }
  return false;
}

export async function validateWorkspaceDir(dir: string, forbiddenRoots: readonly string[] = []): Promise<string> {
  if (typeof dir !== 'string' || !dir.trim() || !isAbsolute(dir) || /[\x00-\x1f]/u.test(dir)) {
    throw new Error('Choose an absolute directory path for the workspace.');
  }
  const linfo = await lstat(dir);
  if (linfo.isSymbolicLink()) {
    throw new Error('Workspace path must be a real directory, not a symbolic link.');
  }
  if (!linfo.isDirectory()) throw new Error('The chosen workspace path is not a directory.');
  const real = await realpath(dir);
  if (isForbiddenSystemWorkspaceRoot(real)) {
    throw new Error('System roots and OS directories cannot be bound as a Harness workspace.');
  }
  for (const forbidden of forbiddenRoots) {
    if (!forbidden) continue;
    let resolvedForbidden = resolve(forbidden);
    try {
      resolvedForbidden = await realpath(forbidden);
    } catch {
      // Directory may not exist yet; compare resolved absolute path.
    }
    if (pathsOverlapCaseAware(real, resolvedForbidden)) {
      throw new Error('Harness internal data directory cannot be bound as a user workspace.');
    }
  }
  return real;
}

/** Verify whether a candidate path (existing or to-be-created) resolves strictly inside the workspace root. */
export async function isInsideWorkspace(workspace: string, targetPath: string): Promise<boolean> {
  if (typeof targetPath !== 'string' || !targetPath.trim() || /[\x00-\x1f]/u.test(targetPath)) return false;
  let root: string;
  try {
    root = await realpath(workspace);
  } catch {
    return false;
  }
  const candidate = resolve(root, targetPath);
  const rootPrefix = root.endsWith(sep) ? root : root + sep;
  if (candidate !== root && !candidate.startsWith(rootPrefix)) return false;

  // Walk up from candidate until an existing entry is found, verifying no symlink escapes root.
  const trailing: string[] = [];
  let probe = candidate;
  for (;;) {
    try {
      const info = await lstat(probe);
      if (info.isSymbolicLink()) {
        // Resolve the symlink target and confirm it stays within root.
        const resolvedLink = await realpath(probe);
        if (resolvedLink !== root && !resolvedLink.startsWith(rootPrefix)) return false;
        const reconstructed = trailing.length ? join(resolvedLink, ...trailing.reverse()) : resolvedLink;
        return reconstructed === root || reconstructed.startsWith(rootPrefix);
      }
      const resolvedProbe = await realpath(probe);
      if (resolvedProbe !== root && !resolvedProbe.startsWith(rootPrefix)) return false;
      const reconstructed = trailing.length ? join(resolvedProbe, ...trailing.reverse()) : resolvedProbe;
      return reconstructed === root || reconstructed.startsWith(rootPrefix);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return false;
      const parent = dirname(probe);
      if (parent === probe) return false;
      trailing.push(basename(probe));
      probe = parent;
    }
  }
}

async function readRange(file: FileHandle, start: number, size: number, signal: AbortSignal) {
  const data = Buffer.alloc(size);
  let length = 0;
  while (length < size) {
    signal.throwIfAborted();
    const { bytesRead } = await file.read(data, length, size - length, start + length);
    if (!bytesRead) break;
    length += bytesRead;
  }
  signal.throwIfAborted();
  return data.subarray(0, length);
}

export function sessionWorkspace(folder: string, session: string) {
  return session === 'main' ? join(folder, 'workspace') : join(folder, 'workspaces', session);
}

/** A tool's path can be opened from history only inside the session workspace. */
export function resultReference(workspace: string, path: unknown): string | undefined {
  if (typeof path !== 'string' || !path) return;
  const rel = relative(workspace, resolve(workspace, path));
  if (!rel || isAbsolute(rel) || rel.split(/[\\/]/).some(part => part === '..')) return;
  return rel.split(/[\\/]/).join('/');
}

async function resolveItem(workspace: string, ref: string, allowSensitiveRoot = false) {
  if (typeof ref !== 'string' || isAbsolute(ref) || ref.includes('\\') || /[\x00-\x1f]/u.test(ref)
    || (ref !== '' && ref.split('/').some(part => !part || part === '.' || part === '..' || part.includes(':')))) {
    throw new Error('Invalid session file reference.');
  }
  if (ref !== '') {
    validateRawWorkspacePathInput(ref);
  }
  if (!(await lstat(workspace)).isDirectory()) throw new Error('Session workspace unavailable.');
  const root = await realpath(workspace);
  if (ref !== '' && !allowSensitiveRoot && isSensitivePath(ref, root)) {
    throw new Error(`Access to sensitive file "${ref}" is blocked by Harness security policy.`);
  }
  let probe = root;
  if (ref !== '') {
    for (const seg of ref.split('/')) {
      probe = join(probe, seg);
      const segInfo = await lstat(probe);
      if (segInfo.isSymbolicLink()) throw new Error('Choose a file inside this workspace.');
    }
  }
  const path = join(root, ref);
  if (await realpath(path) !== path) throw new Error('Choose a file inside this workspace.');
  const relPosix = relative(root, path).split(sep).join('/');
  if (relPosix && !allowSensitiveRoot && isSensitivePath(relPosix, root)) {
    throw new Error(`Access to sensitive file "${relPosix}" is blocked by Harness security policy.`);
  }
  return path;
}

export async function copyMaterial(workspace: string, name: string, bytes: Uint8Array, signal: AbortSignal) {
  if (typeof name !== 'string' || !name.trim() || name === '.' || name === '..' || basename(name) !== name || /[/\\:\x00-\x1f]/u.test(name)) {
    throw new Error('Invalid attachment name.');
  }
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > importLimit) throw new Error('Choose a file up to 32 MiB.');
  signal.throwIfAborted();
  await mkdir(workspace, { recursive: true, mode: 0o700 });
  const root = await resolveItem(workspace, '');
  const folder = await mkdtemp(join(root, 'material-'));
  const target = join(folder, name);
  let file: FileHandle | undefined;
  try {
    file = await open(target, 'wx', 0o600);
    try { await file.writeFile(bytes, { signal }); }
    finally { await file.close(); }
    signal.throwIfAborted();
    return { name, ref: basename(folder) + '/' + name };
  } catch (error) {
    if (file) await unlink(target).catch(() => {});
    await rmdir(folder).catch(() => {}); // Leave unrelated concurrent files alone.
    throw error;
  }
}

export async function listWorkspace(workspace: string, folder: string, offset: number, signal: AbortSignal) {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid file list position.');
  const path = await resolveItem(workspace, folder, true);
  const root = await realpath(workspace);
  const entries = (await readdir(path, { withFileTypes: true })).filter(item => {
    if (item.isSymbolicLink()) return false;
    if (!item.isDirectory() && !item.isFile()) return false;
    const ref = folder ? folder + '/' + item.name : item.name;
    return !isSensitivePath(ref, root);
  });
  entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
  signal.throwIfAborted();
  const slice = entries.slice(offset, offset + 100);
  const items = await Promise.all(slice.map(async item => {
    const ref = folder ? folder + '/' + item.name : item.name;
    const directory = item.isDirectory();
    if (directory) return { name: item.name, ref, directory: true as const };
    let size: number | undefined;
    try {
      const info = await lstat(join(path, item.name));
      if (info.isFile() && info.nlink === 1) size = info.size;
    } catch { /* ignore transient stat failures */ }
    return { name: item.name, ref, directory: false as const, ...(size !== undefined ? { size } : {}) };
  }));
  signal.throwIfAborted();
  return { items, next: offset + items.length < entries.length ? offset + items.length : null };
}

export async function workspaceFile(workspace: string, ref: string, signal: AbortSignal) {
  if (!ref) throw new Error('Choose a file.');
  const path = await resolveItem(workspace, ref);
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error('Choose a regular workspace file.');
  if (info.nlink > 1) throw new Error('Hardlinked files are blocked by Harness security policy.');
  signal.throwIfAborted();
  return { path, info };
}

export async function previewWorkspaceFile(workspace: string, ref: string, signal: AbortSignal, requestedPage = 0) {
  if (!Number.isSafeInteger(requestedPage) || requestedPage < 0) throw new Error('Invalid preview page.');
  const { path, info } = await workspaceFile(workspace, ref, signal);
  const extension = extname(path).toLowerCase();
  const meta = { name: basename(path), ref, size: info.size };
  const imageType = imageTypes.get(extension);
  if (!imageType && !isPreviewableText(path)) return { ...meta, format: 'file' as const };
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink > 1 || stat.dev !== info.dev || stat.ino !== info.ino) throw new Error('The file changed or is a hardlink. Open it again.');
    if (imageType) {
      if (stat.size > importLimit) return { ...meta, size: stat.size, format: 'file' as const, message: 'Images over 32 MiB can be opened from their folder.' };
      const bytes = await readRange(file, 0, stat.size, signal);
      if (bytes.length !== stat.size) throw new Error('The image changed. Refresh to read it again.');
      return { ...meta, size: stat.size, format: 'image' as const, mimeType: imageType, bytes: bytes.buffer };
    }
    const pages = Math.max(1, Math.ceil(stat.size / previewLimit));
    const page = Math.min(requestedPage, pages - 1);
    const start = page * previewLimit;
    // Move each cut back to the start of a UTF-8 character. Even the last
    // character of a file that just crosses the limit gets a nonempty page.
    const readStart = Math.max(0, start - 3);
    const end = Math.min(stat.size, start + previewLimit);
    const data = await readRange(file, readStart, Math.min(stat.size, end + 1) - readStart, signal);
    const length = data.length;
    const boundary = (index: number) => {
      let aligned = index;
      while (aligned > 0 && aligned > index - 3 && (data[aligned] & 0xc0) === 0x80) aligned--;
      return aligned;
    };
    const markdown = pages === 1 && (extension === '.md' || extension === '.markdown');
    return { ...meta, size: stat.size, format: markdown ? 'markdown' as const : 'text' as const,
      content: data.toString('utf8', boundary(start - readStart), length <= end - readStart ? length : boundary(end - readStart)), page, pages };
  } finally { await file.close(); }
}
