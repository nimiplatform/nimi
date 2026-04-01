export type RelayLocalAssetKind =
  | 'chat'
  | 'image'
  | 'video'
  | 'tts'
  | 'stt'
  | 'vae'
  | 'clip'
  | 'lora'
  | 'controlnet'
  | 'auxiliary';

export type RelayLocalProfileEntryOverride = {
  entryId: string;
  localAssetId: string;
};

export type RelayLocalImageProfileEntry = {
  entryId: string;
  kind: 'asset';
  capability: 'image';
  assetId: string;
  assetKind: RelayLocalAssetKind;
  engine: string;
  title: string;
  required: boolean;
  preferred?: boolean;
  engineSlot?: string;
  templateId?: string;
};

export type RelayLocalImageProfile = {
  id: string;
  title: string;
  description: string;
  mainAssetId: string;
  mainAssetEngine: string;
  entries: RelayLocalImageProfileEntry[];
};

export const RELAY_LOCAL_IMAGE_PROFILES: RelayLocalImageProfile[] = [
  {
    id: 'local-chat-default',
    title: 'Default local image stack',
    description: 'Z-Image Turbo with Z-Image AE VAE and Qwen3 4B text encoder.',
    mainAssetId: 'local/z_image_turbo',
    mainAssetEngine: 'media',
    entries: [
      {
        entryId: 'local-chat/image-z-image-turbo',
        kind: 'asset',
        capability: 'image',
        assetId: 'local/z_image_turbo',
        assetKind: 'image',
        engine: 'media',
        title: 'Z-Image Turbo (GGUF)',
        required: true,
        preferred: true,
      },
      {
        entryId: 'local-chat/image-z-image-ae',
        kind: 'asset',
        capability: 'image',
        assetId: 'local/z_image_ae',
        assetKind: 'vae',
        engine: 'media',
        engineSlot: 'vae_path',
        title: 'Z-Image AE VAE',
        required: true,
        preferred: true,
        templateId: 'verified.asset.z_image.vae',
      },
      {
        entryId: 'local-chat/image-qwen3-4b-text-encoder',
        kind: 'asset',
        capability: 'image',
        assetId: 'local/qwen3_4b',
        assetKind: 'chat',
        engine: 'media',
        engineSlot: 'llm_path',
        title: 'Qwen3 4B Text Encoder',
        required: true,
        preferred: true,
        templateId: 'verified.asset.z_image.qwen3_4b',
      },
    ],
  },
  {
    id: 'local-chat-compact',
    title: 'Compact local image stack',
    description: 'Compact image stack with the same verified dependencies.',
    mainAssetId: 'local/z_image_turbo',
    mainAssetEngine: 'media',
    entries: [
      {
        entryId: 'local-chat/image-z-image-turbo',
        kind: 'asset',
        capability: 'image',
        assetId: 'local/z_image_turbo',
        assetKind: 'image',
        engine: 'media',
        title: 'Z-Image Turbo (GGUF)',
        required: true,
        preferred: true,
      },
      {
        entryId: 'local-chat/image-z-image-ae',
        kind: 'asset',
        capability: 'image',
        assetId: 'local/z_image_ae',
        assetKind: 'vae',
        engine: 'media',
        engineSlot: 'vae_path',
        title: 'Z-Image AE VAE',
        required: true,
        preferred: true,
        templateId: 'verified.asset.z_image.vae',
      },
      {
        entryId: 'local-chat/image-qwen3-4b-text-encoder',
        kind: 'asset',
        capability: 'image',
        assetId: 'local/qwen3_4b',
        assetKind: 'chat',
        engine: 'media',
        engineSlot: 'llm_path',
        title: 'Qwen3 4B Text Encoder',
        required: true,
        preferred: true,
        templateId: 'verified.asset.z_image.qwen3_4b',
      },
    ],
  },
];

export function findRelayLocalImageProfile(profileId: string): RelayLocalImageProfile | null {
  const normalized = String(profileId || '').trim();
  if (!normalized) {
    return null;
  }
  return RELAY_LOCAL_IMAGE_PROFILES.find((profile) => profile.id === normalized) || null;
}

export function normalizeRelayLocalProfileEntryOverrides(value: unknown): RelayLocalProfileEntryOverride[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return null;
      }
      const record = item as Record<string, unknown>;
      const entryId = String(record.entryId || record.entry_id || '').trim();
      const localAssetId = String(record.localAssetId || record.local_asset_id || '').trim();
      if (!entryId || !localAssetId) {
        return null;
      }
      return { entryId, localAssetId };
    })
    .filter((item): item is RelayLocalProfileEntryOverride => Boolean(item));
}

export function buildRelayLocalImageProfileExtensions(input: {
  profileId: string;
  entryOverrides?: RelayLocalProfileEntryOverride[];
}): Record<string, unknown> | undefined {
  const profile = findRelayLocalImageProfile(input.profileId);
  if (!profile) {
    return undefined;
  }
  const entryOverrides = normalizeRelayLocalProfileEntryOverrides(input.entryOverrides);
  const extensions: Record<string, unknown> = {
    profile_entries: profile.entries.map((entry) => ({
      entryId: entry.entryId,
      kind: entry.kind,
      capability: entry.capability,
      title: entry.title,
      required: entry.required,
      preferred: entry.preferred === true,
      assetId: entry.assetId,
      assetKind: entry.assetKind,
      engine: entry.engine,
      engineSlot: entry.engineSlot,
      templateId: entry.templateId,
    })),
  };
  if (entryOverrides.length > 0) {
    extensions.entry_overrides = entryOverrides.map((item) => ({
      entry_id: item.entryId,
      local_asset_id: item.localAssetId,
    }));
  }
  return extensions;
}

export function relayLocalImageProfileRequestedModel(profileId: string): string | null {
  const profile = findRelayLocalImageProfile(profileId);
  if (!profile) {
    return null;
  }
  return `${profile.mainAssetEngine}/${profile.mainAssetId}`;
}
