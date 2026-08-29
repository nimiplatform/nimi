import {
  createNimiLocalAIConfigCapabilityIntent,
  type NimiAIConfigOverwriteResult,
  type NimiPortableAppAIConfig,
  type NimiPortableAppAIConfigIntent,
} from '@nimiplatform/kit/core/sdk-contract';
import type { ModelConfigListOptions, ModelConfigOverwrite } from './types.js';

export type ModelConfigCurrentMachineLocalActionErrorCode =
  | 'INVALID_ACTION_INPUT'
  | 'INVALID_CURRENT_CONFIG'
  | 'INVALID_LOCAL_OPTIONS'
  | 'INVALID_OVERWRITE_RESULT'
  | 'STALE_ACTION_CONTEXT';

export class ModelConfigCurrentMachineLocalActionError extends Error {
  readonly code: ModelConfigCurrentMachineLocalActionErrorCode;
  readonly capabilityContract?: string;

  constructor(
    code: ModelConfigCurrentMachineLocalActionErrorCode,
    message: string,
    capabilityContract?: string,
  ) {
    super(message);
    this.name = 'ModelConfigCurrentMachineLocalActionError';
    this.code = code;
    this.capabilityContract = capabilityContract;
  }
}

export type ModelConfigCurrentMachineLocalActionInput = Readonly<{
  readonly capabilityContracts: readonly string[];
  readonly capabilities: readonly NimiPortableAppAIConfigIntent[];
  readonly revision: string;
  readonly listOptions: ModelConfigListOptions;
  readonly onOverwrite: ModelConfigOverwrite;
  readonly isCurrent?: () => boolean;
}>;

type ModelConfigCurrentMachineLocalActionBaseResult = Readonly<{
  readonly selectedCapabilityContracts: readonly string[];
}>;

export type ModelConfigCurrentMachineLocalActionResult =
  | (ModelConfigCurrentMachineLocalActionBaseResult & {
      readonly outcome: 'no-selection' | 'no-change';
    })
  | (ModelConfigCurrentMachineLocalActionBaseResult & {
      readonly outcome: 'committed';
      readonly config: NimiPortableAppAIConfig;
      readonly revision: string;
    })
  | (ModelConfigCurrentMachineLocalActionBaseResult & {
      readonly outcome: 'conflict';
      readonly config: NimiPortableAppAIConfig | null;
      readonly revision: string;
      readonly reasonCode: Extract<NimiAIConfigOverwriteResult, { readonly outcome: 'conflict' }>['reasonCode'];
      readonly draftCapabilities: readonly NimiPortableAppAIConfigIntent[];
    });

function exactText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value;
}

function canonicalExplicitContracts(values: readonly string[]): readonly string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const contract = typeof value === 'string' ? value.trim() : '';
    if (!contract || seen.has(contract)) continue;
    seen.add(contract);
    result.push(contract);
  }
  return Object.freeze(result);
}

function freezeCurrentCapabilities(
  capabilities: readonly NimiPortableAppAIConfigIntent[],
): readonly NimiPortableAppAIConfigIntent[] {
  const seen = new Set<string>();
  const frozen = structuredClone([...capabilities]);
  for (const intent of frozen) {
    if (!intent || !exactText(intent.capabilityContract) || seen.has(intent.capabilityContract)) {
      throw new ModelConfigCurrentMachineLocalActionError(
        'INVALID_CURRENT_CONFIG',
        'Current AIConfig contains a missing or duplicate CapabilityContract.',
      );
    }
    seen.add(intent.capabilityContract);
  }
  return Object.freeze(frozen);
}

function assertCurrentLocalOption(value: unknown, capabilityContract: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ModelConfigCurrentMachineLocalActionError(
      'INVALID_LOCAL_OPTIONS',
      'Current Local selection is malformed.',
      capabilityContract,
    );
  }
  const option = value as Record<string, unknown>;
  const implementation = option.implementation;
  if (
    option.capabilityContract !== capabilityContract
    || !exactText(option.loadoutRef)
    || !exactText(option.label)
    || !implementation
    || typeof implementation !== 'object'
    || Array.isArray(implementation)
    || !exactText((implementation as Record<string, unknown>).implementationId)
    || !exactText((implementation as Record<string, unknown>).driverId)
    || !exactText((implementation as Record<string, unknown>).driverDialect)
    || (option.state !== 'ready' && option.state !== 'blocked')
    || !Array.isArray(option.supportedFeatures)
    || !option.supportedFeatures.every(exactText)
    || !Array.isArray(option.reasons)
    || !option.reasons.every(exactText)
  ) {
    throw new ModelConfigCurrentMachineLocalActionError(
      'INVALID_LOCAL_OPTIONS',
      'Current Local selection does not match the requested capability.',
      capabilityContract,
    );
  }
}

