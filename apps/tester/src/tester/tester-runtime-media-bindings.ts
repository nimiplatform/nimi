import { COMPANION_SLOTS } from '@nimiplatform/kit/features/model-config/headless';
import {
  listNimiRuntimeLocalAssetEntries,
  toNimiRuntimeProtoStruct,
  toNimiRuntimeVoiceReference,
  type NimiRuntimeLocalAssetEntry,
  type NimiRuntimeSpeechVoiceReference,
} from '@nimiplatform/sdk/runtime';
import type { JsonObject } from '@nimiplatform/sdk/types';
import type {
  ResolvedLLMBinding,
  TesterRuntimeInvocationClient,
} from './tester-runtime-invokers-core.js';

type ImageProfileEntry = JsonObject;
type ImageEntryOverride = JsonObject & {
  readonly entry_id: string;
  readonly local_asset_id: string;
};

type LocalRunnableAssetKind = 'image' | 'tts' | 'stt' | 'video';

export type SpeechSynthesisRuntimeParams = {
  readonly voiceRef?: ReturnType<typeof toNimiRuntimeVoiceReference>;
  readonly language?: string;
  readonly audioFormat: string;
  readonly speed?: number;
  readonly pitch?: number;
  readonly volume?: number;
  readonly timeoutMs?: number;
};

type ImageRuntimeBinding = {
  readonly resolved: ResolvedLLMBinding;
  readonly profileEntries: readonly ImageProfileEntry[];
  readonly entryOverrides?: readonly ImageEntryOverride[];
};

function selectedParamRecord(resolved: ResolvedLLMBinding): Record<string, unknown> {
  return resolved.selectedParams && typeof resolved.selectedParams === 'object' && !Array.isArray(resolved.selectedParams)
    ? resolved.selectedParams as Record<string, unknown>
    : {};
}

function optionalText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function selectedCompanionSlots(params: Record<string, unknown>): Record<string, string> {
  const raw = params.companionSlots;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [slot, value] of Object.entries(raw as Record<string, unknown>)) {
    const normalized = optionalText(value);
    if (slot.trim() && normalized) {
      out[slot.trim()] = normalized;
    }
  }
  return out;
}

function assetMatchesId(asset: NimiRuntimeLocalAssetEntry, id: string): boolean {
  const normalized = optionalText(id);
  return Boolean(normalized) && (
    optionalText(asset.localAssetId) === normalized
    || optionalText(asset.assetId) === normalized
  );
}

function findLocalAssetById(
  assets: readonly NimiRuntimeLocalAssetEntry[],
  id: string,
): NimiRuntimeLocalAssetEntry | null {
  return assets.find((asset) => assetMatchesId(asset, id)) ?? null;
}

export async function resolveLocalRunnableAssetBinding(input: {
  readonly client: TesterRuntimeInvocationClient;
  readonly resolved: ResolvedLLMBinding;
  readonly capabilityId: string;
  readonly assetKind: LocalRunnableAssetKind;
}): Promise<ResolvedLLMBinding> {
  if (input.resolved.routePolicy !== 'local') {
    return input.resolved;
  }
  if (!input.client.runtime.local) {
    throw new Error(`${input.capabilityId} local model binding requires Runtime local asset listing; reload Runtime projection and reselect the active model.`);
  }
  const assets = await listNimiRuntimeLocalAssetEntries({ local: input.client.runtime.local });
  const asset = findLocalAssetById(assets, input.resolved.model);
  if (!asset) {
    throw new Error(`${input.capabilityId} active model ${input.resolved.model} is not present in Runtime local assets; reselect the active model.`);
  }
  if (asset.kind !== input.assetKind) {
    throw new Error(`${input.capabilityId} active model ${input.resolved.model} resolves to local asset kind ${asset.kind}; expected ${input.assetKind}.`);
  }
  const model = asset.assetId || input.resolved.model;
  return {
    ...input.resolved,
    model,
    metadata: {
      ...input.resolved.metadata,
      aiConfigRuntimeModelAssetId: model,
      aiConfigRuntimeModelLocalAssetId: asset.localAssetId,
    },
  };
}

