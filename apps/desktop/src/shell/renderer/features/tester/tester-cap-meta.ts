import type { CapabilityId } from './tester-types.js';

export type CapTone = 'mint' | 'blue' | 'violet' | 'pink';
export type CapIconKind =
  | 'chat'
  | 'stream'
  | 'vector'
  | 'image'
  | 'imageJob'
  | 'video'
  | 'world'
  | 'tts'
  | 'stt'
  | 'clone'
  | 'design';

export type CapGroupLabel = 'Text' | 'Media' | 'World' | 'Audio';

export type CapMeta = {
  group: CapGroupLabel;
  icon: CapIconKind;
  tone: CapTone;
};

export const CAP_META: Record<CapabilityId, CapMeta> = {
  'text.generate': { group: 'Text', icon: 'chat', tone: 'mint' },
  'text.stream': { group: 'Text', icon: 'stream', tone: 'mint' },
  'text.embed': { group: 'Text', icon: 'vector', tone: 'blue' },
  'image.generate': { group: 'Media', icon: 'image', tone: 'violet' },
  'image.create-job': { group: 'Media', icon: 'imageJob', tone: 'violet' },
  'video.generate': { group: 'Media', icon: 'video', tone: 'pink' },
  'video.create-job': { group: 'Media', icon: 'video', tone: 'pink' },
  'world.generate': { group: 'World', icon: 'world', tone: 'mint' },
  'audio.synthesize': { group: 'Audio', icon: 'tts', tone: 'blue' },
  'audio.transcribe': { group: 'Audio', icon: 'stt', tone: 'blue' },
  'voice.clone': { group: 'Audio', icon: 'clone', tone: 'violet' },
  'voice.design': { group: 'Audio', icon: 'design', tone: 'pink' },
};

export type TonePalette = {
  soft: string;
  glow: string;
  ink: string;
  hex: string;
};

export const TONE_PALETTE: Record<CapTone, TonePalette> = {
  mint: { soft: 'rgba(167,243,208,0.45)', glow: '#a7f3d0', ink: '#065F46', hex: '#4ECCA3' },
  blue: { soft: 'rgba(191,219,254,0.55)', glow: '#bfdbfe', ink: '#1E3A8A', hex: '#60A5FA' },
  violet: { soft: 'rgba(221,214,254,0.55)', glow: '#ddd6fe', ink: '#4C1D95', hex: '#8b5cf6' },
  pink: { soft: 'rgba(252,231,243,0.55)', glow: '#fce7f3', ink: '#831843', hex: '#EC4899' },
};
