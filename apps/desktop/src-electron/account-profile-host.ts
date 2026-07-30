import { createRequire } from 'node:module';

const PACKAGE_BY_PLATFORM = Object.freeze({
  'darwin:arm64': '@nimiplatform/desktop-product-control-darwin-arm64',
  'win32:x64': '@nimiplatform/desktop-product-control-win32-x64',
} as const);

type NativeOutcome =
  | { readonly status: 'ok'; readonly value: unknown }
  | { readonly status: 'error'; readonly reasonCode: unknown; readonly retryable: unknown };

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

export type DesktopAccountProfileHostBinding = {
  readonly listAccountProfileLibrary: (input: DesktopAccountProfileLibraryInput) => NativeOutcome;
  readonly createAccountProfileLibraryProfile: (input: DesktopAccountProfileLibraryEntryInput) => NativeOutcome;
  readonly editAccountProfileLibraryProfile: (input: DesktopAccountProfileLibraryEntryInput) => NativeOutcome;
  readonly importAccountProfileLibraryProfiles: (input: DesktopAccountProfileLibraryImportInput) => NativeOutcome;
  readonly exportAccountProfileLibraryProfiles: (input: DesktopAccountProfileLibraryExportInput) => NativeOutcome;
  readonly deleteAccountProfileLibraryProfile: (input: DesktopAccountProfileLibraryDeleteInput) => NativeOutcome;
};

export type DesktopAccountProfileHost = {
  readonly listAccountProfileLibrary: (input: DesktopAccountProfileLibraryInput) => unknown;
  readonly createAccountProfileLibraryProfile: (input: DesktopAccountProfileLibraryEntryInput) => unknown;
  readonly editAccountProfileLibraryProfile: (input: DesktopAccountProfileLibraryEntryInput) => unknown;
  readonly importAccountProfileLibraryProfiles: (input: DesktopAccountProfileLibraryImportInput) => unknown;
  readonly exportAccountProfileLibraryProfiles: (input: DesktopAccountProfileLibraryExportInput) => unknown;
  readonly deleteAccountProfileLibraryProfile: (input: DesktopAccountProfileLibraryDeleteInput) => unknown;
};

export function createDesktopAccountProfileHost(
  binding?: DesktopAccountProfileHostBinding,
): DesktopAccountProfileHost {
  let checked = binding ? validateBinding(binding) : undefined;
  const current = () => (checked ??= loadBinding());
  return {
    listAccountProfileLibrary: (input) => unwrap(current().listAccountProfileLibrary(input)),
    createAccountProfileLibraryProfile: (input) => unwrap(current().createAccountProfileLibraryProfile(input)),
    editAccountProfileLibraryProfile: (input) => unwrap(current().editAccountProfileLibraryProfile(input)),
    importAccountProfileLibraryProfiles: (input) => unwrap(current().importAccountProfileLibraryProfiles(input)),
    exportAccountProfileLibraryProfiles: (input) => unwrap(current().exportAccountProfileLibraryProfiles(input)),
    deleteAccountProfileLibraryProfile: (input) => unwrap(current().deleteAccountProfileLibraryProfile(input)),
  };
}

function loadBinding(): DesktopAccountProfileHostBinding {
  const packageName = PACKAGE_BY_PLATFORM[`${process.platform}:${process.arch}` as keyof typeof PACKAGE_BY_PLATFORM];
  if (!packageName) {
    throw new Error('desktop-account-profile-platform-unsupported');
  }
  try {
    return validateBinding(createRequire(import.meta.url)(packageName) as unknown);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('desktop-account-profile-')) throw error;
    throw new Error('desktop-account-profile-host-required', { cause: error });
  }
}

function validateBinding(value: unknown): DesktopAccountProfileHostBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('desktop-account-profile-host-untrusted');
  }
  const binding = value as Record<string, unknown>;
  for (const method of [
    'listAccountProfileLibrary',
    'createAccountProfileLibraryProfile',
    'editAccountProfileLibraryProfile',
    'importAccountProfileLibraryProfiles',
    'exportAccountProfileLibraryProfiles',
    'deleteAccountProfileLibraryProfile',
  ]) {
    if (typeof binding[method] !== 'function') {
      throw new Error('desktop-account-profile-host-untrusted');
    }
  }
  return value as DesktopAccountProfileHostBinding;
}

function unwrap(outcome: NativeOutcome): unknown {
  if (outcome?.status === 'ok') return outcome.value;
  if (outcome?.status === 'error'
    && typeof outcome.reasonCode === 'string'
    && /^[a-z][a-z0-9-]{0,127}$/u.test(outcome.reasonCode)
    && typeof outcome.retryable === 'boolean') {
    throw new Error(outcome.reasonCode);
  }
  throw new Error('desktop-account-profile-host-untrusted');
}
