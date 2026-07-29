import { execFile } from 'node:child_process';
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
  stat,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const COMMAND = 'desktop_logs_export' as const;
const LOGS_DIRECTORY_NAME = 'logs';
const EXPORT_FILE_PREFIX = 'nimi-logs-export-';
const execFileAsync = promisify(execFile);

type LogFile = {
  readonly sourcePath: string;
  readonly relativePath: string;
  readonly byteSize: number;
};

export type DesktopElectronLogsExportResult = {
  readonly artifactPath: string;
  readonly fileCount: number;
  readonly byteSize: number;
  readonly exportedAt: string;
};

export type DesktopSupportLogsArchiveCommand = {
  readonly executable: string;
  readonly arguments: readonly string[];
};

export type DesktopElectronSupportLogsHost = {
  readonly commandHandlers: Readonly<Record<typeof COMMAND, (context: {
    readonly payload: Readonly<Record<string, unknown>>;
  }) => Promise<DesktopElectronLogsExportResult>>>;
};

export function createDesktopElectronSupportLogsHost(input: {
  readonly resolveSelectedDataRoot: () => Promise<string>;
  readonly downloadsDirectory: string;
  readonly revealFile: (filePath: string) => void;
  readonly platform?: NodeJS.Platform;
  readonly windowsSystemRoot?: string;
}): DesktopElectronSupportLogsHost {
  return {
    commandHandlers: {
      [COMMAND]: async ({ payload }) => {
        if (Object.keys(payload).length !== 0) {
          throw new Error('desktop-logs-export-payload-invalid');
        }
        return exportDesktopElectronSupportLogs({
          dataRoot: await input.resolveSelectedDataRoot(),
          downloadsDirectory: input.downloadsDirectory,
          revealFile: input.revealFile,
          platform: input.platform ?? process.platform,
          windowsSystemRoot: input.windowsSystemRoot,
        });
      },
    },
  };
}

