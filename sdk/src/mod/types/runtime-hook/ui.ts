import type { HookSourceType } from './shared';

export type RuntimeHookUiFacade = {
  registerUIExtensionV2: (input: {
    modId: string;
    sourceType?: HookSourceType;
    slot: string;
    priority?: number;
    extension: Record<string, unknown>;
  }) => Promise<void>;
  unregisterUIExtension: (input: {
    modId: string;
    slot?: string;
  }) => number;
  resolveUIExtensions: (slot: string) => Array<{
    modId: string;
    slot: string;
    priority: number;
    extension: Record<string, unknown>;
  }>;
  listUISlots: () => string[];
};

export type HookUiClient = {
  register: (input: {
    slot: string;
    priority?: number;
    extension: Record<string, unknown>;
  }) => Promise<void>;
  unregister: (input?: { slot?: string }) => number;
  resolve: (slot: string) => Array<{
    modId: string;
    slot: string;
    priority: number;
    extension: Record<string, unknown>;
  }>;
  listSlots: () => string[];
};
