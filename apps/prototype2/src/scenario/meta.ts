/* Module registry (mock). Mirrors the design's generated registry shape at
 * product level: module id, main surface, accent, entry copy. No code loading
 * happens here — surfaces are static mock components. */

import type { ModuleId } from './types';

export interface ModuleMeta {
  id: ModuleId;
  name: string;
  en: string;
  tag: string;
  desc: string;
  accent: string;
}

export const MODULES: Record<ModuleId, ModuleMeta> = {
  desktop: {
    id: 'desktop',
    name: 'Desktop',
    en: 'Nimi Desktop',
    tag: '宿主桌面 · main',
    desc: '生态的主工作台：会话、探索与设置。',
    accent: 'var(--mod-desktop)',
  },
  zhiyu: {
    id: 'zhiyu',
    name: '织羽',
    en: 'Zhiyu',
    tag: 'AI 写作空间 · main',
    desc: '面向长文本的应用自有 AI 会话空间。',
    accent: 'var(--mod-zhiyu)',
  },
  tester: {
    id: 'tester',
    name: 'Tester',
    en: 'Nimi Tester',
    tag: '工作台 · main',
    desc: '生态能力的验证工作台与世界巡游观察窗。',
    accent: 'var(--mod-tester)',
  },
};

export const MODULE_ORDER: ModuleId[] = ['desktop', 'zhiyu', 'tester'];
