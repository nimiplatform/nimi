// Relay NSFW media policy — adapted from local-chat services/policy/nsfw-media-policy.ts
// Imports adapted: uses ../chat-pipeline/types.js and ../settings/types.js

import type { ChatMessageMeta } from '../chat-pipeline/types.js';

export type NsfwMediaPolicy = NonNullable<ChatMessageMeta['nsfwPolicy']>;

const NSFW_PROMPT_PATTERNS: RegExp[] = [
  /\bnsfw\b/i,
  /\berotic\b/i,
  /\bporn(?:ography)?\b/i,
  /\bxxx\b/i,
  /\bnude\b/i,
  /\bnaked\b/i,
  /\bsexual\b/i,
  /\bsex\b/i,
  /\badult\b/i,
  /\blingerie\b/i,
  /\bfetish\b/i,
  /\bexplicit\b/i,
  /\bbreast(?:s)?\b/i,
  /\bnipple(?:s)?\b/i,
  /\bgenital(?:ia)?\b/i,
  /\b18\+\b/i,
  /\btopless\b/i,
  /\bmasturbat(?:e|ion)\b/i,
  /\borgasm(?:ic)?\b/i,
  /\bblowjob\b/i,
  /\bfellatio\b/i,
  /\bpenetrat(?:e|ion)\b/i,
  /\boral sex\b/i,
  /\banal\b/i,
  /裸体|裸露|全裸|半裸/u,
  /色情|情色|淫秽|淫荡/u,
  /做爱|性交|交合|性行为/u,
  /口交|肛交|手淫|自慰/u,
  /脱光|脱衣/u,
  /胸部|乳房|乳头/u,
  /私处|下体|生殖器/u,
  /阴茎|阴道|龟头/u,
  /高潮|呻吟|喘息/u,
  /肉欲|欲望|情欲/u,
];

export function evaluateNsfwMediaPolicy(input: {
  routeSource: string;
  visualComfortLevel?: 'text-only' | 'restrained-visuals' | 'natural-visuals';
}): NsfwMediaPolicy {
  if (input.routeSource === 'cloud') {
    return 'local-only';
  }
  if (input.visualComfortLevel === 'natural-visuals') {
    return 'allowed';
  }
  return 'disabled';
}

export function isNsfwMediaAllowed(policy: NsfwMediaPolicy): boolean {
  return policy === 'allowed';
}

export function isPromptLikelyNsfw(prompt: string): boolean {
  const normalized = String(prompt || '').trim();
  if (!normalized) return false;
  return NSFW_PROMPT_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isMediaGenerationAllowed(input: {
  policy: NsfwMediaPolicy;
  routeSource: 'local' | 'cloud' | string;
  prompt?: string;
  isNsfwPrompt?: boolean;
}): boolean {
  const nsfwPrompt = input.isNsfwPrompt ?? isPromptLikelyNsfw(input.prompt || '');
  if (!nsfwPrompt) {
    return true;
  }
  if (input.policy === 'disabled') {
    return false;
  }
  if (input.policy === 'allowed') {
    return true;
  }
  return input.routeSource === 'local';
}
