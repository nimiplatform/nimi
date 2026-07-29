import { createRequire } from 'node:module';

const PACKAGE_BY_PLATFORM = Object.freeze({
  'darwin:arm64': '@nimiplatform/desktop-product-control-darwin-arm64',
  'win32:x64': '@nimiplatform/desktop-product-control-win32-x64',
} as const);

type NativeOutcome =
  | { readonly status: 'ok'; readonly value: unknown }
  | { readonly status: 'error'; readonly reasonCode: unknown; readonly retryable: unknown };

export type DesktopProductControlEvidenceInput = {
  readonly dataRoot: string;
  readonly accountId: string;
  readonly aiProfileAlias?: string;
  readonly installLevel?: string;
  readonly accountDefaultProfileRef?: string;
};

export type DesktopBuiltInAiConfigInput = {
  readonly dataRoot: string;
  readonly accountId: string;
  readonly aiProfileAlias: string;
  readonly installLevel: string;
  readonly executionEvidence: Readonly<Record<string, unknown>>;
  readonly surfaceId?: string;
  readonly builtInAiConfigRefs?: readonly string[];
};

export type DesktopAccountProfileLibraryInput = {
  readonly dataRoot: string;
  readonly accountId: string;
};

export type DesktopAccountProfileLibraryEntryInput = DesktopAccountProfileLibraryInput & {
  readonly profile: unknown;
};

export type DesktopAccountProfileLibraryImportInput = DesktopAccountProfileLibraryInput & {
  readonly profiles: readonly unknown[];
};

export type DesktopAccountProfileLibraryExportInput = DesktopAccountProfileLibraryInput & {
  readonly profileIds: readonly string[];
};

export type DesktopAccountProfileLibraryDeleteInput = DesktopAccountProfileLibraryInput & {
  readonly profileId: string;
};

export type DesktopProductControlEvidenceBinding = {
  readonly ensureAccountDefaultProfile: (input: DesktopProductControlEvidenceInput) => NativeOutcome;
  readonly readAccountDefaultProfile: (input: DesktopProductControlEvidenceInput) => NativeOutcome;
  readonly verifyAccountDefaultProfile: (input: DesktopProductControlEvidenceInput) => NativeOutcome;
  readonly ensureBuiltInAiConfigEvidenceSet: (input: DesktopBuiltInAiConfigInput) => NativeOutcome;
  readonly readBuiltInAiConfigForScopeInit: (input: DesktopBuiltInAiConfigInput) => NativeOutcome;
  readonly verifyBuiltInAiConfigEvidenceSet: (input: DesktopBuiltInAiConfigInput) => NativeOutcome;
  readonly listAccountProfileLibrary: (input: DesktopAccountProfileLibraryInput) => NativeOutcome;
  readonly createAccountProfileLibraryProfile: (input: DesktopAccountProfileLibraryEntryInput) => NativeOutcome;
  readonly editAccountProfileLibraryProfile: (input: DesktopAccountProfileLibraryEntryInput) => NativeOutcome;
  readonly importAccountProfileLibraryProfiles: (input: DesktopAccountProfileLibraryImportInput) => NativeOutcome;
  readonly exportAccountProfileLibraryProfiles: (input: DesktopAccountProfileLibraryExportInput) => NativeOutcome;
  readonly deleteAccountProfileLibraryProfile: (input: DesktopAccountProfileLibraryDeleteInput) => NativeOutcome;
};

export type DesktopProductControlEvidence = {
  readonly ensureAccountDefaultProfile: (input: DesktopProductControlEvidenceInput) => unknown;
  readonly readAccountDefaultProfile: (input: DesktopProductControlEvidenceInput) => unknown;
  readonly verifyAccountDefaultProfile: (input: DesktopProductControlEvidenceInput) => unknown;
  readonly ensureBuiltInAiConfigEvidenceSet: (input: DesktopBuiltInAiConfigInput) => unknown;
  readonly readBuiltInAiConfigForScopeInit: (input: DesktopBuiltInAiConfigInput) => unknown;
  readonly verifyBuiltInAiConfigEvidenceSet: (input: DesktopBuiltInAiConfigInput) => unknown;
  readonly listAccountProfileLibrary: (input: DesktopAccountProfileLibraryInput) => unknown;
  readonly createAccountProfileLibraryProfile: (input: DesktopAccountProfileLibraryEntryInput) => unknown;
  readonly editAccountProfileLibraryProfile: (input: DesktopAccountProfileLibraryEntryInput) => unknown;
  readonly importAccountProfileLibraryProfiles: (input: DesktopAccountProfileLibraryImportInput) => unknown;
  readonly exportAccountProfileLibraryProfiles: (input: DesktopAccountProfileLibraryExportInput) => unknown;
  readonly deleteAccountProfileLibraryProfile: (input: DesktopAccountProfileLibraryDeleteInput) => unknown;
};

