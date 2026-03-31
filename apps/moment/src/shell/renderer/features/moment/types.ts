import type { MomentRuntimeTargetOption } from './runtime-targets.js';

export type MomentSeedMode = 'image' | 'phrase';

export type MomentRelationState =
  | 'distant'
  | 'approaching'
  | 'noticed'
  | 'addressed'
  | 'involved';

export type MomentSeed = {
  mode: MomentSeedMode;
  phrase?: string;
  imageDataUrl?: string;
  imageName?: string;
};

export type MomentStoryOpening = {
  title: string;
  opening: string;
  presence: string;
  mystery: string;
  sceneSummary: string;
  actions: [string, string, string];
  relationState: MomentRelationState;
  traceId?: string;
};

export type MomentContinuationBeat = {
  userLine: string;
  storyBeat: string;
  actions: [string, string, string];
  relationState: MomentRelationState;
  traceId?: string;
};

export type MomentPlayState = 'open' | 'sealing' | 'sealed';

export type MomentSession = {
  sessionId: string;
  createdAt: string;
  seed: MomentSeed;
  opening: MomentStoryOpening;
  turns: MomentContinuationBeat[];
  beatIndex: number;
  relationState: MomentRelationState;
  playState: MomentPlayState;
  sealed: boolean;
  sealedAt?: string;
  textTarget: Pick<MomentRuntimeTargetOption, 'key' | 'route' | 'connectorId' | 'modelId' | 'provider' | 'modelLabel'>;
  visionTarget?: Pick<MomentRuntimeTargetOption, 'key' | 'route' | 'connectorId' | 'modelId' | 'provider' | 'modelLabel'>;
};
