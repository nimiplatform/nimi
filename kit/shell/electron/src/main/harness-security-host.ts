import { loadNimiElectronProtectedLocalPackage } from './protected-local-binding-loader.js';
import {
  NimiElectronLocalAppHostError,
  resolveNimiElectronProtectedLocalBindingPackage,
} from './local-app-host.js';

export interface NimiHarnessJobProcessInput {
  readonly executable: string;
  readonly args: readonly string[];
  readonly workingDirectory: string;
  /** Explicit minimal environment allowlist. Parent environment is never inherited. */
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}

export interface NimiHarnessJobProcessResult {
  readonly pid: number;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly killed: boolean;
  readonly stdoutBase64: string;
  readonly stderrBase64: string;
  readonly stdoutUtf8: string;
  readonly stderrUtf8: string;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
  readonly activeProcessesRemaining: number;
}

export interface NimiHarnessSpawnedJob {
  readonly jobId: string;
  readonly pid: number;
}

export interface NimiHarnessKillJobResult {
  readonly killed: boolean;
  readonly activeProcessesRemaining: number;
}

export interface NimiHarnessVerifiedPath {
  readonly canonicalWorkspaceRoot: string;
  readonly finalPath: string;
  readonly relativePath: string;
  readonly isDirectory: boolean;
  readonly sizeBytes: number;
  readonly nNumberOfLinks: number;
}

export interface NimiHarnessSecureReadResult {
  readonly finalPath: string;
  readonly contentBase64: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly nNumberOfLinks: number;
}

export interface NimiHarnessSecureWriteInput {
  readonly workspaceRoot: string;
  readonly relativePath: string;
  readonly content: Uint8Array;
  readonly preconditionSha256?: string;
  readonly allowCreate?: boolean;
  readonly snapshotPath?: string;
  readonly snapshotRoot?: string;
}

export interface NimiHarnessSecureWriteResult {
  readonly finalPath: string;
  readonly sha256: string;
  readonly previousSha256: string | null;
  readonly bytesWritten: number;
  readonly created: boolean;
  readonly snapshotWritten: boolean;
}

export interface NimiHarnessSecureDeleteInput {
  readonly workspaceRoot: string;
  readonly relativePath: string;
  readonly preconditionSha256?: string;
  readonly snapshotPath?: string;
  readonly snapshotRoot?: string;
}

export interface NimiHarnessSecureDeleteResult {
  readonly finalPath: string;
  readonly previousSha256: string;
  readonly snapshotWritten: boolean;
}

type NativeOutcome =
  | { readonly status: 'ok'; readonly value: unknown }
  | {
      readonly status: 'error';
      readonly reasonCode?: string;
      readonly retryable?: boolean;
      readonly reasonMetadata?: Record<string, string>;
    };

export interface NimiElectronHarnessSecurityBinding {
  harnessRunJobProcess(input: Record<string, unknown>): Promise<NativeOutcome>;
  harnessSpawnJobProcess(input: Record<string, unknown>): Promise<NativeOutcome>;
  harnessWaitJobProcess(input: Record<string, unknown>): Promise<NativeOutcome>;
  harnessKillJobProcess(input: Record<string, unknown>): Promise<NativeOutcome>;
  harnessVerifyWorkspacePath(input: Record<string, unknown>): Promise<NativeOutcome>;
  harnessSecureReadFile(input: Record<string, unknown>): Promise<NativeOutcome>;
  harnessSecureWriteFile(input: Record<string, unknown>): Promise<NativeOutcome>;
  harnessSecureDeleteFile(input: Record<string, unknown>): Promise<NativeOutcome>;
}

export interface NimiElectronHarnessSecurityHost {
  runJobProcess(input: NimiHarnessJobProcessInput): Promise<NimiHarnessJobProcessResult>;
  spawnJobProcess(input: NimiHarnessJobProcessInput): Promise<NimiHarnessSpawnedJob>;
  waitJobProcess(input: { readonly jobId: string; readonly timeoutMs?: number }): Promise<NimiHarnessJobProcessResult>;
  killJobProcess(input: { readonly jobId: string }): Promise<NimiHarnessKillJobResult>;
  verifyWorkspacePath(input: {
    readonly workspaceRoot: string;
    readonly relativePath: string;
    readonly expectDirectory?: boolean;
  }): Promise<NimiHarnessVerifiedPath>;
  secureReadFile(input: {
    readonly workspaceRoot: string;
    readonly relativePath: string;
    readonly maxBytes?: number;
  }): Promise<NimiHarnessSecureReadResult>;
  secureWriteFile(input: NimiHarnessSecureWriteInput): Promise<NimiHarnessSecureWriteResult>;
  secureDeleteFile(input: NimiHarnessSecureDeleteInput): Promise<NimiHarnessSecureDeleteResult>;
}

const REQUIRED_METHODS = [
  'harnessRunJobProcess',
  'harnessSpawnJobProcess',
  'harnessWaitJobProcess',
  'harnessKillJobProcess',
  'harnessVerifyWorkspacePath',
  'harnessSecureReadFile',
  'harnessSecureWriteFile',
  'harnessSecureDeleteFile',
] as const;

