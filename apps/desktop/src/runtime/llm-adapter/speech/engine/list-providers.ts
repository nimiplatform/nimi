import { ADAPTER_FAMILY_REGISTRY } from '../../contracts/adapter-family';
import type { SpeechProviderDescriptor } from '../types';

export function listSpeechProviders(): SpeechProviderDescriptor[] {
  return ADAPTER_FAMILY_REGISTRY
    .filter((descriptor) => descriptor.capabilities.includes('tts'))
    .map((descriptor) => ({
      id: descriptor.family,
      name: descriptor.label,
      status: 'available' as const,
      capabilities: descriptor.family === 'openai-compatible'
        ? ['synthesize', 'streaming']
        : ['synthesize'],
      ownerModId: 'world.nimi.runtime-speech',
    }));
}
