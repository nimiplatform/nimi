import type { NimiAiModel } from '../../core/ai';
import { textPart } from '../../core/contracts';
import { createNimiMastraAdapter } from './index';

export async function runMastraStructuralGenerateExample(model: NimiAiModel): Promise<string> {
  const adapter = createNimiMastraAdapter({ model });
  const result = await adapter.model.generate({
    messages: [{ role: 'user', content: [textPart('Generate with the Nimi model.')] }],
  });
  return result.text;
}
