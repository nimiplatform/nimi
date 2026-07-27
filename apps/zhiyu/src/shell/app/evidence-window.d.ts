import type { ZhiyuEvidence } from './evidence';

declare global {
  interface Window {
    __nimiZhiyuEvidence?: ZhiyuEvidence;
    __nimiZhiyuAbortActiveTurn?: (reason?: string) => void;
  }
}

export {};
