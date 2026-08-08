import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function temporaryOutputPath(outDirAbsolute, purpose) {
  const parent = path.dirname(outDirAbsolute);
  const name = path.basename(outDirAbsolute);
  return path.join(parent, `.${name}.${purpose}-${process.pid}-${randomUUID()}`);
}

function isWindowsDirectoryInUseError(error) {
  return process.platform === 'win32'
    && (error?.code === 'EPERM' || error?.code === 'EACCES' || error?.code === 'EBUSY');
}

function mirrorDirectoryInPlace(sourceDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  const sourceEntries = fs.readdirSync(sourceDir, { withFileTypes: true });
  const sourceEntriesByName = new Map(sourceEntries.map((entry) => [entry.name, entry]));

  for (const targetEntry of fs.readdirSync(targetDir, { withFileTypes: true })) {
    const sourceEntry = sourceEntriesByName.get(targetEntry.name);
    const sameKind = sourceEntry
      && sourceEntry.isDirectory() === targetEntry.isDirectory()
      && sourceEntry.isFile() === targetEntry.isFile();
    if (!sameKind) {
      fs.rmSync(path.join(targetDir, targetEntry.name), { recursive: true, force: true });
    }
  }

  for (const sourceEntry of sourceEntries) {
    const sourcePath = path.join(sourceDir, sourceEntry.name);
    const targetPath = path.join(targetDir, sourceEntry.name);
    if (sourceEntry.isDirectory()) {
      mirrorDirectoryInPlace(sourcePath, targetPath);
      continue;
    }
    if (sourceEntry.isFile()) {
      fs.copyFileSync(sourcePath, targetPath);
      continue;
    }
    throw new Error(`unsupported build output entry: ${sourcePath}`);
  }
}

export function publishBuildOutput(stagingDir, outDirAbsolute) {
  const previousDir = temporaryOutputPath(outDirAbsolute, 'previous');
  const hadPreviousOutput = fs.existsSync(outDirAbsolute);
  let previousOutputMoved = false;

  try {
    if (hadPreviousOutput) {
      try {
        fs.renameSync(outDirAbsolute, previousDir);
      } catch (error) {
        if (!isWindowsDirectoryInUseError(error)) throw error;
        mirrorDirectoryInPlace(stagingDir, outDirAbsolute);
        return;
      }
      previousOutputMoved = true;
    }
    fs.renameSync(stagingDir, outDirAbsolute);
  } catch (error) {
    if (previousOutputMoved && !fs.existsSync(outDirAbsolute)) {
      try {
        fs.renameSync(previousDir, outDirAbsolute);
        previousOutputMoved = false;
      } catch (restoreError) {
        throw new AggregateError(
          [error, restoreError],
          `failed to publish build output and restore previous output at ${outDirAbsolute}`,
        );
      }
    }
    throw error;
  }

  if (previousOutputMoved) {
    fs.rmSync(previousDir, { recursive: true, force: true });
  }
}
