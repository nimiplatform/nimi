import type { NimiCapabilityManifest } from '../../core/contracts';
import type { NimiAiModel } from '../../core/ai';
import {
  createNimiOpenAICompatibleAdapter,
  type OpenAICompatibleChatCompletionRequest,
} from '../openai-compatible';

export const NIMI_NEXT_ADAPTER_ID = 'next' as const;
export const NIMI_NEXT_UNSUPPORTED_FEATURE_CODE = 'SDK_ADAPTER_FEATURE_UNSUPPORTED' as const;

export const NIMI_NEXT_ADAPTER_MANIFEST = {
  adapterId: NIMI_NEXT_ADAPTER_ID,
  targetLibrary: 'Next',
  targetVersionRange: 'structural-route-v1',
  capabilityLevel: 'L1',
  capabilities: {
    'route.chatCompletions.json': { support: 'supported', mode: 'adapter-mapped' },
    'route.chatCompletions.stream': { support: 'unsupported', mode: 'adapter-mapped' },
    middleware: { support: 'unsupported', mode: 'adapter-mapped' },
    serverActions: { support: 'unsupported', mode: 'adapter-mapped' },
  },
  unsupportedBehavior: 'throw',
} as const satisfies NimiCapabilityManifest;

export class NimiNextUnsupportedFeatureError extends Error {
  readonly code = NIMI_NEXT_UNSUPPORTED_FEATURE_CODE;
  readonly feature: string;

  constructor(feature: string) {
    super(feature);
    this.name = 'NimiNextUnsupportedFeatureError';
    this.feature = feature;
  }
}

export function throwUnsupportedNextFeature(feature: string): never {
  throw new NimiNextUnsupportedFeatureError(feature);
}

export interface NimiNextChatCompletionRouteOptions {
  readonly model: NimiAiModel;
}

export interface NimiNextChatCompletionRoute {
  POST(request: Request): Promise<Response>;
}

export function createNimiNextChatCompletionRoute(
  options: NimiNextChatCompletionRouteOptions,
): NimiNextChatCompletionRoute {
  const adapter = createNimiOpenAICompatibleAdapter({ model: options.model });
  return {
    async POST(request) {
      const body = await request.json() as OpenAICompatibleChatCompletionRequest;
      if (body.stream === true) {
        throwUnsupportedNextFeature('route.chatCompletions.stream');
      }
      const completion = await adapter.chat.completions.create({
        ...body,
        stream: false,
      });
      return new Response(JSON.stringify(completion), {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
        },
      });
    },
  };
}
