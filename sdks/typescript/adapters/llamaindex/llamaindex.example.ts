import type { NimiAiModel } from '../../core/ai';
import { createNimiLlamaIndexAdapter } from './index';

export async function runLlamaIndexStructuralQueryExample(model: NimiAiModel): Promise<string> {
  const adapter = createNimiLlamaIndexAdapter({ model });
  const result = await adapter.query({ query: 'Answer using Nimi knowledge context.' });
  return result.response;
}
