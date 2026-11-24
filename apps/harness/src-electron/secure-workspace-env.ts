// SecureWorkspaceExecutionEnv replaces pi-durable's NodeExecutionEnv with all
// 7 v2.1 PC Body Security Gates:
//   Gate 1: Rust Win32 Job Object / POSIX process-group supervision (zero grandchild residue)
//   Gate 2: Handle-level NTFS/POSIX file ops (GetFinalPathNameByHandleW + nNumberOfLinks == 1 + CAS)
//   Gate 3: Control-plane file wall + shared isSensitivePath() across read/write/edit/delete/grep/glob
//   Gate 4: Free Shell minimal env allowlist (inheritEnv: false) + recursive .env* canary redaction
//   Gate 6: Overlapping workspace write mutex + persistent pre-write snapshots & conflict-checked restore
//   Gate 7: Redirected Spill directory (2 GiB / 14d recursive LRU) + 256 KiB UTF-8 byte frame ceiling
// Fail-closed invariant (Fork 4): on Windows & macOS, missing native security host NEVER silently falls back.
// @nimi-authority: rule.nimi.harness.security-gates.workspace-execution-env
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { lstat, mkdir, readdir, readFile, rm, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Context } from '@earendil-works/chord/context';
import {
  err,
  ExecutionError,
  FileError,
  ok,
  type BinaryReader,
  type DirReader,
  type ExecutionEnv,
  type FileChange,
  type FileInfo,
  type FileListEntry,
  type FileListing,
  type FileWatcher,
  type LineScan,
  type ListFilesOptions,
  type Result,
  type ShellExecOptions,
  type ShellExecResult,
  type TextLine,
  type TextLineReader,
  type WatchTarget,
} from '@earendil-works/pi-durable/env';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import {
  createNimiElectronHarnessSecurityHost,
  type NimiElectronHarnessSecurityBinding,
  type NimiElectronHarnessSecurityHost,
} from '@nimiplatform/kit/shell/electron/main';
import {
  buildMinimalShellEnv,
  extractWorkspaceEnvCanarySecrets,
  filterSafeCallerEnvOverrides,
  isControlPlanePath,
  isSensitivePath,
  redactCanarySecrets,
  resolveSafeWorkspacePath,
  StreamingCanaryRedactor,
  truncateUtf8Bytes,
} from './security-policy.js';

export const SPILL_MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB
export const SPILL_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
export const MAX_CONTROL_FRAME_BYTES = 256 * 1024; // 256 KiB (UTF-8 bytes)

const NON_DEV_ALLOWED_GIT_SUBCOMMANDS = new Set([
  'status', 'diff', 'log', 'show', 'rev-parse', 'branch', 'tag', 'ls-files',
]);

function isDangerousGitCommand(args: readonly string[]): boolean {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    const lower = arg.toLowerCase();
    if (
      lower === '-c'
      || lower.startsWith('-c=')
      || (arg.startsWith('-c') && arg.length > 2)
      || arg === '-C'
      || (arg.startsWith('-C') && arg.length > 2)
      || lower === '--git-dir'
      || lower.startsWith('--git-dir=')
      || lower === '--work-tree'
      || lower.startsWith('--work-tree=')
      || lower === '--exec-path'
      || lower.startsWith('--exec-path=')
      || lower === '--config-env'
      || lower.startsWith('--config-env=')
      || lower.includes('core.pager')
      || lower.includes('core.fsmonitor')
      || lower.includes('core.hookspath')
      || lower.includes('core.sshcommand')
      || lower.includes('diff.external')
      || lower === '--upload-pack'
      || lower.startsWith('--upload-pack=')
      || lower === '--receive-pack'
      || lower.startsWith('--receive-pack=')
    ) {
      return true;
    }
  }
  return false;
}

function isAllowedNonDevExecCommand(command: string | readonly string[]): boolean {
  if (typeof command === 'string' || command.length === 0) return false;
  const execExeBase = basename(command[0] ?? '').toLowerCase();
  if (execExeBase !== 'git' && execExeBase !== 'git.exe') return false;
  const args = command.slice(1);
  if (isDangerousGitCommand(args)) return false;
  const subcommand = args.find(arg => !arg.startsWith('-'))?.toLowerCase();
  return Boolean(subcommand && NON_DEV_ALLOWED_GIT_SUBCOMMANDS.has(subcommand));
}

const lineScanEncoder = new TextEncoder();

function decodedByteLength(text: string): number {
  return text === '' ? 0 : lineScanEncoder.encode(text).length;
}

function scanLineBytes(data: Uint8Array, startLine: number, endLine = Number.POSITIVE_INFINITY): LineScan {
  if (!Number.isSafeInteger(startLine) || startLine < 0 || !(endLine > startLine)) {
    throw new RangeError('Invalid line range');
  }
  if (endLine !== Number.POSITIVE_INFINITY && !Number.isSafeInteger(endLine)) {
    throw new RangeError('Invalid line range');
  }
  const hasBom = data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf;
  let newlines = 0;
  let lineStart = 0;
  let start: number | undefined;
  let end: number | undefined;
  let firstLineEnd: number | undefined;
  let lastLineStart: number | undefined;
  let selectedBytes = 0;
  let firstLineBytes = 0;
  let selectionDecoder: TextDecoder | undefined;
  let firstLineDecoder: TextDecoder | undefined;

  const begin = (pos: number) => {
    start = pos;
    if (startLine === endLine - 1) lastLineStart = pos;
    selectionDecoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true });
    firstLineDecoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true });
  };
  const endFirstLine = (pos: number) => {
    firstLineEnd = pos;
    if (firstLineDecoder) {
      firstLineBytes += decodedByteLength(firstLineDecoder.decode());
      firstLineDecoder = undefined;
    }
  };
  const endSelection = (pos: number) => {
    end = pos;
    if (selectionDecoder) {
      selectedBytes += decodedByteLength(selectionDecoder.decode());
      selectionDecoder = undefined;
    }
  };
  const feed = (from: number, to: number) => {
    if (hasBom && from < 3) from = Math.min(to, 3);
    if (to <= from) return;
    const slice = data.subarray(from, to);
    if (selectionDecoder) {
      selectedBytes += decodedByteLength(selectionDecoder.decode(slice, { stream: true }));
    }
    if (firstLineDecoder) {
      firstLineBytes += decodedByteLength(firstLineDecoder.decode(slice, { stream: true }));
    }
  };

  if (startLine === 0) begin(0);
  let from = 0;
  for (let index = data.indexOf(0x0a); index !== -1; index = data.indexOf(0x0a, index + 1)) {
    feed(from, index);
    const line = newlines;
    if (line === startLine) endFirstLine(index);
    if (line === endLine - 1) endSelection(index);
    feed(index, index + 1);
    from = index + 1;
    newlines++;
    lineStart = index + 1;
    if (newlines === startLine) begin(lineStart);
    if (newlines === endLine - 1) lastLineStart = lineStart;
  }
  feed(from, data.length);
  const size = data.length;
  if (start === undefined) {
    return {
      newlines,
      start: size,
      end: size,
      firstLineEnd: size,
      lastLineStart: size,
      selectedBytes: 0,
      firstLineBytes: 0,
    };
  }
  if (firstLineEnd === undefined) endFirstLine(size);
  if (end === undefined) endSelection(size);
  return {
    newlines,
    start,
    end: end ?? size,
    firstLineEnd: firstLineEnd ?? size,
    lastLineStart: lastLineStart ?? lineStart,
    selectedBytes,
    firstLineBytes,
  };
}

export interface PreWriteSnapshotRecord {
  readonly snapshotId: string;
  readonly sessionId: string;
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly snapshotPath: string;
  readonly existedBefore: boolean;
  readonly beforeSha256: string | null;
  readonly afterSha256: string | null;
  readonly createdAt: number;
  readonly restoredAt?: number;
}

