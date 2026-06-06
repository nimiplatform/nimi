import type { NimiAiModel } from '@nimiplatform/sdk/ai';
import { createNimiVercelLanguageModel } from './index';

export async function runVercelLanguageModelExample(model: NimiAiModel): Promise<string> {
  const vercelModel = createNimiVercelLanguageModel({ model });
  const result = await vercelModel.doGenerate({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hello from Vercel AI SDK shape.' }] }],
  });
  const text = result.content.find((part) => part.type === 'text');
  return text?.text ?? '';
}
