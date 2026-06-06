import type { NimiAiModel } from '../../core/ai';
import { createNimiOpenAICompatibleAdapter } from '../openai-compatible';
import { createNimiNextChatCompletionRoute } from './index';

export function createNextRouteExample(model: NimiAiModel): ReturnType<typeof createNimiNextChatCompletionRoute> {
  const openAICompatible = createNimiOpenAICompatibleAdapter({ model });
  return createNimiNextChatCompletionRoute({
    completions: openAICompatible.chat.completions,
  });
}