export async function exportDesktopElectronSupportLogs(input: {
  readonly dataRoot: string;
  readonly downloadsDirectory: string;
  readonly revealFile: (filePath: string) => void;
  readonly platform?: NodeJS.Platform;
  readonly windowsSystemRoot?: string;
}): Promise<DesktopElectronLogsExportResult> {
  const platform = input.platform ?? process.platform;
  requireSupportedPlatform(platform);
  if (!path.isAbsolute(input.dataRoot) || !path.isAbsolute(input.downloadsDirectory)) {
    throw new Error('desktop-logs-export-path-invalid');
  }

  const logsDirectory = path.join(input.dataRoot, LOGS_DIRECTORY_NAME);
  const logsDirectoryStat = await lstat(logsDirectory).catch(() => null);
  if (!logsDirectoryStat) {
    throw new Error('desktop-logs-export-logs-directory-missing');
  }
  if (!logsDirectoryStat.isDirectory() || logsDirectoryStat.isSymbolicLink()) {
    throw new Error('desktop-logs-export-logs-directory-invalid');
  }

  const canonicalLogsDirectory = await realpath(logsDirectory);
  const files = await collectRegularLogFiles(canonicalLogsDirectory, canonicalLogsDirectory);
  if (files.length === 0) {
    throw new Error('desktop-logs-export-logs-directory-empty');
  }
  const byteSize = files.reduce((total, file) => total + file.byteSize, 0);
  if (!Number.isSafeInteger(byteSize) || byteSize <= 0) {
    throw new Error('desktop-logs-export-log-content-empty');
  }

  await mkdir(input.downloadsDirectory, { recursive: true });
  const exportedAt = new Date().toISOString();
  const artifactPath = await resolveAvailableArtifactPath(input.downloadsDirectory, exportedAt);
  const stagingRoot = await mkdtemp(path.join(os.tmpdir(), 'nimi-logs-export-'));

  try {
    for (const file of files) {
      const destinationPath = path.join(stagingRoot, file.relativePath);
      await mkdir(path.dirname(destinationPath), { recursive: true });
      await copyFile(file.sourcePath, destinationPath);
    }
    const archive = resolveDesktopSupportLogsArchiveCommand(
      platform,
      stagingRoot,
      artifactPath,
      input.windowsSystemRoot,
    );
    await execFileAsync(archive.executable, [...archive.arguments]);
    const artifactStat = await stat(artifactPath);
    if (!artifactStat.isFile() || artifactStat.size <= 0) {
      throw new Error('desktop-logs-export-artifact-invalid');
    }
  } catch (error) {
    await rm(artifactPath, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }

  try {
    input.revealFile(artifactPath);
  } catch {
    // The archive is already complete and user-locatable in Downloads.
  }

  return Object.freeze({
    artifactPath,
    fileCount: files.length,
    byteSize,
    exportedAt,
  });
}

export function resolveDesktopSupportLogsArchiveCommand(
  platform: NodeJS.Platform,
  sourceDirectory: string,
  artifactPath: string,
  windowsSystemRoot?: string,
): DesktopSupportLogsArchiveCommand {
  requireSupportedPlatform(platform);
  const platformPath = platform === 'win32' ? path.win32 : path.posix;
  if (!platformPath.isAbsolute(sourceDirectory) || !platformPath.isAbsolute(artifactPath)) {
    throw new Error('desktop-logs-export-path-invalid');
  }
  if (platform === 'darwin') {
    return Object.freeze({
      executable: '/usr/bin/ditto',
      arguments: Object.freeze([
        '-c',
        '-k',
        '--norsrc',
        '--noextattr',
        '--noqtn',
        '--noacl',
        sourceDirectory,
        artifactPath,
      ]),
    });
  }
  const systemRoot = normalizeWindowsSystemRoot(
    windowsSystemRoot ?? process.env.SystemRoot ?? 'C:\\Windows',
  );
  return Object.freeze({
    executable: path.win32.join(systemRoot, 'System32', 'tar.exe'),
    arguments: Object.freeze([
      '-a',
      '-c',
      '-f',
      artifactPath,
      '-C',
      sourceDirectory,
      '.',
    ]),
  });
}

function normalizeWindowsSystemRoot(value: string): string {
  if (
    value.trim() !== value
    || value.includes('\0')
    || !/^[A-Za-z]:\\/u.test(value)
    || !path.win32.isAbsolute(value)
    || path.win32.normalize(value) !== value
    || path.win32.dirname(value) !== path.win32.parse(value).root
    || path.win32.basename(value).toLowerCase() !== 'windows'
  ) {
    throw new Error('desktop-logs-export-system-root-invalid');
  }
  return value;
}

function requireSupportedPlatform(platform: NodeJS.Platform): void {
  if (platform !== 'darwin' && platform !== 'win32') {
    throw new Error('desktop-logs-export-platform-unsupported');
  }
}

async function collectRegularLogFiles(
  rootDirectory: string,
  currentDirectory: string,
): Promise<LogFile[]> {
  const entries = await readdir(currentDirectory, { withFileTypes: true });
  const files: LogFile[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const sourcePath = path.join(currentDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectRegularLogFiles(rootDirectory, sourcePath));
      continue;
    }
    if (!entry.isFile()) continue;
    const canonicalSourcePath = await realpath(sourcePath);
    if (!isPathWithin(rootDirectory, canonicalSourcePath)) {
      throw new Error('desktop-logs-export-file-outside-logs-directory');
    }
    const sourceStat = await stat(canonicalSourcePath);
    files.push({
      sourcePath: canonicalSourcePath,
      relativePath: path.relative(rootDirectory, canonicalSourcePath),
      byteSize: sourceStat.size,
    });
  }
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function isPathWithin(rootDirectory: string, candidatePath: string): boolean {
  const relative = path.relative(rootDirectory, candidatePath);
  return relative !== ''
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

async function resolveAvailableArtifactPath(
  downloadsDirectory: string,
  exportedAt: string,
): Promise<string> {
  const stamp = exportedAt.replace(/[-:.]/gu, '');
  for (let suffix = 0; suffix < 100; suffix += 1) {
    const discriminator = suffix === 0 ? '' : `-${suffix}`;
    const candidate = path.join(
      downloadsDirectory,
      `${EXPORT_FILE_PREFIX}${stamp}${discriminator}.zip`,
    );
    const existing = await lstat(candidate).catch(() => null);
    if (!existing) return candidate;
  }
  throw new Error('desktop-logs-export-artifact-name-exhausted');
}
