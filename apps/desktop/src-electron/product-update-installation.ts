import type { ProductRelease } from '../../../config/product-update-contract.mjs';
import type { DesktopShutdownReport } from './product-update-shutdown.js';

export type PreparedProductCandidate = Readonly<{ release: ProductRelease; envelope: unknown; file: string }>;
export type PreinstallationFailure = Readonly<{ reason: string; releaseId: string | null; candidateVersion: string | null }>;
export type ProductInstallationPorts = {
  ready(): Promise<boolean>;
  preflight(candidate: PreparedProductCandidate): Promise<void>;
  shutdown(): Promise<DesktopShutdownReport>;
  handoff(candidate: PreparedProductCandidate, report: DesktopShutdownReport): Promise<void>;
  preserveFailure(failure: PreinstallationFailure): Promise<void>;
  reopenCurrentVersion(): Promise<void>;
  quit(): void;
};
