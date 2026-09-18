import type { LandingLocale } from '../i18n/locale.js';
import type { CanonicalTranscriptViewProps } from '@nimiplatform/kit/features/chat/components/canonical-transcript-view';

export type LandingAppItem = {
  id: string;
  name: string;
  task: string;
  capabilities: ReadonlyArray<string>;
};

export type LandingCapabilityTask = {
  id: string;
  title: string;
  description: string;
};

export type LandingCreateStep = {
  title: string;
  description: string;
};

export type HeroDemoChatCopy = NonNullable<CanonicalTranscriptViewProps['copy']>;

export type HeroDemoMessageSeed = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** Minutes before the demo renders; relative stamps keep date separators alive. */
  minutesAgo: number;
};

export type HeroDemoAgent = {
  id: string;
  name: string;
  initial: string;
  messages: ReadonlyArray<HeroDemoMessageSeed>;
};

export type HeroDemoAppItem = {
  id: string;
  name: string;
  task: string;
  tags: ReadonlyArray<string>;
  updatedAt: string;
  /** Shows the local-development source glyph, matching the desktop list badge. */
  localDev: boolean;
};

export type HeroDemoZhiyuPreview = {
  appName: string;
  partnersLabel: string;
  emptyTitle: string;
  emptyDescription: string;
  composerPlaceholder: string;
  sendLabel: string;
  streamReplyText: string;
  sessionChipLabel: string;
  replyChipLabel: string;
  rapportChipLabel: string;
  readyChipLabel: string;
  streamingChipLabel: string;
  rapportChipText: string;
  stopLabel: string;
  panelTitle: string;
  panelCloseLabel: string;
  panelRows: ReadonlyArray<{ label: string; value: string }>;
  partners: ReadonlyArray<{
    id: string;
    name: string;
    cue: string;
    messages: ReadonlyArray<HeroDemoMessageSeed>;
  }>;
};

export type HeroDemoSurface = 'chat' | 'explore' | 'apps' | 'runtime' | 'settings';

export type HeroDemoRowGroup = {
  label: string;
  rows: ReadonlyArray<{ label: string; value: string }>;
};

export type HeroDemo = {
  windowTitle: string;
  nav: {
    chat: string;
    explore: string;
    apps: string;
    runtime: string;
    settings: string;
  };
  chat: {
    greeting: string;
    inputPlaceholder: string;
    inputNote: string;
    sendLabel: string;
    backLabel: string;
    userName: string;
    defaultTargetId: string;
    scriptedReply: string;
    /** Locale tag used by the demo's explicit date formatter (never the browser's). */
    dateLocale: string;
    dateLabels: { today: string; yesterday: string };
    copy: HeroDemoChatCopy;
    agents: ReadonlyArray<HeroDemoAgent>;
  };
  explore: {
    title: string;
    searchPlaceholder: string;
    sections: ReadonlyArray<{
      label: string;
      items: ReadonlyArray<{ name: string; meta: string }>;
    }>;
  };
  apps: {
    title: string;
    countSuffix: string;
    searchPlaceholder: string;
    backLabel: string;
    launchLabel: string;
    tabs: ReadonlyArray<string>;
    tabPlaceholderNote: string;
    aboutTitle: string;
    updatedLabel: string;
    moreInfoLabel: string;
    previewBadge: string;
    previewUnavailableTitle: string;
    previewUnavailableBody: string;
    closeLabel: string;
    items: ReadonlyArray<HeroDemoAppItem>;
  };
  appPreview: {
    /** Zhiyu is a zh-CN-first app; its preview copy intentionally stays zh. */
    zhiyu: HeroDemoZhiyuPreview;
  };
  runtime: {
    title: string;
    subtitle: string;
    groups: ReadonlyArray<HeroDemoRowGroup>;
  };
  settings: {
    title: string;
    groups: ReadonlyArray<HeroDemoRowGroup>;
  };
};

export type LandingContent = {
  skipToContent: string;
  nav: {
    apps: string;
    worlds: string;
    create: string;
    developers: string;
    docs: string;
    discord: string;
    menu: string;
    openMenu: string;
    closeMenu: string;
  };
  hero: {
    slogan: string;
    sloganAccent: string;
    subSlogan: string;
    paragraphs: ReadonlyArray<string>;
    downloadCta: string;
    docsCta: string;
    availableNote: string;
    demo: HeroDemo;
  };
  apps: {
    title: string;
    subtitle: string;
    body: string;
    listCta: string;
    itemCta: string;
    capabilityLabels: Readonly<Record<string, string>>;
    availabilityNote: string;
    groups: ReadonlyArray<{
      id: string;
      label: string;
      items: ReadonlyArray<LandingAppItem>;
    }>;
  };
  worlds: {
    title: string;
    subtitle: string;
    body: string;
    exampleTitle: string;
    exampleSteps: ReadonlyArray<string>;
    cta: string;
  };
  capabilities: {
    title: string;
    subtitle: string;
    tasks: ReadonlyArray<LandingCapabilityTask>;
    localTitle: string;
    localText: string;
    cloudTitle: string;
    cloudText: string;
    costNote: string;
    cta: string;
  };
  create: {
    title: string;
    subtitle: string;
    body: string;
    steps: ReadonlyArray<LandingCreateStep>;
    caveat: string;
    cta: string;
  };
  continuity: {
    title: string;
    subtitle: string;
    body: string;
    supports: ReadonlyArray<string>;
  };
  developers: {
    eyebrow: string;
    title: string;
    subtitle: string;
    body: string;
    points: ReadonlyArray<string>;
    primaryCta: string;
    secondaryCta: string;
  };
  getStarted: {
    title: string;
    subtitle: string;
    primaryCta: string;
    availability: string;
    secondaryCta: string;
  };
  footer: {
    line1: string;
    line2: string;
    navLabel: string;
    appsLabel: string;
    worldsLabel: string;
    createLabel: string;
    developersLabel: string;
    docsLabel: string;
    githubLabel: string;
    downloadLabel: string;
    codeSigningLabel: string;
    securityLabel: string;
    termsLabel: string;
    privacyLabel: string;
  };
  localeToggleLabel: string;
  localeOptions: {
    en: string;
    zh: string;
    switchToEn: string;
    switchToZh: string;
  };
};

const landingContentCache: Partial<Record<LandingLocale, Promise<LandingContent>>> = {};

function importLandingContent(locale: LandingLocale): Promise<LandingContent> {
  if (locale === 'zh') {
    return import('./landing-content.zh.js').then((module) => module.landingContentZh);
  }
  return import('./landing-content.en.js').then((module) => module.landingContentEn);
}

export function loadLandingContent(locale: LandingLocale): Promise<LandingContent> {
  const cached = landingContentCache[locale];
  if (cached) {
    return cached;
  }

  const pending = importLandingContent(locale);
  landingContentCache[locale] = pending;
  // A rejected chunk import must not poison the cache: clearing it lets the
  // retry action issue a fresh import instead of replaying the failure.
  pending.catch(() => {
    if (landingContentCache[locale] === pending) {
      delete landingContentCache[locale];
    }
  });
  return pending;
}
