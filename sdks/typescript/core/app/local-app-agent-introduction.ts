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
      assertExactProjectionKeys(record, ['worldName', 'era', 'role', 'greeting', 'referenceImageUrl', 'voiceSampleUrl', 'voiceSampleDurationSec', 'questionTopics'], 'Agent introduction');
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
      const voiceSampleUrl = media(record.voiceSampleUrl);
      const duration = record.voiceSampleDurationSec;
      if (duration !== null && (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0 || !voiceSampleUrl)) localAppProjectionError('Agent introduction voice duration');
      return Object.freeze({
        worldName: optionalText(record.worldName, 256), era: optionalText(record.era, 256), role: optionalText(record.role, 256), greeting: optionalText(record.greeting, 4096),
        referenceImageUrl: media(record.referenceImageUrl), voiceSampleUrl, voiceSampleDurationSec: duration as number | null, questionTopics,
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
        referenceImageUrl: value.referenceImageUrl ?? null, voiceSampleUrl: value.voiceSampleUrl ?? null, voiceSampleDurationSec: value.voiceSampleDurationSec ?? null,
        questionTopics: value.questionTopics.map(topic => ({ kind: kinds[topic.kind as keyof typeof kinds], text: topic.text })),
      };
    },
  });
}
