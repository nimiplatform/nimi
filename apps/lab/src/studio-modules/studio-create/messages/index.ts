import type { AIStudioMessageBundles } from '../../../ai-studio-core/messages/index.js';
import en from './en.json' with { type: 'json' };
import zh from './zh.json' with { type: 'json' };

export const studioCreateMessageBundles = Object.freeze({ en, zh }) satisfies AIStudioMessageBundles;
