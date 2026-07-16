import type { ZhiyuEvidence } from './evidence';
import type { ZhiyuDevKernelEvidence } from '../local-development/ZhiyuLocalDevelopmentJourney';

export type ZhiyuLocalDevelopmentTarget = {
  readonly profile: 'isolated-local-development';
  readonly agentId?: string;
  readonly buildMarker: string;
};

export type ZhiyuSelectedLocalDevelopmentTarget = ZhiyuLocalDevelopmentTarget & {
  readonly agentId: string;
};

declare global {
  interface Window {
    __nimiZhiyuEvidence?: ZhiyuEvidence;
    __nimiZhiyuAbortActiveTurn?: (reason?: string) => void;
    __nimiZhiyuLocalDevelopment?: ZhiyuLocalDevelopmentTarget;
    __nimiZhiyuDevKernelEvidence?: ZhiyuDevKernelEvidence;
  }
}

export {};
