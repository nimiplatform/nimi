export interface NimiRuntimeImageCompanionSlotContract {
  readonly role: string;
  readonly engineSlot: string;
  readonly label: string;
  readonly componentKind: string;
  readonly assetKind: string;
  readonly required: boolean;
}

export interface NimiRuntimeImageModelFamilyOption {
  readonly value: string;
  readonly label: string;
}

const IMAGE_COMPANION_LLM: NimiRuntimeImageCompanionSlotContract = {
  role: 'text_encoder',
  engineSlot: 'llm_path',
  label: 'LLM',
  componentKind: 'chat',
  assetKind: 'chat',
  required: true,
};

const IMAGE_COMPANION_VAE: NimiRuntimeImageCompanionSlotContract = {
  role: 'vae',
  engineSlot: 'vae_path',
  label: 'VAE',
  componentKind: 'vae',
  assetKind: 'vae',
  required: true,
};

const IMAGE_COMPANION_UNCOND_DIFFUSION: NimiRuntimeImageCompanionSlotContract = {
  role: 'uncond_diffusion_model',
  engineSlot: 'uncond_diffusion_model',
  label: 'Uncond diffusion',
  componentKind: 'image',
  assetKind: 'image',
  required: true,
};

const IMAGE_MODEL_FAMILY_COMPANION_SLOTS: Readonly<Record<string, readonly NimiRuntimeImageCompanionSlotContract[]>> = {
  ideogram4: [
    IMAGE_COMPANION_UNCOND_DIFFUSION,
    IMAGE_COMPANION_LLM,
    IMAGE_COMPANION_VAE,
  ],
  'z-image': [
    IMAGE_COMPANION_LLM,
    IMAGE_COMPANION_VAE,
  ],
  'z-image-turbo': [
    IMAGE_COMPANION_LLM,
    IMAGE_COMPANION_VAE,
  ],
};

export const NIMI_RUNTIME_IMAGE_MODEL_FAMILY_OPTIONS: readonly NimiRuntimeImageModelFamilyOption[] = [
  { value: 'ideogram4', label: 'Ideogram4' },
  { value: 'z-image', label: 'Z-Image Base' },
  { value: 'z-image-turbo', label: 'Z-Image Turbo' },
];

export function normalizeNimiRuntimeImageModelFamily(value: unknown): string {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replaceAll('_', '-');
  if (normalized === 'z-image-base') return 'z-image';
  return normalized;
}

export function resolveNimiRuntimeImageCompanionSlots(
  modelFamily: unknown,
): readonly NimiRuntimeImageCompanionSlotContract[] {
  const normalized = normalizeNimiRuntimeImageModelFamily(modelFamily);
  const slots = IMAGE_MODEL_FAMILY_COMPANION_SLOTS[normalized] ?? [];
  return slots.map((slot) => ({ ...slot }));
}
