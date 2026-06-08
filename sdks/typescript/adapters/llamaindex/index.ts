import type { NimiAiModel } from '../../core/ai';
import { textPart, type NimiCapabilityManifest, type NimiJsonObject } from '../../core/contracts';
import type { NimiKnowledgeReference } from '../../features/knowledge-context';

export const NIMI_LLAMA_INDEX_ADAPTER_ID = 'llamaindex' as const;
export const NIMI_LLAMA_INDEX_UNSUPPORTED_FEATURE_CODE = 'unsupported_llamaindex_adapter_feature' as const;

export const NIMI_LLAMA_INDEX_ADAPTER_MANIFEST = {
  adapterId: NIMI_LLAMA_INDEX_ADAPTER_ID,
  targetLibrary: 'LlamaIndex',
  targetVersionRange: 'structural-query-engine-v1',
  capabilityLevel: 'L1',
  capabilities: {
    'query.generate': { support: 'supported', mode: 'adapter-mapped' },
    retrievalReferences: { support: 'supported', mode: 'adapter-mapped' },
    indexMutation: { support: 'unsupported', mode: 'adapter-mapped' },
    toolCalling: { support: 'unsupported', mode: 'adapter-mapped' },
  },
  unsupportedBehavior: 'throw',
} as const satisfies NimiCapabilityManifest;

export interface NimiLlamaIndexQueryRequest {
  readonly query: string;
  readonly context?: readonly NimiKnowledgeReference[];
  readonly metadata?: NimiJsonObject;
}

export interface NimiLlamaIndexQueryResponse {
  readonly response: string;
  readonly sourceNodes: readonly NimiKnowledgeReference[];
}

export class NimiLlamaIndexUnsupportedFeatureError extends Error {
  readonly code = NIMI_LLAMA_INDEX_UNSUPPORTED_FEATURE_CODE;
  readonly feature: string;

  constructor(feature: string) {
    super(feature);
    this.name = 'NimiLlamaIndexUnsupportedFeatureError';
    this.feature = feature;
  }
}

export function throwUnsupportedLlamaIndexFeature(feature: string): never {
  throw new NimiLlamaIndexUnsupportedFeatureError(feature);
}

export interface NimiLlamaIndexAdapter {
  readonly manifest: typeof NIMI_LLAMA_INDEX_ADAPTER_MANIFEST;
  query(request: NimiLlamaIndexQueryRequest): Promise<NimiLlamaIndexQueryResponse>;
  mutateIndex(): never;
}

export function createNimiLlamaIndexAdapter(options: { readonly model: NimiAiModel }): NimiLlamaIndexAdapter {
  return {
    manifest: NIMI_LLAMA_INDEX_ADAPTER_MANIFEST,
    async query(request) {
      const contextText = request.context?.map((reference) => reference.text).join('\n') ?? '';
      const result = await options.model.generateText({
        model: options.model.model,
        messages: [
          {
            role: 'user',
            content: [textPart(contextText ? `${contextText}\n\n${request.query}` : request.query)],
            metadata: request.metadata,
          },
        ],
      });
      return {
        response: result.text,
        sourceNodes: request.context ?? [],
      };
    },
    mutateIndex() {
      throwUnsupportedLlamaIndexFeature('indexMutation');
    },
  };
}
