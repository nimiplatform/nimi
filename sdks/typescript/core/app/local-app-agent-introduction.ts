import type { NimiLocalAppAgentHandle } from './local-app-agent-selector.js';
import { validateAgentHandle } from './local-app-runtime-platform-conversation.js';
import { safeAgentAvatarUrl } from './local-app-runtime-platform-agent-references.js';
import { asRecord, assertExactKeys, assertExactProjectionKeys, localAppProjectionError } from './local-app-runtime-platform-validation.js';
import type { GetLocalAppAgentIntroductionRequest, GetLocalAppAgentIntroductionResponse } from '../../core-generated/runtime-protobuf/runtime/v1/agent_service.js';

export type NimiLocalAppAgentIntroductionTopic = Readonly<{ kind: 'role' | 'work' | 'relationship' | 'topic'; text: string }>;
export type NimiLocalAppAgentIntroduction = Readonly<{
  worldName: string | null;
  era: string | null;
  role: string | null;
  greeting: string | null;
  referenceImageUrl: string | null;
  voiceSampleUrl: string | null;
  voicePreviewUrl: string | null;
  voiceSampleContentHash: string | null;
  voiceSampleMimeType: string | null;
  voiceSampleDurationSec: number | null;
  questionTopics: readonly NimiLocalAppAgentIntroductionTopic[];
}>;
export type NimiLocalAppAgentIntroductionInput = Readonly<{ agentHandle: NimiLocalAppAgentHandle }>;
export type NimiLocalAppAgentIntroductionShell = {
  readonly getIntroduction: (input: NimiLocalAppAgentIntroductionInput) => Promise<unknown>;
};
export type NimiLocalAppAgentIntroductionClient = {
  readonly getIntroduction: (input: NimiLocalAppAgentIntroductionInput) => Promise<NimiLocalAppAgentIntroduction>;
};

// @nimi-authority: rule.nimi.sdks.feature-clients.agent-introduction
export function createNimiLocalAppAgentIntroductionClient(shell: NimiLocalAppAgentIntroductionShell): NimiLocalAppAgentIntroductionClient {
  return Object.freeze({
    async getIntroduction(input: NimiLocalAppAgentIntroductionInput) {
      assertExactKeys(input, ['agentHandle'], 'Agent introduction input');
      validateAgentHandle(input.agentHandle);
      const record = asRecord(await shell.getIntroduction({ agentHandle: input.agentHandle }));
      assertExactProjectionKeys(record, ['worldName', 'era', 'role', 'greeting', 'referenceImageUrl', 'voiceSampleUrl', 'voicePreviewUrl', 'voiceSampleContentHash', 'voiceSampleMimeType', 'voiceSampleDurationSec', 'questionTopics'], 'Agent introduction');
      const optionalText = (value: unknown, limit: number): string | null => {
        if (value === null) return null;
        if (typeof value !== 'string' || !value || value.trim() !== value || new TextEncoder().encode(value).byteLength > limit || /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u.test(value)) localAppProjectionError('Agent introduction text');
        return value;
      };
      const media = (value: unknown): string | null => {
        if (value === null) return null;
        if (!safeAgentAvatarUrl(value)) localAppProjectionError('Agent introduction media');
        return value;
      };
      if (!Array.isArray(record.questionTopics) || record.questionTopics.length > 16) localAppProjectionError('Agent introduction topics');
      const questionTopics = Object.freeze(record.questionTopics.map(value => {
        const topic = asRecord(value);
        assertExactProjectionKeys(topic, ['kind', 'text'], 'Agent introduction topic');
        if (typeof topic.kind !== 'string' || !['role', 'work', 'relationship', 'topic'].includes(topic.kind)) localAppProjectionError('Agent introduction topic kind');
        const text = optionalText(topic.text, 256);
        if (text === null) localAppProjectionError('Agent introduction topic text');
        return Object.freeze({ kind: topic.kind as NimiLocalAppAgentIntroductionTopic['kind'], text });
      }));
      const voiceSampleContentHash = record.voiceSampleContentHash;
      if (voiceSampleContentHash !== null && (typeof voiceSampleContentHash !== 'string' || !/^[a-f0-9]{64}$/u.test(voiceSampleContentHash))) localAppProjectionError('Agent introduction original hash');
      const voiceSampleUrl = record.voiceSampleUrl === null ? null : safeIntroductionOriginalUrl(record.voiceSampleUrl, voiceSampleContentHash as string | null) ? record.voiceSampleUrl as string : localAppProjectionError('Agent introduction original media');
      const voicePreviewUrl = media(record.voicePreviewUrl);
      const voiceSampleMimeType = record.voiceSampleMimeType;
      if (voiceSampleMimeType !== null && (typeof voiceSampleMimeType !== 'string' || !/^audio\/[a-z0-9.+-]+$/u.test(voiceSampleMimeType) || !voiceSampleUrl)) localAppProjectionError('Agent introduction original MIME');
      if (voiceSampleContentHash !== null && !voiceSampleUrl) localAppProjectionError('Agent introduction original hash without content');
      const duration = record.voiceSampleDurationSec;
      if (duration !== null && (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0 || !voiceSampleUrl && !voicePreviewUrl)) localAppProjectionError('Agent introduction voice duration');
      return Object.freeze({
        worldName: optionalText(record.worldName, 256), era: optionalText(record.era, 256), role: optionalText(record.role, 256), greeting: optionalText(record.greeting, 4096),
        referenceImageUrl: media(record.referenceImageUrl), voiceSampleUrl, voicePreviewUrl, voiceSampleContentHash: voiceSampleContentHash as string | null, voiceSampleMimeType: voiceSampleMimeType as string | null, voiceSampleDurationSec: duration as number | null, questionTopics,
      });
    },
  });
}

