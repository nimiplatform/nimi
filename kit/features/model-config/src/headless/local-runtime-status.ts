import type { NimiAIConfig, NimiAIConfigTargetRef } from '@nimiplatform/kit/core/sdk-contract';
import type { ModelConfigProjectionStatus } from '@nimiplatform/kit/core/model-config';
import { resolveImageCompanionSlotsForModelFamily } from '../constants.js';
import type { LocalAssetEntry } from '../types.js';

export interface ResolveModelConfigLocalRuntimeStatusInput {
  readonly capabilityId: string;
  readonly config: NimiAIConfig;
  readonly targetRef: NimiAIConfigTargetRef | null;
  readonly assets: readonly LocalAssetEntry[];
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function localRuntimeRefCandidates(value: unknown): string[] {
  const normalized = normalizeText(value);
  if (!normalized) {
    return [];
  }
  const candidates = [
    normalized,
    ...normalized.split(':').map((part) => part.trim()).filter(Boolean),
  ];
  const prefix = 'local-runtime:';
  if (normalized.toLowerCase().startsWith(prefix)) {
    const localAssetId = normalized.slice(prefix.length).trim();
    if (localAssetId) {
      candidates.push(localAssetId);
    }
  }
  return [...new Set(candidates)];
}

function targetRefCandidateTexts(targetRef: NimiAIConfigTargetRef | null): string[] {
  if (!targetRef || targetRef.kind !== 'local-runtime') {
    return [];
  }
  return [
    ...localRuntimeRefCandidates(targetRef.profileBindingId),
    ...localRuntimeRefCandidates(targetRef.readinessRef),
  ].filter(Boolean);
}

function localAssetMatchesCandidate(asset: LocalAssetEntry, candidate: string): boolean {
  return normalizeText(asset.localAssetId) === candidate
    || normalizeText(asset.assetId) === candidate;
}

export function findLocalAssetForTargetRef(
  assets: readonly LocalAssetEntry[],
  targetRef: NimiAIConfigTargetRef | null,
): LocalAssetEntry | null {
  const candidates = targetRefCandidateTexts(targetRef);
  if (candidates.length === 0) {
    return null;
  }
  return assets.find((asset) => candidates.some((candidate) => localAssetMatchesCandidate(asset, candidate))) ?? null;
}

function selectedParamsRecord(config: NimiAIConfig, capabilityId: string): Record<string, unknown> {
  const raw = config.capabilities.selectedParams?.[capabilityId];
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
}

function selectedCompanionSlots(config: NimiAIConfig): Record<string, string> {
  const raw = selectedParamsRecord(config, 'image.generate').companionSlots;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [slot, value] of Object.entries(raw as Record<string, unknown>)) {
    const normalized = normalizeText(value);
    if (normalized) {
      out[slot] = normalized;
    }
  }
  return out;
}

function isLocalAssetRunnableStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase();
  return normalized === 'active' || normalized === 'installed';
}

function assetLabel(asset: LocalAssetEntry): string {
  return asset.assetId || asset.localAssetId;
}

function localAssetFamily(asset: LocalAssetEntry | null): string {
  if (!asset) return '';
  const extensible = asset as LocalAssetEntry & {
    readonly family?: unknown;
    readonly modelFamily?: unknown;
    readonly model_family?: unknown;
    readonly metadata?: Readonly<Record<string, unknown>>;
  };
  return normalizeText(
    extensible.modelFamily
    ?? extensible.model_family
    ?? extensible.family
    ?? extensible.metadata?.modelFamily
    ?? extensible.metadata?.model_family
    ?? extensible.metadata?.family,
  );
}

function imageModelFamilyForSetup(input: {
  readonly config: NimiAIConfig;
  readonly targetRef: NimiAIConfigTargetRef | null;
  readonly mainAsset: LocalAssetEntry | null;
}): string {
  const params = selectedParamsRecord(input.config, 'image.generate');
  return normalizeText(
    params.modelFamily
    ?? params.model_family
    ?? params.runtimeModelFamily
    ?? params.runtime_model_family,
  ) || localAssetFamily(input.mainAsset);
}

function localRuntimeTargetRefFromCandidate(candidate: string): NimiAIConfigTargetRef {
  return {
    kind: 'local-runtime',
    version: 'v2',
    profileBindingId: candidate,
  };
}

export function resolveModelConfigLocalRuntimeStatus(
  input: ResolveModelConfigLocalRuntimeStatusInput,
): ModelConfigProjectionStatus | null {
  if (input.targetRef?.kind !== 'local-runtime') {
    return null;
  }

  const mainAsset = findLocalAssetForTargetRef(input.assets, input.targetRef);
  if (mainAsset && !isLocalAssetRunnableStatus(mainAsset.status)) {
    return {
      supported: false,
      tone: 'attention',
      badgeLabel: 'Needs setup',
      title: 'Local model setup required',
      detail: `${assetLabel(mainAsset)} is ${mainAsset.status}; confirm or activate it before running ${input.capabilityId}.`,
    };
  }

  if (input.capabilityId !== 'image.generate') {
    return null;
  }

  const companionSlots = selectedCompanionSlots(input.config);
  const requiredCompanionSlots = resolveImageCompanionSlotsForModelFamily(
    imageModelFamilyForSetup({
      config: input.config,
      targetRef: input.targetRef,
      mainAsset,
    }),
  ).filter((slot) => slot.required);
  const missingRequired = requiredCompanionSlots
    .filter((slot) => !normalizeText(companionSlots[slot.slot]))
    .map((slot) => slot.label);
  if (missingRequired.length > 0) {
    return {
      supported: false,
      tone: 'attention',
      badgeLabel: 'Needs setup',
      title: 'Required companion models missing',
      detail: `Set ${missingRequired.join(', ')} before running Image Generate with this local model.`,
    };
  }

  for (const slot of requiredCompanionSlots) {
    const selected = normalizeText(companionSlots[slot.slot]);
    if (!selected) continue;
    const asset = findLocalAssetForTargetRef(input.assets, localRuntimeTargetRefFromCandidate(selected));
    if (asset && !isLocalAssetRunnableStatus(asset.status)) {
      return {
        supported: false,
        tone: 'attention',
        badgeLabel: 'Needs setup',
        title: 'Required companion setup pending',
        detail: `${slot.label} ${assetLabel(asset)} is ${asset.status}; confirm or activate it before running Image Generate.`,
      };
    }
  }

  return null;
}