export interface RecentAiEditRecord {
  readonly relativePath: string;
  readonly isControlPlane: boolean;
  readonly editedAt: number;
}

type PersistedEnvIndex = {
  snapshots: PreWriteSnapshotRecord[];
  recentAiEdits: RecentAiEditRecord[];
};

/**
 * Gate 6: Overlapping canonical workspace write mutex.
 * Allows concurrent reads while serializing writes across identical, ancestor,
 * or descendant paths, and freezes writes after an aborted/timed-out command
 * until the process group confirms zero active descendants.
 */
export class WorkspaceWriteCoordinator {
  private readonly activeLocks = new Map<string, Promise<void>>();
  private readonly frozenCounts = new Map<string, number>();

  private overlaps(a: string, b: string): boolean {
    const normA = resolve(a).toLowerCase();
    const normB = resolve(b).toLowerCase();
    if (normA === normB) return true;
    const prefA = normA.endsWith(sep) ? normA : normA + sep;
    const prefB = normB.endsWith(sep) ? normB : normB + sep;
    return normA.startsWith(prefB) || normB.startsWith(prefA);
  }

  freezeWorkspace(workspaceRoot: string): void {
    const key = resolve(workspaceRoot).toLowerCase();
    this.frozenCounts.set(key, (this.frozenCounts.get(key) ?? 0) + 1);
  }

  unfreezeWorkspace(workspaceRoot: string): void {
    const key = resolve(workspaceRoot).toLowerCase();
    const next = (this.frozenCounts.get(key) ?? 0) - 1;
    if (next <= 0) this.frozenCounts.delete(key);
    else this.frozenCounts.set(key, next);
  }

  isFrozen(workspaceRoot: string): boolean {
    const target = resolve(workspaceRoot).toLowerCase();
    for (const [frozen, count] of this.frozenCounts.entries()) {
      if (count > 0 && this.overlaps(frozen, target)) return true;
    }
    return false;
  }

  async withWriteLock<T>(workspaceRoot: string, fn: () => Promise<T>): Promise<T> {
    const key = resolve(workspaceRoot).toLowerCase();
    if (this.isFrozen(key)) {
      throw new FileError('permission_denied', 'Workspace writes are frozen until active child processes finish terminating.', workspaceRoot);
    }
    for (;;) {
      const blocking: Promise<void>[] = [];
      for (const [held, promise] of this.activeLocks.entries()) {
        if (this.overlaps(held, key)) {
          blocking.push(promise);
        }
      }
      if (blocking.length === 0) break;
      await Promise.all(blocking);
    }
    if (this.isFrozen(key)) {
      throw new FileError('permission_denied', 'Workspace writes are frozen until active child processes finish terminating.', workspaceRoot);
    }
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    this.activeLocks.set(key, gate);
    try {
      return await fn();
    } finally {
      this.activeLocks.delete(key);
      release();
    }
  }
}

export const sharedWorkspaceWriteCoordinator = new WorkspaceWriteCoordinator();

export interface SecureWorkspaceExecutionEnvOptions {
  readonly sessionId: string;
  readonly workspaceRoot: string;
  readonly explicitDevWorkspace: boolean;
  readonly dataRoot: string;
  readonly securityHost?: NimiElectronHarnessSecurityHost | null;
  readonly writeCoordinator?: WorkspaceWriteCoordinator;
  readonly authorizeSideEffect?: (input: { actionKind: string; relativePath: string; payloadHash: string }) => Promise<void>;
  /**
   * True ONLY when verified by Electron main (`process.defaultApp === true`) and
   * passed to a child `utilityProcess` in source-local-development mode (`p-napp-037a`).
   */
  readonly allowSourceLocalDev?: boolean;
  /**
   * Test-only opt-in allowing non-native Node fs/spawn fallback when running
   * isolated unit tests without the native addon. Production MUST leave false.
   */
  readonly allowInsecureTestFallback?: boolean;
}

