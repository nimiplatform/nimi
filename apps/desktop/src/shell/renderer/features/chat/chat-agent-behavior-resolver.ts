import type {
  AgentResolvedBehavior,
  AgentResolvedExperiencePolicy,
  AgentResolvedTurnMode,
} from './chat-agent-behavior';
import type { AgentChatExperienceSettings } from './chat-settings-storage';
import {
  buildAgentResolvedOutputText,
  parseAgentResolvedMessageActionEnvelope,
} from './chat-agent-behavior-resolver-envelope';
import {
  buildAgentPreflightDiagnosticsFromError,
  parseAgentModelOutputDiagnostics,
  resolveAgentModelOutputEnvelope,
  toAgentModelOutputTurnError,
} from './chat-agent-behavior-resolver-diagnostics';

const QUESTION_RE = /[?？]|为什么|怎么|如何|能不能|可不可以|是什么|什么意思|怎样/u;
const EMOTIONAL_RE = /难过|好累|很累|烦|崩溃|想哭|孤单|害怕|抱抱|安慰|委屈|想你|心情不好|睡不着/u;
const PLAYFUL_RE = /哈哈|hh+|笑死|好耶|太好了|天啊|卧槽|嘿嘿|一起玩|烟花|庆祝|可爱/u;
const INTIMATE_RE = /亲|抱|想你|暧昧|恋人|喜欢你|爱你|想抱你|亲你一下|接吻/u;
const EXPLICIT_MEDIA_RE = /发图|来张图|发一张|看看你|照片|图片|视频|发个视频|自拍|给我看/u;
const EXPLICIT_VOICE_RE = /语音|说话|声音|读给我听|直接说|用语音/u;
const CHECKIN_RE = /^(在吗|早安|晚安|想你了|喂|hi|hello|hey|你好|嗨)[\s!,.?？！，。~]*$/iu;

export type {
  AgentImageExecutionDiagnostics,
  AgentModelOutputClassification,
  AgentModelOutputDiagnostics,
  AgentModelOutputRecoveryPath,
  AgentModelOutputUsage,
  AgentPromptContextWindowSource,
  ResolveAgentModelOutputEnvelopeInput,
  ResolveAgentModelOutputEnvelopeResult,
} from './chat-agent-behavior-resolver-types';

export function resolveAgentTurnMode(input: {
  userText: string;
  hasUserAttachments?: boolean;
}): AgentResolvedTurnMode {
  const userText = input.userText;
  const text = String(userText || '').trim();
  if (!text) {
    if (input.hasUserAttachments) {
      return 'explicit-media';
    }
    throw new Error('agent turn text is required for behavior resolution');
  }
  if (EXPLICIT_VOICE_RE.test(text)) return 'explicit-voice';
  if (EXPLICIT_MEDIA_RE.test(text)) return 'explicit-media';
  if (CHECKIN_RE.test(text)) return 'checkin';
  if (INTIMATE_RE.test(text)) return 'intimate';
  if (EMOTIONAL_RE.test(text)) return 'emotional';
  if (PLAYFUL_RE.test(text)) return 'playful';
  if (QUESTION_RE.test(text)) return 'information';
  return 'information';
}

export function resolveAgentExperiencePolicy(input: {
  turnMode: AgentResolvedTurnMode;
}): AgentResolvedExperiencePolicy {
  return {
    contentBoundary: input.turnMode === 'explicit-media' ? 'explicit-media-request' : 'default',
    autonomyPolicy: 'guarded',
  };
}

export {
  buildAgentResolvedOutputText,
  buildAgentPreflightDiagnosticsFromError,
  parseAgentModelOutputDiagnostics,
  parseAgentResolvedMessageActionEnvelope,
  resolveAgentModelOutputEnvelope,
  toAgentModelOutputTurnError,
};

export function resolveAgentChatBehavior(input: {
  userText: string;
  hasUserAttachments?: boolean;
  settings: AgentChatExperienceSettings;
}): AgentResolvedBehavior {
  const resolvedTurnMode = resolveAgentTurnMode({
    userText: input.userText,
    hasUserAttachments: input.hasUserAttachments,
  });
  const resolvedExperiencePolicy = resolveAgentExperiencePolicy({
    turnMode: resolvedTurnMode,
  });
  return {
    settings: input.settings,
    resolvedTurnMode,
    resolvedExperiencePolicy,
  };
}