export function createDesktopProductControlEvidence(
  binding?: DesktopProductControlEvidenceBinding,
): DesktopProductControlEvidence {
  let checked = binding ? validateBinding(binding) : undefined;
  const current = () => (checked ??= loadBinding());
  return {
    ensureAccountDefaultProfile: (input) => unwrap(current().ensureAccountDefaultProfile(input)),
    readAccountDefaultProfile: (input) => unwrap(current().readAccountDefaultProfile(input)),
    verifyAccountDefaultProfile: (input) => unwrap(current().verifyAccountDefaultProfile(input)),
    ensureBuiltInAiConfigEvidenceSet: (input) => unwrap(current().ensureBuiltInAiConfigEvidenceSet(input)),
    readBuiltInAiConfigForScopeInit: (input) => unwrap(current().readBuiltInAiConfigForScopeInit(input)),
    verifyBuiltInAiConfigEvidenceSet: (input) => unwrap(current().verifyBuiltInAiConfigEvidenceSet(input)),
    listAccountProfileLibrary: (input) => unwrap(current().listAccountProfileLibrary(input)),
    createAccountProfileLibraryProfile: (input) => unwrap(current().createAccountProfileLibraryProfile(input)),
    editAccountProfileLibraryProfile: (input) => unwrap(current().editAccountProfileLibraryProfile(input)),
    importAccountProfileLibraryProfiles: (input) => unwrap(current().importAccountProfileLibraryProfiles(input)),
    exportAccountProfileLibraryProfiles: (input) => unwrap(current().exportAccountProfileLibraryProfiles(input)),
    deleteAccountProfileLibraryProfile: (input) => unwrap(current().deleteAccountProfileLibraryProfile(input)),
  };
}

function loadBinding(): DesktopProductControlEvidenceBinding {
  const packageName = PACKAGE_BY_PLATFORM[`${process.platform}:${process.arch}` as keyof typeof PACKAGE_BY_PLATFORM];
  if (!packageName) {
    throw new Error('desktop-first-run-evidence-platform-unsupported');
  }
  try {
    return validateBinding(createRequire(import.meta.url)(packageName) as unknown);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('desktop-first-run-evidence-')) throw error;
    throw new Error('desktop-first-run-evidence-carrier-required', { cause: error });
  }
}

function validateBinding(value: unknown): DesktopProductControlEvidenceBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('desktop-first-run-evidence-carrier-untrusted');
  }
  const binding = value as Record<string, unknown>;
  for (const method of [
    'ensureAccountDefaultProfile',
    'readAccountDefaultProfile',
    'verifyAccountDefaultProfile',
    'ensureBuiltInAiConfigEvidenceSet',
    'readBuiltInAiConfigForScopeInit',
    'verifyBuiltInAiConfigEvidenceSet',
    'listAccountProfileLibrary',
    'createAccountProfileLibraryProfile',
    'editAccountProfileLibraryProfile',
    'importAccountProfileLibraryProfiles',
    'exportAccountProfileLibraryProfiles',
    'deleteAccountProfileLibraryProfile',
  ]) {
    if (typeof binding[method] !== 'function') {
      throw new Error('desktop-first-run-evidence-carrier-untrusted');
    }
  }
  return value as DesktopProductControlEvidenceBinding;
}

function unwrap(outcome: NativeOutcome): unknown {
  if (outcome?.status === 'ok') return outcome.value;
  if (outcome?.status === 'error'
    && typeof outcome.reasonCode === 'string'
    && /^[a-z][a-z0-9-]{0,127}$/u.test(outcome.reasonCode)
    && typeof outcome.retryable === 'boolean') {
    throw new Error(outcome.reasonCode);
  }
  throw new Error('desktop-first-run-evidence-carrier-untrusted');
}
