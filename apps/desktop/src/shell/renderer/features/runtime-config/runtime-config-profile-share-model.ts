import type {
  NimiLoadoutSelection,
  NimiMachineLoadout,
  NimiRuntimeModelAssetRecord,
} from '@nimiplatform/sdk/runtime';
import { exportRuntimeConfigAIProfileFromLoadouts } from './runtime-config-ai-profile-transfer.js';
import { capabilityGroup, type CapabilityGroup } from './runtime-capability-presentation.js';

/**
 * Why a saved model setup cannot go into a shared file right now. The export
 * itself is the judge: a Loadout the Runtime marks configured can still fail
 * when its bound model files are gone or unverified, so the panel probes the
 * real export for every candidate instead of trusting `validationState`.
 */
export type RuntimeConfigShareBlockReason =
  | { readonly kind: 'blocked'; readonly detail: string }
  | { readonly kind: 'unresolved'; readonly detail: string }
  | { readonly kind: 'assets'; readonly detail: string };

export type RuntimeConfigShareCandidate = {
  readonly loadout: NimiMachineLoadout;
  /** Machine-selected Loadout for this use ("正在使用"). */
  readonly current: boolean;
  readonly block: RuntimeConfigShareBlockReason | null;
};

export type RuntimeConfigShareUse = {
  readonly capabilityContract: string;
  readonly group: CapabilityGroup;
  /** Saved setups with stable identities, exportable ones first. */
  readonly candidates: readonly RuntimeConfigShareCandidate[];
  readonly exportable: readonly RuntimeConfigShareCandidate[];
};

export type RuntimeConfigShareInventory = {
  /** Uses with at least one setup that exports cleanly. */
  readonly shareable: readonly RuntimeConfigShareUse[];
  /** Uses whose saved setups all fail the export probe. */
  readonly blocked: readonly RuntimeConfigShareUse[];
};

export function probeRuntimeConfigShareExport(
  loadout: NimiMachineLoadout,
  assets: readonly NimiRuntimeModelAssetRecord[],
): RuntimeConfigShareBlockReason | null {
  const detail = loadout.reasons.filter((reason) => reason.trim()).join('; ');
  if (loadout.validationState === 'blocked') return { kind: 'blocked', detail };
  if (loadout.validationState === 'unresolved') return { kind: 'unresolved', detail };
  try {
    exportRuntimeConfigAIProfileFromLoadouts({
      profileId: 'profile.share-probe',
      title: 'probe',
      loadouts: [loadout],
      assets,
    });
    return null;
  } catch (error) {
    return { kind: 'assets', detail: error instanceof Error ? error.message : String(error) };
  }
}

export function buildRuntimeConfigShareInventory(input: {
  readonly loadouts: readonly NimiMachineLoadout[];
  readonly selections: readonly NimiLoadoutSelection[];
  readonly assets: readonly NimiRuntimeModelAssetRecord[];
}): RuntimeConfigShareInventory {
  const selectedByUse = new Map(input.selections.map((selection) => [selection.capabilityContract, selection.loadoutId]));
  const byUse = new Map<string, NimiMachineLoadout[]>();
  for (const loadout of input.loadouts) {
    byUse.set(loadout.capabilityContract, [...(byUse.get(loadout.capabilityContract) ?? []), loadout]);
  }
  const shareable: RuntimeConfigShareUse[] = [];
  const blocked: RuntimeConfigShareUse[] = [];
  for (const [capabilityContract, loadouts] of byUse) {
    const currentId = selectedByUse.get(capabilityContract);
    const candidates = loadouts
      .map((loadout): RuntimeConfigShareCandidate => ({
        loadout,
        current: loadout.loadoutId === currentId,
        block: probeRuntimeConfigShareExport(loadout, input.assets),
      }))
      .sort((left, right) => Number(Boolean(left.block)) - Number(Boolean(right.block))
        || Number(right.current) - Number(left.current)
        || left.loadout.createdAt.localeCompare(right.loadout.createdAt));
    const exportable = candidates.filter((candidate) => !candidate.block);
    const use: RuntimeConfigShareUse = { capabilityContract, group: capabilityGroup(capabilityContract), candidates, exportable };
    (exportable.length > 0 ? shareable : blocked).push(use);
  }
  const order = (left: RuntimeConfigShareUse, right: RuntimeConfigShareUse) =>
    GROUP_ORDER.indexOf(left.group) - GROUP_ORDER.indexOf(right.group)
    || left.capabilityContract.localeCompare(right.capabilityContract);
  return Object.freeze({ shareable: shareable.sort(order), blocked: blocked.sort(order) });
}

const GROUP_ORDER: readonly CapabilityGroup[] = ['text', 'visual', 'audio', 'other'];

/**
 * What the person has decided per use: a Loadout id to include, or `null`
 * for "leave this use out". Uses absent from the record take the default.
 */
export type RuntimeConfigShareChoices = Readonly<Record<string, string | null>>;

/** Default for one use: the setup in use when it exports, else the first that does. */
export function defaultRuntimeConfigShareChoice(use: RuntimeConfigShareUse): string | null {
  return (use.exportable.find((candidate) => candidate.current) ?? use.exportable[0])?.loadout.loadoutId ?? null;
}

/**
 * Resolves the choices against a (re)loaded inventory: an explicit exclusion
 * survives, including while a use or setup is unavailable. Only a use without
 * a prior choice takes the default. Unavailable choices are omitted from the
 * export until repaired or explicitly changed; they never select a substitute.
 */
export function resolveRuntimeConfigShareChoices(
  inventory: RuntimeConfigShareInventory,
  previous: RuntimeConfigShareChoices,
): RuntimeConfigShareChoices {
  const resolved: Record<string, string | null> = { ...previous };
  for (const use of inventory.shareable) {
    if (previous[use.capabilityContract] === undefined) {
      resolved[use.capabilityContract] = defaultRuntimeConfigShareChoice(use);
    }
  }
  return Object.freeze(resolved);
}

export function includedRuntimeConfigShareLoadouts(
  inventory: RuntimeConfigShareInventory,
  choices: RuntimeConfigShareChoices,
): readonly NimiMachineLoadout[] {
  return inventory.shareable.flatMap((use) => {
    const id = choices[use.capabilityContract];
    const candidate = id ? use.exportable.find((item) => item.loadout.loadoutId === id) : undefined;
    return candidate ? [candidate.loadout] : [];
  });
}

/** File name the export writes; the person's title lives inside the file. */
export function runtimeConfigShareFileName(profileId: string): string {
  return `${profileId}.ai-profile.json`;
}
