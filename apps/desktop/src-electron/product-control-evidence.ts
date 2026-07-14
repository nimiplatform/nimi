import { createRequire } from 'node:module';

const PACKAGE_NAME = '@nimiplatform/desktop-product-control-win32-x64';

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

export type DesktopProductControlEvidenceBinding = {
  readonly ensureAccountDefaultProfile: (input: DesktopProductControlEvidenceInput) => NativeOutcome;
  readonly readAccountDefaultProfile: (input: DesktopProductControlEvidenceInput) => NativeOutcome;
  readonly verifyAccountDefaultProfile: (input: DesktopProductControlEvidenceInput) => NativeOutcome;
  readonly ensureBuiltInAiConfigEvidenceSet: (input: DesktopBuiltInAiConfigInput) => NativeOutcome;
  readonly readBuiltInAiConfigForScopeInit: (input: DesktopBuiltInAiConfigInput) => NativeOutcome;
  readonly verifyBuiltInAiConfigEvidenceSet: (input: DesktopBuiltInAiConfigInput) => NativeOutcome;
};

export type DesktopProductControlEvidence = {
  readonly ensureAccountDefaultProfile: (input: DesktopProductControlEvidenceInput) => unknown;
  readonly readAccountDefaultProfile: (input: DesktopProductControlEvidenceInput) => unknown;
  readonly verifyAccountDefaultProfile: (input: DesktopProductControlEvidenceInput) => unknown;
  readonly ensureBuiltInAiConfigEvidenceSet: (input: DesktopBuiltInAiConfigInput) => unknown;
  readonly readBuiltInAiConfigForScopeInit: (input: DesktopBuiltInAiConfigInput) => unknown;
  readonly verifyBuiltInAiConfigEvidenceSet: (input: DesktopBuiltInAiConfigInput) => unknown;
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
  };
}

function loadBinding(): DesktopProductControlEvidenceBinding {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('desktop-first-run-evidence-platform-unsupported');
  }
  try {
    return validateBinding(createRequire(import.meta.url)(PACKAGE_NAME) as unknown);
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
