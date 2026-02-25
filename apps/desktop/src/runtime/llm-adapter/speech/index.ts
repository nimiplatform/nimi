import type { ProviderType } from '../types';
import type { SpeechAdapter, SpeechAdapterConfig } from './types';
import { DashScopeCompatibleSpeechAdapter } from './dashscope-compatible';
import { OpenAICompatibleSpeechAdapter } from './openai-compatible';
import { VolcengineCompatibleSpeechAdapter } from './volcengine-compatible';

export type {
  SpeechAdapter,
  SpeechAdapterConfig,
  SpeechFormat,
  SpeechProviderDescriptor,
  SpeechStreamControlAction,
  SpeechStreamEvent,
  SpeechStreamOpenRequest,
  SpeechStreamOpenResult,
  SpeechHealthResult,
  SpeechNativeStreamResponse,
  SpeechSynthesizeRequest,
  SpeechSynthesizeResult,
  SpeechSynthesisRequest,
  SpeechSynthesisResponse,
  SpeechVoiceDescriptor,
} from './types';

export { DashScopeCompatibleSpeechAdapter } from './dashscope-compatible';
export { OpenAICompatibleSpeechAdapter } from './openai-compatible';
export { VolcengineCompatibleSpeechAdapter } from './volcengine-compatible';
export { SpeechAssetStore } from './asset-store';
export { SpeechStreamRuntime } from './stream-runtime';
export { NimiSpeechEngine } from './engine';

export function createSpeechAdapter(type: ProviderType, config: SpeechAdapterConfig): SpeechAdapter {
  if (type === 'DASHSCOPE_COMPATIBLE') {
    return new DashScopeCompatibleSpeechAdapter(type, config);
  }
  if (type === 'VOLCENGINE_COMPATIBLE') {
    return new VolcengineCompatibleSpeechAdapter(type, config);
  }
  if (type === 'OPENAI_COMPATIBLE' || type === 'CLOUD_API') {
    return new OpenAICompatibleSpeechAdapter(type, config);
  }

  throw new Error(`SPEECH_ADAPTER_UNSUPPORTED: provider type ${type} is not supported`);
}