function unwrapOutcome<T>(outcome: NativeOutcome): T {
  if (outcome?.status === 'ok') {
    return outcome.value as T;
  }
  const reasonCode = typeof outcome?.reasonCode === 'string' && outcome.reasonCode
    ? outcome.reasonCode
    : 'host-internal-error';
  const retryable = outcome?.retryable === true;
  const metadata = outcome?.reasonMetadata && typeof outcome.reasonMetadata === 'object'
    ? Object.fromEntries(
        Object.entries(outcome.reasonMetadata).filter(([, v]) => typeof v === 'string'),
      )
    : {};
  throw new NimiElectronLocalAppHostError(reasonCode, retryable, metadata);
}

function loadBinding(injected?: NimiElectronHarnessSecurityBinding): NimiElectronHarnessSecurityBinding {
  const candidate = (injected ?? loadNimiElectronProtectedLocalPackage(
    resolveNimiElectronProtectedLocalBindingPackage(process.platform, process.arch),
  )) as Record<string, unknown>;
  if (!candidate || typeof candidate !== 'object' || REQUIRED_METHODS.some((m) => typeof candidate[m] !== 'function')) {
    throw new NimiElectronLocalAppHostError('protected-carrier-required', false);
  }
  return candidate as unknown as NimiElectronHarnessSecurityBinding;
}

// @nimi-authority: rule.nimi.harness.assistant.security-gates
/** Host-only native Win32 Job Object and NTFS handle-security facade for Harness main/utilityProcess. */
export function createNimiElectronHarnessSecurityHost(
  injectedBinding?: NimiElectronHarnessSecurityBinding,
): NimiElectronHarnessSecurityHost {
  let cached: NimiElectronHarnessSecurityBinding | undefined;
  const binding = () => (cached ??= loadBinding(injectedBinding));
  const host: NimiElectronHarnessSecurityHost = {
    async runJobProcess(input) {
      return unwrapOutcome(await binding().harnessRunJobProcess({
        executable: input.executable,
        args: [...input.args],
        workingDirectory: input.workingDirectory,
        ...(input.env ? { env: { ...input.env } } : {}),
        ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
        ...(input.maxOutputBytes !== undefined ? { maxOutputBytes: input.maxOutputBytes } : {}),
      }));
    },
    async spawnJobProcess(input) {
      return unwrapOutcome(await binding().harnessSpawnJobProcess({
        executable: input.executable,
        args: [...input.args],
        workingDirectory: input.workingDirectory,
        ...(input.env ? { env: { ...input.env } } : {}),
        ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
        ...(input.maxOutputBytes !== undefined ? { maxOutputBytes: input.maxOutputBytes } : {}),
      }));
    },
    async waitJobProcess(input) {
      return unwrapOutcome(await binding().harnessWaitJobProcess({
        jobId: input.jobId,
        ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
      }));
    },
    async killJobProcess(input) {
      return unwrapOutcome(await binding().harnessKillJobProcess({ jobId: input.jobId }));
    },
    async verifyWorkspacePath(input) {
      return unwrapOutcome(await binding().harnessVerifyWorkspacePath({
        workspaceRoot: input.workspaceRoot,
        relativePath: input.relativePath,
        ...(input.expectDirectory !== undefined ? { expectDirectory: input.expectDirectory } : {}),
      }));
    },
    async secureReadFile(input) {
      return unwrapOutcome(await binding().harnessSecureReadFile({
        workspaceRoot: input.workspaceRoot,
        relativePath: input.relativePath,
        ...(input.maxBytes !== undefined ? { maxBytes: input.maxBytes } : {}),
      }));
    },
    async secureWriteFile(input) {
      return unwrapOutcome(await binding().harnessSecureWriteFile({
        workspaceRoot: input.workspaceRoot,
        relativePath: input.relativePath,
        content: Buffer.from(input.content.buffer, input.content.byteOffset, input.content.byteLength),
        ...(input.preconditionSha256 !== undefined ? { preconditionSha256: input.preconditionSha256 } : {}),
        ...(input.allowCreate !== undefined ? { allowCreate: input.allowCreate } : {}),
        ...(input.snapshotPath !== undefined ? { snapshotPath: input.snapshotPath } : {}),
        ...(input.snapshotRoot !== undefined ? { snapshotRoot: input.snapshotRoot } : {}),
      }));
    },
    async secureDeleteFile(input) {
      return unwrapOutcome(await binding().harnessSecureDeleteFile({
        workspaceRoot: input.workspaceRoot,
        relativePath: input.relativePath,
        ...(input.preconditionSha256 !== undefined ? { preconditionSha256: input.preconditionSha256 } : {}),
        ...(input.snapshotPath !== undefined ? { snapshotPath: input.snapshotPath } : {}),
        ...(input.snapshotRoot !== undefined ? { snapshotRoot: input.snapshotRoot } : {}),
      }));
    },
  };
  return Object.freeze(host);
}
