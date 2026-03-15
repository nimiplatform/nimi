import type { LandingLocale } from '../i18n/locale.js';

export type LandingContent = {
  localeName: string;
  skipToContent: string;
  nav: {
    install: string;
    sdk: string;
    catalog: string;
    architecture: string;
    desktop: string;
    security: string;
    mods: string;
    openSource: string;
    discord: string;
  };
  hero: {
    eyebrow: string;
    title: string;
    titleAccent: string;
    title2: string;
    titleAccent2: string;
    subtitle: string;
    description: string;
    primaryCta: string;
    docsCta: string;
    helperPrefix: string;
    helperDocsCta: string;
    helperGithubCta: string;
    copyTooltipLabel: string;
    copiedCommandLabel: string;
    githubCta: string;
    previewLabel: string;
    previewAlt: string;
    previewCaption: string;
    getStartedTitle: string;
    getStartedSubtitle: string;
    tabs: Array<{
      id: string;
      label: string;
      command: string;
      ctaText: string;
    }>;
    terminalMockupTitle: string;
  };
  architecture: {
    title: string;
    subtitle: string;
    description: string;
    devTitle: string;
    devText: string;
    userTitle: string;
    userText: string;
    conclusion: string;
    slogan: string;
  };
  modelCatalog: {
    kicker: string;
    title: string;
    subtitle: string;
    overview: {
      searchPlaceholder: string;
      cloudProvidersLabel?: string;
      localModelsLabel?: string;
      modalitiesLabel?: string;
      modalitiesValue?: string;
      modalitiesDescription?: string;
      industryLeadersLabel: string;
      shortcutLabel: string;
      clearSearchLabel: string;
      matchingProvidersLabel: string;
      liveCatalogLabel: string;
    };
    liveBadge: string;
    featuredProvidersLabel: string;
    featuredProviders: string[];
    stats: {
      providers: string;
      models: string;
      cloudProviders: string;
      localModels: string;
    };
    localTitle: string;
    localHeadline: string;
    localDescription: string;
    capabilitiesTitle: string;
    capabilitiesHeadline: string;
    capabilitiesDescription: string;
    capabilityLabels: {
      'text.generate': string;
      'text.embed': string;
      'image.generate': string;
      'video.generate': string;
      'audio.synthesize': string;
      'audio.transcribe': string;
    };
    capabilityCountLabel: string;
    cloudBadge: string;
    matrixTitle: string;
    matrixHeadline: string;
    matrixDescription: string;
    providerDetailSuffix: string;
    searchResultsTitle: string;
    searchResultsDescription: string;
    noResultsTitle: string;
    noResultsDescription: string;
    sourceNote: string;
  };
  sdk: {
    title: string;
    subtitle: string;
    tabs: Array<{
      label: string;
      snippet: string;
      caption: string;
    }>;
    previewLabel: string;
    previewAlt: string;
    previewCaption: string;
    multimodalLabel: string;
    multimodalAlt: string;
    multimodalCaption: string;
    callout: string;
  };
  desktop: {
    title: string;
    subtitle: string;
    screenshotAlt: string;
    features: Array<{
      icon: string;
      title: string;
      description: string;
    }>;
    downloadCta: string;
    availability: {
      eyebrow: string;
      items: string[];
    };
  };
  faq: {
    eyebrow: string;
    title: string;
    description: string;
    communityCta: string;
    items: Array<{
      question: string;
      answer: string;
    }>;
  };
  security: {
    title: string;
    subtitle: string;
    intro: string;
    pillars: Array<{
      label: string;
      title: string;
      points: string[];
    }>;
  };
  mods: {
    title: string;
    subtitle: string;
    items: Array<{
      icon: string;
      name: string;
      description: string;
    }>;
    buildModCta: string;
  };
  openSource: {
    title: string;
    subtitle: string;
    description: string;
    githubCta: string;
    docsCta: string;
  };
  finalCta: {
    title: string;
    description: string;
    primaryCta: string;
    githubCta: string;
  };
  footer: {
    line1: string;
    line2: string;
    termsLabel: string;
    privacyLabel: string;
  };
  localeToggleLabel: string;
  localeOptions: { en: string; zh: string };
};

const landingContentCache: Partial<Record<LandingLocale, Promise<LandingContent>>> = {};

export function loadLandingContent(locale: LandingLocale): Promise<LandingContent> {
  if (locale === 'zh') {
    landingContentCache.zh ??= import('./landing-content.zh.js').then((module) => module.landingContentZh);
    return landingContentCache.zh;
  }

  landingContentCache.en ??= import('./landing-content.en.js').then((module) => module.landingContentEn);
  return landingContentCache.en;
}
