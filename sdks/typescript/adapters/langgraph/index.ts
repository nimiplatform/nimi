import type { NimiAiModel } from '../../core/ai';
import { textPart, type NimiCapabilityManifest, type NimiMessage } from '../../core/contracts';

export const NIMI_LANGGRAPH_ADAPTER_ID = 'langgraph' as const;
export const NIMI_LANGGRAPH_UNSUPPORTED_FEATURE_CODE = 'SDK_ADAPTER_FEATURE_UNSUPPORTED' as const;

export const NIMI_LANGGRAPH_ADAPTER_MANIFEST = {
  adapterId: NIMI_LANGGRAPH_ADAPTER_ID,
  targetLibrary: 'LangGraph',
  targetVersionRange: 'structural-node-v1',
  capabilityLevel: 'L1',
  capabilities: {
    'node.generate': { support: 'supported', mode: 'adapter-mapped' },
    'node.toolMapping': { support: 'unsupported', mode: 'adapter-mapped' },
    checkpointResume: { support: 'unsupported', mode: 'adapter-mapped' },
    workflowCheckpoint: { support: 'unsupported', mode: 'adapter-mapped' },
  },
  unsupportedBehavior: 'throw',
} as const satisfies NimiCapabilityManifest;

export interface NimiLangGraphState {
  readonly messages: readonly NimiMessage[];
}

export class NimiLangGraphUnsupportedFeatureError extends Error {
  readonly code = NIMI_LANGGRAPH_UNSUPPORTED_FEATURE_CODE;
  readonly feature: string;

  constructor(feature: string) {
    super(feature);
    this.name = 'NimiLangGraphUnsupportedFeatureError';
    this.feature = feature;
  }
}

export function throwUnsupportedLangGraphFeature(feature: string): never {
  throw new NimiLangGraphUnsupportedFeatureError(feature);
}

export interface NimiLangGraphAdapter {
  readonly manifest: typeof NIMI_LANGGRAPH_ADAPTER_MANIFEST;
  readonly node: (state: NimiLangGraphState) => Promise<NimiLangGraphState>;
  readonly checkpointResume: () => never;
}

export function createNimiLangGraphAdapter(options: { readonly model: NimiAiModel }): NimiLangGraphAdapter {
  return {
    manifest: NIMI_LANGGRAPH_ADAPTER_MANIFEST,
    async node(state) {
      const result = await options.model.generateText({
        model: options.model.model,
        messages: state.messages,
      });
      return {
        messages: [
          ...state.messages,
          {
            role: 'assistant',
            content: [textPart(result.text)],
            toolCalls: result.toolCalls,
          },
        ],
      };
    },
    checkpointResume() {
      throwUnsupportedLangGraphFeature('checkpointResume');
    },
  };
}
