import { lstat, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { ProductUpdateError } from '../../../config/product-update-contract.mjs';
import { writeOwnerPrivateAtomicJson } from './owner-private-atomic-json.js';
import type { PreinstallationFailure } from './product-update-installation.js';

export async function readUpdateFailureDiagnostic(
  store: Pick<ProductUpdateFailureStore, 'take'>,
  unavailable: () => void,
): Promise<PreinstallationFailure | null> {
  try { return await store.take(); }
  catch {
    // Diagnostic content is unconfirmed. Do not use it as a cause, an install
    // permission or a prerequisite for the normal Home bootstrap.
    try { unavailable(); } catch { /* Logging also remains non-authoritative. */ }
    return null;
  }
}

// One transient diagnostic for a safe current-version relaunch. This file
// never grants installation, data restoration or activation authority.
export class ProductUpdateFailureStore {
  private readonly file: string;
  constructor(cacheRoot: string, private readonly validateWindowsPrivateFile?: (file: string) => Promise<void>) { this.file = path.join(cacheRoot, 'preinstallation-failure.json'); }
  save(failure: PreinstallationFailure): Promise<void> { return writeOwnerPrivateAtomicJson(this.file, { schema: 'nimi-update-preinstallation-failure/v1', ...failure }, 'product-update-failure'); }
  async take(): Promise<PreinstallationFailure | null> {
    let info;
    try { info = await lstat(this.file); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    if (process.platform === 'win32') {
      if (!this.validateWindowsPrivateFile) throw new ProductUpdateError('UPDATE_RECOVERY_STATE_FAILED');
      await this.validateWindowsPrivateFile(this.file);
    }
    if (!info.isFile() || info.isSymbolicLink() || info.size > 4096 || (process.platform !== 'win32' && (info.mode & 0o077) !== 0)
      || (process.getuid && info.uid !== process.getuid())) throw new ProductUpdateError('UPDATE_RECOVERY_STATE_FAILED');
    const value = JSON.parse(await readFile(this.file, 'utf8'));
    if (value.schema !== 'nimi-update-preinstallation-failure/v1' || !/^UPDATE_[A-Z_]{1,100}$/u.test(value.reason)
      || !(value.releaseId === null || typeof value.releaseId === 'string' && value.releaseId.startsWith('nimi/v') && value.releaseId.length < 512)
      || !(value.candidateVersion === null || typeof value.candidateVersion === 'string' && value.candidateVersion.length < 128)) throw new ProductUpdateError('UPDATE_RECOVERY_STATE_FAILED');
    await rm(this.file);
    return { reason: value.reason, releaseId: value.releaseId, candidateVersion: value.candidateVersion };
  }
}
