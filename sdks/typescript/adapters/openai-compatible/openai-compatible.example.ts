import type { NimiAiModel } from '../../core/ai';
import { createNimiOpenAICompatibleAdapter } from './index';

export async function runOpenAICompatibleChatCompletionExample(model: NimiAiModel): Promise<string | null> {
  const client = createNimiOpenAICompatibleAdapter({ model });
  const completion = await client.chat.completions.create({
    model: model.model.modelId,
    messages: [
      {
        role: 'user',
        content: 'Summarize the current task.',
      },
    ],
  });

  return completion.choices[0].message.content;
}
