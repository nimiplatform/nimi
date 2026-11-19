import {
  AudioWaveform,
  ChartColumnIncreasing,
  Clapperboard,
  Earth,
  FileMusic,
  FileSearch,
  Image,
  ImageUpscale,
  Languages,
  ListChecks,
  Maximize,
  MessageSquare,
  Mic,
  Music2,
  Radio,
  Repeat2,
  ScanFace,
  ScanSearch,
  Speech,
  Split,
  Video,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react';

const capabilityIcons = new Map<string, LucideIcon>([
  ['text.generate', MessageSquare],
  ['image.generate', Image],
  ['audio.synthesize', Speech],
  ['audio.transcribe', Mic],
  ['video.generate', Video],
  ['music.generate', Music2],
  ['music.transcribe', FileMusic],
  ['audio.voice.convert', Repeat2],
  ['voice.create', AudioWaveform],
  ['audio.separate', Split],
  ['audio.speaker.embed', ChartColumnIncreasing],
  ['text.annotate', Languages],
  ['text.decide', ListChecks],
  ['image.face_swap', ScanFace],
  ['video.face_swap', Clapperboard],
  ['image.upscale', ImageUpscale],
  ['video.upscale', Maximize],
  ['vision.locate', ScanSearch],
  ['text.embed', FileSearch],
  ['world.generate', Earth],
  ['realtime.interact', Radio],
]);

/** Default glyph for an AI capability contract, including a neutral fallback for unknown IDs. */
export function capabilityIcon(contract: string): LucideIcon {
  return capabilityIcons.get(contract) ?? WandSparkles;
}
