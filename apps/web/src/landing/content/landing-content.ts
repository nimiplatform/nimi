import type { LandingLocale } from '../i18n/locale.js';
import type { AdmittedCapability } from '../generated/index.js';

export type LandingContent = {
  skipToContent: string;
  nav: {
    enterNimi: string;
    install: string;
    sdk: string;
    catalog: string;
    architecture: string;
    desktop: string;
    apps: string;
    security: string;
    openSource: string;
    faq: string;
  };
  hero: {
    eyebrow: string;
    title: string;
    titleAccent: string;
    subtitle: string;
    helperPrefix: string;
    helperDocsCta: string;
    helperGithubCta: string;
    copyTooltipLabel: string;
    copiedCommandLabel: string;
    previewAlt: string;
    getStartedTitle: string;
    getStartedSubtitle: string;
    tabs: Array<{
      id: string;
      label: string;
      command: string;
      ctaText: string;
    }>;
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
    diagram: {
      appLabel: string;
      realm: string;
      runtime: string;
      cloudContextPlane: string;
      localExecutionPlane: string;
      cloudContext: string;
      localCompute: string;
      realmDomains: ReadonlyArray<{ id: string; label: string; icon: string }>;
      runtimeCapabilities: ReadonlyArray<{ id: string; label: string; icon: string }>;
      crossCutting: ReadonlyArray<{ id: string; label: string; icon: string }>;
      transportLabels: { rest: string; grpc: string };
      mobileFallback: { sdkLabel: string; sdkDescription: string };
    };
  };
  modelCatalog: {
    kicker: string;
    title: string;
    subtitle: string;
    overview: {
      searchPlaceholder: string;
      cloudProvidersLabel: string;
      localModelsLabel: string;
      modalitiesLabel: string;
      modalitiesDescription: string;
      industryLeadersLabel: string;
      shortcutLabel: string;
      clearSearchLabel: string;
      matchingProvidersLabel: string;
      liveCatalogLabel: string;
      supportedByLabel: string;
    };
    liveBadge: string;
    featuredProvidersLabel: string;
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
    capabilityLabels: Record<AdmittedCapability, string>;
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
    providerDisplayNames: Readonly<Record<string, string>>;
    marqueeProviderOrder: ReadonlyArray<string>;
  };
  sdk: {
    eyebrow: string;
    title: string;
    titleAccent: string;
    subtitle: string;
    callout: string;
    primaryCta: string;
    secondaryCta: string;
    codeWindowTitle: string;
    codeWindowCaption: string;
    matrixEyebrow: string;
    matrixTitle: string;
    matrixSubtitle: string;
    runtimeBadges: ReadonlyArray<string>;
    heroHighlights: ReadonlyArray<{
      title: string;
      description: string;
    }>;
    tabs: ReadonlyArray<{
      id: string;
      label: string;
      description: string;
      docsPath: string;
      previewMediaId: 'sdk' | 'multimodal' | 'streamJob' | 'workflow';
    }>;
    capabilityMatrix: ReadonlyArray<{
      title: string;
      description: string;
      docsPath: string;
    }>;
    previewMedia: {
      sdk: { alt: string };
      multimodal: { alt: string };
      streamJob: { alt: string };
      workflow: { alt: string };
    };
  };
  desktop: {
    title: string;
    subtitle: string;
    chromeLabels: {
      appName: string;
      runtime: string;
      health: string;
      healthDetail: string;
      workspace: string;
      activity: string;
      ready: string;
      connected: string;
      installed: string;
    };
    features: ReadonlyArray<{
      icon: string;
      title: string;
      description: string;
    }>;
    downloadCta: string;
    availability: {
      eyebrow: string;
      items: ReadonlyArray<string>;
    };
  };
  apps: {
    eyebrow: string;
    title: string;
    subtitle: string;
    cta: string;
    cards: ReadonlyArray<{
      label: string;
      title: string;
      description: string;
    }>;
    notes: ReadonlyArray<string>;
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
  openSource: {
    title: string;
    subtitle: string;
    description: string;
    githubCta: string;
    docsCta: string;
    roadmapCta: string;
    proofItems: ReadonlyArray<{
      label: string;
      value: string;
      detail: string;
      icon: 'runtime' | 'apps' | 'contracts';
      featured?: boolean;
    }>;
  };
  footer: {
    line1: string;
    line2: string;
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

export function loadLandingContent(locale: LandingLocale): Promise<LandingContent> {
  if (locale === 'zh') {
    landingContentCache.zh ??= import('./landing-content.zh.js').then((module) => module.landingContentZh);
    return landingContentCache.zh;
  }

  landingContentCache.en ??= import('./landing-content.en.js').then((module) => module.landingContentEn);
  return landingContentCache.en;
}