function isJsonRecord(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function configuredImageProfileEntries(params: Record<string, unknown>): ImageProfileEntry[] | null {
  const configuredEntries = Array.isArray(params.profile_entries)
    ? params.profile_entries
    : Array.isArray(params.profileEntries) ? params.profileEntries : null;
  if (!configuredEntries || configuredEntries.length === 0) return null;
  const entries = configuredEntries.filter(isJsonRecord);
  if (entries.length !== configuredEntries.length) {
    throw new Error('image.generate profile_entries must contain only JSON object entries.');
  }
  return entries;
}

function imageEntryAssetId(entry: unknown): string {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return '';
  const record = entry as Record<string, unknown>;
  const slot = optionalText(record.engine_slot ?? record.engineSlot);
  if (slot) return '';
  const kind = optionalText(record.asset_kind ?? record.assetKind).toLowerCase();
  if (kind && kind !== 'image' && kind !== 'local_asset_kind_image') return '';
  return optionalText(record.asset_id ?? record.assetId);
}

function imageModelAssetIdFromConfiguredEntries(entries: readonly unknown[]): string {
  for (const entry of entries) {
    const assetId = imageEntryAssetId(entry);
    if (assetId) return assetId;
  }
  return '';
}

function imageProfileEntryForAsset(input: {
  readonly entryId: string;
  readonly title: string;
  readonly capability: string;
  readonly asset: NimiRuntimeLocalAssetEntry;
  readonly engineSlot?: string;
  readonly required?: boolean;
}): ImageProfileEntry {
  return {
    entry_id: input.entryId,
    kind: 'asset',
    title: input.title,
    capability: input.capability,
    asset_id: input.asset.assetId || input.asset.localAssetId,
    asset_kind: input.asset.kind,
    engine: input.asset.engine,
    ...(input.engineSlot ? { engine_slot: input.engineSlot } : {}),
    ...(typeof input.required === 'boolean' ? { required: input.required } : {}),
  };
}

export async function resolveImageRuntimeBinding(
  client: TesterRuntimeInvocationClient,
  resolved: ResolvedLLMBinding,
): Promise<ImageRuntimeBinding> {
  const params = selectedParamRecord(resolved);
  const configuredEntries = configuredImageProfileEntries(params);
  if (configuredEntries) {
    const configuredModel = imageModelAssetIdFromConfiguredEntries(configuredEntries);
    return {
      resolved: configuredModel ? {
        ...resolved,
        model: configuredModel,
        metadata: {
          ...resolved.metadata,
          aiConfigRuntimeModelAssetId: configuredModel,
        },
      } : resolved,
      profileEntries: configuredEntries,
    };
  }

  if (resolved.routePolicy !== 'local') {
    return {
      resolved,
      profileEntries: [{
        entry_id: 'main-image',
        kind: 'asset',
        title: 'Main image model',
        capability: 'image.generate',
        asset_id: resolved.model,
        asset_kind: 'image',
        engine: 'media',
        required: true,
      }],
    };
  }

  if (!client.runtime.local) {
    throw new Error('image.generate local model binding requires Runtime local asset listing; reload Runtime projection and reselect the Image active model.');
  }
  const assets = await listNimiRuntimeLocalAssetEntries({ local: client.runtime.local });
  const mainAsset = findLocalAssetById(assets, resolved.model);
  if (!mainAsset) {
    throw new Error(`image.generate active model ${resolved.model} is not present in Runtime local assets; reselect the Image active model.`);
  }

  const companionSlots = selectedCompanionSlots(params);
  const profileEntries: ImageProfileEntry[] = [
    imageProfileEntryForAsset({
      entryId: 'main-image',
      title: 'Main image model',
      capability: 'image.generate',
      asset: mainAsset,
      required: true,
    }),
  ];
  const entryOverrides: ImageEntryOverride[] = [{
    entry_id: 'main-image',
    local_asset_id: mainAsset.localAssetId,
  }];

  for (const slot of COMPANION_SLOTS) {
    const selected = companionSlots[slot.slot];
    if (!selected) continue;
    const asset = findLocalAssetById(assets, selected);
    if (!asset) {
      throw new Error(`image.generate companion slot ${slot.slot} references missing Runtime local asset ${selected}; reselect the companion model.`);
    }
    const entryId = `companion-${slot.slot.replace(/_path$/u, '').replace(/[^a-zA-Z0-9._:-]+/gu, '-')}`;
    profileEntries.push(imageProfileEntryForAsset({
      entryId,
      title: `${slot.label} companion`,
      capability: 'image.generate',
      asset,
      engineSlot: slot.slot,
    }));
    entryOverrides.push({
      entry_id: entryId,
      local_asset_id: asset.localAssetId,
    });
  }

  return {
    resolved: {
      ...resolved,
      model: mainAsset.assetId || resolved.model,
      metadata: {
        ...resolved.metadata,
        aiConfigRuntimeModelAssetId: mainAsset.assetId || resolved.model,
        aiConfigRuntimeModelLocalAssetId: mainAsset.localAssetId,
      },
    },
    profileEntries,
    entryOverrides,
  };
}

export function imageProfileExtensions(binding: ImageRuntimeBinding) {
  const params = selectedParamRecord(binding.resolved);
  const {
    companionSlots: _companionSlots,
    profileEntries: _profileEntries,
    profile_entries: _profileEntriesSnake,
    entry_overrides: _entryOverridesSnake,
    entryOverrides: _entryOverrides,
    ...forwardedParams
  } = params;
  return [{
    namespace: 'nimi.scenario.image.request',
    payload: toNimiRuntimeProtoStruct({
      ...forwardedParams,
      profile_entries: binding.profileEntries,
      ...(binding.entryOverrides && binding.entryOverrides.length > 0 ? { entry_overrides: binding.entryOverrides } : {}),
    }),
  }];
}

function parseVoiceReference(value: unknown): NimiRuntimeSpeechVoiceReference | undefined {
  if (!value) return undefined;
  if (typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const kind = optionalText(record.kind);
    if (kind === 'preset_voice_id') {
      return { kind, presetVoiceId: optionalText(record.presetVoiceId ?? record.preset_voice_id) };
    }
    if (kind === 'voice_asset_id') {
      return { kind, voiceAssetId: optionalText(record.voiceAssetId ?? record.voice_asset_id) };
    }
    if (kind === 'provider_voice_ref') {
      return { kind, providerVoiceRef: optionalText(record.providerVoiceRef ?? record.provider_voice_ref) };
    }
    const providerVoiceRef = optionalText(record.providerVoiceRef ?? record.provider_voice_ref);
    if (providerVoiceRef) return { kind: 'provider_voice_ref', providerVoiceRef };
    const presetVoiceId = optionalText(record.presetVoiceId ?? record.preset_voice_id);
    if (presetVoiceId) return { kind: 'preset_voice_id', presetVoiceId };
    const voiceAssetId = optionalText(record.voiceAssetId ?? record.voice_asset_id);
    if (voiceAssetId) return { kind: 'voice_asset_id', voiceAssetId };
    return undefined;
  }
  const text = optionalText(value);
  if (!text) return undefined;
  const [prefix, ...rest] = text.split(':');
  const payload = rest.join(':').trim();
  if (prefix === 'preset_voice_id' && payload) return { kind: 'preset_voice_id', presetVoiceId: payload };
  if (prefix === 'voice_asset_id' && payload) return { kind: 'voice_asset_id', voiceAssetId: payload };
  if (prefix === 'provider_voice_ref' && payload) return { kind: 'provider_voice_ref', providerVoiceRef: payload };
  return { kind: 'provider_voice_ref', providerVoiceRef: text };
}

function voiceReferenceFromParams(resolved: ResolvedLLMBinding) {
  const params = selectedParamRecord(resolved);
  return toNimiRuntimeVoiceReference(parseVoiceReference(
    params.voiceRef
    ?? params.voice_ref
    ?? params.providerVoiceRef
    ?? params.provider_voice_ref
    ?? params.presetVoiceId
    ?? params.preset_voice_id
    ?? params.voiceAssetId
    ?? params.voice_asset_id,
  ));
}

function optionalFiniteNumber(value: unknown, fieldName: string): number | undefined {
  const raw = typeof value === 'number' ? String(value) : optionalText(value);
  if (!raw || raw.toLowerCase() === 'default' || raw.toLowerCase() === 'auto') return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`audio.synthesize ${fieldName} must be a finite number.`);
  }
  return parsed;
}

