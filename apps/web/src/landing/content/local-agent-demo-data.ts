import { getStoryCopy } from './story-copy.js';
import { exploreCharacters } from './explore-demo-data.js';
import type { HeroDemoAgent, HeroDemoZhiyuPartner } from './landing-content.js';

/**
 * Shared Home / Zhiyu presentation data. Identities and portraits come from the
 * published Explore catalog. The four opening exchanges are verbatim excerpts
 * from Character → 初次相遇 · 设定参考, reviewed in Home on 2026-11-03.
 * Authored names and dialogue stay in their original language, as in Explore.
 * No account conversations, personal memories or runtime configuration are exported.
 */
const excerpts = [
  {
    characterId: 'demo:cbdb-ming-lettered-networks-world:character-1',
    role: '资深文官与经学导师',
    greeting: '吾乃唐龙，字虞佐，兰溪人氏。正德三年进士，历仕两朝，今官至兵部尚书。',
    referenceImageUrl: '/demo/explore/tanglong-reference.webp',
    voiceUrl: '/demo/explore/tanglong-voice.mp3',
    voiceDuration: 36,
    opening: null,
  },
  {
    characterId: 'demo:meridian-archipelago:character-0',
    role: '石渠山门退修与公共汲取名册管理者',
    greeting: '差了三毫就是祸根，哪来的半刻通融？地脉不是井水，你这头多抽一口，下游三道闸口就得逆涌断流。按规矩查验封印，急躁只会把人骨头搭进去。',
    opening: '柳前辈，下游坞堡急需开闸引脉灌溉，能不能通融半刻？',
    voiceUrl: '/demo/explore/liuwenxing-voice.mp3',
    voiceDuration: 10,
  },
  {
    characterId: 'demo:emberware-court:character-1',
    role: '曾为地方刊物撰稿的花白发老住户',
    greeting: '清静？你那是没瞧见东头。禾罐一早就在廊檐下对光看砖，小炉火上还坐着温水呢。过日子就是这慢火候，忙乱都在暗处。',
    opening: '佩榆阿姨，今天院里怎么这么清静？',
    voiceUrl: '/demo/explore/peiyu-voice.mp3',
    voiceDuration: 18,
  },
  {
    characterId: 'demo:emberware-court:character-0',
    role: '砖画创作者 · 成体陶偶',
    greeting: '急不得。等这道斜阳移到第三格窗棂，阴影最深的时候，我才好拿矿彩点出檐下的烟痕。陶身稳，刀尖才不飘。',
    opening: '禾罐，你这块砖画要刻到什么时候？',
    voiceUrl: '/demo/explore/heguan-voice.mp3',
    voiceDuration: 14,
  },
  {
    characterId: 'demo:meridian-archipelago:character-1',
    role: '澄汊河城线路修复师 · 共线路修坊发起人',
    greeting: '等他们排上号，街坊早喝西北风去了。拿上铜锥和引信，咱们现在就下涵洞摸排，两个时辰内准给它重新续上！',
    opening: '罗师傅，街坊磨坊的石磨地息又断了，宗门工匠说过两月才排得上号。',
    voiceUrl: '/demo/explore/luomi-voice.mp3',
    voiceDuration: 7,
  },
] as const;

export function createLocalAgentDemoData(): HeroDemoAgent[] {
  return excerpts.map((excerpt, index) => {
    const character = exploreCharacters.find((entry) => entry.id === excerpt.characterId)!;
    const referenceImageUrl = 'referenceImageUrl' in excerpt ? excerpt.referenceImageUrl : character.image;
    return {
      id: character.id,
      name: character.name,
      initial: character.name.slice(0, 1),
      avatarUrl: character.image,
      bio: character.bio,
      worldName: character.worldName,
      role: excerpt.role,
      greeting: excerpt.greeting,
      referenceImageUrl,
      voiceUrl: excerpt.voiceUrl,
      voiceDuration: excerpt.voiceDuration,
      introduction: {
        worldName: character.worldName,
        era: null,
        role: excerpt.role,
        greeting: excerpt.greeting,
        referenceImageUrl,
        voiceSampleUrl: excerpt.voiceUrl,
        voicePreviewUrl: excerpt.voiceUrl,
        voiceSampleContentHash: null,
        voiceSampleMimeType: 'audio/mpeg',
        voiceSampleDurationSec: excerpt.voiceDuration,
        questionTopics: [{ kind: 'role', text: excerpt.role }],
      },
      messages: excerpt.opening === null ? [] : [
        { id: `${character.id}:opening:user`, role: 'user', text: excerpt.opening, minutesAgo: 8 + index * 10 },
        { id: `${character.id}:opening:agent`, role: 'assistant', text: excerpt.greeting, minutesAgo: 7 + index * 10 },
      ],
      replies: [excerpt.greeting],
    };
  });
}

/** Demo-only settings, shared by both public Kit Agent Center consumers. */
export function toLocalAgentDemoPartner(agent: HeroDemoAgent, locale: 'zh' | 'en'): HeroDemoZhiyuPartner {
  return {
    id: agent.id,
    name: agent.name,
    avatarUrl: agent.avatarUrl!,
    bio: agent.bio,
    introduction: agent.introduction,
    moodLabel: '',
    hostMoodLabel: null,
    hostActivityLabel: null,
    messages: agent.messages,
    replies: agent.replies ?? [],
    reasoning: null,
    // Explicitly illustrative, never exported from a real account or claimed as model-extracted.
    memories: agent.id === 'demo:emberware-court:character-0' ? [{
      id: 'illustrative-heguan-memory',
      content: getStoryCopy(locale)['experience.memorySeed'],
      epistemicStatus: 'explicit',
      daysAgo: 1,
      sourceExplanation: getStoryCopy(locale)['experience.memorySeedSource'],
    }] : [],
    autonomy: { enabled: false, mode: 'off', dailyTokenBudget: 8000, maxBackgroundOutputTokens: 800, usedTokensInWindow: 0 },
    appearance: { backendKind: null, avatarAssetRef: null, backgroundAssetRef: null, defaultVoiceReference: null, avatarAutoplay: false },
    aiConfig: [{ capability: 'text.generate', route: 'local' }, { capability: 'text.embed', route: 'local' }],
    manager: {
      lifecycleStatus: 'active',
      executionState: 'idle',
      statusText: '',
      currentEmotion: '',
      sourceReady: true,
      transcriptTurnCount: agent.messages.length,
      memoryItemCount: agent.id === 'demo:emberware-court:character-0' ? 1 : 0,
      lorebookItemCount: 0,
    },
  };
}

export function createLocalAgentDemoPartners(locale: 'zh' | 'en'): HeroDemoZhiyuPartner[] {
  return createLocalAgentDemoData().map(agent => toLocalAgentDemoPartner(agent, locale));
}