export function createNimiLocalAppAgentIntroductionRuntimeClient(runtime: {
  getLocalAppAgentIntroduction: (input: GetLocalAppAgentIntroductionRequest) => Promise<GetLocalAppAgentIntroductionResponse>;
}): NimiLocalAppAgentIntroductionClient {
  return createNimiLocalAppAgentIntroductionClient({
    async getIntroduction(input) {
      const value = (await runtime.getLocalAppAgentIntroduction(input)).introduction;
      if (!value) localAppProjectionError('Agent introduction');
      const kinds = { 1: 'role', 2: 'work', 3: 'relationship', 4: 'topic' } as const;
      return {
        worldName: value.worldName ?? null, era: value.era ?? null, role: value.role ?? null, greeting: value.greeting ?? null,
        referenceImageUrl: value.referenceImageUrl ?? null, voiceSampleUrl: value.voiceSampleUrl ?? null, voicePreviewUrl: value.voicePreviewUrl ?? null, voiceSampleContentHash: value.voiceSampleContentHash ?? null, voiceSampleMimeType: value.voiceSampleMimeType ?? null, voiceSampleDurationSec: value.voiceSampleDurationSec ?? null,
        questionTopics: value.questionTopics.map(topic => ({ kind: kinds[topic.kind as keyof typeof kinds], text: topic.text })),
      };
    },
  });
}

function safeIntroductionOriginalUrl(value: unknown, hash: string | null): boolean {
  if (safeAgentAvatarUrl(value)) return true;
  if (typeof value !== 'string' || value.length > 2048 || !hash) return false;
  try {
    const url = new URL(value); const query = url.searchParams;
    const grant = query.get('grant');
    if ([...query.keys()].length !== 1 || !grant || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u.test(grant)) return false;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length !== 5 || parts[0] !== 'm' || parts[2] !== hash || parts[3] !== 'v1' || parts[4] !== 'original.bin') return false;
    url.search = ''; return safeAgentAvatarUrl(url.toString());
  } catch { return false; }
}