function positiveInteger(value: unknown, fieldName: string): number | undefined {
  const parsed = optionalFiniteNumber(value, fieldName);
  if (parsed === undefined) return undefined;
  const rounded = Math.floor(parsed);
  if (rounded <= 0) {
    throw new Error(`audio.synthesize ${fieldName} must be greater than zero.`);
  }
  return rounded;
}

export function speechSynthesisParamsFromBinding(resolved: ResolvedLLMBinding): SpeechSynthesisRuntimeParams {
  const params = selectedParamRecord(resolved);
  const audioFormat = optionalText(params.responseFormat ?? params.response_format ?? params.audioFormat ?? params.audio_format) || 'mp3';
  return {
    voiceRef: voiceReferenceFromParams(resolved),
    language: optionalText(params.languageHint ?? params.language_hint ?? params.language) || undefined,
    audioFormat,
    speed: optionalFiniteNumber(params.speakingRate ?? params.speaking_rate ?? params.speed, 'speakingRate'),
    pitch: optionalFiniteNumber(params.pitchSemitones ?? params.pitch_semitones ?? params.pitch, 'pitchSemitones'),
    volume: optionalFiniteNumber(params.volume, 'volume'),
    timeoutMs: positiveInteger(params.timeoutMs ?? params.timeout_ms, 'timeoutMs'),
  };
}
