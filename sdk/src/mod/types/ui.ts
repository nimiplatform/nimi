import type { JsonObject } from '../../internal/utils.js';
import type { HookSourceType } from './shared';

export type RuntimeHookUiFacade = {
  registerUIExtensionV2: (input: {
    modId: string;
    sourceType?: HookSourceType;
    slot: string;
    priority?: number;
    extension: JsonObject;
  }) => Promise<void>;
  unregisterUIExtension: (input: {
    modId: string;
    slot?: string;
  }) => number;
  resolveUIExtensions: (slot: string) => Array<{
    modId: string;
    slot: string;
    priority: number;
    extension: JsonObject;
  }>;
  listUISlots: () => string[];
};

export type HookUiClient = {
  register: (input: {
    slot: string;
    priority?: number;
    extension: JsonObject;
  }) => Promise<void>;
  unregister: (input?: { slot?: string }) => number;
  resolve: (slot: string) => Array<{
    modId: string;
    slot: string;
    priority: number;
    extension: JsonObject;
  }>;
  listSlots: () => string[];
};
