import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { lstat, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { ProductUpdateError, authenticateProductEnvelope, validateProductRelease, type ProductRelease } from '../../../config/product-update-contract.mjs';
import { PRODUCT_UPDATE_POLICY } from '../../../config/product-update-policy.mjs';
import { verifyWindowsProductIdentity } from '../../../config/windows-product-identity.mjs';
import { writeOwnerPrivateAtomicJson } from './owner-private-atomic-json.js';
import type { PreparedProductCandidate } from './product-update-installation.js';
import type { DesktopShutdownReport } from './product-update-shutdown.js';
import { projectProductActivation, type ProductActivationFacts } from './product-update-activation.js';

const execute = promisify(execFile);
type Handoff = { envelope: unknown; packagePath: string; resultPath: string; helperPid: number; releaseId: string };
// @nimi-authority: rule.nimi.platform.product-lifecycle.p-supd-012
export class WindowsProductUpdateAdapter {
  private readonly pointer: string;
  private failedChild: ChildProcess | undefined;
  private abortedDirectory: string | undefined;
  constructor(private readonly cacheRoot: string, private readonly production: boolean) { this.pointer = path.join(cacheRoot, 'handoff.json'); }
  private admittedHelper(): string {
    if (!this.production || process.platform !== 'win32' || process.arch !== 'x64' || !PRODUCT_UPDATE_POLICY.publicKey) throw new ProductUpdateError('UPDATE_INSTALL_NOT_READY');
    const binding = createRequire(import.meta.url)('@nimiplatform/kit-protected-local-win32-x64') as { windowsProductUpdateHost?: () => { status: string; value?: { helperPath?: string; publicKey?: string } } };
    const result = binding.windowsProductUpdateHost?.();
    if (result?.status !== 'ok' || result.value?.publicKey !== PRODUCT_UPDATE_POLICY.publicKey || result.value.helperPath !== path.join(path.dirname(process.execPath), 'NimiProductUpdater.exe')) throw new ProductUpdateError('UPDATE_INSTALL_NOT_READY');
    return result.value.helperPath;
  }
  async ready(): Promise<boolean> {
    try {
      const output = await execute(this.admittedHelper(), ['--probe'], { timeout: 30_000, maxBuffer: 16 * 1024, windowsHide: true });
      const value = JSON.parse(output.stdout);
      return value.protocolVersion === 1 && value.productionTrusted === true && value.publicKeyConfigured === true && value.authorization === 'uac' && value.installer === 'nsis'
        && value.publicKeyFingerprint === createHash('sha256').update(PRODUCT_UPDATE_POLICY.publicKey!).digest('hex');
    } catch { return false; }
  }
  async prepareCache(): Promise<void> { await execute(this.admittedHelper(), ['--prepare-cache'], { timeout: 30_000, maxBuffer: 16 * 1024, windowsHide: true }); }
  async validatePrivateFile(file: string): Promise<void> { await execute(this.admittedHelper(), ['--verify-cache-file', file], { timeout: 30_000, maxBuffer: 16 * 1024, windowsHide: true }); }
  private async readPrivate(file: string): Promise<unknown> {
    const info = await lstat(file);
    await this.validatePrivateFile(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 128 * 1024) throw new ProductUpdateError('UPDATE_HANDOFF_INVALID');
    return JSON.parse(await readFile(file, 'utf8'));
  }
  async hasPending(): Promise<boolean> { try { await lstat(this.pointer); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; } }
  canSafelyReopen(): boolean { return !this.failedChild || !this.failedChild.pid || this.failedChild.exitCode !== null || this.failedChild.signalCode !== null; }
  async prepareCurrentVersionReopen(): Promise<void> {
    if (!this.canSafelyReopen()) throw new ProductUpdateError('UPDATE_HELPER_STOP_FAILED');
    if (this.abortedDirectory) {
      try { const item = await this.readPrivate(this.pointer) as Handoff; if (path.dirname(item.packagePath) === this.abortedDirectory) await rm(this.pointer); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      this.abortedDirectory = undefined;
    }
  }
  async preflight(candidate: PreparedProductCandidate): Promise<void> {
    if (!await this.ready() || candidate.release.target !== 'windows-amd64' || candidate.release.asset.installer !== 'windows-exe') throw new ProductUpdateError('UPDATE_INSTALL_NOT_READY');
    const directory = path.dirname(candidate.file);
    if (path.dirname(directory) !== this.cacheRoot || !/^download-[A-Za-z0-9]{6}$/u.test(path.basename(directory)) || path.basename(candidate.file) !== candidate.release.asset.name) throw new ProductUpdateError('UPDATE_HANDOFF_INVALID');
    await this.validatePrivateFile(candidate.file);
  }
  async handoff(candidate: PreparedProductCandidate, report: DesktopShutdownReport): Promise<void> {
    if (!report.criticalCleanupComplete || report.criticalFailures.length) throw new ProductUpdateError('UPDATE_CRITICAL_CLEANUP_FAILED');
    await this.preflight(candidate);
    const directory = path.dirname(candidate.file), jobPath = path.join(directory, 'job.json'), resultPath = path.join(directory, 'result.json');
    const job = { schema: 'nimi-product-install/v1', parentPid: process.pid, consentApproved: true, criticalCleanupComplete: true, envelope: candidate.envelope, packagePath: candidate.file, resultPath };
    await writeOwnerPrivateAtomicJson(jobPath, job, 'product-update-handoff');
    const requestHash = createHash('sha256').update(`${JSON.stringify(job, null, 2)}\n`).digest('hex');
    const child = spawn(this.admittedHelper(), ['--apply', jobPath], { detached: true, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    try {
      await new Promise<void>((resolve, reject) => {
        let output = '', settled = false;
        const finish = (error?: Error) => { if (settled) return; settled = true; clearTimeout(timer); if (error) reject(error); else resolve(); };
        const timer = setTimeout(() => finish(new ProductUpdateError('UPDATE_HANDOFF_FAILED')), 30_000);
        child.once('error', () => finish(new ProductUpdateError('UPDATE_HANDOFF_FAILED')));
        child.once('exit', () => finish(new ProductUpdateError('UPDATE_HANDOFF_FAILED')));
        child.stdout.on('data', (chunk) => {
          output += String(chunk); if (output.length > 16 * 1024) { finish(new ProductUpdateError('UPDATE_HANDOFF_FAILED')); return; }
          if (!output.includes('\n')) return;
          try { const item = JSON.parse(output.split('\n')[0]!); finish(item.phase === 'handoff' && item.releaseId === candidate.release.releaseId && item.requestHash === requestHash ? undefined : new ProductUpdateError('UPDATE_HANDOFF_FAILED')); }
          catch { finish(new ProductUpdateError('UPDATE_HANDOFF_FAILED')); }
        });
      });
      await writeOwnerPrivateAtomicJson(this.pointer, { envelope: candidate.envelope, packagePath: candidate.file, resultPath, helperPid: child.pid, releaseId: candidate.release.releaseId }, 'product-update-handoff');
      child.stdout.destroy(); child.unref();
    } catch (error) {
      this.abortedDirectory = directory; this.failedChild = child;
      // Before acknowledged handoff Home is still alive; this child is only
      // verifying/waiting for its parent. Never terminate NSIS or UAC.
      child.kill();
      if (child.pid && child.exitCode === null && child.signalCode === null) await new Promise<void>((resolve) => { const timer = setTimeout(resolve, 30_000); child.once('exit', () => { clearTimeout(timer); resolve(); }); });
      if (this.canSafelyReopen()) { this.failedChild = undefined; await this.prepareCurrentVersionReopen().catch(() => undefined); }
      throw error;
    }
  }
  async clearFailedPending(): Promise<boolean> {
    const item = await this.readPrivate(this.pointer) as Handoff, directory = path.dirname(item.packagePath);
    if (path.dirname(directory) !== this.cacheRoot || item.resultPath !== path.join(directory, 'result.json')) throw new ProductUpdateError('UPDATE_HANDOFF_INVALID');
    const result = await this.readPrivate(item.resultPath) as { phase?: string };
    if (result.phase !== 'failed') return false;
    try { process.kill(item.helperPid, 0); return false; } catch { /* no active handoff */ }
    await rm(this.pointer); return true;
  }
  async reconcile(readHealth: () => Promise<{ running: boolean; version?: string; healthy: boolean; homeReady: boolean; approvalPending?: boolean }>): Promise<{ release: ProductRelease; phase: 'completed' | 'failed' | 'awaiting-activation' | 'recovery-required'; reason: string | null } | null> {
    if (!await this.hasPending()) return null;
    const item = await this.readPrivate(this.pointer) as Handoff;
    const identity = await authenticateProductEnvelope(item.envelope), published = Date.parse((identity as { publishedAt?: string }).publishedAt ?? '');
    if (!Number.isFinite(published) || published > Date.now() + 300_000) throw new ProductUpdateError('UPDATE_HANDOFF_INVALID');
    const release = validateProductRelease(identity, published), directory = path.dirname(item.packagePath);
    if (release.target !== 'windows-amd64' || item.releaseId !== release.releaseId || path.dirname(directory) !== this.cacheRoot || path.basename(item.packagePath) !== release.asset.name || item.resultPath !== path.join(directory, 'result.json')) throw new ProductUpdateError('UPDATE_HANDOFF_INVALID');
    let result = null;
    try { result = await this.readPrivate(item.resultPath) as { phase?: string; reason?: string }; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const facts: ProductActivationFacts = { identityMatches: false, running: false, healthy: false, runtimeVersionMatches: false, homeReady: false, helperActive: false, installerResult: result };
    try { await this.verifyInstalledIdentity(release); facts.identityMatches = true; } catch { /* installer exit is not identity */ }
    if (facts.identityMatches) try { const health = await readHealth(); Object.assign(facts, health, { runtimeVersionMatches: health.version === release.components.runtime.version }); } catch { /* protected health unavailable */ }
    try { process.kill(item.helperPid, 0); facts.helperActive = true; } catch { /* read-only liveness */ }
    const outcome = projectProductActivation(facts);
    if (outcome.phase === 'completed') { await rm(this.pointer); await rm(directory, { recursive: true, force: true }); }
    return { release, ...outcome };
  }
  private async verifyInstalledIdentity(release: ProductRelease): Promise<void> {
    this.admittedHelper(); // native fixed root, ACLs, full bytes and current Home role
    const root = path.dirname(process.execPath);
    const installed = await verifyWindowsProductIdentity(JSON.parse(await readFile(path.join(root, 'nimi-product-identity.json'), 'utf8')));
    if (installed.releaseId !== release.releaseId || installed.sourceRevision !== release.sourceRevision || !['desktop', 'runtime', 'avatar'].every((key) => installed.components[key as keyof typeof installed.components].version === release.components[key as keyof typeof release.components].version && installed.components[key as keyof typeof installed.components].sha256 === release.components[key as keyof typeof release.components].sha256)) throw new ProductUpdateError('UPDATE_ACTIVATION_IDENTITY_FAILED');
    const hash = createHash('sha256'), avatar = path.join(root, 'resources/app.asar/avatar/dist');
    async function visit(directory: string): Promise<void> { for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name, 'en'))) { const file = path.join(directory, entry.name); if (entry.isDirectory()) { await visit(file); continue; } if (!entry.isFile()) throw new ProductUpdateError('UPDATE_ACTIVATION_IDENTITY_FAILED'); const body = await readFile(file); hash.update(`${path.relative(avatar,file).split(path.sep).join('/')}\0${body.length}\0`); hash.update(body); } }
    await visit(avatar); if (hash.digest('hex') !== release.components.avatar.sha256) throw new ProductUpdateError('UPDATE_ACTIVATION_IDENTITY_FAILED');
  }
}
