import {
  runRuntimeAIConsumeCapability,
  type RuntimeAIConsumeCapabilityId,
  type RuntimeAIConsumeInput,
  type RuntimeAIConsumeResult,
  type RuntimeAIConsumeRuntime,
  type RuntimeAIConsumeScopeRunner,
} from '@nimiplatform/kit/features/generation/runtime';
import type { NimiAIConfig } from '@nimiplatform/sdk/ai';

export type ZhiyuCapabilityStudioCapabilityId = Extract<
  RuntimeAIConsumeCapabilityId,
  'text.generate' | 'chat.stream' | 'text.embed'
>;

export type ZhiyuCapabilityStudioAIConsumeInput = {
  readonly runtime: RuntimeAIConsumeRuntime;
  readonly config: NimiAIConfig;
  readonly capabilityId: ZhiyuCapabilityStudioCapabilityId;
  readonly prompt: string;
  readonly directive?: string;
  readonly subjectUserId?: string;
  readonly onPartial?: (accumulatedText: string) => void;
  readonly withScopes?: RuntimeAIConsumeScopeRunner;
  readonly consume?: (input: RuntimeAIConsumeInput) => Promise<RuntimeAIConsumeResult>;
};

export type ZhiyuCapabilityStudioAIConsumeResult = RuntimeAIConsumeResult;

export async function runZhiyuCapabilityStudioAIConsume(
  input: ZhiyuCapabilityStudioAIConsumeInput,
): Promise<ZhiyuCapabilityStudioAIConsumeResult> {
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
): 'text.generate' | 'text.embed' {
  return capabilityId === 'text.embed' ? 'text.embed' : 'text.generate';
}

function zhiyuCapabilityScenarioId(capabilityId: ZhiyuCapabilityStudioCapabilityId): string {
  return `zhiyu-capability-studio-${capabilityId.replaceAll('.', '-')}`;
}
