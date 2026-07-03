import type { ZhiyuEvidence } from './evidence';

declare global {
  interface Window {
    __nimiZhiyuEvidence?: ZhiyuEvidence;
  }
}

export {};
