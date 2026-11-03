import { createDemoUsers, createDemoSelf } from './demo-user-content.js';
import { createLocalAgentDemoData } from './local-agent-demo-data.js';
import type { HeroDemoAgent } from './landing-content.js';

/** Local agents share published character excerpts with Zhiyu; human contacts are fictional. */
export function createHomeChatData(locale: 'zh' | 'en') {
  const t = (zh: string, en: string) => (locale === 'zh' ? zh : en);
  const agents = createLocalAgentDemoData();
  const people = createDemoUsers(locale);
  const self = createDemoSelf(locale);
  const assistantThreads: HeroDemoAgent[] = [
    { id: 'ai:assistant', name: t('新对话', 'New conversation'), initial: 'N', messages: [] },
    {
      id: 'ai:plan',
      name: t('周末的创作安排', 'Weekend creative plan'),
      initial: 'N',
      messages: [
        {
          id: 'plan-1',
          role: 'user',
          text: t('帮我安排一个轻松的创作周末。', 'Help me plan a relaxed creative weekend.'),
          minutesAgo: 25,
        },
        {
          id: 'plan-2',
          role: 'assistant',
          text: t(
            '可以分成三个小段：\n\n- **周六上午**：散步拍照，收集灵感。\n- **周六下午**：选一个最感兴趣的主题，写一页草稿。\n- **周日上午**：整理成果，留出充分的休息时间。',
            'Try three small sessions:\n\n- **Saturday morning:** Take a photo walk and collect ideas.\n- **Saturday afternoon:** Choose one theme and write a page.\n- **Sunday morning:** Review your work and leave plenty of time to rest.',
          ),
          minutesAgo: 24,
        },
      ],
    },
  ];
  return { agents, people, assistantThreads, self };
}
export type DemoChatSubmission = {
  text: string;
  image?: string;
  quote?: { id: string; name: string; text: string };
};
