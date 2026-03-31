// RL-PIPE-006 — Product settings state in renderer
// Fetched from main process, updated via IPC

import { create } from 'zustand';
import { getBridge } from '../../bridge/electron-bridge.js';
import type { JsonObject } from '../../../shared/json.js';

export type ImageWorkflowComponent = {
  slot: string;
  localArtifactId: string;
};

export type MediaAutonomy = 'off' | 'explicit-only' | 'natural';
export type VoiceAutonomy = 'off' | 'explicit-only' | 'natural';
export type VisualComfortLevel = 'text-only' | 'restrained-visuals' | 'natural-visuals';

export interface ProductSettings {
  mediaAutonomy: MediaAutonomy;
  voiceAutonomy: VoiceAutonomy;
  voiceConversationMode: 'off' | 'on';
  visualComfortLevel: VisualComfortLevel;
  allowProactiveContact: boolean;
  autoPlayVoiceReplies: boolean;
}

export interface InspectSettings {
  imageRouteSource: 'auto' | 'local' | 'cloud';
  imageConnectorId: string;
  imageModel: string;
  imageLocalModelId: string;
  imageWorkflowComponents: ImageWorkflowComponent[];
  imageProfileOverrides: JsonObject | null;
  videoConnectorId: string;
  videoModel: string;
  ttsConnectorId: string;
  ttsModel: string;
  ttsVoiceId: string;
  sttConnectorId: string;
  sttModel: string;
}

const DEFAULT_PRODUCT_SETTINGS: ProductSettings = {
  mediaAutonomy: 'natural',
  voiceAutonomy: 'natural',
  voiceConversationMode: 'off',
  visualComfortLevel: 'natural-visuals',
  allowProactiveContact: true,
  autoPlayVoiceReplies: false,
};

const DEFAULT_INSPECT_SETTINGS: InspectSettings = {
  imageRouteSource: 'auto',
  imageConnectorId: '',
  imageModel: '',
  imageLocalModelId: '',
  imageWorkflowComponents: [],
  imageProfileOverrides: null,
  videoConnectorId: '',
  videoModel: '',
  ttsConnectorId: '',
  ttsModel: '',
  ttsVoiceId: '',
  sttConnectorId: '',
  sttModel: '',
};

export interface SettingsState {
  product: ProductSettings;
  inspect: InspectSettings;
  loaded: boolean;
  saveError: string | null;
  lastSavedAt: number | null;
  setProduct: (settings: ProductSettings) => void;
  updateProduct: (patch: Partial<ProductSettings>) => void;
  updateInspect: (patch: Partial<InspectSettings>) => void;
  load: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  product: { ...DEFAULT_PRODUCT_SETTINGS },
  inspect: { ...DEFAULT_INSPECT_SETTINGS },
  loaded: false,
  saveError: null,
  lastSavedAt: null,

  setProduct: (settings) => set({ product: settings, loaded: true, saveError: null }),

  updateProduct: async (patch) => {
    const previous = get().product;
    const next = { ...get().product, ...patch };
    set({ product: next, saveError: null });
    try {
      await getBridge().chat.settings.set({ product: next });
      set({ lastSavedAt: Date.now(), saveError: null });
    } catch (error) {
      console.error('[relay:settings] failed to save product settings', error);
      set({
        product: previous,
        saveError: error instanceof Error ? error.message : 'Failed to save settings',
      });
    }
  },

  updateInspect: async (patch) => {
    const previous = get().inspect;
    const next = { ...get().inspect, ...patch };
    set({ inspect: next, saveError: null });
    try {
      await getBridge().chat.settings.set({ inspect: next });
      set({ lastSavedAt: Date.now(), saveError: null });
    } catch (error) {
      console.error('[relay:settings] failed to save inspect settings', error);
      set({
        inspect: previous,
        saveError: error instanceof Error ? error.message : 'Failed to save settings',
      });
    }
  },

  load: async () => {
    try {
      const result = await getBridge().chat.settings.get();
      if (result) {
        set({
          product: result.product ?? { ...DEFAULT_PRODUCT_SETTINGS },
          inspect: {
            ...DEFAULT_INSPECT_SETTINGS,
            ...pickInspectFields(result.inspect),
          },
          loaded: true,
          saveError: null,
        });
      } else {
        set({ loaded: true, saveError: null });
      }
    } catch (error) {
      set({
        loaded: true,
        saveError: error instanceof Error ? error.message : 'Failed to load settings',
      });
    }
  },
}));

function pickInspectFields(value: unknown): Partial<InspectSettings> {
  if (!value || typeof value !== 'object') return {};
  const r = value as Record<string, unknown>;
  const result: Partial<InspectSettings> = {};
  const imageRouteSource = typeof r.imageRouteSource === 'string' ? r.imageRouteSource.trim() : '';
  if (imageRouteSource === 'auto' || imageRouteSource === 'local' || imageRouteSource === 'cloud') {
    result.imageRouteSource = imageRouteSource;
  }
  for (const key of [
    'imageConnectorId', 'imageModel', 'imageLocalModelId',
    'videoConnectorId', 'videoModel',
    'ttsConnectorId', 'ttsModel', 'ttsVoiceId',
    'sttConnectorId', 'sttModel',
  ] as const) {
    if (typeof r[key] === 'string') {
      result[key] = r[key].trim() as InspectSettings[typeof key];
    }
  }
  if (Array.isArray(r.imageWorkflowComponents)) {
    result.imageWorkflowComponents = r.imageWorkflowComponents
      .map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          return null;
        }
        const record = item as Record<string, unknown>;
        const slot = typeof record.slot === 'string' ? record.slot.trim() : '';
        const localArtifactId = typeof record.localArtifactId === 'string' ? record.localArtifactId.trim() : '';
        if (!slot || !localArtifactId) {
          return null;
        }
        return { slot, localArtifactId };
      })
      .filter((item): item is ImageWorkflowComponent => item !== null);
  }
  if (r.imageProfileOverrides && typeof r.imageProfileOverrides === 'object' && !Array.isArray(r.imageProfileOverrides)) {
    result.imageProfileOverrides = r.imageProfileOverrides as JsonObject;
  }
  // Map voiceName (main process canonical field) → ttsVoiceId (renderer field)
  if (!result.ttsVoiceId && typeof r.voiceName === 'string' && r.voiceName) {
    result.ttsVoiceId = r.voiceName;
  }
  return result;
}
