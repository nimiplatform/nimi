import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, open, readdir, rename, rm, statfs } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { ProductUpdateError, compareProductVersions, readBoundedResponse, rejectProductUpdate, verifyProductEnvelope, type ProductRelease } from '../../../config/product-update-contract.mjs';
import { PRODUCT_UPDATE_POLICY } from '../../../config/product-update-policy.mjs';
import type { ProductUpdateStatus } from '../src/shell/shared/product-update.js';
import type { ProductInstallationPorts, PreparedProductCandidate, PreinstallationFailure } from './product-update-installation.js';

type Inputs = {
  currentVersion: string; target: string; osVersion: string; cacheRoot: string;
  verifyInstaller: (file: string, release: ProductRelease) => Promise<void>;
  fetchImpl?: typeof fetch;
  policy?: typeof PRODUCT_UPDATE_POLICY;
  installation?: ProductInstallationPorts;
  prepareCache?: () => Promise<void>;
};

// @nimi-authority: rule.nimi.platform.product-lifecycle.p-supd-009
// @nimi-authority: rule.nimi.platform.product-lifecycle.p-supd-006
export class DesktopProductUpdateHost {
  private state: ProductUpdateStatus;
  private operation: Promise<void> | undefined;
  private abort: AbortController | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private stagedDirectory: string | undefined;
  private stagedRelease: ProductRelease | undefined;
  private stagedEnvelope: unknown;
  private installing: Promise<void> | undefined;
  private quiesceStarted = false;
  private handoffAccepted = false;
  private reopening: Promise<void> | undefined;
  private readonly policy: typeof PRODUCT_UPDATE_POLICY;
  private stopped = false;
  private cacheInitialized = false;

