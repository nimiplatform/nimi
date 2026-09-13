import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export function plannedFile(targetDir, relativePath, content) {
  const filePath = path.join(targetDir, relativePath);
  assertProjectOutputPath(targetDir, filePath);
  return { path: filePath, content, previous: existsSync(filePath) ? readFileSync(filePath) : null };
}

export function assertProjectOutputPath(targetDir, filePath) {
  const relative = path.relative(targetDir, filePath);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`App output must stay in the project: ${filePath}`);
  }
  let current = targetDir;
  const parts = relative.split(path.sep);
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    let stat;
    try { stat = lstatSync(current); }
    catch (error) { if (error.code === 'ENOENT') break; throw error; }
    if (stat.isSymbolicLink() || (index < parts.length - 1 && !stat.isDirectory())) {
      throw new Error(`App output path collision: ${path.relative(targetDir, current)} must not be a symbolic link or non-directory ancestor`);
    }
    if (index === parts.length - 1 && !stat.isFile()) throw new Error(`App output file collision: ${relative}`);
  }
}

export function changedFiles(planned) {
  // Later normalization of the same owned file supplies its final content.
  return [...new Map(planned.map((file) => [file.path, file])).values()].filter((file) => (
    file.content === null ? file.previous !== null
      : file.previous === null || !Buffer.from(file.content).equals(Buffer.from(file.previous))
  ));
}

export function describeChanges(targetDir, planned) {
  return changedFiles(planned).map((file) => ({
    path: path.relative(targetDir, file.path).split(path.sep).join('/'),
    action: file.content === null ? 'remove' : file.previous === null ? 'create' : 'update',
    // Source text makes script/dependency/managed-block changes reviewable.
    ...(path.extname(file.path).match(/^\.(?:json|ya?ml|md|[cm]?js|tsx?|toml|css)$/u)
      ? { before: file.previous === null ? null : Buffer.from(file.previous).toString('utf8'), after: file.content === null ? null : Buffer.from(file.content).toString('utf8') }
      : {}),
  }));
}

export function applyProjectFiles(targetDir, planned) {
  for (const file of planned) assertProjectOutputPath(targetDir, file.path);
  const completed = [];
  for (const file of changedFiles(planned)) {
    const temporary = `${file.path}.${randomUUID()}.tmp`;
    try {
      if (file.content === null) rmSync(file.path);
      else {
        mkdirSync(path.dirname(file.path), { recursive: true });
        writeFileSync(temporary, file.content);
        renameSync(temporary, file.path);
      }
      completed.push(path.relative(targetDir, file.path).split(path.sep).join('/'));
    } catch (cause) {
      throw new Error(`App file update failed at ${path.relative(targetDir, file.path)}; completed files: ${completed.join(', ') || 'none'}. Fix the filesystem error and rerun the command.`, { cause });
    } finally {
      rmSync(temporary, { force: true });
    }
  }
  return completed;
}
