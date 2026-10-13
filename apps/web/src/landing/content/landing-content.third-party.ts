import type { PreviewTranslate } from '../i18n/preview-messages.js';
/** Public authored examples, localized by the landing content loader. */
export const createJevSearchPreviewContent = (t: PreviewTranslate) =>
  ({
    name: 'Jev Search',
    tagline: t('jevSearch.tagline'),
    query: t('jevSearch.query'),
    examples: [
      t('jevSearch.examples.item1'),
      t('jevSearch.examples.item2'),
      t('jevSearch.examples.item3'),
    ],
    results: [
      {
        source: 'Hacker News',
        url: 'news.ycombinator.com',
        title: t('jevSearch.results.item1.title'),
        description: t('jevSearch.results.item1.description'),
        relevance: 96,
      },
      {
        source: 'Google',
        url: 'rust-lang.org',
        title: t('jevSearch.results.item2.title'),
        description: t('jevSearch.results.item2.description'),
        relevance: 92,
      },
      {
        source: 'Hacker News',
        url: 'news.ycombinator.com',
        title: t('jevSearch.results.item3.title'),
        description: t('jevSearch.results.item3.description'),
        relevance: 85,
      },
    ],
    notice: t('jevSearch.notice'),
  }) as const;

export const createJevUltrafastPreviewContent = (t: PreviewTranslate) =>
  ({
    name: 'Jev Ultrafast',
    title: t('jevUltrafast.title'),
    description: t('jevUltrafast.description'),
    goal: t('jevUltrafast.goal'),
    steps: [
      {
        title: t('jevUltrafast.steps.item1.title'),
        action: 'CLICK',
        target: t('jevUltrafast.steps.item1.target'),
        detail: t('jevUltrafast.steps.item1.detail'),
        url: 'https://example.com',
        page: t('jevUltrafast.steps.item1.page'),
      },
      {
        title: t('jevUltrafast.steps.item2.title'),
        action: t('jevUltrafast.steps.item2.action'),
        target: t('jevUltrafast.steps.item2.target'),
        detail: t('jevUltrafast.steps.item2.detail'),
        url: 'https://www.iana.org/help/example-domains',
        page: t('jevUltrafast.steps.item2.page'),
      },
    ],
    notice: t('jevUltrafast.notice'),
  }) as const;

export const createMoneyPrinterPreviewContent = (t: PreviewTranslate) =>
  ({
    name: 'MoneyPrinterTurbo',
    subject: t('moneyPrinter.subject'),
    script: t('moneyPrinter.script'),
    terms: t('moneyPrinter.terms'),
    stages: [
      t('moneyPrinter.stages.item1'),
      t('moneyPrinter.stages.item2'),
      t('moneyPrinter.stages.item3'),
      t('moneyPrinter.stages.item4'),
      t('moneyPrinter.stages.item5'),
    ],
    materials: ['coast-morning.mp4', 'quiet-cafe.mp4', 'sunset-walk.mp4'],
    notice: t('moneyPrinter.notice'),
  }) as const;

export const createOpenwhisprPreviewContent = (t: PreviewTranslate) =>
  ({
    name: 'OpenWhispr',
    navigation: [
      t('openwhispr.navigation.home'),
      t('openwhispr.navigation.statistics'),
      t('openwhispr.navigation.chat'),
      t('openwhispr.navigation.notes'),
      t('openwhispr.navigation.uploads'),
      t('openwhispr.navigation.dictionary'),
      t('openwhispr.navigation.settings'),
    ],
    notes: [
      {
        title: t('openwhispr.notes.item1.title'),
        time: '10:24',
        duration: '00:18',
        text: t('openwhispr.notes.item1.text'),
        raw: t('openwhispr.notes.item1.raw'),
      },
      {
        title: t('openwhispr.notes.item2.title'),
        time: '09:16',
        duration: '00:12',
        text: t('openwhispr.notes.item2.text'),
        raw: t('openwhispr.notes.item2.raw'),
      },
      {
        title: t('openwhispr.notes.item3.title'),
        time: t('openwhispr.notes.item3.time'),
        duration: '00:09',
        text: t('openwhispr.notes.item3.text'),
        raw: t('openwhispr.notes.item3.raw'),
      },
    ],
    chatPrompt: t('openwhispr.chatPrompt'),
    chatReply: t('openwhispr.chatReply'),
    notice: t('openwhispr.notice'),
  }) as const;

export const createVideoLingoPreviewContent = (t: PreviewTranslate) =>
  ({
    name: 'VideoLingo',
    project: t('videoLingo.project'),
    file: 'weekend-by-the-sea.mp4',
    stages: [
      t('videoLingo.stages.item1'),
      t('videoLingo.stages.item2'),
      t('videoLingo.stages.item3'),
      t('videoLingo.stages.item4'),
    ],
    subtitles: [
      {
        time: '00:00:00 → 00:00:03',
        source: 'Leave a little room in your weekend.',
        target: '给你的周末留一点空白。',
      },
      {
        time: '00:00:03 → 00:00:06',
        source: 'Take a book and walk beside the sea.',
        target: '带一本书，沿着海边慢慢走。',
      },
      {
        time: '00:00:06 → 00:00:09',
        source: 'There is no need to hurry.',
        target: '不必着急赶路。',
      },
    ],
    notice: t('videoLingo.notice'),
  }) as const;

export const createVoiceStudioPreviewContent = (t: PreviewTranslate) =>
  ({
    name: 'VoiceStudio',
    navigation: [
      t('voiceStudio.navigation.clone'),
      t('voiceStudio.navigation.story'),
      t('voiceStudio.navigation.dubbing'),
      t('voiceStudio.navigation.savedVoices'),
      t('voiceStudio.navigation.transcribe'),
      t('voiceStudio.navigation.design'),
      t('voiceStudio.navigation.audiobook'),
      t('voiceStudio.navigation.projects'),
      t('voiceStudio.navigation.tools'),
    ],
    description: t('voiceStudio.description'),
    script: t('voiceStudio.script'),
    voices: [
      {
        name: t('voiceStudio.voices.item1.name'),
        detail: t('voiceStudio.voices.item1.detail'),
        initial: t('voiceStudio.voices.item1.initial'),
      },
      {
        name: t('voiceStudio.voices.item2.name'),
        detail: t('voiceStudio.voices.item2.detail'),
        initial: t('voiceStudio.voices.item2.initial'),
      },
      {
        name: t('voiceStudio.voices.item3.name'),
        detail: t('voiceStudio.voices.item3.detail'),
        initial: t('voiceStudio.voices.item3.initial'),
      },
    ],
    notice: t('voiceStudio.notice'),
  }) as const;

export type JevSearchPreviewContent = ReturnType<typeof createJevSearchPreviewContent>;
export type JevUltrafastPreviewContent = ReturnType<typeof createJevUltrafastPreviewContent>;
export type MoneyPrinterPreviewContent = ReturnType<typeof createMoneyPrinterPreviewContent>;
export type OpenwhisprPreviewContent = ReturnType<typeof createOpenwhisprPreviewContent>;
export type VideoLingoPreviewContent = ReturnType<typeof createVideoLingoPreviewContent>;
export type VoiceStudioPreviewContent = ReturnType<typeof createVoiceStudioPreviewContent>;
