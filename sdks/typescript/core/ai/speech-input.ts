import { createNimiError } from '../../types';
export type NimiSpeechInputCapabilities = {
  readonly supportsIdentityAudio: boolean;
  readonly supportsPerformanceAudio: boolean;
  readonly maxReferenceBytes: number;
  readonly maxReferenceDurationSeconds: number;
  readonly maxPerformanceTextBytes: number;
};
// @nimi-authority: rule.nimi.runtime.ai-provider.r112
export function projectSpeechInputCapabilities(value: unknown): NimiSpeechInputCapabilities {
  const fail = (): never => { throw createNimiError({ message:'Invalid speech input capabilities',reasonCode:'SDK_LOCAL_APP_PROJECTION_INVALID',actionHint:'upgrade_matching_runtime_and_carrier',source:'sdk' }); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const p=value as NimiSpeechInputCapabilities;
  if (Object.keys(p).length!==5 || typeof p.supportsIdentityAudio!=='boolean' || typeof p.supportsPerformanceAudio!=='boolean'
    || !Number.isInteger(p.maxReferenceBytes) || p.maxReferenceBytes<1 || p.maxReferenceBytes>0xffffffff
    || !Number.isInteger(p.maxReferenceDurationSeconds) || p.maxReferenceDurationSeconds<1 || p.maxReferenceDurationSeconds>0xffffffff
    || !Number.isInteger(p.maxPerformanceTextBytes) || p.maxPerformanceTextBytes<0 || p.maxPerformanceTextBytes>0xffffffff
    || p.supportsPerformanceAudio!==(p.maxPerformanceTextBytes>0)) return fail();
  return Object.freeze({...p});
}
