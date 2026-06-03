import type { PlatformClient } from '@nimiplatform/sdk';
import type { TesterCapabilityId } from './tester-capabilities.js';
import type {
  TesterInvocationResult,
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
  client: PlatformClient,
  capabilityId: TesterCapabilityId,
  input: TesterScenarioInput,
): Promise<TesterInvocationResult> {
  switch (capabilityId) {
    case 'text.generate':
      return invokeTextGenerate(client, input);
    case 'chat.stream':
      return invokeChatStream(client, input);
    case 'text.embed':
      return invokeEmbedding(client, input);
    case 'image.generate':
      return invokeImageGenerate(client, input);
    case 'video.generate':
      return invokeVideoGenerate(client, input);
    case 'audio.synthesize':
      return invokeSpeechSynthesize(client, input);
    case 'audio.transcribe':
      return invokeSpeechTranscribe(client, input);
    case 'speech.bundle':
      return invokeSpeechBundle(client, input);
    case 'world.generate':
      return unavailableFromValidation(
        'world.generate',
        'world.generate runs through the standalone Tauri viewer — use Resolve fixture / Open viewer, not the runtime invoker.',
      );
  }
}
