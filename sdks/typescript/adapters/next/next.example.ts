import type { NimiAiModel } from '../../core/ai';
import { createNimiNextChatCompletionRoute } from './index';

export function createNextChatCompletionRouteExample(model: NimiAiModel) {
  return createNimiNextChatCompletionRoute({ model });
}
