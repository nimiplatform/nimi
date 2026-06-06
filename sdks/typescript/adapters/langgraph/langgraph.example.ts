import type { NimiAiModel } from '../../core/ai';
import { textPart } from '../../core/contracts';
import { createNimiLangGraphAdapter } from './index';

export async function runLangGraphStructuralNodeExample(model: NimiAiModel): Promise<number> {
  const adapter = createNimiLangGraphAdapter({ model });
  const next = await adapter.node({
    messages: [{ role: 'user', content: [textPart('Continue graph.')] }],
  });
  return next.messages.length;
}
