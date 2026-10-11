import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { ProductUpdateError, authenticateProductEnvelope, validateProductRelease, type ProductRelease } from '../../../config/product-update-contract.mjs';
import { PRODUCT_UPDATE_POLICY } from '../../../config/product-update-policy.mjs';
import { writeOwnerPrivateAtomicJson } from './owner-private-atomic-json.js';
import type { PreparedProductCandidate } from './product-update-installation.js';
import type { DesktopShutdownReport } from './product-update-shutdown.js';
import { projectProductActivation, type ProductActivationFacts } from './product-update-activation.js';

const execute = promisify(execFile);
const APP = '/Applications/Nimi.app';
const HELPER = `${APP}/Contents/Helpers/Nimi Product Updater`;
type Handoff = { envelope: unknown; packagePath: string; jobPath: string; resultPath: string; helperPid: number; releaseId: string };
type InstallResult = { phase?: string; reason?: string };

async function readPrivate(file: string): Promise<unknown> {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 128 * 1024 || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0) throw new ProductUpdateError('UPDATE_HANDOFF_INVALID');
  return JSON.parse(await readFile(file, 'utf8'));
}

// @nimi-authority: rule.nimi.platform.product-lifecycle.p-supd-011
export class MacOSProductUpdateAdapter {
  private readonly pointer: string;
  private verifiedActivation: string | undefined;
  private failedHandoffChild: ChildProcess | undefined;
  private abortedJobPath: string | undefined;
  constructor(private readonly cacheRoot: string, private readonly production: boolean) { this.pointer = path.join(cacheRoot, 'handoff.json'); }
  async ready(): Promise<boolean> {
    if (!this.production || process.platform !== 'darwin' || !PRODUCT_UPDATE_POLICY.publicKey || process.execPath !== `${APP}/Contents/MacOS/Nimi`) return false;
    try {
      const requirement = `anchor apple generic and identifier "ai.nimi.product-update" and certificate leaf[subject.OU] = "${PRODUCT_UPDATE_POLICY.macOSTeamId}" and certificate leaf[field.1.2.840.113635.100.6.1.13] exists`;
      await execute('/usr/bin/codesign', ['--verify', '--strict', '--all-architectures', '-R', requirement, HELPER], { timeout: 10_000, maxBuffer: 16 * 1024 });
      const output = await execute(HELPER, ['--probe'], { timeout: 10_000, maxBuffer: 16 * 1024 });
      const value = JSON.parse(output.stdout);
      return value.protocolVersion === 1 && value.productionTrusted === true && value.publicKeyConfigured === true && value.authorizationScriptCompiled === true
        && value.publicKeyFingerprint === createHash('sha256').update(Buffer.from(PRODUCT_UPDATE_POLICY.publicKey, 'base64')).digest('hex');
    } catch { return false; }
  }
  async hasPending(): Promise<boolean> {
    try { await lstat(this.pointer); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
  }
  canSafelyReopen(): boolean { return !this.failedHandoffChild || !this.failedHandoffChild.pid || this.failedHandoffChild.exitCode !== null || this.failedHandoffChild.signalCode !== null; }
  async prepareCurrentVersionReopen(): Promise<void> {
    if (!this.canSafelyReopen()) throw new ProductUpdateError('UPDATE_HELPER_STOP_FAILED');
    if (!this.abortedJobPath) return;
    try {
      const pointer = await readPrivate(this.pointer) as Handoff;
      if (pointer.jobPath === this.abortedJobPath) await rm(this.pointer);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    this.abortedJobPath = undefined;
  }
  async preflight(candidate: PreparedProductCandidate): Promise<void> {
    if (!await this.ready()) throw new ProductUpdateError('UPDATE_INSTALL_NOT_READY');
    const directory = path.dirname(candidate.file);
    const info = await lstat(directory), packageInfo = await lstat(candidate.file);
    if (path.dirname(directory) !== this.cacheRoot || !/^download-[A-Za-z0-9]{6}$/u.test(path.basename(directory))
      || !info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()
      || !packageInfo.isFile() || packageInfo.isSymbolicLink() || path.basename(candidate.file) !== candidate.release.asset.name) throw new ProductUpdateError('UPDATE_HANDOFF_INVALID');
  }
  async clearFailedPending(): Promise<boolean> {
    const handoff = await readPrivate(this.pointer) as Handoff;
    const directory = path.dirname(handoff.packagePath);
    if (path.dirname(directory) !== this.cacheRoot || handoff.resultPath !== path.join(directory, 'result.json')) throw new ProductUpdateError('UPDATE_HANDOFF_INVALID');
    const result = await readPrivate(handoff.resultPath) as InstallResult;
    if (result.phase !== 'failed') return false;
    try { process.kill(handoff.helperPid, 0); return false; } catch { /* no active installer bridge */ }
    await rm(this.pointer, { force: true });
    this.verifiedActivation = undefined;
    return true;
  }
  async handoff(candidate: PreparedProductCandidate, report: DesktopShutdownReport): Promise<void> {
    if (!report.criticalCleanupComplete || report.criticalFailures.length) throw new ProductUpdateError('UPDATE_CRITICAL_CLEANUP_FAILED');
    const directory = path.dirname(candidate.file);
    await this.preflight(candidate);
    if (path.dirname(directory) !== this.cacheRoot || !/^download-[A-Za-z0-9]{6}$/u.test(path.basename(directory))) throw new ProductUpdateError('UPDATE_HANDOFF_INVALID');
    const jobPath = path.join(directory, 'job.json'), resultPath = path.join(directory, 'result.json');
    const job = { schema: 'nimi-product-install/v1', ownerUid: process.getuid?.(), parentPid: process.pid,
      consentApproved: true, criticalCleanupComplete: report.criticalCleanupComplete, envelope: candidate.envelope,
      packagePath: candidate.file, resultPath };
    const requestHash = createHash('sha256').update(`${JSON.stringify(job, null, 2)}\n`).digest('hex');
    await writeOwnerPrivateAtomicJson(jobPath, job, 'product-update-handoff');
    const child = spawn(HELPER, ['--apply', jobPath], { detached: true, stdio: ['ignore', 'pipe', 'ignore'], env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C' } });
    try {
      await new Promise<void>((resolve, reject) => {
        let text = '', settled = false;
        const finish = (error?: Error) => { if (settled) return; settled = true; clearTimeout(timer); if (error) reject(error); else resolve(); };
        const timer = setTimeout(() => finish(new ProductUpdateError('UPDATE_HANDOFF_FAILED')), 30_000);
        child.once('error', () => finish(new ProductUpdateError('UPDATE_HANDOFF_FAILED')));
        child.once('exit', () => finish(new ProductUpdateError('UPDATE_HANDOFF_FAILED')));
        child.stdout.on('data', (chunk) => {
          text += String(chunk);
          if (text.length > 16 * 1024) { finish(new ProductUpdateError('UPDATE_HANDOFF_FAILED')); return; }
          if (!text.includes('\n')) return;
          try { const item = JSON.parse(text.split('\n')[0]!); finish(item.phase === 'handoff' && item.releaseId === candidate.release.releaseId && item.requestHash === requestHash ? undefined : new ProductUpdateError(item.reason || 'UPDATE_HANDOFF_FAILED')); }
          catch { finish(new ProductUpdateError('UPDATE_HANDOFF_FAILED')); }
        });
      });
      await writeOwnerPrivateAtomicJson(this.pointer, { envelope: candidate.envelope, packagePath: candidate.file, jobPath, resultPath,
        helperPid: child.pid, releaseId: candidate.release.releaseId }, 'product-update-handoff');
      child.stdout.destroy(); child.unref();
    } catch (error) {
      this.abortedJobPath = jobPath;
      this.failedHandoffChild = child;
      child.kill();
      if (child.pid && child.exitCode === null && child.signalCode === null) await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 30_000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
      });
      if (this.canSafelyReopen()) { this.failedHandoffChild = undefined; await this.prepareCurrentVersionReopen().catch(() => undefined); }
      throw error;
    }
  }
  async reconcile(readHealth: () => Promise<{ running: boolean; version?: string; healthy: boolean; homeReady: boolean; approvalPending?: boolean }>): Promise<{
    release: ProductRelease; phase: 'completed' | 'failed' | 'awaiting-activation' | 'recovery-required'; reason: string | null;
  } | null> {
    if (!await this.hasPending()) return null;
    const handoff = await readPrivate(this.pointer) as Handoff;
    const identity = await authenticateProductEnvelope(handoff.envelope);
    const published = Date.parse((identity as { publishedAt?: string })?.publishedAt ?? '');
    if (!Number.isFinite(published) || published > Date.now() + 300_000) throw new ProductUpdateError('UPDATE_HANDOFF_INVALID');
    // Activation is historical truth: expiration prevents new installation,
    // but cannot erase an already installed, signed and healthy identity.
    const release = validateProductRelease(identity, published);
    const directory = path.dirname(handoff.packagePath);
    if (path.dirname(directory) !== this.cacheRoot || handoff.resultPath !== path.join(directory, 'result.json')
      || handoff.jobPath !== path.join(directory, 'job.json') || path.basename(handoff.packagePath) !== release.asset.name) throw new ProductUpdateError('UPDATE_HANDOFF_INVALID');
    let result: InstallResult | null = null;
    try { result = await readPrivate(handoff.resultPath) as InstallResult; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const facts: ProductActivationFacts = { identityMatches: false, running: false, healthy: false, runtimeVersionMatches: false, homeReady: false, helperActive: false, installerResult: result };
    try {
      if (this.verifiedActivation !== release.releaseId) { await verifyInstalledProductIdentity(release); this.verifiedActivation = release.releaseId; }
      facts.identityMatches = true;
    } catch { /* A receipt cannot substitute for the signed installed identity. */ }
    if (facts.identityMatches) {
      try { const health = await readHealth(); Object.assign(facts, health, { runtimeVersionMatches: health.version === release.components.runtime.version }); }
      catch { /* A reachable process or installer exit is not healthy Runtime. */ }
    }
    try { process.kill(handoff.helperPid, 0); facts.helperActive = true; } catch { /* read-only liveness */ }
    const outcome = projectProductActivation(facts);
    if (outcome.phase === 'completed') { await rm(this.pointer, { force: true }); await rm(directory, { recursive: true, force: true }); }
    return { release, ...outcome };
  }
}

async function hashFile(file: string): Promise<string> {
  const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex');
}
async function hashTree(root: string): Promise<string> {
  const hash = createHash('sha256');
  async function visit(directory: string): Promise<void> {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) { await visit(file); continue; }
      if (!entry.isFile()) throw new ProductUpdateError('UPDATE_ACTIVATION_IDENTITY_FAILED');
      const body = await readFile(file);
      hash.update(`${path.relative(root, file).split(path.sep).join('/')}\0${body.length}\0`); hash.update(body);
    }
  }
  await visit(root); return hash.digest('hex');
}
export async function verifyInstalledProductIdentity(release: ProductRelease): Promise<void> {
  await execute('/usr/bin/codesign', ['--verify', '--strict', '--deep', APP], { timeout: 30_000, maxBuffer: 64 * 1024 });
  const installed = JSON.parse(await readFile(`${APP}/Contents/Resources/nimi-product-identity.json`, 'utf8'));
  if (installed.releaseId !== release.releaseId || installed.version !== release.version || installed.sourceRevision !== release.sourceRevision
    || !['desktop', 'runtime', 'avatar'].every((key) => installed.components?.[key]?.version === release.components[key as keyof typeof release.components].version
      && installed.components?.[key]?.sha256 === release.components[key as keyof typeof release.components].sha256)) throw new ProductUpdateError('UPDATE_ACTIVATION_IDENTITY_FAILED');
  if (await hashFile(`${APP}/Contents/Resources/app.asar`) !== release.components.desktop.sha256
    || await hashFile(`${APP}/Contents/Library/LaunchServices/nimi-runtime`) !== release.components.runtime.sha256
    || await hashTree(`${APP}/Contents/Resources/app.asar/avatar/dist`) !== release.components.avatar.sha256) throw new ProductUpdateError('UPDATE_ACTIVATION_IDENTITY_FAILED');
}
