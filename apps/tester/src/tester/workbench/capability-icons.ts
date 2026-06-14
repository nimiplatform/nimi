import {
  AudioWaveform,
  Captions,
  Compass,
  Image as ImageIcon,
  MessageSquareText,
  Sparkles,
  Speech,
  TextCursorInput,
  Video,
  type LucideIcon,
} from 'lucide-react';
import type { TesterCapabilityId } from '../tester-capabilities.js';

export const capabilityIcons: Record<TesterCapabilityId, LucideIcon> = {
  'text.generate': Sparkles,
  'chat.stream': MessageSquareText,
  'text.embed': TextCursorInput,
  'image.generate': ImageIcon,
  'video.generate': Video,
  'audio.synthesize': Speech,
  'audio.transcribe': Captions,
  'speech.bundle': AudioWaveform,
  'world.generate': Compass,
};
