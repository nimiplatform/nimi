// SecureWorkspaceExecutionEnv replaces pi-durable's NodeExecutionEnv with all
// 7 v2.1 PC Body Security Gates:
//   Gate 1: Rust Win32 Job Object process supervision (zero grandchild residue)
//   Gate 2: Handle-level NTFS file ops (GetFinalPathNameByHandleW + nNumberOfLinks == 1 + CAS)
//   Gate 3: Control-plane file wall + shared isSensitivePath() across read/write/edit/grep/glob
//   Gate 4: Free Shell minimal env allowlist (inheritEnv: false) + .env* canary secret redaction
//   Gate 6: Overlapping workspace write mutex + typed pre-write snapshots & atomic restore
//   Gate 7: Redirected Spill directory (2 GiB / 14d LRU) + 256 KiB frame ceiling
// @nimi-authority: rule.nimi.harness.security-gates.workspace-execution-env
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
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
  type ListFilesOptions,
  type Result,
  type ShellExecOptions,
  type ShellExecResult,
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
  isControlPlanePath,
  isSensitivePath,
  redactCanarySecrets,
  resolveSafeWorkspacePath,
} from './security-policy.js';

export const SPILL_MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB
export const SPILL_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
export const MAX_CONTROL_FRAME_BYTES = 256 * 1024; // 256 KiB

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

/**
 * Gate 6: Overlapping canonical workspace write mutex.
 * Allows concurrent reads while serializing writes across identical, ancestor,
 * or descendant paths, and freezes writes after an aborted/timed-out command
 * until the process group confirms zero active descendants.
 */
export class WorkspaceWriteCoordinator {
  private readonly activeLocks = new Map<string, Promise<void>>();
  private readonly frozenRoots = new Set<string>();

  private overlaps(a: string, b: string): boolean {
    const normA = resolve(a).toLowerCase();
    const normB = resolve(b).toLowerCase();
    if (normA === normB) return true;
    const prefA = normA.endsWith(sep) ? normA : normA + sep;
    const prefB = normB.endsWith(sep) ? normB : normB + sep;
    return normA.startsWith(prefB) || normB.startsWith(prefA);
  }

  freezeWorkspace(workspaceRoot: string): void {
    this.frozenRoots.add(resolve(workspaceRoot).toLowerCase());
  }

  unfreezeWorkspace(workspaceRoot: string): void {
    this.frozenRoots.delete(resolve(workspaceRoot).toLowerCase());
  }

  isFrozen(workspaceRoot: string): boolean {
    const target = resolve(workspaceRoot).toLowerCase();
    for (const frozen of this.frozenRoots) {
      if (this.overlaps(frozen, target)) return true;
    }
    return false;
  }

