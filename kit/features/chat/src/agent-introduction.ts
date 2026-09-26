import type { NimiLocalAppAgentIntroduction } from '@nimiplatform/kit/core/sdk-contract';
import { simplifyChineseDisplayText } from './introduction-text.js';

const DYNASTIES: Record<string, string> = { qin: '秦代', han: '汉代', sui: '隋代', tang: '唐代', song: '宋代', liao: '辽代', jin: '金代', yuan: '元代', ming: '明代', qing: '清代' };
const STYLE_LABELS: Record<string, readonly [string, string]> = {
  "CARING": [
    "照护型",
    "Caring"
  ],
  "PLAYFUL": [
    "顽皮型",
    "Playful"
  ],
  "INTELLECTUAL": [
    "理智型",
    "Intellectual"
  ],
  "CONFIDENT": [
    "自信型",
    "Confident"
  ],
  "MYSTERIOUS": [
    "神秘型",
    "Mysterious"
  ],
  "ROMANTIC": [
    "浪漫型",
    "Romantic"
  ],
  "HUMOROUS": [
    "幽默",
    "Humorous"
  ],
  "SARCASTIC": [
    "讽刺",
    "Sarcastic"
  ],
  "GENTLE": [
    "温和",
    "Gentle"
  ],
  "DIRECT": [
    "直率",
    "Direct"
  ],
  "OPTIMISTIC": [
    "乐观",
    "Optimistic"
  ],
  "REALISTIC": [
    "务实",
    "Realistic"
  ],
  "DRAMATIC": [
    "戏剧化",
    "Dramatic"
  ],
  "PASSIONATE": [
    "热情",
    "Passionate"
  ],
  "REBELLIOUS": [
    "叛逆",
    "Rebellious"
  ],
  "INNOCENT": [
    "天真",
    "Innocent"
  ],
  "WISE": [
    "睿智",
    "Wise"
  ],
  "ECCENTRIC": [
    "古怪",
    "Eccentric"
  ],
  "CONVERSATION": [
    "对话",
    "Conversation"
  ]
};

export function agentIntroductionDisplayText(value: string, locale: string): string {
  const label = STYLE_LABELS[value.toUpperCase()]?.[locale.startsWith('zh') ? 0 : 1] ?? value;
  return locale.startsWith('zh') ? simplifyChineseDisplayText(label) : label;
}

export function agentIntroductionSubtitle(value: NimiLocalAppAgentIntroduction | null, locale: string): string | null {
  if (!value) return null;
  const era = value.era?.trim();
  // Only interpret the authored era field. Never infer a dynasty from IDs.
  const eraKey = era?.toLowerCase().replace(/[-_\s]?dynasty$/u, '');
  const location = era && locale.startsWith('zh') ? DYNASTIES[eraKey ?? ''] ?? era : era;
  return [...new Set([location || value.worldName, value.role].filter((text): text is string => Boolean(text)).map(text => agentIntroductionDisplayText(text, locale)))].join(' · ') || null;
}

export function agentIntroductionQuestions(value: NimiLocalAppAgentIntroduction | null, locale: string): readonly string[] {
  const zh = locale.startsWith('zh');
  const result: string[] = [];
  for (const topic of value?.questionTopics ?? []) {
    const text = agentIntroductionDisplayText(topic.text, locale).replace(/[。.!！?？]+$/u, '').trim();
    if (!text || text.length > 80 || /^[a-z0-9]+(?:[-_][a-z0-9]+)+$/u.test(text)
      || /^[A-Za-z][A-Za-z0-9]*[:：]/u.test(text) || /[()（）]/u.test(text)
      || (topic.kind === 'work' && text === '著述线索')) continue;
    const question = topic.kind === 'role'
      ? zh ? `你为什么被称为${text}？` : `Why are you known as ${text}?`
      : topic.kind === 'work'
        ? zh ? `你的《${text}》为什么重要？` : `Why does your ${text} matter?`
        : topic.kind === 'relationship'
          ? zh ? `你和${text}有什么关系？` : `How are you connected to ${text}?`
          : zh ? `你会如何解释${text}？` : `How would you explain ${text}?`;
    if (!result.includes(question)) result.push(question);
    if (result.length === 2) break;
  }
  return result.length ? result : zh ? ['介绍一下你自己', '陪我随便聊聊', '给我讲个有趣的故事'] : ['Introduce yourself', 'Chat with me for a while', 'Tell me an interesting story'];
}
