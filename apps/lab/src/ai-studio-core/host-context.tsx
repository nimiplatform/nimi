import { createContext, useContext, type ReactNode } from 'react';
import type { NimiPortableAppAIConfig } from '@nimiplatform/sdk/ai';
import type { NimiLocalAppArtifactImageMime } from '@nimiplatform/sdk/app';
import type { StudioCapabilityRunInput, StudioCapabilityRunResult } from './runtime-types.js';
import type { StudioCapabilityDescriptor } from './module-registration.js';
import type { StudioRunTargetSummary } from './history.js';

export type StudioPromptDraftKey = {
  readonly surfaceId: 'ai-capabilities';
  readonly capabilityId: string;
  readonly scenarioId: string;
};

export type StudioHostCommandResult<TValue extends object = Record<string, never>> =
  | { readonly ok: true; readonly value?: TValue }
  | { readonly ok: false; readonly error?: unknown };

export type AIStudioHostPort = {
  readonly appTitle: string;
  readonly translate: (key: string, values?: Readonly<Record<string, unknown>>) => string;
  readonly locale: string;
  readonly clock: {
    readonly now: () => number;
  };
  readonly app: {
    readonly projection: {
      readonly promptDraft: (key: StudioPromptDraftKey, enabled: boolean) => { readonly prompt: string | null };
      readonly projectRunTarget: (input: {
        readonly capability: StudioCapabilityDescriptor;
        readonly runtime: import('./runtime-types.js').StudioRuntimeInspection | null;
        readonly config: NimiPortableAppAIConfig | null;
        readonly configState: 'loading' | 'loaded' | 'failed';
        readonly configError: string | null;
      }) => StudioRunTargetSummary;
      readonly runStatusLabel: (status: string) => string;
    };
    readonly events: {
      readonly subscribeAIConfigRefresh: (listener: () => void) => () => void;
    };
    readonly commands: {
      readonly savePromptDraft: (key: StudioPromptDraftKey, prompt: string, enabled: boolean) => Promise<unknown>;
      readonly copyText: (text: string) => Promise<StudioHostCommandResult<{ readonly copied: boolean }>>;
      readonly exportText: (input: { readonly filename: string; readonly body: string }) => Promise<unknown>;
      readonly exportArtifact: (input: { readonly filename: string; readonly url: string }) => Promise<unknown>;
    };
  };
  readonly sdk: {
    readonly runCapability: (input: StudioCapabilityRunInput) => Promise<StudioCapabilityRunResult>;
    readonly listLocalAppVoiceAssets: () => Promise<readonly {
      readonly voiceAssetId: string;
      readonly creationSource: string;
      readonly status: string;
    }[]>;
    readonly uploadLocalAppArtifact: (input: {
      readonly bytes: Uint8Array;
      readonly mimeType: NimiLocalAppArtifactImageMime;
    }) => Promise<{
      readonly artifactId: string;
      readonly sizeBytes: number;
      readonly mimeType: NimiLocalAppArtifactImageMime;
    }>;
    readonly aiConfig: {
      readonly get: () => Promise<NimiPortableAppAIConfig | null>;
    };
  };
};

const AIStudioHostContext = createContext<AIStudioHostPort | null>(null);

export function AIStudioHostProvider({
  value,
  children,
}: {
  readonly value: AIStudioHostPort;
  readonly children: ReactNode;
}) {
  return <AIStudioHostContext.Provider value={value}>{children}</AIStudioHostContext.Provider>;
}

export function useAIStudioHost(): AIStudioHostPort {
  const host = useContext(AIStudioHostContext);
  if (!host) throw new Error('AI_STUDIO_HOST_UNAVAILABLE');
  return host;
}
