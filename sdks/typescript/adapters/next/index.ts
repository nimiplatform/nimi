import type { NimiCapabilityManifest } from '../../core/contracts';
import type {
  NimiOpenAICompatibleChatCompletions,
  OpenAICompatibleChatCompletionRequest,
} from '../openai-compatible';

export const NIMI_NEXT_ADAPTER_ID = 'next' as const;
export const NIMI_NEXT_UNSUPPORTED_FEATURE_CODE = 'unsupported_next_adapter_feature' as const;

export const NIMI_NEXT_ADAPTER_MANIFEST = {
  adapterId: NIMI_NEXT_ADAPTER_ID,
  targetLibrary: 'Next',
  targetVersionRange: 'structural-route-v1',
  capabilityLevel: 'L1',
  capabilities: {
    'route.chatCompletions.json': 'supported',
    'route.chatCompletions.stream': 'unsupported',
    middleware: 'unsupported',
    serverActions: 'unsupported',
  },
  unsupportedBehavior: 'throw',
} as const satisfies NimiCapabilityManifest;

export interface NimiNextRequestLike {
  json(): Promise<unknown>;
}

export interface NimiNextResponseLike {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

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

export function createNimiNextChatCompletionRoute(options: {
  readonly completions: NimiOpenAICompatibleChatCompletions;
}): (request: NimiNextRequestLike) => Promise<NimiNextResponseLike> {
  return async (request) => {
    const body = (await request.json()) as OpenAICompatibleChatCompletionRequest;
    if (body.stream === true) {
      throwUnsupportedNextFeature('route.chatCompletions.stream');
    }
    const completion = await options.completions.create({
      ...body,
      stream: false,
    });
    return {
      status: 200,
      headers: {
        'content-type': 'application/json',
      },
      body: completion,
    };
  };
}
