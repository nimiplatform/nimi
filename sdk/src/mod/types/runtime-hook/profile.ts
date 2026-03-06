import type { HookSourceType } from './shared.js';

export type RuntimeHookAgentProfileReadInput = {
  modId: string;
  sourceType?: HookSourceType;
  viewerUserId?: string;
  ownerAgentId: string;
  worldId?: string;
  profile: Record<string, unknown>;
};

export type RuntimeHookAgentProfileReadResult = {
  referenceImageUrl?: string | null;
};

export type RuntimeHookProfileFacade = {
  registerAgentProfileReadFilter: (input: {
    modId: string;
    sourceType?: HookSourceType;
    handler: (
      input: Omit<RuntimeHookAgentProfileReadInput, 'modId' | 'sourceType'>,
    ) => Promise<RuntimeHookAgentProfileReadResult> | RuntimeHookAgentProfileReadResult;
  }) => Promise<void>;
  unregisterAgentProfileReadFilter: (input: {
    modId: string;
  }) => boolean;
};

export type HookProfileClient = {
  registerAgentReadFilter: (input: {
    handler: (
      input: Omit<RuntimeHookAgentProfileReadInput, 'modId' | 'sourceType'>,
    ) => Promise<RuntimeHookAgentProfileReadResult> | RuntimeHookAgentProfileReadResult;
  }) => Promise<void>;
  unregisterAgentReadFilter: () => boolean;
};