function toFileError(error: unknown, path?: string): FileError {
  if (error instanceof FileError) return error;
  const reason = (error as { reasonCode?: unknown })?.reasonCode;
  const msg = error instanceof Error ? error.message : String(error);
  if (reason === 'not-found' || /\bnot-found\b/i.test(msg)) {
    return new FileError('not_found', msg, path);
  }
  return new FileError('permission_denied', msg, path);
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function resolveWindowsPowerShellAbsolutePath(): string {
  const sysRoot = process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows';
  return join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

function hasHarnessSecurityExports(candidate: unknown): candidate is NimiElectronHarnessSecurityBinding {
  if (!candidate || typeof candidate !== 'object') return false;
  const record = candidate as Record<string, unknown>;
  return typeof record.harnessRunJobProcess === 'function'
    && typeof record.harnessSpawnJobProcess === 'function'
    && typeof record.harnessWaitJobProcess === 'function'
    && typeof record.harnessKillJobProcess === 'function'
    && typeof record.harnessVerifyWorkspacePath === 'function'
    && typeof record.harnessSecureReadFile === 'function'
    && typeof record.harnessSecureWriteFile === 'function'
    && typeof record.harnessSecureDeleteFile === 'function';
}

function tryLoadNativeSecurityHost(
  injected?: NimiElectronHarnessSecurityHost | null,
  allowSourceLocalDev = false,
): NimiElectronHarnessSecurityHost | null {
  if (injected !== undefined) return injected;
  if (process.platform !== 'win32' && process.platform !== 'darwin') return null;

  // Prefer Kit's canonical p-napp-037a verified loader: resolves packaged macOS
  // Resources/nimi-native/protected-local, packaged Windows node_modules, and
  // main-verified source-local-development native entries.
  try {
    return createNimiElectronHarnessSecurityHost({
      allowSourceLocalDevFromMain: allowSourceLocalDev,
    });
  } catch {
    // Fall through only for direct workspace package resolution or source-dev builds.
  }

  const packageName = process.platform === 'win32'
    ? '@nimiplatform/kit-protected-local-win32-x64'
    : '@nimiplatform/kit-protected-local-darwin-arm64';
  if (!allowSourceLocalDev && process.platform === 'darwin') {
    // Never bypass macOS Resources/nimi-native/protected-local integrity verification in packaged mode.
    return null;
  }
  try {
    const req = createRequire(import.meta.url);
    const loaded = req(packageName) as unknown;
    if (hasHarnessSecurityExports(loaded)) {
      return createNimiElectronHarnessSecurityHost(loaded);
    }
  } catch {
    // Fall through to workspace-built native addon only in source-dev / node --test.
  }

  const isSourceOrTest = allowSourceLocalDev
    || process.execArgv.includes('--test')
    || Boolean(process.env.NODE_TEST_CONTEXT);
  if (!isSourceOrTest) {
    return null;
  }

  const artifact = process.platform === 'win32'
    ? 'nimi_shell_protected_local_node.dll'
    : 'libnimi_shell_protected_local_node.dylib';
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidateDirs = [
    resolve(moduleDir, '../../../kit/shell/protected-local-node/target/windows-production/release'),
    resolve(moduleDir, '../../../kit/shell/protected-local-node/target/release'),
    resolve(moduleDir, '../../../kit/shell/protected-local-node/target/debug'),
  ];
  for (const dir of candidateDirs) {
    const addonPath = join(dir, artifact);
    if (!existsSync(addonPath)) continue;
    try {
      const nativeModule: { exports: Record<string, unknown> } = { exports: {} };
      process.dlopen(nativeModule, addonPath);
      if (hasHarnessSecurityExports(nativeModule.exports)) {
        return createNimiElectronHarnessSecurityHost(nativeModule.exports);
      }
    } catch {
      // Try next build target.
    }
  }
  return null;
}

function extractContextAbortSignal(ctx: Context): AbortSignal | undefined {
  const candidate = ctx as unknown as { abortSignal?: AbortSignal; signal?: AbortSignal };
  return candidate?.abortSignal ?? candidate?.signal;
}

export class SecureWorkspaceExecutionEnv implements ExecutionEnv {
  readonly id: string;
  cwd: string;
  private readonly sessionId: string;
  private readonly workspaceRoot: string;
  private readonly explicitDevWorkspace: boolean;
  private readonly spillDir: string;
  private readonly snapshotDir: string;
  private readonly indexPath: string;
  private readonly nativeHost: NimiElectronHarnessSecurityHost | null;
  private readonly allowInsecureFallback: boolean;
  private readonly coordinator: WorkspaceWriteCoordinator;
  private readonly authorizeSideEffect?: SecureWorkspaceExecutionEnvOptions['authorizeSideEffect'];
  private readonly inner: NodeExecutionEnv;
  private readonly snapshots: PreWriteSnapshotRecord[] = [];
  private readonly recentAiEdits = new Map<string, RecentAiEditRecord>();
  private readonly activeJobIds = new Set<string>();

  constructor(options: SecureWorkspaceExecutionEnvOptions) {
    this.sessionId = options.sessionId;
    this.workspaceRoot = resolve(options.workspaceRoot);
    this.cwd = this.workspaceRoot;
    this.id = `nimi-secure-workspace:${this.workspaceRoot.toLowerCase()}`;
    this.explicitDevWorkspace = options.explicitDevWorkspace;
    this.spillDir = join(resolve(options.dataRoot), 'spill');
    this.snapshotDir = join(resolve(options.dataRoot), 'snapshots', options.sessionId);
    this.indexPath = join(this.snapshotDir, 'index.json');
    this.nativeHost = tryLoadNativeSecurityHost(options.securityHost, Boolean(options.allowSourceLocalDev));
    this.allowInsecureFallback = Boolean(options.allowInsecureTestFallback);
    this.coordinator = options.writeCoordinator ?? sharedWorkspaceWriteCoordinator;
    this.authorizeSideEffect = options.authorizeSideEffect;
    this.inner = new NodeExecutionEnv({ cwd: this.workspaceRoot });
    this.loadPersistedIndexSync();
  }

  private loadPersistedIndexSync(): void {
    try {
      if (!existsSync(this.indexPath)) return;
      const raw = readFileSync(this.indexPath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<PersistedEnvIndex>;
      if (Array.isArray(parsed.snapshots)) {
        for (const item of parsed.snapshots) {
          if (item && typeof item.snapshotId === 'string' && typeof item.relativePath === 'string') {
            this.snapshots.push(item);
          }
        }
      }
      if (Array.isArray(parsed.recentAiEdits)) {
        for (const edit of parsed.recentAiEdits) {
          if (edit && typeof edit.relativePath === 'string') {
            this.recentAiEdits.set(edit.relativePath.toLowerCase(), edit);
          }
        }
      }
    } catch {
      // Corrupt or missing snapshot index starts empty without crashing boot.
    }
  }

  private async persistIndex(): Promise<void> {
    await mkdir(this.snapshotDir, { recursive: true, mode: 0o700 });
    const payload: PersistedEnvIndex = {
      snapshots: this.snapshots.slice(-256),
      recentAiEdits: [...this.recentAiEdits.values()].slice(-256),
    };
    const tmpPath = `${this.indexPath}.${randomUUID()}.tmp`;
    await writeFile(tmpPath, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 });
    // Atomic rename replacement on POSIX; on Windows unlink+rename or writeFile fallback.
    try {
      const { rename } = await import('node:fs/promises');
      await rename(tmpPath, this.indexPath);
    } catch {
      await writeFile(this.indexPath, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 });
      await unlink(tmpPath).catch(() => {});
    }
  }

  private requireNativeHostOrFailClosed(operation: string): NimiElectronHarnessSecurityHost | null {
    if (this.nativeHost) return this.nativeHost;
    if (this.allowInsecureFallback) return null;
    if (process.platform === 'win32' || process.platform === 'darwin') {
      throw new FileError(
        'permission_denied',
        `Native Harness security host is unavailable on ${process.platform}; refusing ${operation} fail-closed.`,
      );
    }
    return null;
  }

  getSnapshots(): readonly PreWriteSnapshotRecord[] {
    return [...this.snapshots];
  }

  getRecentAiEditedFiles(): readonly RecentAiEditRecord[] {
    return [...this.recentAiEdits.values()].sort((a, b) => b.editedAt - a.editedAt);
  }

  isExplicitDevWorkspace(): boolean {
    return this.explicitDevWorkspace;
  }

  private resolveGuardedPath(rawPath: string, allowSensitive = false): { absolutePath: string; relativePosix: string } {
    const resolved = resolveSafeWorkspacePath(this.workspaceRoot, rawPath);
    if (!allowSensitive && isSensitivePath(resolved.relativePosix, this.workspaceRoot)) {
      throw new FileError('permission_denied', `Access to sensitive file "${resolved.relativePosix}" is blocked by Harness security policy.`, rawPath);
    }
    return resolved;
  }

  private async enforceSpillQuota(pendingBytes = 0): Promise<void> {
    await mkdir(this.spillDir, { recursive: true, mode: 0o700 });
    const now = Date.now();
    const files: { path: string; size: number; mtimeMs: number }[] = [];
    const dirs: string[] = [];
    let totalBytes = 0;

    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          await walk(full);
          dirs.push(full);
          continue;
        }
        if (!entry.isFile()) continue;
        try {
          const info = await stat(full);
          if (now - info.mtimeMs > SPILL_MAX_AGE_MS) {
            await unlink(full).catch(() => {});
            continue;
          }
          files.push({ path: full, size: info.size, mtimeMs: info.mtimeMs });
          totalBytes += info.size;
        } catch {
          // Ignore raced deletions.
        }
      }
    };
    await walk(this.spillDir);

    const budget = Math.max(0, SPILL_MAX_BYTES - Math.max(0, pendingBytes));
    if (totalBytes > budget) {
      files.sort((a, b) => a.mtimeMs - b.mtimeMs);
      for (const file of files) {
        if (totalBytes <= budget) break;
        await unlink(file.path).catch(() => {});
        totalBytes -= file.size;
      }
    }
    for (const dir of dirs) {
      await rmdir(dir).catch(() => {});
    }
  }

  async restorePreWriteSnapshot(snapshotId: string): Promise<{ restored: boolean; relativePath: string }> {
    const index = this.snapshots.findIndex(item => item.snapshotId === snapshotId);
    if (index < 0) {
      throw new FileError('not_found', `Pre-write snapshot "${snapshotId}" not found.`);
    }
    const record = this.snapshots[index];
    const native = this.requireNativeHostOrFailClosed('restorePreWriteSnapshot');
    return this.coordinator.withWriteLock(this.workspaceRoot, async () => {
      if (record.afterSha256 !== null) {
        let currentSha: string | null = null;
        try {
          if (native) {
            const read = await native.secureReadFile({
              workspaceRoot: this.workspaceRoot,
              relativePath: record.relativePath,
            });
            currentSha = read.sha256;
          } else {
            const bytes = await readFile(record.absolutePath);
            currentSha = sha256Bytes(bytes);
          }
        } catch {
          currentSha = null;
        }
        if (currentSha !== record.afterSha256) {
          throw new FileError(
            'permission_denied',
            `Cannot restore "${record.relativePath}": file was modified after the recorded edit.`,
            record.relativePath,
          );
        }
      } else {
        // File was deleted by AI: verify no new user file now exists at that path before restoring!
        let stillExists = false;
        try {
          if (native) {
            await native.verifyWorkspacePath({
              workspaceRoot: this.workspaceRoot,
              relativePath: record.relativePath,
              expectDirectory: false,
            });
            stillExists = true;
          } else {
            await stat(record.absolutePath);
            stillExists = true;
          }
        } catch {
          stillExists = false;
        }
        if (stillExists) {
          throw new FileError(
            'permission_denied',
            `Cannot restore deleted file "${record.relativePath}": a newer file now exists at this path.`,
            record.relativePath,
          );
        }
      }

      if (!record.existedBefore) {
        if (native) {
          await native.secureDeleteFile({
            workspaceRoot: this.workspaceRoot,
            relativePath: record.relativePath,
            ...(record.afterSha256 ? { preconditionSha256: record.afterSha256 } : {}),
          });
        } else {
          await unlink(record.absolutePath);
        }
      } else {
        const snapshotBytes = await readFile(record.snapshotPath);
        if (native) {
          await native.secureWriteFile({
            workspaceRoot: this.workspaceRoot,
            relativePath: record.relativePath,
            content: snapshotBytes,
            ...(record.afterSha256 ? { preconditionSha256: record.afterSha256 } : {}),
            allowCreate: true,
            mustNotExist: record.afterSha256 === null,
          });
        } else if (record.afterSha256 === null) {
          await writeFile(record.absolutePath, snapshotBytes, { flag: 'wx' });
        } else {
          await writeFile(record.absolutePath, snapshotBytes);
        }
      }

      this.snapshots[index] = { ...record, restoredAt: Date.now() };
      await this.persistIndex();
      return { restored: true, relativePath: record.relativePath };
    });
  }

  async absolutePath(path: string, _context: Context): Promise<Result<string, FileError>> {
    try {
      const { absolutePath } = this.resolveGuardedPath(path);
      return ok(absolutePath);
    } catch (error) {
      return err(error instanceof FileError ? error : new FileError('permission_denied', String(error), path));
    }
  }

  async joinPath(parts: string[], _context: Context): Promise<Result<string, FileError>> {
    try {
      const joined = join(...parts);
      const { absolutePath } = this.resolveGuardedPath(joined);
      return ok(absolutePath);
    } catch (error) {
      return err(error instanceof FileError ? error : new FileError('permission_denied', String(error)));
    }
  }

  async readBinaryFile(path: string, _context: Context): Promise<Result<Uint8Array, FileError>> {
    try {
      const { absolutePath, relativePosix } = this.resolveGuardedPath(path);
      const native = this.requireNativeHostOrFailClosed('readBinaryFile');
      if (native) {
        const res = await native.secureReadFile({
          workspaceRoot: this.workspaceRoot,
          relativePath: relativePosix,
        });
        return ok(Uint8Array.from(Buffer.from(res.contentBase64, 'base64')));
      }
      const bytes = await readFile(absolutePath);
      return ok(Uint8Array.from(bytes));
    } catch (error) {
      return err(toFileError(error, path));
    }
  }

  async readTextFile(path: string, context: Context): Promise<Result<string, FileError>> {
    const bin = await this.readBinaryFile(path, context);
    if (!bin.ok) return bin;
    return ok(new TextDecoder('utf-8', { fatal: false }).decode(bin.value));
  }

  async readTextLines(path: string, options: { maxLines?: number } | undefined, context: Context): Promise<Result<string[], FileError>> {
    const text = await this.readTextFile(path, context);
    if (!text.ok) return text;
    const lines = text.value.split(/\r?\n/);
    return ok(options?.maxLines !== undefined ? lines.slice(0, options.maxLines) : lines);
  }

  async openTextLineReader(path: string, context: Context): Promise<Result<TextLineReader, FileError>> {
    try {
      const { absolutePath, relativePosix } = this.resolveGuardedPath(path);
      const native = this.requireNativeHostOrFailClosed('openTextLineReader');
      if (native) {
        // Read via handle-level native security host so TOCTOU/symlink/hardlink/8.3 checks are atomic.
        const res = await native.secureReadFile({
          workspaceRoot: this.workspaceRoot,
          relativePath: relativePosix,
        });
        const decoded = new TextDecoder('utf-8', { fatal: false }).decode(Buffer.from(res.contentBase64, 'base64'));
        const lines: TextLine[] = [];
        if (decoded.length > 0) {
          let start = 0;
          for (let i = 0; i < decoded.length; i++) {
            if (decoded.charCodeAt(i) === 0x0a) {
              const end = i > start && decoded.charCodeAt(i - 1) === 0x0d ? i - 1 : i;
              lines.push({ text: decoded.slice(start, end), terminated: true });
              start = i + 1;
            }
          }
          if (start < decoded.length) {
            lines.push({ text: decoded.slice(start), terminated: false });
          }
        }
        let idx = 0;
        const reader: TextLineReader = {
          async readLine(_ctx: Context) {
            if (idx >= lines.length) return ok(undefined);
            return ok(lines[idx++]);
          },
          async close(_ctx: Context) { /* memory backed */ },
        };
        return ok(reader);
      }
      return this.inner.openTextLineReader(absolutePath, context);
    } catch (error) {
      return err(toFileError(error, path));
    }
  }

  /**
   * Handle-level secure read helper exposed for workspace search tools (grep) so
   * reading candidate files never falls back to racy path-based realpath + open.
   */
  async readWorkspaceFileSecure(relativePath: string, maxBytes: number): Promise<Uint8Array> {
    const { absolutePath, relativePosix } = this.resolveGuardedPath(relativePath);
    const native = this.requireNativeHostOrFailClosed('readWorkspaceFileSecure');
    if (native) {
      const res = await native.secureReadFile({
        workspaceRoot: this.workspaceRoot,
        relativePath: relativePosix,
        maxBytes,
      });
      return Uint8Array.from(Buffer.from(res.contentBase64, 'base64'));
    }
    const bytes = await readFile(absolutePath);
    if (bytes.byteLength > maxBytes) {
      throw new FileError('invalid', 'File exceeds maximum read limit.', relativePath);
    }
    return Uint8Array.from(bytes);
  }

  async openBinaryReader(path: string, options: { noFollow?: boolean } | undefined, context: Context): Promise<Result<BinaryReader, FileError>> {
    try {
      const { absolutePath, relativePosix } = this.resolveGuardedPath(path);
      const native = this.requireNativeHostOrFailClosed('openBinaryReader');
      if (native) {
        const res = await native.secureReadFile({
          workspaceRoot: this.workspaceRoot,
          relativePath: relativePosix,
          maxBytes: 32 * 1024 * 1024,
        });
        const data = Uint8Array.from(Buffer.from(res.contentBase64, 'base64'));
        let mtimeMs = Date.now();
        try {
          mtimeMs = (await stat(absolutePath)).mtimeMs;
        } catch {
          // Use snapshot timestamp if path vanished right after handle read.
        }
        const fileInfoValue: FileInfo = {
          name: basename(absolutePath),
          path: absolutePath,
          kind: 'file',
          size: data.byteLength,
          mtimeMs,
        };
        const reader: BinaryReader = {
          async info(_ctx: Context) {
            return ok({ ...fileInfoValue });
          },
          async read(offset: number, length: number, _ctx: Context) {
            if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0) {
              return err(new FileError('invalid', 'Invalid binary read range.', path));
            }
            if (offset >= data.byteLength || length === 0) return ok(new Uint8Array(0));
            const end = Math.min(data.byteLength, offset + length);
            return ok(data.slice(offset, end));
          },
          async scanLines(scanOptions: { startLine: number; endLine?: number }, _ctx: Context) {
            try {
              return ok(scanLineBytes(data, scanOptions.startLine, scanOptions.endLine));
            } catch (scanErr) {
              return err(new FileError('invalid', scanErr instanceof Error ? scanErr.message : String(scanErr), path));
            }
          },
          async close(_ctx: Context) { /* memory backed */ },
        };
        return ok(reader);
      }
      return this.inner.openBinaryReader(absolutePath, { ...options, noFollow: true }, context);
    } catch (error) {
      return err(toFileError(error, path));
    }
  }

  async writeFile(path: string, content: string | Uint8Array, _context: Context): Promise<Result<void, FileError>> {
    try {
      const { absolutePath, relativePosix } = this.resolveGuardedPath(path);
      const native = this.requireNativeHostOrFailClosed('writeFile');
      const bytes = typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content);
      const afterSha = sha256Bytes(bytes);

      await this.coordinator.withWriteLock(this.workspaceRoot, async () => {
        if (this.authorizeSideEffect) {
          await this.authorizeSideEffect({ actionKind: 'file_write', relativePath: relativePosix, payloadHash: afterSha });
        }
        await mkdir(this.snapshotDir, { recursive: true, mode: 0o700 });
        const snapshotId = randomUUID();
        const snapshotPath = join(this.snapshotDir, `${snapshotId}.bak`);
        let existedBefore = false;
        let beforeSha: string | null = null;

        if (native) {
          const result = await native.secureWriteFile({
            workspaceRoot: this.workspaceRoot,
            relativePath: relativePosix,
            content: bytes,
            allowCreate: true,
            snapshotPath,
            snapshotRoot: this.snapshotDir,
          });
          existedBefore = !result.created;
          beforeSha = result.previousSha256;
        } else {
          try {
            const prev = await readFile(absolutePath);
            existedBefore = true;
            beforeSha = sha256Bytes(prev);
            await writeFile(snapshotPath, prev);
          } catch {
            existedBefore = false;
            beforeSha = null;
          }
          await mkdir(dirname(absolutePath), { recursive: true });
          await writeFile(absolutePath, bytes);
        }

        this.snapshots.push({
          snapshotId,
          sessionId: this.sessionId,
          relativePath: relativePosix,
          absolutePath,
          snapshotPath,
          existedBefore,
          beforeSha256: beforeSha,
          afterSha256: afterSha,
          createdAt: Date.now(),
        });
        this.recentAiEdits.set(relativePosix.toLowerCase(), {
          relativePath: relativePosix,
          isControlPlane: isControlPlanePath(relativePosix, this.workspaceRoot),
          editedAt: Date.now(),
        });
        await this.persistIndex();
      });

      return ok(undefined);
    } catch (error) {
      return err(toFileError(error, path));
    }
  }

  async appendFile(path: string, content: string | Uint8Array, context: Context): Promise<Result<void, FileError>> {
    const existing = await this.readBinaryFile(path, context);
    const prev = existing.ok ? existing.value : new Uint8Array(0);
    const next = typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content);
    const combined = Buffer.concat([Buffer.from(prev), next]);
    return this.writeFile(path, combined, context);
  }

  async truncateFile(path: string, size: number, context: Context): Promise<Result<void, FileError>> {
    const existing = await this.readBinaryFile(path, context);
    if (!existing.ok) return existing;
    const resized = Buffer.alloc(Math.max(0, size));
    Buffer.from(existing.value).copy(resized, 0, 0, Math.min(existing.value.byteLength, resized.byteLength));
    return this.writeFile(path, resized, context);
  }

  async flushFile(path: string, context: Context): Promise<Result<void, FileError>> {
    try {
      const { absolutePath, relativePosix } = this.resolveGuardedPath(path);
      const native = this.requireNativeHostOrFailClosed('flushFile');
      if (native) {
        await native.verifyWorkspacePath({ workspaceRoot: this.workspaceRoot, relativePath: relativePosix, expectDirectory: false });
        return ok(undefined);
      }
      return this.inner.flushFile(absolutePath, context);
    } catch (error) {
      return err(toFileError(error, path));
    }
  }

  async renameFile(sourcePath: string, destinationPath: string, context: Context): Promise<Result<void, FileError>> {
    try {
      const src = this.resolveGuardedPath(sourcePath);
      const dst = this.resolveGuardedPath(destinationPath);
      const native = this.requireNativeHostOrFailClosed('renameFile');
      if (native) {
        await this.coordinator.withWriteLock(this.workspaceRoot, async () => {
          if (this.authorizeSideEffect) {
            await this.authorizeSideEffect({
              actionKind: 'file_rename',
              relativePath: dst.relativePosix,
              payloadHash: sha256Bytes(Buffer.from(`${src.relativePosix}->${dst.relativePosix}`)),
            });
          }
          const read = await native.secureReadFile({
            workspaceRoot: this.workspaceRoot,
            relativePath: src.relativePosix,
          });
          const bytes = Buffer.from(read.contentBase64, 'base64');
          await mkdir(this.snapshotDir, { recursive: true, mode: 0o700 });
          const snapshotId = randomUUID();
          const snapshotPath = join(this.snapshotDir, `${snapshotId}.bak`);
          await native.secureWriteFile({
            workspaceRoot: this.workspaceRoot,
            relativePath: dst.relativePosix,
            content: bytes,
            allowCreate: true,
            snapshotPath,
            snapshotRoot: this.snapshotDir,
          });
          await native.secureDeleteFile({
            workspaceRoot: this.workspaceRoot,
            relativePath: src.relativePosix,
            preconditionSha256: read.sha256,
            snapshotRoot: this.snapshotDir,
          });
        });
        return ok(undefined);
      }
      return await this.coordinator.withWriteLock(this.workspaceRoot, async () => {
        if (this.authorizeSideEffect) {
          await this.authorizeSideEffect({
            actionKind: 'file_rename',
            relativePath: dst.relativePosix,
            payloadHash: sha256Bytes(Buffer.from(`${src.relativePosix}->${dst.relativePosix}`)),
          });
        }
        return this.inner.renameFile(src.absolutePath, dst.absolutePath, context);
      });
    } catch (error) {
      return err(toFileError(error, sourcePath));
    }
  }

  async fileInfo(path: string, context: Context): Promise<Result<FileInfo, FileError>> {
    try {
      const { absolutePath, relativePosix } = this.resolveGuardedPath(path);
      const native = this.requireNativeHostOrFailClosed('fileInfo');
      if (native) {
        if (!relativePosix) {
          await native.verifyWorkspacePath({ workspaceRoot: this.workspaceRoot, relativePath: '.', expectDirectory: true });
        } else {
          try {
            await native.verifyWorkspacePath({ workspaceRoot: this.workspaceRoot, relativePath: relativePosix, expectDirectory: false });
          } catch (firstErr) {
            const firstReason = (firstErr as { reasonCode?: unknown })?.reasonCode;
            if (firstReason === 'is-directory') {
              await native.verifyWorkspacePath({ workspaceRoot: this.workspaceRoot, relativePath: relativePosix, expectDirectory: true });
            } else {
              throw firstErr;
            }
          }
        }
      }
      return this.inner.fileInfo(absolutePath, context);
    } catch (error) {
      return err(toFileError(error, path));
    }
  }

  async listDir(path: string, context: Context): Promise<Result<FileInfo[], FileError>> {
    try {
      const { absolutePath, relativePosix } = this.resolveGuardedPath(path, true);
      const native = this.requireNativeHostOrFailClosed('listDir');
      if (native) {
        await native.verifyWorkspacePath({
          workspaceRoot: this.workspaceRoot,
          relativePath: relativePosix || '.',
          expectDirectory: true,
        });
      }
      const listed = await this.inner.listDir(absolutePath, context);
      if (!listed.ok) return listed;
      return ok(listed.value.filter(item => {
        if (item.kind === 'symlink') return false;
        const rel = relative(this.workspaceRoot, item.path).split(sep).join('/');
        return !isSensitivePath(rel, this.workspaceRoot);
      }));
    } catch (error) {
      return err(toFileError(error, path));
    }
  }

  async listFiles(path: string, options: ListFilesOptions | undefined, context: Context): Promise<Result<FileListing, FileError>> {
    try {
      const { absolutePath, relativePosix } = this.resolveGuardedPath(path, true);
      const native = this.requireNativeHostOrFailClosed('listFiles');
      if (native) {
        await native.verifyWorkspacePath({
          workspaceRoot: this.workspaceRoot,
          relativePath: relativePosix || '.',
          expectDirectory: true,
        });
      }
      const innerEnv: ExecutionEnv = this.inner;
      if (!innerEnv.listFiles) return err(new FileError('not_supported', 'listFiles unavailable'));
      const listed = await innerEnv.listFiles(absolutePath, options, context);
      if (!listed.ok) return listed;
      const prefix = relativePosix ? `${relativePosix}/` : '';
      const filtered: FileListEntry[] = listed.value.entries.filter((entry: FileListEntry) =>
        entry.kind !== 'symlink' && !isSensitivePath(`${prefix}${entry.path}`, this.workspaceRoot),
      );
      return ok({ entries: filtered, truncated: listed.value.truncated });
    } catch (error) {
      return err(toFileError(error, path));
    }
  }

  async openDirReader(path: string, context: Context): Promise<Result<DirReader, FileError>> {
    try {
      const { absolutePath, relativePosix } = this.resolveGuardedPath(path, true);
      const native = this.requireNativeHostOrFailClosed('openDirReader');
      if (native) {
        await native.verifyWorkspacePath({
          workspaceRoot: this.workspaceRoot,
          relativePath: relativePosix || '.',
          expectDirectory: true,
        });
      }
      const opened = await this.inner.openDirReader(absolutePath, context);
      if (!opened.ok) return opened;
      const innerReader = opened.value;
      const workspaceRoot = this.workspaceRoot;
      const guarded: DirReader = {
        async next(maxEntries: number, ctx: Context) {
          for (;;) {
            const page = await innerReader.next(maxEntries, ctx);
            if (!page.ok) return page;
            const filtered = page.value.entries.filter(item => {
              if (item.kind === 'symlink') return false;
              const rel = relative(workspaceRoot, item.path).split(sep).join('/');
              return !isSensitivePath(rel, workspaceRoot);
            });
            if (filtered.length > 0 || page.value.done) {
              return ok({ entries: filtered, done: page.value.done });
            }
          }
        },
        close: (ctx: Context) => innerReader.close(ctx),
      };
      return ok(guarded);
    } catch (error) {
      return err(toFileError(error, path));
    }
  }

  async watch(targets: readonly WatchTarget[], onChange: (change: FileChange) => void, context: Context): Promise<Result<FileWatcher, FileError>> {
    try {
      const native = this.requireNativeHostOrFailClosed('watch');
      const guardedTargets: WatchTarget[] = [];
      for (const target of targets) {
        const resolved = this.resolveGuardedPath(target.path, true);
        if (native) {
          try {
            await native.verifyWorkspacePath({
              workspaceRoot: this.workspaceRoot,
              relativePath: resolved.relativePosix || '.',
              expectDirectory: true,
            });
          } catch (verifyErr) {
            const reason = (verifyErr as { reasonCode?: unknown })?.reasonCode;
            if (reason !== 'not-found' && reason !== 'not-directory') {
              throw verifyErr;
            }
          }
        }
        guardedTargets.push({ ...target, path: resolved.absolutePath });
      }
      const workspaceRoot = this.workspaceRoot;
      const filteredOnChange = (change: FileChange) => {
        if (change.kind !== 'paths') {
          onChange(change);
          return;
        }
        const safePaths = change.paths.filter(p => {
          const rel = relative(workspaceRoot, p).split(sep).join('/');
          return !rel.startsWith('..') && !isSensitivePath(rel, workspaceRoot);
        });
        if (safePaths.length > 0) {
          onChange({ kind: 'paths', paths: safePaths });
        }
      };
      return this.inner.watch(guardedTargets, filteredOnChange, context);
    } catch (error) {
      return err(toFileError(error));
    }
  }

  async canonicalPath(path: string, context: Context): Promise<Result<string, FileError>> {
    try {
      const { absolutePath, relativePosix } = this.resolveGuardedPath(path);
      const native = this.requireNativeHostOrFailClosed('canonicalPath');
      if (native) {
        if (!relativePosix) {
          const verifiedRoot = await native.verifyWorkspacePath({
            workspaceRoot: this.workspaceRoot,
            relativePath: '.',
            expectDirectory: true,
          });
          return ok(verifiedRoot.finalPath);
        }
        try {
          const verified = await native.verifyWorkspacePath({
            workspaceRoot: this.workspaceRoot,
            relativePath: relativePosix,
            expectDirectory: false,
          });
          return ok(verified.finalPath);
        } catch (firstErr) {
          const firstReason = (firstErr as { reasonCode?: unknown })?.reasonCode;
          if (firstReason === 'is-directory') {
            const verifiedDir = await native.verifyWorkspacePath({
              workspaceRoot: this.workspaceRoot,
              relativePath: relativePosix,
              expectDirectory: true,
            });
            return ok(verifiedDir.finalPath);
          }
          throw firstErr;
        }
      }
      return this.inner.canonicalPath(absolutePath, context);
    } catch (error) {
      return err(toFileError(error, path));
    }
  }

  async exists(path: string, context: Context): Promise<Result<boolean, FileError>> {
    try {
      const resolved = resolveSafeWorkspacePath(this.workspaceRoot, path);
      // Never disclose existence of sensitive files such as .env or private keys.
      if (isSensitivePath(resolved.relativePosix, this.workspaceRoot)) {
        return ok(false);
      }
      const native = this.requireNativeHostOrFailClosed('exists');
      if (native) {
        if (!resolved.relativePosix) {
          await native.verifyWorkspacePath({ workspaceRoot: this.workspaceRoot, relativePath: '.', expectDirectory: true });
          return ok(true);
        }
        try {
          await native.verifyWorkspacePath({ workspaceRoot: this.workspaceRoot, relativePath: resolved.relativePosix, expectDirectory: false });
          return ok(true);
        } catch (firstErr) {
          const reason = (firstErr as { reasonCode?: unknown })?.reasonCode;
          if (reason === 'not-found') return ok(false);
          if (reason === 'is-directory') {
            await native.verifyWorkspacePath({ workspaceRoot: this.workspaceRoot, relativePath: resolved.relativePosix, expectDirectory: true });
            return ok(true);
          }
          throw firstErr;
        }
      }
      return this.inner.exists(resolved.absolutePath, context);
    } catch (error) {
      return err(toFileError(error, path));
    }
  }

  async createDir(path: string, options: { recursive?: boolean } | undefined, context: Context): Promise<Result<void, FileError>> {
    try {
      const { absolutePath, relativePosix } = this.resolveGuardedPath(path);
      const native = this.requireNativeHostOrFailClosed('createDir');
      return await this.coordinator.withWriteLock(this.workspaceRoot, async () => {
        // Walk every existing ancestor segment from workspaceRoot downward and reject symlinks/reparse points.
        const segments = relativePosix ? relativePosix.split('/') : [];
        let deepestExistingRel = '.';
        let cursor = this.workspaceRoot;
        for (let i = 0; i < segments.length; i++) {
          cursor = join(cursor, segments[i]!);
          try {
            const info = await lstat(cursor);
            if (info.isSymbolicLink()) {
              throw new FileError('permission_denied', `Refusing createDir across symlink segment "${segments.slice(0, i + 1).join('/')}".`, path);
            }
            deepestExistingRel = segments.slice(0, i + 1).join('/');
          } catch (statErr) {
            if ((statErr as NodeJS.ErrnoException)?.code === 'ENOENT') break;
            throw statErr;
          }
        }
        if (native) {
          await native.verifyWorkspacePath({
            workspaceRoot: this.workspaceRoot,
            relativePath: deepestExistingRel,
            expectDirectory: true,
          });
        }
        return this.inner.createDir(absolutePath, options, context);
      });
    } catch (error) {
      return err(toFileError(error, path));
    }
  }

  async remove(path: string, options: { recursive?: boolean; force?: boolean } | undefined, _context: Context): Promise<Result<void, FileError>> {
    try {
      const { absolutePath, relativePosix } = this.resolveGuardedPath(path);
      const native = this.requireNativeHostOrFailClosed('remove');
      await this.coordinator.withWriteLock(this.workspaceRoot, async () => {
        if (this.authorizeSideEffect) {
          await this.authorizeSideEffect({
            actionKind: 'file_delete',
            relativePath: relativePosix,
            payloadHash: sha256Bytes(Buffer.from(relativePosix)),
          });
        }
        await mkdir(this.snapshotDir, { recursive: true, mode: 0o700 });
        const snapshotId = randomUUID();
        const snapshotPath = join(this.snapshotDir, `${snapshotId}.bak`);
        if (native && !options?.recursive) {
          const del = await native.secureDeleteFile({
            workspaceRoot: this.workspaceRoot,
            relativePath: relativePosix,
            snapshotPath,
            snapshotRoot: this.snapshotDir,
          });
          this.snapshots.push({
            snapshotId,
            sessionId: this.sessionId,
            relativePath: relativePosix,
            absolutePath,
            snapshotPath,
            existedBefore: true,
            beforeSha256: del.previousSha256,
            afterSha256: null,
            createdAt: Date.now(),
          });
          await this.persistIndex();
        } else {
          if (native && options?.recursive) {
            // Verify target directory is strictly inside canonical workspace with no reparse points before recursive rm.
            await native.verifyWorkspacePath({
              workspaceRoot: this.workspaceRoot,
              relativePath: relativePosix,
              expectDirectory: true,
            });
          }
          try {
            const info = await stat(absolutePath);
            if (info.isFile()) {
              const prev = await readFile(absolutePath);
              await writeFile(snapshotPath, prev);
              this.snapshots.push({
                snapshotId,
                sessionId: this.sessionId,
                relativePath: relativePosix,
                absolutePath,
                snapshotPath,
                existedBefore: true,
                beforeSha256: sha256Bytes(prev),
                afterSha256: null,
                createdAt: Date.now(),
              });
              await this.persistIndex();
            }
          } catch {
            // File may already be missing when force=true.
          }
          await rm(absolutePath, { recursive: options?.recursive ?? false, force: options?.force ?? false });
        }
      });
      return ok(undefined);
    } catch (error) {
      return err(error instanceof FileError ? error : new FileError('permission_denied', error instanceof Error ? error.message : String(error), path));
    }
  }

  /** Gate 7: Redirect all temp directories strictly into `<dataRoot>/spill/` (never os.tmpdir()). */
  async createTempDir(prefix: string | undefined, _context: Context): Promise<Result<string, FileError>> {
    try {
      await this.enforceSpillQuota();
      const safePrefix = (prefix ?? 'dir-').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 32);
      const dirPath = join(this.spillDir, `${safePrefix}${randomUUID()}`);
      await mkdir(dirPath, { recursive: true, mode: 0o700 });
      return ok(dirPath);
    } catch (error) {
      return err(new FileError('unknown', String(error)));
    }
  }

  /** Gate 7: Redirect all temp spill files strictly into `<dataRoot>/spill/` with 2 GiB / 14d recursive LRU. */
  async createTempFile(options: { prefix?: string; suffix?: string } | undefined, _context: Context): Promise<Result<string, FileError>> {
    try {
      await this.enforceSpillQuota();
      const safePrefix = (options?.prefix ?? 'spill-').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 32);
      const safeSuffix = (options?.suffix ?? '.log').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 16);
      const filePath = join(this.spillDir, `${safePrefix}${randomUUID()}${safeSuffix}`);
      await writeFile(filePath, new Uint8Array(0), { mode: 0o600 });
      return ok(filePath);
    } catch (error) {
      return err(new FileError('unknown', String(error)));
    }
  }

  /**
   * Gates 1 & 4: Executes an approved shell/process command inside a supervised
   * OS Job Object (Win32) or POSIX process group, enforcing:
   *   - Explicit dev workspace required for string shell AND interpreter array commands
   *   - Fail-closed when native Job Object / process-group host is unavailable on Windows/macOS
   *   - inheritEnv: false (strict minimal environment allowlist + safe caller subset only)
   *   - Recursive .env* secret canary extraction & cross-chunk redaction wiped on exit
   *   - pi-durable timeout is in SECONDS -> converted to ms; uses context.abortSignal
   *   - Workspace write freeze on abort/timeout until ActiveProcesses == 0
   */
  async exec(
    command: string | readonly string[],
    options: ShellExecOptions | undefined,
    context: Context,
  ): Promise<Result<ShellExecResult, ExecutionError>> {
    const isStringShell = typeof command === 'string';
    if (!isStringShell && command.length === 0) {
      return err(new ExecutionError('spawn_error', 'Command must not be empty.'));
    }
    // Closed non-dev allowlist: outside an explicitly bound dev workspace, block ALL shell
    // strings and non-allowlisted executables (only read-only git inspection without -c/-C/etc.).
    if (!this.explicitDevWorkspace && !isAllowedNonDevExecCommand(command)) {
      return err(new ExecutionError('shell_unavailable', 'Free shell and process execution are only permitted inside an explicitly bound development workspace.'));
    }

    let native: NimiElectronHarnessSecurityHost | null;
    try {
      native = this.requireNativeHostOrFailClosed('exec');
    } catch (error) {
      return err(new ExecutionError('shell_unavailable', error instanceof Error ? error.message : String(error)));
    }

    let execCwd: string;
    try {
      execCwd = options?.cwd ? resolveSafeWorkspacePath(this.workspaceRoot, options.cwd).absolutePath : this.workspaceRoot;
    } catch (error) {
      return err(new ExecutionError('spawn_error', error instanceof Error ? error.message : String(error)));
    }

    const minimalEnv: Record<string, string> = {
      ...buildMinimalShellEnv(),
      ...filterSafeCallerEnvOverrides(options?.env),
      PAGER: 'cat',
      GIT_PAGER: 'cat',
      GIT_TERMINAL_PROMPT: '0',
    };

    const commandSummary = isStringShell ? command : command.join(' ');
    if (this.authorizeSideEffect) {
      try {
        await this.authorizeSideEffect({
          actionKind: 'shell_exec',
          relativePath: relative(this.workspaceRoot, execCwd) || '.',
          payloadHash: sha256Bytes(Buffer.from(commandSummary, 'utf8')),
        });
      } catch (error) {
        return err(new ExecutionError('spawn_error', error instanceof Error ? error.message : String(error)));
      }
    }

    // Gate 4 Layer 3: Extract recursive .env* canary secrets strictly in memory; wipe in finally!
    const canarySecrets = await extractWorkspaceEnvCanarySecrets(this.workspaceRoot);
    // pi-durable ShellExecOptions.timeout is specified in SECONDS (convert to ms cleanly!).
    const timeoutSeconds = typeof options?.timeout === 'number' && Number.isFinite(options.timeout) && options.timeout > 0
      ? options.timeout
      : 120;
    const timeoutMs = Math.max(100, Math.min(Math.round(timeoutSeconds * 1000), 600_000));

    try {
      const { executable, args } = isStringShell
        ? (process.platform === 'win32'
          ? {
            executable: resolveWindowsPowerShellAbsolutePath(),
            args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${command}`],
          }
          : { executable: '/bin/sh', args: ['-c', command] })
        : {
          executable: process.platform === 'win32' && /^(?:powershell(?:\.exe)?)$/i.test(command[0] ?? '')
            ? resolveWindowsPowerShellAbsolutePath()
            : command[0],
          args: command.slice(1),
        };

      if (native) {
        let spawned;
        try {
          spawned = await native.spawnJobProcess({
            executable,
            args,
            workingDirectory: execCwd,
            env: minimalEnv,
            timeoutMs,
            maxOutputBytes: 4 * 1024 * 1024,
          });
        } catch (spawnErr) {
          return err(new ExecutionError('spawn_error', spawnErr instanceof Error ? spawnErr.message : String(spawnErr)));
        }
        this.activeJobIds.add(spawned.jobId);
        let aborted = false;
        let workspaceFrozenByJob = false;
        const markFrozen = () => {
          if (!workspaceFrozenByJob) {
            workspaceFrozenByJob = true;
            this.coordinator.freezeWorkspace(this.workspaceRoot);
          }
        };
        const clearFrozen = () => {
          if (workspaceFrozenByJob) {
            workspaceFrozenByJob = false;
            this.coordinator.unfreezeWorkspace(this.workspaceRoot);
          }
        };
        const onAbort = () => {
          aborted = true;
          markFrozen();
          void native!.killJobProcess({ jobId: spawned.jobId }).then(k => {
            if (k.activeProcessesRemaining === 0) {
              clearFrozen();
            }
          }).catch(() => {});
        };
        const abortSignal = extractContextAbortSignal(context);
        if (abortSignal?.aborted) {
          onAbort();
        } else {
          abortSignal?.addEventListener('abort', onAbort, { once: true });
        }
        try {
          const result = await native.waitJobProcess({ jobId: spawned.jobId, timeoutMs });
          if (result.timedOut || result.killed || result.activeProcessesRemaining > 0) {
            markFrozen();
            if (result.activeProcessesRemaining === 0) {
              clearFrozen();
            }
          } else {
            clearFrozen();
          }
          const cleanStdout = redactCanarySecrets(result.stdoutUtf8, canarySecrets);
          const cleanStderr = redactCanarySecrets(result.stderrUtf8, canarySecrets);
          let spillPath: string | undefined;
          const combinedText = cleanStdout + (cleanStderr ? `\n${cleanStderr}` : '');
          const totalBytes = Buffer.byteLength(combinedText, 'utf8');
          if (options?.spill && totalBytes > options.spill.afterBytes) {
            await this.enforceSpillQuota(totalBytes);
            const temp = await this.createTempFile({ prefix: 'exec-', suffix: '.log' }, context);
            if (temp.ok) {
              await writeFile(temp.value, combinedText, { encoding: 'utf8', mode: 0o600 });
              await this.enforceSpillQuota();
              spillPath = temp.value;
            }
          }
          if (cleanStdout && options?.onOutput) {
            options.onOutput(truncateUtf8Bytes(cleanStdout, MAX_CONTROL_FRAME_BYTES, true), context, { stream: 'stdout' });
          }
          if (cleanStderr && options?.onOutput) {
            options.onOutput(truncateUtf8Bytes(cleanStderr, MAX_CONTROL_FRAME_BYTES, true), context, { stream: 'stderr' });
          }
          if (result.activeProcessesRemaining > 0) {
            return err(new ExecutionError(
              'timeout',
              `Workspace writes remain frozen: ${result.activeProcessesRemaining} child process(es) did not terminate.`,
            ));
          }
          if (aborted) return err(new ExecutionError('aborted', 'Command aborted and process tree terminated.'));
          if (result.timedOut) {
            const timeoutErr = new ExecutionError('timeout', `Command timed out after ${timeoutMs}ms (remaining=${result.activeProcessesRemaining}).`);
            if (spillPath) timeoutErr.spillPath = spillPath;
            return err(timeoutErr);
          }
          return ok({ exitCode: result.exitCode ?? 1, ...(spillPath ? { spillPath } : {}) });
        } finally {
          abortSignal?.removeEventListener('abort', onAbort);
          this.activeJobIds.delete(spawned.jobId);
        }
      }

      // Test-only / Linux POSIX process-group path with streaming cross-chunk canary redaction.
      return await new Promise<Result<ShellExecResult, ExecutionError>>(resolvePromise => {
        const child = spawn(executable, args, {
          cwd: execCwd,
          env: minimalEnv,
          detached: process.platform !== 'win32',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        const stdoutRedactor = new StreamingCanaryRedactor(canarySecrets);
        const stderrRedactor = new StreamingCanaryRedactor(canarySecrets);
        let stdout = '';
        let stderr = '';
        let settled = false;
        const abortSignal = extractContextAbortSignal(context);
        const killTree = () => {
          try {
            if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
            else child.kill('SIGKILL');
          } catch { /* already exited */ }
        };
        const finish = (res: Result<ShellExecResult, ExecutionError>) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          abortSignal?.removeEventListener('abort', onAbort);
          resolvePromise(res);
        };
        const onAbort = () => {
          killTree();
          finish(err(new ExecutionError('aborted', 'Command aborted and process tree terminated.')));
        };
        abortSignal?.addEventListener('abort', onAbort, { once: true });
        const timer = setTimeout(() => {
          killTree();
          finish(err(new ExecutionError('timeout', `Command timed out after ${timeoutMs}ms.`)));
        }, timeoutMs);
        child.stdout?.on('data', (chunk: Buffer) => {
          const piece = stdoutRedactor.push(new TextDecoder('utf-8', { fatal: false }).decode(chunk));
          if (piece) {
            stdout += piece;
            options?.onOutput?.(truncateUtf8Bytes(piece, MAX_CONTROL_FRAME_BYTES, true), context, { stream: 'stdout' });
          }
        });
        child.stderr?.on('data', (chunk: Buffer) => {
          const piece = stderrRedactor.push(new TextDecoder('utf-8', { fatal: false }).decode(chunk));
          if (piece) {
            stderr += piece;
            options?.onOutput?.(truncateUtf8Bytes(piece, MAX_CONTROL_FRAME_BYTES, true), context, { stream: 'stderr' });
          }
        });
        child.on('error', e => finish(err(new ExecutionError('spawn_error', e.message, e))));
        child.on('close', code => {
          const tailOut = stdoutRedactor.flush();
          if (tailOut) {
            stdout += tailOut;
            options?.onOutput?.(truncateUtf8Bytes(tailOut, MAX_CONTROL_FRAME_BYTES, true), context, { stream: 'stdout' });
          }
          const tailErr = stderrRedactor.flush();
          if (tailErr) {
            stderr += tailErr;
            options?.onOutput?.(truncateUtf8Bytes(tailErr, MAX_CONTROL_FRAME_BYTES, true), context, { stream: 'stderr' });
          }
          void (async () => {
            let spillPath: string | undefined;
            const combinedText = stdout + (stderr ? `\n${stderr}` : '');
            const totalBytes = Buffer.byteLength(combinedText, 'utf8');
            if (options?.spill && totalBytes > options.spill.afterBytes) {
              await this.enforceSpillQuota(totalBytes);
              const temp = await this.createTempFile({ prefix: 'exec-', suffix: '.log' }, context);
              if (temp.ok) {
                await writeFile(temp.value, combinedText, { encoding: 'utf8', mode: 0o600 });
                await this.enforceSpillQuota();
                spillPath = temp.value;
              }
            }
            finish(ok({ exitCode: code ?? 1, ...(spillPath ? { spillPath } : {}) }));
          })();
        });
      });
    } finally {
      canarySecrets.fill('');
      canarySecrets.length = 0;
    }
  }

  async cleanup(context: Context): Promise<void> {
    if (this.nativeHost) {
      for (const jobId of [...this.activeJobIds]) {
        await this.nativeHost.killJobProcess({ jobId }).catch(() => {});
        // Drain/reap the tracked job handle from native HARNESS_JOBS registry.
        await this.nativeHost.waitJobProcess({ jobId, timeoutMs: 2_000 }).catch(() => {});
        this.activeJobIds.delete(jobId);
      }
    }
    await this.inner.cleanup(context);
  }
}