  constructor(private readonly input: Inputs) {
    this.policy = input.policy ?? PRODUCT_UPDATE_POLICY;
    this.state = { phase: 'idle', currentVersion: input.currentVersion, channel: this.policy.channel,
      target: input.target, candidateVersion: null, releaseId: null, downloadedBytes: 0,
      totalBytes: 0, checkedAt: null, reason: null, installationAvailable: false,
      checkAvailable: true, recoveryAction: 'none', recoveryError: null };
  }
  status(): ProductUpdateStatus {
    if (this.state.phase === 'prepared' && this.stagedRelease && Date.parse(this.stagedRelease.expiresAt) <= Date.now()) {
      this.project({ phase: 'failed', reason: 'UPDATE_METADATA_EXPIRED', installationAvailable: false });
    }
    return { ...this.state, recoveryAction: this.installing || this.reopening ? 'none' : this.state.recoveryAction,
      checkAvailable: !this.stopped && !this.installing && !this.reopening
      && this.state.recoveryAction === 'none' && !['handoff', 'awaiting-activation', 'recovery-required'].includes(this.state.phase) };
  }
  start(checkImmediately = true): void {
    if (this.state.recoveryAction === 'reopen-current') return;
    this.stopped = false;
    if (this.timer) return;
    if (checkImmediately) void this.check();
    this.timer = setInterval(() => { void this.check(); }, this.policy.checkIntervalMs);
    this.timer.unref?.();
  }
  check(): Promise<void> {
    if (this.installing) return this.installing;
    if (this.operation) return this.operation;
    if (this.stopped || this.state.recoveryAction === 'reopen-current') return Promise.reject(new ProductUpdateError('UPDATE_CHECK_UNAVAILABLE'));
    this.abort = new AbortController();
    this.operation = this.run(this.abort.signal).catch((error: unknown) => {
      const reason = this.abort?.signal.aborted ? 'UPDATE_CANCELED'
        : error instanceof ProductUpdateError ? error.code
        : (error as NodeJS.ErrnoException)?.code === 'ENOSPC' ? 'UPDATE_DISK_SPACE_INSUFFICIENT'
        : this.state.phase === 'checking' ? 'UPDATE_UPSTREAM_UNAVAILABLE'
        : 'UPDATE_DOWNLOAD_FAILED';
      this.project({ phase: reason === 'UPDATE_CANCELED' ? 'canceled' : reason === 'UPDATE_TARGET_UNSUPPORTED' ? 'unsupported' : 'failed', reason });
    }).finally(() => { this.operation = undefined; this.abort = undefined; });
    return this.operation;
  }
  cancel(): void { this.abort?.abort(); }
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.cancel();
    await this.operation;
    if (!this.installing && this.state.phase !== 'handoff') await this.discardStaged();
  }
  // @nimi-authority: rule.nimi.platform.product-lifecycle.p-supd-011
  install(releaseId: string, consentApproved: boolean): Promise<void> {
    if (this.installing) return this.installing;
    if (this.state.recoveryAction !== 'none') return Promise.reject(new ProductUpdateError('UPDATE_INSTALL_NOT_READY'));
    this.quiesceStarted = false; this.handoffAccepted = false;
    this.installing = this.runInstall(releaseId, consentApproved).catch(async (error: unknown) => {
      const reason = error instanceof ProductUpdateError ? error.code : 'UPDATE_INSTALL_FAILED';
      this.project({ phase: this.handoffAccepted ? 'recovery-required' : 'failed', installationAvailable: false, reason,
        recoveryAction: this.quiesceStarted && !this.handoffAccepted ? 'reopen-current' : 'none', recoveryError: null });
      if (this.quiesceStarted && !this.handoffAccepted) {
        await this.preserveFailureDiagnostic();
      }
    }).finally(() => { this.installing = undefined; });
    return this.installing;
  }
  restorePreinstallationFailure(failure: PreinstallationFailure): void {
    this.project({ phase: 'failed', reason: failure.reason, releaseId: failure.releaseId, candidateVersion: failure.candidateVersion,
      installationAvailable: false, recoveryAction: 'none', recoveryError: null });
  }
  reopenCurrentVersion(): Promise<void> {
    if (this.reopening) return this.reopening;
    if (this.installing || this.state.recoveryAction !== 'reopen-current' || !this.input.installation) return Promise.reject(new ProductUpdateError('UPDATE_REOPEN_UNAVAILABLE'));
    this.reopening = (async () => {
      await this.preserveFailureDiagnostic();
      await this.input.installation!.reopenCurrentVersion();
    })().catch(() => { this.project({ recoveryError: 'UPDATE_REOPEN_BLOCKED' }); }).finally(() => { this.reopening = undefined; });
    return this.reopening;
  }
  private failure(): PreinstallationFailure { return { reason: this.state.reason ?? 'UPDATE_INSTALL_FAILED', releaseId: this.state.releaseId, candidateVersion: this.state.candidateVersion }; }
  private async preserveFailureDiagnostic(): Promise<void> {
    try { await this.input.installation!.preserveFailure(this.failure()); }
    catch { this.projectDiagnosticUnavailable(); }
  }
  projectDiagnosticUnavailable(): void { this.project({ recoveryError: 'UPDATE_RECOVERY_STATE_FAILED' }); }
  async checkAfterFailedHandoffCleared(ownersAvailable: () => boolean, clearFailedHandoff: () => Promise<boolean>): Promise<void> {
    const allowed = () => ownersAvailable() && !this.stopped && !this.quiesceStarted && !this.installing && !this.reopening && this.state.recoveryAction === 'none';
    if (!allowed() || !await clearFailedHandoff() || !allowed()) throw new ProductUpdateError('UPDATE_CHECK_UNAVAILABLE');
    // Only this new, available owner process may re-establish its scheduler.
    // start is never used to revive an old quiesced Host after installation.
    this.start(false);
    void this.check();
  }
  projectActivation(phase: 'completed' | 'failed' | 'recovery-required' | 'awaiting-activation', release: ProductRelease, reason: string | null): void {
    this.project({ phase, candidateVersion: release.version, releaseId: release.releaseId, reason, installationAvailable: false });
  }
  projectRecoveryFailure(reason: string): void { this.project({ phase: 'recovery-required', reason, installationAvailable: false }); }
  private async runInstall(releaseId: string, consentApproved: boolean): Promise<void> {
    const ports = this.input.installation;
    if (!consentApproved || !ports || this.state.recoveryAction !== 'none' || this.state.phase !== 'prepared' || !this.stagedRelease
      || releaseId !== this.stagedRelease.releaseId || !this.state.installationAvailable || this.operation) rejectProductUpdate('UPDATE_INSTALL_NOT_READY');
    if (!await ports.ready()) rejectProductUpdate('UPDATE_INSTALL_NOT_READY');
    // Reuse the exact check/verification chain: current publisher admission,
    // compatibility and cache bytes must still identify this consented release.
    const approved = this.stagedRelease;
    await this.run(new AbortController().signal);
    if (this.state.phase !== 'prepared' || !this.stagedDirectory || !this.stagedRelease
      || this.stagedRelease.releaseId !== approved.releaseId || this.stagedRelease.asset.sha256 !== approved.asset.sha256) rejectProductUpdate('UPDATE_CANDIDATE_CHANGED');
    const candidate: PreparedProductCandidate = { release: this.stagedRelease, envelope: this.stagedEnvelope,
      file: path.join(this.stagedDirectory, this.stagedRelease.asset.name) };
    await ports.preflight(candidate);
    this.project({ phase: 'quiescing', installationAvailable: false, reason: null });
    this.quiesceStarted = true;
    const report = await ports.shutdown();
    if (!report.criticalCleanupComplete) rejectProductUpdate('UPDATE_CRITICAL_CLEANUP_FAILED');
    await verifyProductEnvelope(candidate.envelope, this.policy.publicKey);
    await this.verifyFile(candidate.file, candidate.release);
    await ports.handoff(candidate, report);
    this.handoffAccepted = true;
    this.project({ phase: 'handoff', reason: null });
    ports.quit();
  }
  private project(patch: Partial<ProductUpdateStatus>): void { this.state = { ...this.state, ...patch }; }

  private async run(signal: AbortSignal): Promise<void> {
    this.project({ phase: 'checking', reason: null, candidateVersion: null, releaseId: null,
      downloadedBytes: 0, totalBytes: 0, checkedAt: new Date().toISOString(), installationAvailable: false, recoveryError: null });
    if (!['macos-arm64', 'windows-amd64'].includes(this.input.target)) rejectProductUpdate('UPDATE_TARGET_UNSUPPORTED');
    const fetchImpl = this.input.fetchImpl ?? fetch;
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(this.policy.requestTimeoutMs)]);
    const response = await fetchImpl(`${this.policy.endpoint}/${this.policy.channel}/${this.input.target}/latest.json`, { signal: requestSignal, cache: 'no-store', redirect: 'error' });
    if (!response.ok) {
      let errorCode: unknown;
      try {
        const body = await readBoundedResponse(response, this.policy.maximumMetadataBytes);
        errorCode = JSON.parse(new TextDecoder().decode(body)).error;
      } catch { /* A missing route or HTML error never means no releases. */ }
      if (response.status === 404 && errorCode === 'UPDATE_RELEASE_NOT_FOUND') {
        await this.discardStaged(); this.project({ phase: 'unavailable', reason: 'UPDATE_RELEASE_NOT_FOUND' }); return;
      }
      if (response.status === 503 && errorCode === 'UPDATE_TRUST_NOT_CONFIGURED') rejectProductUpdate('UPDATE_TRUST_NOT_CONFIGURED');
      rejectProductUpdate('UPDATE_UPSTREAM_UNAVAILABLE');
    }
    const metadata = await readBoundedResponse(response, this.policy.maximumMetadataBytes);
    let envelope: unknown;
    try { envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(metadata)); }
    catch { rejectProductUpdate('UPDATE_METADATA_INVALID'); }
    const release = await verifyProductEnvelope(envelope, this.policy.publicKey);
    if (release.target !== this.input.target) rejectProductUpdate('UPDATE_TARGET_MISMATCH');
    if (release.channel !== this.policy.channel) rejectProductUpdate('UPDATE_CHANNEL_MISMATCH');
    if (compareProductVersions(release.version, this.input.currentVersion) <= 0) {
      await this.discardStaged(); this.project({ phase: 'current' }); return;
    }
    if (compareProductVersions(this.input.currentVersion, release.compatibility.minimumProductVersion) < 0
      || compareOsVersions(this.input.osVersion, release.compatibility.minimumOsVersion) < 0) rejectProductUpdate('UPDATE_COMPATIBILITY_INVALID');
    this.project({ candidateVersion: release.version, releaseId: release.releaseId, totalBytes: release.asset.size, phase: 'downloading' });
    if (this.stagedDirectory && this.stagedRelease?.asset.sha256 === release.asset.sha256
      && this.stagedRelease.releaseId === release.releaseId) {
      this.project({ phase: 'verifying', downloadedBytes: release.asset.size });
      try {
        await this.verifyFile(path.join(this.stagedDirectory, release.asset.name), release);
        signal.throwIfAborted();
        await verifyProductEnvelope(envelope, this.policy.publicKey);
        this.stagedEnvelope = envelope;
        await this.projectPrepared();
        return;
      } catch (error) { await this.discardStaged(); throw error; }
    }
    await this.discardStaged();
    if (process.platform === 'win32' && !this.input.prepareCache) rejectProductUpdate('UPDATE_CACHE_UNSAFE');
    await this.input.prepareCache?.();
    await mkdir(this.input.cacheRoot, { recursive: true, mode: 0o700 });
    const root = await lstat(this.input.cacheRoot);
    if (!root.isDirectory() || root.isSymbolicLink() || (process.platform !== 'win32' && (root.mode & 0o077) !== 0)
      || (typeof process.getuid === 'function' && root.uid !== process.getuid())) rejectProductUpdate('UPDATE_CACHE_UNSAFE');
    if (!this.cacheInitialized) {
      // A interrupted prior process grants no prepared state. Reclaim only
      // this downloader's private scratch directories, then download again.
      for (const entry of await readdir(this.input.cacheRoot, { withFileTypes: true })) {
        if (entry.isDirectory() && /^download-[A-Za-z0-9]{6}$/u.test(entry.name)) {
          await rm(path.join(this.input.cacheRoot, entry.name), { recursive: true, force: true });
        }
      }
      this.cacheInitialized = true;
    }
    const disk = await statfs(this.input.cacheRoot);
    if (disk.bavail * disk.bsize < release.asset.size) rejectProductUpdate('UPDATE_DISK_SPACE_INSUFFICIENT');
    const directory = await mkdtemp(path.join(this.input.cacheRoot, 'download-'));
    await chmod(directory, 0o700);
    const temporary = path.join(directory, 'candidate.part');
    try {
      const downloadSignal = AbortSignal.any([signal, AbortSignal.timeout(this.policy.downloadTimeoutMs)]);
      const asset = await fetchImpl(release.asset.url, { signal: downloadSignal, redirect: 'follow' });
      if (!asset.ok || !asset.body) rejectProductUpdate('UPDATE_DOWNLOAD_FAILED');
      const length = asset.headers.get('content-length');
      if (length !== null && Number(length) !== release.asset.size) rejectProductUpdate('UPDATE_ASSET_SIZE_MISMATCH');
      const file = await open(temporary, 'wx', 0o600);
      const hash = createHash('sha256');
      const reader = asset.body.getReader();
      let received = 0;
      try {
        for (;;) {
          signal.throwIfAborted();
          const { value, done } = await reader.read();
          if (done) break;
          received += value.byteLength;
          if (received > release.asset.size) rejectProductUpdate('UPDATE_ASSET_SIZE_MISMATCH');
          hash.update(value);
          // FileHandle.write may make a partial write; writeFile completes the
          // buffer at the current file position without claiming lost bytes.
          await file.writeFile(value);
          this.project({ downloadedBytes: received });
        }
        await file.sync();
      } finally { await file.close(); await reader.cancel().catch(() => undefined); }
      this.project({ phase: 'verifying' });
      if (received !== release.asset.size) rejectProductUpdate('UPDATE_ASSET_SIZE_MISMATCH');
      if (hash.digest('hex') !== release.asset.sha256) rejectProductUpdate('UPDATE_ASSET_DIGEST_MISMATCH');
      signal.throwIfAborted();
      await this.verifyFile(temporary, release);
      signal.throwIfAborted();
      await verifyProductEnvelope(envelope, this.policy.publicKey);
      await rename(temporary, path.join(directory, release.asset.name));
      signal.throwIfAborted();
      this.stagedDirectory = directory;
      this.stagedRelease = release;
      this.stagedEnvelope = envelope;
      await this.projectPrepared();
    } finally {
      if (this.stagedDirectory !== directory) await rm(directory, { recursive: true, force: true });
    }
  }
  private async discardStaged(): Promise<void> {
    if (this.stagedDirectory) await rm(this.stagedDirectory, { recursive: true, force: true });
    this.stagedDirectory = undefined;
    this.stagedRelease = undefined;
    this.stagedEnvelope = undefined;
  }
  private async projectPrepared(): Promise<void> {
    const available = Boolean(this.policy.publicKey && this.input.installation && await this.input.installation.ready());
    this.project({ phase: 'prepared', reason: available ? null : 'UPDATE_INSTALLER_NOT_CONNECTED', installationAvailable: available });
  }
  private async verifyFile(file: string, release: ProductRelease): Promise<void> {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== release.asset.size) rejectProductUpdate('UPDATE_ASSET_SIZE_MISMATCH');
    await this.verifyDigest(file, release);
    await this.input.verifyInstaller(file, release);
    // Native verification must not make changed bytes become prepared.
    await this.verifyDigest(file, release);
  }
  private async verifyDigest(file: string, release: ProductRelease): Promise<void> {
    const hash = createHash('sha256');
    let size = 0;
    for await (const chunk of createReadStream(file)) { hash.update(chunk); size += chunk.length; }
    if (size !== release.asset.size || hash.digest('hex') !== release.asset.sha256) rejectProductUpdate('UPDATE_ASSET_DIGEST_MISMATCH');
  }
}

function compareOsVersions(left: string, right: string): number {
  if (!/^\d+\.\d+(?:\.\d+)?$/u.test(left)) rejectProductUpdate('UPDATE_COMPATIBILITY_INVALID');
  const a = left.split('.').map(Number), b = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}
