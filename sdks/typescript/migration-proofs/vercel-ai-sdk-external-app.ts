import { NIMI_VERCEL_AI_ADAPTER_MANIFEST } from '../adapters/vercel-ai/manifest';
import { createNimiVercelLanguageModel, type NimiVercelLanguageModel } from '../adapters/vercel-ai';
import { createNimiProofModel } from './model-fixtures';
import type { NimiMigrationProofResult } from './proof-contracts';

export async function runVercelAiSdkExternalAppProof(): Promise<NimiMigrationProofResult> {
  const fixture = createNimiProofModel({ modelId: 'vercel-proof-model', text: 'vercel migrated' });
  const model = createNimiVercelLanguageModel({ model: fixture.model });
  const result = await vercelGenerateTextLike({
    model,
    prompt: 'Existing app prompt migrated by replacing the Vercel model.',
  });

  return {
    proofId: 'vercel-ai-sdk-external-app',
    appShape: 'Vercel AI SDK generateText-style app',
    status: result.text === 'vercel migrated' && fixture.calls.length === 1 ? 'passed' : 'failed',
    migratedBy: 'adapter-model-replacement',
    adapterIds: [NIMI_VERCEL_AI_ADAPTER_MANIFEST.adapterId],
    observedCapabilities: ['model.generate'],
    evidence: [`text:${result.text}`, `calls:${fixture.calls.length}`],
  };
}

async function vercelGenerateTextLike(input: {
  readonly model: NimiVercelLanguageModel;
  readonly prompt: string;
}): Promise<{ readonly text: string }> {
  const result = await input.model.doGenerate({
    prompt: [{ role: 'user', content: [{ type: 'text', text: input.prompt }] }],
  });
  const text = result.content.find((part) => part.type === 'text');
  return {
    text: text?.text ?? '',
  };
}
