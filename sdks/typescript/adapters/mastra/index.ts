import type { NimiAiModel, NimiGenerateTextRequest, NimiGenerateTextResult } from '../../core/ai';
import type { NimiCapabilityManifest, NimiMessage } from '../../core/contracts';

export const NIMI_MASTRA_ADAPTER_ID = 'mastra' as const;
export const NIMI_MASTRA_UNSUPPORTED_FEATURE_CODE = 'unsupported_mastra_adapter_feature' as const;

export const NIMI_MASTRA_ADAPTER_MANIFEST = {
  adapterId: NIMI_MASTRA_ADAPTER_ID,
  targetLibrary: 'Mastra',
  targetVersionRange: 'structural-model-v1',
  capabilityLevel: 'L1',
  capabilities: {
    'model.generate': { support: 'supported', mode: 'adapter-mapped' },
    'model.stream': { support: 'unsupported', mode: 'adapter-mapped' },
    'tools.mapping': { support: 'unsupported', mode: 'adapter-mapped' },
    structuredOutput: { support: 'unsupported', mode: 'adapter-mapped' },
    workflowCheckpoint: { support: 'not-applicable', mode: 'out-of-domain' },
  },
  unsupportedBehavior: 'throw',
} as const satisfies NimiCapabilityManifest;

export interface NimiMastraGenerateInput {
  readonly messages: readonly NimiMessage[];
}

export interface NimiMastraGenerateOutput {
  readonly text: string;
  readonly raw: NimiGenerateTextResult;
}

export class NimiMastraUnsupportedFeatureError extends Error {
  readonly code = NIMI_MASTRA_UNSUPPORTED_FEATURE_CODE;
  readonly feature: string;

  constructor(feature: string) {
    super(feature);
    this.name = 'NimiMastraUnsupportedFeatureError';
    this.feature = feature;
  }
}

export function throwUnsupportedMastraFeature(feature: string): never {
  throw new NimiMastraUnsupportedFeatureError(feature);
}

export interface NimiMastraAdapter {
  readonly manifest: typeof NIMI_MASTRA_ADAPTER_MANIFEST;
  readonly model: {
    readonly provider: 'nimi';
    readonly modelId: string;
    generate(input: NimiMastraGenerateInput): Promise<NimiMastraGenerateOutput>;
    stream(): never;
  };
}

export function createNimiMastraAdapter(options: { readonly model: NimiAiModel }): NimiMastraAdapter {
  return {
    manifest: NIMI_MASTRA_ADAPTER_MANIFEST,
    model: {
      provider: 'nimi',
      modelId: options.model.model.modelId,
      async generate(input) {
        const request: NimiGenerateTextRequest = {
          model: options.model.model,
          messages: input.messages,
        };
        const raw = await options.model.generateText(request);
        return {
          text: raw.text,
          raw,
        };
      },
      stream() {
        throwUnsupportedMastraFeature('model.stream');
      },
    },
  };
}