async function readCurrentLocalSelection(
  listOptions: ModelConfigListOptions,
  capabilityContract: string,
): Promise<boolean> {
  const result = await listOptions({ kind: 'local-loadouts', capabilityContract });
  if (!result || result.kind !== 'local-loadouts' || result.truncated !== false
    || !Array.isArray(result.options) || result.options.length > 1) {
    throw new ModelConfigCurrentMachineLocalActionError(
      'INVALID_LOCAL_OPTIONS',
      'Current Local selection projection is incomplete or mismatched.',
      capabilityContract,
    );
  }
  if (result.options.length === 0) return false;
  assertCurrentLocalOption(result.options[0], capabilityContract);
  return true;
}

function isRouteOnlyLocal(intent: NimiPortableAppAIConfigIntent): boolean {
  return intent.route.oneofKind === 'local';
}

function buildLocalDraft(
  explicitContracts: readonly string[],
  current: readonly NimiPortableAppAIConfigIntent[],
  selectedContracts: readonly string[],
): { readonly capabilities: readonly NimiPortableAppAIConfigIntent[]; readonly changed: boolean } {
  const selected = new Set(selectedContracts);
  const seenSelected = new Set<string>();
  let changed = false;
  const capabilities = current.map((intent) => {
    if (!selected.has(intent.capabilityContract)) return intent;
    seenSelected.add(intent.capabilityContract);
    if (isRouteOnlyLocal(intent)) return intent;
    changed = true;
    return Object.freeze({
      ...intent,
      route: Object.freeze({ oneofKind: 'local' as const, local: Object.freeze({}) }),
    });
  });
  for (const capabilityContract of explicitContracts) {
    if (!selected.has(capabilityContract) || seenSelected.has(capabilityContract)) continue;
    capabilities.push(createNimiLocalAIConfigCapabilityIntent({ capabilityContract }));
    changed = true;
  }
  return { capabilities: Object.freeze(capabilities), changed };
}

// @nimi-authority: rule.nimi.platform.ui-design-system.p-model-config-002
export async function runModelConfigCurrentMachineLocalAction(
  input: ModelConfigCurrentMachineLocalActionInput,
): Promise<ModelConfigCurrentMachineLocalActionResult> {
  const isCurrent = input.isCurrent ?? (() => true);
  const explicitContracts = canonicalExplicitContracts(input.capabilityContracts);
  if (explicitContracts.length === 0 || !exactText(input.revision)
    || typeof input.listOptions !== 'function' || typeof input.onOverwrite !== 'function'
    || !isCurrent()) {
    throw new ModelConfigCurrentMachineLocalActionError(
      'INVALID_ACTION_INPUT',
      'Current-machine Local action inputs are incomplete.',
    );
  }
  const current = freezeCurrentCapabilities(input.capabilities);
  const revision = input.revision;
  const reads = await Promise.allSettled(explicitContracts.map(async (capabilityContract) => ({
    capabilityContract,
    selected: await readCurrentLocalSelection(input.listOptions, capabilityContract),
  })));
  const failedRead = reads.find((entry): entry is PromiseRejectedResult => entry.status === 'rejected');
  if (failedRead) throw failedRead.reason;
  const selected = reads
    .filter((entry): entry is PromiseFulfilledResult<{ readonly capabilityContract: string; readonly selected: boolean }> => entry.status === 'fulfilled')
    .map((entry) => entry.value)
    .filter((entry) => entry.selected)
    .map((entry) => entry.capabilityContract);
  const selectedCapabilityContracts = Object.freeze(selected);
  if (selected.length === 0) {
    return Object.freeze({ outcome: 'no-selection', selectedCapabilityContracts });
  }

  const draft = buildLocalDraft(explicitContracts, current, selected);
  if (!draft.changed) {
    return Object.freeze({ outcome: 'no-change', selectedCapabilityContracts });
  }

  if (!isCurrent()) {
    throw new ModelConfigCurrentMachineLocalActionError(
      'STALE_ACTION_CONTEXT',
      'Model configuration owner changed before mutation.',
    );
  }

  const result = await input.onOverwrite({
    expectedRevision: revision,
    capabilities: draft.capabilities,
  });
  if (!result || (result.outcome !== 'committed' && result.outcome !== 'conflict')) {
    throw new ModelConfigCurrentMachineLocalActionError(
      'INVALID_OVERWRITE_RESULT',
      'AIConfig overwrite returned an invalid result.',
    );
  }
  if (result.outcome === 'conflict') {
    return Object.freeze({
      outcome: 'conflict',
      config: result.config,
      revision: result.revision,
      reasonCode: result.reasonCode,
      draftCapabilities: draft.capabilities,
      selectedCapabilityContracts,
    });
  }
  return Object.freeze({
    outcome: 'committed',
    config: result.config,
    revision: result.revision,
    selectedCapabilityContracts,
  });
}
