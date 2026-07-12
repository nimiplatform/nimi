import { MemoryCanonicalClass } from '../../../sdks/typescript/dist/runtime/wire-types/index.js';

export const conversationReportMemoryCanonicalClasses = Object.freeze([
  MemoryCanonicalClass.PUBLIC_SHARED,
  MemoryCanonicalClass.WORLD_SHARED,
  MemoryCanonicalClass.DYADIC,
]);

export function buildConversationReportMemoryQuery(identity) {
  return {
    ...identity,
    query: '',
    limit: 20,
    canonicalClasses: [...conversationReportMemoryCanonicalClasses],
  };
}
