import zh from './story-copy.zh.json';
import en from './story-copy.en.json';

/** AGY Gemini 4 Argon copy, fact-audited before application. */
export type StoryKey = keyof typeof zh;
export type StoryCopy = Record<StoryKey, string>;
export type StoryText = (key: StoryKey) => string;
export function getStoryCopy(locale: 'zh' | 'en'): StoryCopy { return locale === 'zh' ? zh : en; }
