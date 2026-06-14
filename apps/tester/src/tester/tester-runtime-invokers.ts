import type { TesterCapabilityId } from './tester-capabilities.js';
import type {
  TesterInvocationResult,
  TesterRuntimeInvocationClient,
  TesterScenarioInput,
} from './tester-runtime-invokers-core.js';
import {
  invokeChatStream,
  invokeEmbedding,
  invokeTextGenerate,
  unavailableFromValidation,
} from './tester-runtime-invokers-core.js';
import {
  invokeImageGenerate,
  invokeSpeechBundle,
  invokeSpeechSynthesize,
  invokeSpeechTranscribe,
  invokeVideoGenerate,
} from './tester-runtime-invokers-media.js';
export type {
  TesterInvocationResult,
  TesterScenarioInput,
  TesterTrace,
  TesterTypedOutput,
  TesterTypedSuccess,
} from './tester-runtime-invokers-core.js';
export { resolveTesterLLMBinding } from './tester-runtime-invokers-core.js';

export async function invokeTesterCapability(
  client: TesterRuntimeInvocationClient,
  capabilityId: TesterCapabilityId,
  input: TesterScenarioInput,
): Promise<TesterInvocationResult> {
  const invocationClient: TesterRuntimeInvocationClient = {
    ...client,
    runtimeSubjectUserId: input.subjectUserId ?? client.runtimeSubjectUserId,
  };
  switch (capabilityId) {
    case 'text.generate':
      return invokeTextGenerate(invocationClient, input);
    case 'chat.stream':
      return invokeChatStream(invocationClient, input);
    case 'text.embed':
      return invokeEmbedding(invocationClient, input);
    case 'image.generate':
      return invokeImageGenerate(invocationClient, input);
    case 'video.generate':
      return invokeVideoGenerate(invocationClient, input);
    case 'audio.synthesize':
      return invokeSpeechSynthesize(invocationClient, input);
    case 'audio.transcribe':
      return invokeSpeechTranscribe(invocationClient, input);
    case 'speech.bundle':
      return invokeSpeechBundle(invocationClient, input);
    case 'world.generate':
      return unavailableFromValidation(
        'world.generate',
        'world.generate runs through the standalone Tauri viewer — use Resolve fixture / Open viewer, not the runtime invoker.',
      );
  }
}