  async withWriteLock<T>(workspaceRoot: string, fn: () => Promise<T>): Promise<T> {
    const key = resolve(workspaceRoot).toLowerCase();
    if (this.isFrozen(key)) {
      throw new FileError('permission_denied', 'Workspace writes are frozen until active child processes finish terminating.', workspaceRoot);
    }
    // Wait for any overlapping active write lock to complete.
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
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function hasHarnessSecurityExports(candidate: unknown): candidate is NimiElectronHarnessSecurityBinding {
  if (!candidate || typeof candidate !== 'object') return false;
  const record = candidate as Record<string, unknown>;
  return typeof record.harnessRunJobProcess === 'function'
    && typeof record.harnessSpawnJobProcess === 'function'
    && typeof record.harnessKillJobProcess === 'function'
    && typeof record.harnessVerifyWorkspacePath === 'function'
    && typeof record.harnessSecureReadFile === 'function'
    && typeof record.harnessSecureWriteFile === 'function'
    && typeof record.harnessSecureDeleteFile === 'function';
}

function tryLoadNativeSecurityHost(injected?: NimiElectronHarnessSecurityHost | null): NimiElectronHarnessSecurityHost | null {
  if (injected !== undefined) return injected;
  if (process.platform !== 'win32' && process.platform !== 'darwin') return null;

  // 1. Packaged / installed optional native binding from @nimiplatform/kit.
  const packageName = process.platform === 'win32'
    ? '@nimiplatform/kit-protected-local-win32-x64'
    : '@nimiplatform/kit-protected-local-darwin-arm64';
  try {
    const req = createRequire(import.meta.url);
    const loaded = req(packageName) as unknown;
    if (hasHarnessSecurityExports(loaded)) {
      return createNimiElectronHarnessSecurityHost(loaded);
    }
  } catch {
    // Fall through to workspace-built native addon if present.
  }

  // 2. Monorepo / source-dev compiled protected-local-node addon.
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

export class SecureWorkspaceExecutionEnv implements ExecutionEnv {
  readonly id: string;
  cwd: string;
  private readonly sessionId: string;
  private readonly workspaceRoot: string;
  private readonly explicitDevWorkspace: boolean;
  private readonly spillDir: string;
  private readonly snapshotDir: string;
  private readonly nativeHost: NimiElectronHarnessSecurityHost | null;
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
    this.nativeHost = tryLoadNativeSecurityHost(options.securityHost);
    this.coordinator = options.writeCoordinator ?? sharedWorkspaceWriteCoordinator;
    this.authorizeSideEffect = options.authorizeSideEffect;
    this.inner = new NodeExecutionEnv({ cwd: this.workspaceRoot });
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
    if (!allowSensitive && isSensitivePath(resolved.relativePosix)) {
      throw new FileError('permission_denied', `Access to sensitive file "${resolved.relativePosix}" is blocked by Harness security policy.`, rawPath);
    }
    return resolved;
  }

  private async enforceSpillQuota(): Promise<void> {
    await mkdir(this.spillDir, { recursive: true, mode: 0o700 });
    const now = Date.now();
    let entries;
    try {
      entries = await readdir(this.spillDir, { withFileTypes: true });
    } catch {
      return;
    }
    const files: { path: string; size: number; mtimeMs: number }[] = [];
    let totalBytes = 0;
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const full = join(this.spillDir, entry.name);
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
    if (totalBytes <= SPILL_MAX_BYTES) return;
    files.sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const file of files) {
      if (totalBytes <= SPILL_MAX_BYTES) break;
      await unlink(file.path).catch(() => {});
      totalBytes -= file.size;
    }
  }

  async restorePreWriteSnapshot(snapshotId: string): Promise<{ restored: boolean; relativePath: string }> {
    const index = this.snapshots.findIndex(item => item.snapshotId === snapshotId);
    if (index < 0) {
      throw new FileError('not_found', `Pre-write snapshot "${snapshotId}" not found.`);
    }
    const record = this.snapshots[index];
    return this.coordinator.withWriteLock(this.workspaceRoot, async () => {
      if (record.afterSha256 !== null) {
        // Verify disk file has not been modified externally since our edit!
        let currentSha: string | null = null;
        try {
          if (this.nativeHost) {
            const read = await this.nativeHost.secureReadFile({
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
      }

      if (!record.existedBefore) {
        if (this.nativeHost) {
          await this.nativeHost.secureDeleteFile({
            workspaceRoot: this.workspaceRoot,
            relativePath: record.relativePath,
            ...(record.afterSha256 ? { preconditionSha256: record.afterSha256 } : {}),
          });
        } else {
          await unlink(record.absolutePath);
        }
      } else {
        const snapshotBytes = await readFile(record.snapshotPath);
        if (this.nativeHost) {
          await this.nativeHost.secureWriteFile({
            workspaceRoot: this.workspaceRoot,
            relativePath: record.relativePath,
            content: snapshotBytes,
            ...(record.afterSha256 ? { preconditionSha256: record.afterSha256 } : {}),
            allowCreate: true,
          });
        } else {
          await writeFile(record.absolutePath, snapshotBytes);
        }
      }

      this.snapshots[index] = { ...record, restoredAt: Date.now() };
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
      if (this.nativeHost) {
        const res = await this.nativeHost.secureReadFile({
          workspaceRoot: this.workspaceRoot,
          relativePath: relativePosix,
        });
        return ok(Uint8Array.from(Buffer.from(res.contentBase64, 'base64')));
      }
      const bytes = await readFile(absolutePath);
      return ok(Uint8Array.from(bytes));
    } catch (error) {
      return err(error instanceof FileError ? error : new FileError('permission_denied', error instanceof Error ? error.message : String(error), path));
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
      const { absolutePath } = this.resolveGuardedPath(path);
      if (this.nativeHost) {
        const { relativePosix } = this.resolveGuardedPath(path);
        await this.nativeHost.verifyWorkspacePath({ workspaceRoot: this.workspaceRoot, relativePath: relativePosix, expectDirectory: false });
      }
      return this.inner.openTextLineReader(absolutePath, context);
    } catch (error) {
      return err(error instanceof FileError ? error : new FileError('permission_denied', String(error), path));
    }
  }

  async openBinaryReader(path: string, options: { noFollow?: boolean } | undefined, context: Context): Promise<Result<BinaryReader, FileError>> {
    try {
      const { absolutePath, relativePosix } = this.resolveGuardedPath(path);
      if (this.nativeHost) {
        await this.nativeHost.verifyWorkspacePath({ workspaceRoot: this.workspaceRoot, relativePath: relativePosix, expectDirectory: false });
      }
      return this.inner.openBinaryReader(absolutePath, { ...options, noFollow: true }, context);
    } catch (error) {
      return err(error instanceof FileError ? error : new FileError('permission_denied', String(error), path));
    }
  }

  async writeFile(path: string, content: string | Uint8Array, _context: Context): Promise<Result<void, FileError>> {
    try {
      const { absolutePath, relativePosix } = this.resolveGuardedPath(path);
      const bytes = typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content);
      const afterSha = sha256Bytes(bytes);

      if (this.authorizeSideEffect) {
        await this.authorizeSideEffect({ actionKind: 'file_write', relativePath: relativePosix, payloadHash: afterSha });
      }

      await this.coordinator.withWriteLock(this.workspaceRoot, async () => {
        await mkdir(this.snapshotDir, { recursive: true, mode: 0o700 });
        const snapshotId = randomUUID();
        const snapshotPath = join(this.snapshotDir, `${snapshotId}.bak`);
        let existedBefore = false;
        let beforeSha: string | null = null;

        if (this.nativeHost) {
          const result = await this.nativeHost.secureWriteFile({
            workspaceRoot: this.workspaceRoot,
            relativePath: relativePosix,
            content: bytes,
            allowCreate: true,
            snapshotPath,
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
          isControlPlane: isControlPlanePath(relativePosix),
          editedAt: Date.now(),
        });
      });

      return ok(undefined);
    } catch (error) {
      return err(error instanceof FileError ? error : new FileError('permission_denied', error instanceof Error ? error.message : String(error), path));
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
      const { absolutePath } = this.resolveGuardedPath(path);
      return this.inner.flushFile(absolutePath, context);
    } catch (error) {
      return err(error instanceof FileError ? error : new FileError('permission_denied', String(error), path));
    }
  }

  async renameFile(sourcePath: string, destinationPath: string, context: Context): Promise<Result<void, FileError>> {
    try {
      const src = this.resolveGuardedPath(sourcePath);
      const dst = this.resolveGuardedPath(destinationPath);
      if (this.authorizeSideEffect) {
        await this.authorizeSideEffect({
          actionKind: 'file_rename',
          relativePath: dst.relativePosix,
          payloadHash: sha256Bytes(Buffer.from(`${src.relativePosix}->${dst.relativePosix}`)),
        });
      }
      return await this.coordinator.withWriteLock(this.workspaceRoot, () =>
        this.inner.renameFile(src.absolutePath, dst.absolutePath, context),
      );
    } catch (error) {
      return err(error instanceof FileError ? error : new FileError('permission_denied', String(error), sourcePath));
    }
  }

  async fileInfo(path: string, context: Context): Promise<Result<FileInfo, FileError>> {
    try {
      const { absolutePath } = this.resolveGuardedPath(path);
      return this.inner.fileInfo(absolutePath, context);
    } catch (error) {
      return err(error instanceof FileError ? error : new FileError('permission_denied', String(error), path));
    }
  }

  async listDir(path: string, context: Context): Promise<Result<FileInfo[], FileError>> {
    try {
      const { absolutePath } = this.resolveGuardedPath(path, true);
      const listed = await this.inner.listDir(absolutePath, context);
      if (!listed.ok) return listed;
      return ok(listed.value.filter(item => {
        const rel = relative(this.workspaceRoot, item.path).split(sep).join('/');
        return !isSensitivePath(rel);
      }));
    } catch (error) {
      return err(error instanceof FileError ? error : new FileError('permission_denied', String(error), path));
    }
  }

  async listFiles(path: string, options: ListFilesOptions | undefined, context: Context): Promise<Result<FileListing, FileError>> {
    try {
      const { absolutePath } = this.resolveGuardedPath(path, true);
      const innerEnv: ExecutionEnv = this.inner;
      if (!innerEnv.listFiles) return err(new FileError('not_supported', 'listFiles unavailable'));
      const listed = await innerEnv.listFiles(absolutePath, options, context);
      if (!listed.ok) return listed;
      const filtered: FileListEntry[] = listed.value.entries.filter((entry: FileListEntry) => !isSensitivePath(entry.path));
      return ok({ entries: filtered, truncated: listed.value.truncated });
    } catch (error) {
      return err(error instanceof FileError ? error : new FileError('permission_denied', String(error), path));
    }
  }

  async openDirReader(path: string, context: Context): Promise<Result<DirReader, FileError>> {
    try {
      const { absolutePath } = this.resolveGuardedPath(path, true);
      return this.inner.openDirReader(absolutePath, context);
    } catch (error) {
      return err(error instanceof FileError ? error : new FileError('permission_denied', String(error), path));
    }
  }

  async watch(targets: readonly WatchTarget[], onChange: (change: FileChange) => void, context: Context): Promise<Result<FileWatcher, FileError>> {
    try {
      const guardedTargets = targets.map(t => ({ ...t, path: this.resolveGuardedPath(t.path, true).absolutePath }));
      return this.inner.watch(guardedTargets, onChange, context);
    } catch (error) {
      return err(error instanceof FileError ? error : new FileError('permission_denied', String(error)));
    }
  }

  async canonicalPath(path: string, context: Context): Promise<Result<string, FileError>> {
    try {
      const { absolutePath } = this.resolveGuardedPath(path);
      return this.inner.canonicalPath(absolutePath, context);
    } catch (error) {
      return err(error instanceof FileError ? error : new FileError('permission_denied', String(error), path));
    }
  }

  async exists(path: string, context: Context): Promise<Result<boolean, FileError>> {
    try {
      const { absolutePath } = this.resolveGuardedPath(path);
      return this.inner.exists(absolutePath, context);
    } catch (error) {
      return err(error instanceof FileError ? error : new FileError('permission_denied', String(error), path));
    }
  }

  async createDir(path: string, options: { recursive?: boolean } | undefined, context: Context): Promise<Result<void, FileError>> {
    try {
      const { absolutePath } = this.resolveGuardedPath(path);
      return await this.coordinator.withWriteLock(this.workspaceRoot, () =>
        this.inner.createDir(absolutePath, options, context),
      );
    } catch (error) {
      return err(error instanceof FileError ? error : new FileError('permission_denied', String(error), path));
    }
  }

  async remove(path: string, options: { recursive?: boolean; force?: boolean } | undefined, _context: Context): Promise<Result<void, FileError>> {
    try {
      const { absolutePath, relativePosix } = this.resolveGuardedPath(path);
      if (this.authorizeSideEffect) {
        await this.authorizeSideEffect({
          actionKind: 'file_delete',
          relativePath: relativePosix,
          payloadHash: sha256Bytes(Buffer.from(relativePosix)),
        });
      }
      await this.coordinator.withWriteLock(this.workspaceRoot, async () => {
        await mkdir(this.snapshotDir, { recursive: true, mode: 0o700 });
        const snapshotId = randomUUID();
        const snapshotPath = join(this.snapshotDir, `${snapshotId}.bak`);
        if (this.nativeHost && !options?.recursive) {
          const del = await this.nativeHost.secureDeleteFile({
            workspaceRoot: this.workspaceRoot,
            relativePath: relativePosix,
            snapshotPath,
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
        } else {
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

  /** Gate 7: Redirect all temp spill files strictly into `<dataRoot>/spill/` with 2 GiB / 14d LRU. */
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
   *   - Explicit dev workspace required for string shell commands
   *   - inheritEnv: false (strict minimal environment allowlist)
   *   - .env* secret canary extraction & stdout/stderr redaction wiped on exit
   *   - Workspace write freeze on abort/timeout until ActiveProcesses == 0
   */
  async exec(
    command: string | readonly string[],
    options: ShellExecOptions | undefined,
    context: Context,
  ): Promise<Result<ShellExecResult, ExecutionError>> {
    const isStringShell = typeof command === 'string';
    if (isStringShell && !this.explicitDevWorkspace) {
      return err(new ExecutionError('shell_unavailable', 'Free shell commands are only permitted inside an explicitly bound development workspace.'));
    }
    const execCwd = options?.cwd ? resolveSafeWorkspacePath(this.workspaceRoot, options.cwd).absolutePath : this.workspaceRoot;
    const minimalEnv = buildMinimalShellEnv();
    // Gate 4 Layer 1: Never inherit parent env; merge only explicit safe caller overrides (never secrets).
    if (options?.env) {
      for (const [k, v] of Object.entries(options.env)) {
        if (typeof v === 'string' && !/^(?:LD_|DYLD_|NODE_OPTIONS|ELECTRON_RUN_AS_NODE)/i.test(k)) {
          minimalEnv[k] = v;
        }
      }
    }

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

    // Gate 4 Layer 3: Extract .env* canary secrets strictly in memory; wipe in finally!
    const canarySecrets = await extractWorkspaceEnvCanarySecrets(this.workspaceRoot);
    const timeoutMs = Math.max(100, Math.min(options?.timeout ?? 120_000, 600_000));

    try {
      const { executable, args } = isStringShell
        ? (process.platform === 'win32'
          ? { executable: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${command}`] }
          : { executable: '/bin/sh', args: ['-c', command] })
        : { executable: command[0], args: command.slice(1) };

      if (this.nativeHost) {
        const spawned = await this.nativeHost.spawnJobProcess({
          executable,
          args,
          workingDirectory: execCwd,
          env: minimalEnv,
          timeoutMs,
          maxOutputBytes: 4 * 1024 * 1024,
        });
        this.activeJobIds.add(spawned.jobId);
        let aborted = false;
        const onAbort = () => {
          aborted = true;
          this.coordinator.freezeWorkspace(this.workspaceRoot);
          void this.nativeHost!.killJobProcess({ jobId: spawned.jobId }).then(k => {
            if (k.activeProcessesRemaining === 0) {
              this.coordinator.unfreezeWorkspace(this.workspaceRoot);
            }
          }).catch(() => {});
        };
        const abortSignal = (context as { signal?: AbortSignal })?.signal;
        abortSignal?.addEventListener('abort', onAbort, { once: true });
        try {
          const result = await this.nativeHost.waitJobProcess({ jobId: spawned.jobId, timeoutMs });
          if (result.timedOut || result.killed) {
            this.coordinator.freezeWorkspace(this.workspaceRoot);
            if (result.activeProcessesRemaining === 0) {
              this.coordinator.unfreezeWorkspace(this.workspaceRoot);
            }
          }
          const cleanStdout = redactCanarySecrets(result.stdoutUtf8, canarySecrets);
          const cleanStderr = redactCanarySecrets(result.stderrUtf8, canarySecrets);
          let spillPath: string | undefined;
          const totalBytes = Buffer.byteLength(cleanStdout, 'utf8') + Buffer.byteLength(cleanStderr, 'utf8');
          if (options?.spill && totalBytes > options.spill.afterBytes) {
            const temp = await this.createTempFile({ prefix: 'exec-', suffix: '.log' }, context);
            if (temp.ok) {
              await writeFile(temp.value, cleanStdout + (cleanStderr ? `\n${cleanStderr}` : ''), 'utf8');
              spillPath = temp.value;
            }
          }
          if (cleanStdout && options?.onOutput) {
            options.onOutput(cleanStdout.slice(0, MAX_CONTROL_FRAME_BYTES), context, { stream: 'stdout' });
          }
          if (cleanStderr && options?.onOutput) {
            options.onOutput(cleanStderr.slice(0, MAX_CONTROL_FRAME_BYTES), context, { stream: 'stderr' });
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

      // Non-Windows POSIX process-group fallback with inheritEnv: false + canary redaction.
      return await new Promise<Result<ShellExecResult, ExecutionError>>(resolvePromise => {
        const child = spawn(executable, args, {
          cwd: execCwd,
          env: minimalEnv,
          detached: process.platform !== 'win32',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        let settled = false;
        const finish = (res: Result<ShellExecResult, ExecutionError>) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolvePromise(res);
        };
        const killTree = () => {
          try {
            if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
            else child.kill('SIGKILL');
          } catch { /* already exited */ }
        };
        const timer = setTimeout(() => {
          killTree();
          finish(err(new ExecutionError('timeout', `Command timed out after ${timeoutMs}ms.`)));
        }, timeoutMs);
        child.stdout?.on('data', (chunk: Buffer) => {
          const text = redactCanarySecrets(new TextDecoder('utf-8', { fatal: false }).decode(chunk), canarySecrets);
          stdout += text;
          options?.onOutput?.(text.slice(0, MAX_CONTROL_FRAME_BYTES), context, { stream: 'stdout' });
        });
        child.stderr?.on('data', (chunk: Buffer) => {
          const text = redactCanarySecrets(new TextDecoder('utf-8', { fatal: false }).decode(chunk), canarySecrets);
          stderr += text;
          options?.onOutput?.(text.slice(0, MAX_CONTROL_FRAME_BYTES), context, { stream: 'stderr' });
        });
        child.on('error', e => finish(err(new ExecutionError('spawn_error', e.message, e))));
        child.on('close', code => {
          void (async () => {
            let spillPath: string | undefined;
            const totalBytes = Buffer.byteLength(stdout, 'utf8') + Buffer.byteLength(stderr, 'utf8');
            if (options?.spill && totalBytes > options.spill.afterBytes) {
              const temp = await this.createTempFile({ prefix: 'exec-', suffix: '.log' }, context);
              if (temp.ok) {
                await writeFile(temp.value, stdout + (stderr ? `\n${stderr}` : ''), 'utf8');
                spillPath = temp.value;
              }
            }
            finish(ok({ exitCode: code ?? 1, ...(spillPath ? { spillPath } : {}) }));
          })();
        });
      });
    } finally {
      // Wipe in-memory canary secret patterns immediately upon process completion!
      canarySecrets.fill('');
      canarySecrets.length = 0;
    }
  }

  async cleanup(context: Context): Promise<void> {
    if (this.nativeHost) {
      for (const jobId of [...this.activeJobIds]) {
        await this.nativeHost.killJobProcess({ jobId }).catch(() => {});
        this.activeJobIds.delete(jobId);
      }
    }
    await this.inner.cleanup(context);
  }
}
