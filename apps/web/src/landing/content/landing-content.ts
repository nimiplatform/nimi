import type { LandingLocale } from '../i18n/locale.js';
import type { AdmittedCapability } from '../generated/index.js';

export type LandingContent = {
  skipToContent: string;
  nav: {
    experiences: string;
    catalog: string;
    desktop: string;
    apps: string;
    sdk: string;
    security: string;
    faq: string;
    docs: string;
    download: string;
  };
  hero: {
    title: string;
    titleAccent: string;
    subtitle: string;
    primaryCta: string;
    secondaryCta: string;
    proofPoints: ReadonlyArray<string>;
  };
  experiences: {
    eyebrow: string;
    title: string;
    subtitle: string;
    cards: ReadonlyArray<{
      id: string;
      label: string;
      title: string;
      description: string;
      scenario: string;
      points: ReadonlyArray<string>;
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
    title: string;
    subtitle: string;
    overview: {
      searchPlaceholder: string;
      cloudProvidersLabel: string;
      localModelsLabel: string;
      modalitiesLabel: string;
      modalitiesDescription: string;
      shortcutLabel: string;
      clearSearchLabel: string;
      matchingProvidersLabel: string;
      liveCatalogLabel: string;
      supportedByLabel: string;
    };
    // @nimi-authority: rule.nimi.platform.governance-release.p-gov-026-owner-boundary
    capabilityLabels: Record<AdmittedCapability, string>;
    providerDetailSuffix: string;
    noResultsTitle: string;
    noResultsDescription: string;
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
      previewMediaId: 'sdk' | 'multimodal' | 'streamJob' | 'runtime';
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
      runtime: { alt: string };
    };
  };
  desktop: {
    title: string;
    subtitle: string;
    chromeLabels: {
      appName: string;
      runtime: string;
      workspace: string;
      capabilities: string;
      localIntent: string;
      cloudIntent: string;
    };
    capabilitiesList: ReadonlyArray<{
      name: string;
      intent: 'local' | 'cloud';
    }>;
    features: ReadonlyArray<{
      icon: string;
      title: string;
      description: string;
    }>;
    downloadCta: string;
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
    linksAriaLabel: string;
    pillars: Array<{
      label: string;
      title: string;
      points: string[];
    }>;
    statuses: ReadonlyArray<{
      label: string;
      value: string;
    }>;
    links: ReadonlyArray<{
      label: string;
      detail: string;
      href: string;
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
    downloadLabel: string;
    codeSigningLabel: string;
    securityLabel: string;
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
