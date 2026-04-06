import type { DerivedInteractionProfile, LocalChatTurnMode } from './types.js';

const QUESTION_RE = /[?？]|为什么|怎么|如何|能不能|可不可以|是什么|什么意思|怎样/u;
const EMOTIONAL_RE = /难过|好累|很累|烦|崩溃|想哭|孤单|害怕|抱抱|安慰|委屈|想你|心情不好|睡不着/u;
const PLAYFUL_RE = /哈哈|hh+|笑死|好耶|太好了|天啊|卧槽|嘿嘿|一起玩|烟花|庆祝|可爱/u;
const INTIMATE_RE = /亲|抱|想你|暧昧|恋人|喜欢你|爱你|想抱你|亲你一下|接吻/u;
const EXPLICIT_MEDIA_RE = /发图|来张图|发一张|看看你|照片|图片|视频|发个视频|自拍|给我看/u;
const EXPLICIT_VOICE_RE = /语音|说话|声音|读给我听|直接说|用语音/u;
const CHECKIN_RE = /^(在吗|早安|晚安|想你了|喂|hi|hello|hey|你好|嗨)[\s!,.?？！，。~]*$/iu;

export function resolveTurnMode(input: {
  userText: string;
  interactionProfile: DerivedInteractionProfile;
  proactive?: boolean;
}): LocalChatTurnMode {
  const text = String(input.userText || '').trim();
  if (input.proactive) return 'checkin';
  if (EXPLICIT_VOICE_RE.test(text)) return 'explicit-voice';
  if (EXPLICIT_MEDIA_RE.test(text)) return 'explicit-media';
  if (CHECKIN_RE.test(text)) return 'checkin';
  if (INTIMATE_RE.test(text)) return 'intimate';
  if (EMOTIONAL_RE.test(text)) return 'emotional';
  if (PLAYFUL_RE.test(text)) return 'playful';
  if (QUESTION_RE.test(text)) return 'information';
  if (input.interactionProfile.expression.pacingBias === 'bursty') return 'playful';
  // Default to emotional for general conversation — allows multi-beat replies.
  // Pure information queries are caught by QUESTION_RE above.
  return 'emotional';
}
