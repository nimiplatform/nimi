// RL-PIPE-006 — Product settings state in renderer
// Fetched from main process, updated via IPC

import { create } from 'zustand';
import { getBridge } from '../../bridge/electron-bridge.js';

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

const DEFAULT_PRODUCT_SETTINGS: ProductSettings = {
  mediaAutonomy: 'natural',
  voiceAutonomy: 'natural',
  voiceConversationMode: 'off',
  visualComfortLevel: 'natural-visuals',
  allowProactiveContact: true,
  autoPlayVoiceReplies: false,
};

export interface SettingsState {
  product: ProductSettings;
  loaded: boolean;
  setProduct: (settings: ProductSettings) => void;
  updateProduct: (patch: Partial<ProductSettings>) => void;
  load: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  product: { ...DEFAULT_PRODUCT_SETTINGS },
  loaded: false,

  setProduct: (settings) => set({ product: settings, loaded: true }),

  updateProduct: async (patch) => {
    const next = { ...get().product, ...patch };
    set({ product: next });
    try {
      await getBridge().chat.settings.set({ product: next });
    } catch {
      // Settings save failed — UI stays updated, next load will reconcile
    }
  },

  load: async () => {
    try {
      const result = await getBridge().chat.settings.get();
      if (result?.product) {
        set({ product: result.product, loaded: true });
      } else {
        set({ loaded: true });
      }
    } catch {
      set({ loaded: true });
    }
  },
}));
