import {
  runRuntimeAIConsumeCapability,
  runRuntimeSpeechSynthesize,
  type RuntimeAIConsumeCapabilityId,
  type RuntimeAIConsumeInput,
  type RuntimeAIConsumeResult,
  type RuntimeAIConsumeRuntime,
  type RuntimeAIConsumeScopeRunner,
  type RuntimeSpeechSynthesizeInput,
  type RuntimeSpeechSynthesizeResult,
  type RuntimeSpeechSynthesizeRuntime,
} from '@nimiplatform/kit/features/generation/runtime';
import type { NimiAIConfig } from '@nimiplatform/sdk/ai';

export type ZhiyuCapabilityStudioCapabilityId = Extract<
  RuntimeAIConsumeCapabilityId,
  'text.generate' | 'chat.stream' | 'text.embed'
> | 'audio.synthesize';

export type ZhiyuCapabilityStudioAIConsumeInput = {
  readonly runtime: RuntimeAIConsumeRuntime & RuntimeSpeechSynthesizeRuntime;
  readonly config: NimiAIConfig;
  readonly capabilityId: ZhiyuCapabilityStudioCapabilityId;
  readonly prompt: string;
  readonly directive?: string;
  readonly subjectUserId?: string;
  readonly onPartial?: (accumulatedText: string) => void;
  readonly withScopes?: RuntimeAIConsumeScopeRunner;
  readonly consume?: (input: RuntimeAIConsumeInput) => Promise<RuntimeAIConsumeResult>;
  readonly synthesizeSpeech?: (input: RuntimeSpeechSynthesizeInput) => Promise<RuntimeSpeechSynthesizeResult>;
};

export type ZhiyuCapabilityStudioAIConsumeResult = RuntimeAIConsumeResult | RuntimeSpeechSynthesizeResult;

export async function runZhiyuCapabilityStudioAIConsume(
  input: ZhiyuCapabilityStudioAIConsumeInput,
): Promise<ZhiyuCapabilityStudioAIConsumeResult> {
  if (input.capabilityId === 'audio.synthesize') {
    const synthesizeSpeech = input.synthesizeSpeech ?? runRuntimeSpeechSynthesize;
    return synthesizeSpeech({
      runtime: input.runtime,
      appId: 'nimi.zhiyu',
      config: input.config,
      text: input.prompt,
      scenarioId: 'zhiyu-capability-studio-audio-synthesize',
      subjectUserId: input.subjectUserId,
      surfaceId: 'zhiyu.capability-studio.audio.synthesize',
      metadata: {
        productSurface: 'developer-backstage',
        zhiyuSurface: 'agent-home',
      },
      withScopes: input.withScopes,
    });
  }
  const consume = input.consume ?? runRuntimeAIConsumeCapability;
  return consume({
    runtime: input.runtime,
    appId: 'nimi.zhiyu',
    config: input.config,
    capabilityId: input.capabilityId,
    bindingCapabilityId: zhiyuCapabilityBindingId(input.capabilityId),
    prompt: input.prompt,
    ...(input.directive ? { directive: input.directive } : {}),
    scenarioId: zhiyuCapabilityScenarioId(input.capabilityId),
    subjectUserId: input.subjectUserId,
    surfaceId: `zhiyu.capability-studio.${input.capabilityId}`,
    metadata: {
      productSurface: 'capability-studio',
      zhiyuSurface: 'agent-home',
    },
    onPartial: input.onPartial,
    withScopes: input.withScopes,
  });
}

export function zhiyuCapabilityBindingId(
  capabilityId: ZhiyuCapabilityStudioCapabilityId,
): 'text.generate' | 'text.embed' | 'audio.synthesize' {
  if (capabilityId === 'audio.synthesize') return 'audio.synthesize';
  return capabilityId === 'text.embed' ? 'text.embed' : 'text.generate';
}

function zhiyuCapabilityScenarioId(capabilityId: ZhiyuCapabilityStudioCapabilityId): string {
  return `zhiyu-capability-studio-${capabilityId.replaceAll('.', '-')}`;
}
