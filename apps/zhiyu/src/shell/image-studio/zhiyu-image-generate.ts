import {
  runRuntimeImageGenerate,
  type RuntimeImageGenerateInput,
  type RuntimeImageGenerateResult,
  type RuntimeImageGenerateRuntime,
  type RuntimeImageGenerateScopeRunner,
} from '@nimiplatform/kit/features/generation/runtime';
import type { NimiAIConfig } from '@nimiplatform/sdk/ai';
import type { ScenarioJob } from '@nimiplatform/sdk/runtime/generated';

export type ZhiyuImageGenerateInput = {
  readonly runtime: RuntimeImageGenerateRuntime;
  readonly config: NimiAIConfig;
  readonly prompt: string;
  readonly negativePrompt?: string;
  readonly scenarioId: string;
  readonly subjectUserId?: string;
  readonly onJobUpdate?: (job: ScenarioJob) => void;
  readonly withScopes?: RuntimeImageGenerateScopeRunner;
  readonly generate?: (input: RuntimeImageGenerateInput) => Promise<RuntimeImageGenerateResult>;
};

export type ZhiyuImageGenerateResult = RuntimeImageGenerateResult;

export async function runZhiyuImageStudioGenerate(
  input: ZhiyuImageGenerateInput,
): Promise<ZhiyuImageGenerateResult> {
  const generate = input.generate ?? runRuntimeImageGenerate;
  return generate({
    runtime: input.runtime,
    appId: 'nimi.zhiyu',
    config: input.config,
    prompt: input.prompt,
    ...(input.negativePrompt ? { negativePrompt: input.negativePrompt } : {}),
    scenarioId: input.scenarioId,
    subjectUserId: input.subjectUserId,
    surfaceId: 'zhiyu.image-studio.image.generate',
    metadata: {
      productSurface: 'image-studio',
      zhiyuSurface: 'agent-home',
    },
    onJobUpdate: input.onJobUpdate,
    withScopes: input.withScopes,
  });
}
