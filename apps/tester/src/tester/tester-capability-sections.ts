import type { CanonicalCapabilitySectionId } from '@nimiplatform/kit/core/runtime-capabilities';
import type { TesterCapabilityId } from './tester-capabilities.js';

// Maps Tester journeys to presentation sections only.
export const CAPABILITY_TO_SECTION: Record<TesterCapabilityId, CanonicalCapabilitySectionId> = {
  'text.generate': 'chat',
  'chat.stream': 'chat',
  'text.embed': 'embed',
  'image.generate': 'image',
  'video.generate': 'video',
  'audio.synthesize': 'tts',
  'audio.transcribe': 'stt',
  'voice.create': 'voice',
  'speech.bundle': 'voice',
  'world.generate': 'world',
};
