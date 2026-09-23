import type { LandingLocale } from '../i18n/locale.js';
import type { CanonicalTranscriptViewProps } from '@nimiplatform/kit/features/chat/components/canonical-transcript-view';

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
  /**
   * Real App icon served from /demo. Apps without one fall back to the
   * desktop's deterministic gradient tile with the name's first glyph.
   */
  iconSrc?: string;
};

export type HeroDemoZhiyuMemorySeed = {
  id: string;
  content: string;
  epistemicStatus: 'explicit' | 'inferred' | 'consolidated';
  /** Days before the demo renders. */
  daysAgo: number;
  sourceExplanation: string;
};

export type HeroDemoZhiyuCapabilityRoute = 'local' | 'cloud';

/**
 * One seeded Zhiyu transcript message. Text is the default; voice and image
 * seeds carry the same metadata the kit transcript reads for the real shell
 * (`voiceUrl` / `voiceTranscript`, `mediaUrl` / `caption`), and the files
 * live under `public/demo/zhiyu/`.
 */
export type HeroDemoZhiyuMessageSeed = HeroDemoMessageSeed & (
  | { kind?: 'text' }
  | { kind: 'voice'; voiceUrl: string; voiceTranscript: string }
  | { kind: 'image'; mediaUrl: string; caption?: string }
);

/**
 * One mock local partner. Everything the real Zhiyu shell reads from Runtime
 * for a partner (conversation, companion state, and the Agent Center's
 * shared AIConfig, autonomy, presentation, memory, and manager snapshot) is
 * seeded here so the preview can run the same kit surfaces on mock data.
 */
export type HeroDemoZhiyuPartner = {
  id: string;
  name: string;
  /** Rail and transcript avatar; null falls back to the name's initial like the shell. */
  avatarUrl: string | null;
  /** Companion chip text next to the composer (相处 · …). */
  moodLabel: string;
  /** Host-context chips above the Agent Center; null hides the chip. */
  hostMoodLabel: string | null;
  hostActivityLabel: string | null;
  messages: ReadonlyArray<HeroDemoZhiyuMessageSeed>;
  /** Scripted replies streamed in order for every message the visitor sends. */
  replies: ReadonlyArray<string>;
  /** Optional "思考片段" shown while a reply streams. */
  reasoning: string | null;
  memories: ReadonlyArray<HeroDemoZhiyuMemorySeed>;
  autonomy: {
    enabled: boolean;
    mode: 'off' | 'low' | 'medium' | 'high';
    dailyTokenBudget: number;
    maxTokensPerHook: number;
    usedTokensInWindow: number;
  };
  appearance: {
    backendKind: 'live2d' | 'vrm' | null;
    avatarAssetRef: string | null;
    backgroundAssetRef: string | null;
    defaultVoiceReference: string | null;
    avatarAutoplay: boolean;
  };
  /** Capabilities with a saved intent; the rest render as not configured. */
  aiConfig: ReadonlyArray<{
    capability: 'text.generate' | 'text.embed' | 'audio.transcribe' | 'audio.synthesize' | 'realtime.interact' | 'image.generate';
    route: HeroDemoZhiyuCapabilityRoute;
  }>;
  manager: {
    lifecycleStatus: 'initializing' | 'active' | 'suspended';
    executionState: 'idle' | 'chat-active' | 'life-pending' | 'life-running';
    statusText: string;
    currentEmotion: string;
    /** Whether the character source has materialized; false shows the blocked state. */
    sourceReady: boolean;
    transcriptTurnCount: number;
    memoryItemCount: number;
    lorebookItemCount: number;
  };
};

export type HeroDemoZhiyuPreview = {
  appName: string;
  /** Strings the Zhiyu shell hardcodes; kept here so the preview matches them. */
  copy: {
    railLabel: string;
    currentPartnerAriaPrefix: string;
    selectPartnerAriaPrefix: string;
    emptyEyebrow: string;
    emptyTitle: string;
    emptyDescription: string;
    composerPlaceholder: string;
    sendLabel: string;
    attachLabel: string;
    streamingHint: string;
    streamingSendHint: string;
    streamingPlaceholder: string;
    reasoningLabel: string;
    stopLabel: string;
    stopAriaLabel: string;
    avatarAriaPrefix: string;
    avatarLaunchLabel: string;
    avatarConfigureLabel: string;
    proactiveLabel: string;
    agentCenterLabel: string;
    agentCenterCloseLabel: string;
    sessionChipLabel: string;
    replyChipLabel: string;
    rapportChipLabel: string;
    readyChipLabel: string;
    streamingChipLabel: string;
    idleChipLabel: string;
    panelAriaLabel: string;
    panelTitle: string;
    panelEyebrow: string;
    panelCloseLabel: string;
    panelNavLabel: string;
    panelLoadFailed: string;
    dateLabels: { today: string; yesterday: string };
    /** Kit transcript labels (voice and image bubbles) localized for the zh shell. */
    chat: HeroDemoChatCopy;
  };
  /** Copy that exists only because this is a preview (no desktop host behind it). */
  demo: {
    runtimeSettingsNotice: string;
    avatarLaunchNotice: string;
    noticeDismissLabel: string;
    voiceTranscriptSample: string;
    resourcePackFileName: string;
    avatarFileNames: { live2d: string; vrm: string };
    backgroundFileName: string;
    localModelLabels: Readonly<Record<string, string>>;
    cloudConnectorLabel: string;
    cloudTargetLabels: Readonly<Record<string, string>>;
    presetVoices: ReadonlyArray<{ voiceId: string; name: string }>;
  };
  partners: ReadonlyArray<HeroDemoZhiyuPartner>;
};

export type HeroDemoShijingTone = 'supportive' | 'steady' | 'watch' | 'blocked' | 'turning';
export type HeroDemoShijingTabId = 'rijing' | 'yuejing' | 'nianjing' | 'mingjing' | 'hejing' | 'shijing';
// The three admitted 命理 method profiles (nimiapp-shijing domain/algorithm-method-profile.ts).
export type HeroDemoShijingMethodId = 'bazi_ziping_v1' | 'ziwei_sanhe_v1' | 'qizheng_siyu_guolao_v1';
export type HeroDemoShijingElement = 'wood' | 'fire' | 'earth' | 'metal' | 'water';
export type HeroDemoShijingPillarPosition = 'year' | 'month' | 'day' | 'hour';
export type HeroDemoShijingBaziCoreKey =
  | 'personality'
  | 'strengths'
  | 'long_term_themes'
  | 'relationship_pattern'
  | 'career_inclination';
export type HeroDemoShijingProfileKey =
  | 'life_pattern'
  | 'strengths'
  | 'long_term_theme'
  | 'relationship_pattern'
  | 'career_inclination';

/** 命镜 · 八字子平法 route (MingJingChart projection + deterministic narrative + one AI reading). */
export type HeroDemoShijingBaziRoute = {
  hero: {
    eyebrow: string;
    title: string;
    dayMaster: string;
    patternTag: string;
    strengthTag: string;
    strengthClass: 'weak' | 'balanced' | 'strong';
    persona: string;
    favorableTitle: string;
    adverseTitle: string;
    favorable: ReadonlyArray<HeroDemoShijingElement>;
    adverse: ReadonlyArray<HeroDemoShijingElement>;
    favorableHint: string;
    currentStageLabel: string;
    dayunWord: string;
    notStarted: string;
    seeStages: string;
    current: { pillar: string; stemElement: HeroDemoShijingElement; ageRange: string; nature: HeroDemoShijingTone } | null;
  };
  paipan: {
    sectionTitle: string;
    sectionIntro: string;
    structureBadge: string;
    dayBadge: string;
    dayMaster: string;
    pillarLabels: Record<HeroDemoShijingPillarPosition, string>;
    roles: Record<HeroDemoShijingPillarPosition, string>;
    rows: { hidden: string; tenGod: string; nayin: string; terrain: string; voidRow: string };
    voidMark: string;
    voidEmpty: string;
    expand: string;
    collapse: string;
    detailTitle: string;
    columns: ReadonlyArray<{
      position: HeroDemoShijingPillarPosition;
      stemHanzi: string;
      stemElement: HeroDemoShijingElement;
      branchHanzi: string;
      branchElement: HeroDemoShijingElement;
      hidden: ReadonlyArray<{ hanzi: string; element: HeroDemoShijingElement; weight: string }>;
      tenGod: string;
      nayin: string;
      terrain: string;
      isVoid: boolean;
      isDay: boolean;
    }>;
    five: {
      title: string;
      explanation: string;
      labels: Record<HeroDemoShijingElement, string>;
      count: Record<HeroDemoShijingElement, number>;
      dominant: HeroDemoShijingElement;
      weakest: HeroDemoShijingElement;
      summary: string;
    };
    geju: { strengthLabel: string; supportRatioLabel: string; yong: string; ji: string; relationsLabel: string; relationsEmpty: string };
    strengthBand: string;
    supportRatio: string;
    yong: ReadonlyArray<HeroDemoShijingElement>;
    ji: ReadonlyArray<HeroDemoShijingElement>;
    relations: ReadonlyArray<string>;
  };
  dayun: {
    sectionTitle: string;
    explanation: string;
    directionLabel: string;
    startAgeLabel: string;
    introSegments: ReadonlyArray<{ text: string; tone?: 'current' | 'highlight' }>;
    currentLabel: string;
    highlightLabel: string;
    cols: { age: string; years: string; pillar: string; tenGod: string; terrain: string; nature: string };
    distantTitle: string;
    distantDescription: string;
    distantStartAge: number;
    currentIndex: number;
    highlightIndex: number;
    periods: ReadonlyArray<{
      pillar: string;
      stemElement: HeroDemoShijingElement;
      startAge: number;
      endAge: number;
      startYear: number;
      endYear: number;
      tenGod: string;
      terrainLabel: string;
      nature: HeroDemoShijingTone;
      favor: string;
      isCurrent: boolean;
      isInflection: boolean;
      phaseTitle: string;
      explanation: string;
    }>;
  };
  liunian: {
    title: string;
    intro: string;
    explanation: string;
    horizonLabel: string;
    yearsLabel: string;
    detailToggle: string;
    evidenceLabel: string;
    dayunLabel: string;
    salienceLabels: Record<'high' | 'medium', string>;
    favorLabels: Record<string, string>;
    /** `{count}` placeholder templates. */
    relationMore: string;
    basisMore: string;
    empty: string;
    windows: ReadonlyArray<{
      range: string;
      nature: HeroDemoShijingTone;
      favor: string;
      salience: 'high' | 'medium';
      badge: string;
      plain: string;
      pillars: ReadonlyArray<{ year: number; ganzhi: string }>;
      dayunPillar: string | null;
      relations: ReadonlyArray<string>;
      basis: ReadonlyArray<string>;
    }>;
  };
  events: {
    title: string;
    intro: string;
    explanation: string;
    dateLabel: string;
    datePlaceholder: string;
    bodyLabel: string;
    bodyPlaceholder: string;
    add: string;
    invalidHint: string;
    empty: string;
    delete: string;
    dayunColumn: string;
    liunianColumn: string;
    preGenHint: string;
    items: ReadonlyArray<{
      id: string;
      date: string;
      body: string;
      resonance: {
        dayunPillar: string | null;
        dayunTenGod: string | null;
        dayunNature: HeroDemoShijingTone;
        liunianPillar: string;
        liunianNature: HeroDemoShijingTone;
      } | null;
    }>;
  };
  reading: {
    eyebrow: string;
    coreTitle: string;
    explanation: string;
    coreLabels: Record<HeroDemoShijingBaziCoreKey, string>;
    strategiesTitle: string;
    output: {
      summary: string;
      core: Record<HeroDemoShijingBaziCoreKey, string>;
      strategies: ReadonlyArray<{ pillar: string; ageRange: string; theme: string; strategy: string }>;
    };
  };
  rectifyEntry: string;
};

export type HeroDemoShijingZiweiStar = { name: string; brightness: string; mutagen: '' | '禄' | '权' | '科' | '忌' };

/** 命镜 · 紫微斗数(三合派) route (ZiweiSubjectChart + palace domain copy + one AI brief). */
export type HeroDemoShijingZiweiRoute = {
  copy: {
    personaMark: string;
    personaTitle: string;
    personaSubtitle: string;
    chartTitle: string;
    chartHint: string;
    centralEyebrow: string;
    emptyPalace: string;
    minorStars: string;
    majorStars: string;
    palaceDetailEyebrow: string;
    stemBranchLabel: string;
    sihuaLabel: string;
    interpretationTitle: string;
    decadeTitle: string;
    decadeEmpty: string;
    soulRole: string;
    bodyRole: string;
    selectedRole: string;
    basis: { soulPalace: string; bodyPalace: string; fiveElements: string; soulStar: string; bodyStar: string; palaces: string };
    astrolabeAria: string;
    briefAria: string;
    briefEyebrow: string;
    briefTitle: string;
    profileLabels: Record<HeroDemoShijingProfileKey, string>;
    profileNumerals: Record<HeroDemoShijingProfileKey, string>;
  };
  basis: { soulPalace: string; bodyPalace: string; fiveElementsClass: string; soulStar: string; bodyStar: string; palaceCount: number };
  palaces: ReadonlyArray<{
    index: number;
    name: string;
    stem: string;
    branch: string;
    isSoul: boolean;
    isBody: boolean;
    major: ReadonlyArray<HeroDemoShijingZiweiStar>;
    minor: ReadonlyArray<HeroDemoShijingZiweiStar>;
    startAge: number;
    endAge: number;
  }>;
  palaceDomains: Record<string, { tagline: string; scope: string; boundary: string }>;
  defaultPalaceDomain: { tagline: string; scope: string; boundary: string };
  reading: {
    summary: string;
    profile: Record<HeroDemoShijingProfileKey, string>;
    decadeGuidance: ReadonlyArray<{ ageRange: string; palaceName: string; theme: string; strategy: string }>;
  };
};

export type HeroDemoShijingQizhengStrength = '七强' | '次强' | '闲宫';
export type HeroDemoShijingQizhengStar = {
  key: string;
  label: string;
  planet: string;
  element: string;
  color: string;
  bg: string;
  essence: string;
  houseName: string;
  mansion: string;
  strength: HeroDemoShijingQizhengStrength;
  strengthLabel: string;
  degree: string;
  kind: 'qizheng' | 'siyu';
  isMing: boolean;
  deep: string;
};

/** 命镜 · 七政四余/果老星宗 route (QizhengSiyuSubjectChart + deterministic narrative + one AI reading). */
export type HeroDemoShijingQizhengRoute = {
  copy: {
    heroEyebrow: string;
    favorableTitle: string;
    watchTitle: string;
    basisTitle: string;
    viewIntro: string;
    viewPlain: string;
    viewData: string;
    viewToggleAria: string;
    explainerTitle: string;
    explainerBody: string;
    qizhengCardTitle: string;
    qizhengCardBody: string;
    siyuCardTitle: string;
    siyuCardBody: string;
    explainerHint: string;
    chartTitle: string;
    chartHint: string;
    wheelCenterEyebrow: string;
    deepTitle: string;
    starsTitle: string;
    starsHint: string;
    starGoPalace: string;
    patternsTitle: string;
    patternsHint: string;
    basisSectionTitle: string;
    basisSectionHint: string;
    ctaEyebrow: string;
    ctaTitle: string;
    ctaBody: string;
    ctaButton: string;
    readingTitleSuffix: string;
    emptyDetail: string;
    terms: { mingZhu: string; qizheng: string; siyu: string; emptyHouse: string };
    chartAria: string;
    bodiesTitle: string;
    housesTitle: string;
    emptyHouse: string;
    bodyColumns: { body: string; house: string; mansion: string; position: string; longitude: string };
    readingAria: string;
    starGuidanceTitle: string;
    profileLabels: Record<HeroDemoShijingProfileKey, string>;
  };
  hero: {
    title: string;
    subtitleChips: ReadonlyArray<string>;
    oneLiner: string;
    paragraph: string;
    favorable: ReadonlyArray<string>;
    watch: ReadonlyArray<string>;
    basisLabel: string;
    mingZhuLabel: string;
  };
  stars: ReadonlyArray<HeroDemoShijingQizhengStar>;
  palaces: ReadonlyArray<{
    index: number;
    name: string;
    range: string;
    domain: string;
    strength: HeroDemoShijingQizhengStrength;
    countLabel: string;
    isEmpty: boolean;
    ruler: string;
    occupants: ReadonlyArray<HeroDemoShijingQizhengStar>;
    deep: string;
  }>;
  patterns: ReadonlyArray<{
    id: string;
    tag: string;
    tone: 'accent' | 'gold' | 'warn';
    title: string;
    summary: string;
    glyphs: ReadonlyArray<{ name: string; color: string }>;
    deep: string;
  }>;
  gloss: Record<string, string>;
  basisRows: ReadonlyArray<{ term: string; label: string; value: string }>;
  houses: ReadonlyArray<{ name: string; range: string; occupants: string }>;
  reading: {
    summary: string;
    profile: Record<HeroDemoShijingProfileKey, string>;
    starGuidance: ReadonlyArray<{ bodyKey: string; bodyLabel: string; houseName: string; mansion: string; theme: string; strategy: string }>;
  };
};

/** 命镜 is method-routed: the global 推演方法 select picks which route renders. */
export type HeroDemoShijingMingjing = {
  title: string;
  tendencyLabels: Record<HeroDemoShijingTone, string>;
  reading: { generate: string; regenerate: string; generating: string; empty: string; stale: string };
  bazi: HeroDemoShijingBaziRoute;
  ziwei: HeroDemoShijingZiweiRoute;
  qizheng: HeroDemoShijingQizhengRoute;
};

/** ShiJing (时镜) preview content. The app is zh-CN-first, so this stays zh. */
export type HeroDemoShijingPreview = {
  appName: string;
  brandName: string;
  brandTagline: string;
  accountName: string;
  accountMenuLabel: string;
  navAriaLabel: string;
  methodProfiles: ReadonlyArray<{ id: HeroDemoShijingMethodId; label: string }>;
  tabs: ReadonlyArray<{ id: HeroDemoShijingTabId; label: string }>;
  rijing: {
    title: string;
    refreshLabel: string;
    refreshingLabel: string;
    refreshedHint: string;
    importLabel: string;
    hero: {
      eyebrow: string;
      headline: string;
      subtitle: string;
      leanings: ReadonlyArray<{ label: string; tone: HeroDemoShijingTone }>;
      meter: { percent: number; band: string; stage: string; guidance: string };
      meterAxisStart: string;
      meterAxisEnd: string;
      meterStrengthLabel: string;
      meterStageConnector: string;
      meterStageSuffix: string;
      confidencePrefix: string;
      confidenceLabel: string;
      confidenceNote: string;
      eventTitle: string;
      eventBody: string;
      eventGuidance: string;
      eventAction: string;
      closingLabel: string;
      closingWish: string;
      flipToRite: string;
      flipToOverview: string;
      rite: {
        eyebrow: string;
        lunarTitle: string;
        ganzhiLine: string;
        suitableTitle: string;
        suitable: ReadonlyArray<string>;
        unsuitableTitle: string;
        unsuitable: ReadonlyArray<string>;
        cells: ReadonlyArray<{ label: string; value: string }>;
        hoursTitle: string;
        hours: ReadonlyArray<{ branch: string; luck: string }>;
      };
    };
    projections: {
      title: string;
      allLabel: string;
      manageLabel: string;
      rows: ReadonlyArray<{ id: string; name: string; tone: HeroDemoShijingTone; tendencyLabel: string; takeaway: string; detail: string }>;
    };
    eventInput: {
      title: string;
      intro: string;
      placeholder: string;
      submit: string;
      successHint: string;
      refsBadge: string;
      references: ReadonlyArray<string>;
    };
    actions: {
      title: string;
      groups: ReadonlyArray<{ id: string; name: string; recommendations: ReadonlyArray<string> }>;
    };
    evidence: {
      title: string;
      chips: ReadonlyArray<{ label: string; value: string }>;
    };
  };
  yuejing: {
    title: string;
    generatedAgo: string;
    importLabel: string;
    generateLabel: string;
    /** ISO date of the demo's "today"; the 30-day window starts here. */
    startDate: string;
    weekdayHeaders: ReadonlyArray<string>;
    weekdayShort: ReadonlyArray<string>;
    tendencyLabels: Record<HeroDemoShijingTone, string>;
    todayBodyByTone: Record<HeroDemoShijingTone, string>;
    hero: {
      ariaLabel: string;
      eyebrow: string;
      rowsAriaLabel: string;
      pending: string;
      detailButton: string;
    };
    concernLimit: number;
    /** Active concerns; `tones` holds one tendency per day of the window. */
    concerns: ReadonlyArray<{
      id: string;
      name: string;
      subtitle: string;
      tones: ReadonlyArray<HeroDemoShijingTone>;
      /** Per-date prose shown in the day panel; omitted dates show the chip only. */
      details: Readonly<Record<string, string>>;
    }>;
    concernPresets: ReadonlyArray<{ name: string; subtitle: string }>;
    filter: {
      toolbarAriaLabel: string;
      concernAriaLabel: string;
      concernLabel: string;
      all: string;
      manage: string;
      legendAriaLabel: string;
    };
    concernEditor: {
      ariaLabel: string;
      title: string;
      subtitle: string;
      activeHeading: string;
      addableHeading: string;
      remove: string;
      add: string;
      customPlaceholder: string;
    };
    calendar: {
      ariaLabel: string;
      gridAriaLabel: string;
      todayBadge: string;
      hasRecordAriaLabel: string;
      /** Lunar day name per window day (月初一 shows the month name). */
      lunarDays: ReadonlyArray<string>;
      /** Solar terms / festivals keyed by ISO date; win over the lunar day label. */
      markers: Readonly<Record<string, { kind: 'solar_term' | 'festival' | 'lunar_month'; label: string }>>;
    };
    details: {
      summary: string;
      body: string;
      evidenceTitle: string;
      evidence: ReadonlyArray<string>;
    };
    dayPanel: {
      close: string;
      kindLabels: { past: string; today: string; future: string };
      calendarTitle: string;
      lunarLabel: string;
      ganzhiLabel: string;
      solarTermLabel: string;
      festivalsLabel: string;
      /** Full lunar label per window day, e.g. 农历八月初十. */
      lunar: ReadonlyArray<string>;
      /** 干支 label per window day, e.g. 丙午年 丁酉月 丁酉日. */
      ganzhi: ReadonlyArray<string>;
      currentTendency: string;
      entryHeadings: { past: string; today: string; future: string };
      placeholders: { memory: string; plan: string };
      saveLabels: { memory: string; plan: string };
      recordKinds: { memory: string; plan: string };
      recordsTitle: string;
      recordsEmpty: string;
      askThisRecord: string;
      edit: string;
      delete: string;
      cancel: string;
      save: string;
      editRecordContent: string;
      seededRecords: ReadonlyArray<{ id: string; date: string; body: string }>;
    };
    monthPanel: {
      title: string;
      close: string;
      rangeLabel: string;
      startLabel: string;
      endLabel: string;
      generatedPrefix: string;
      generatedSuffix: string;
      concernsSuffix: string;
      empty: string;
      actionNotice: string;
      conclusionTitle: string;
      bestForLabel: string;
      avoidLabel: string;
      /** Mirrors the app's TENDENCY_LANGUAGE table for the dominant tendency card. */
      tendencyLanguage: Record<HeroDemoShijingTone, { body: string; bestFor: ReadonlyArray<string>; avoid: ReadonlyArray<string> }>;
      distributionTitle: string;
      dayUnit: string;
      windowsTitle: string;
      windows: ReadonlyArray<{
        title: string;
        tone: HeroDemoShijingTone;
        ranges: ReadonlyArray<{ label: string; from: string; to: string }>;
        brief: string;
      }>;
      concernActionsTitle: string;
      primaryAxisPrefix: string;
      checklistTitle: string;
      remindersSuffix: string;
      notGenerated: string;
      pendingConcernBody: string;
      concernActions: ReadonlyArray<{
        concernId: string;
        summary: string;
        checklist: ReadonlyArray<{ window: string; label: string; from: string; to: string }>;
        reminders: ReadonlyArray<string>;
      }>;
      supplementaryAriaLabel: string;
      rhythmTitle: string;
      themeLabel: string;
      suitableLabel: string;
      unsuitableLabel: string;
      phases: ReadonlyArray<{
        title: string;
        name: string;
        from: string;
        to: string;
        theme: string;
        suitable: string;
        unsuitable: string;
      }>;
      dailyDistributionTitle: string;
      rhythmAriaLabel: string;
      pending: string;
      evidenceTitle: string;
      evidence: ReadonlyArray<string>;
      countsAriaLabel: string;
      countUnit: string;
    };
  };
  nianjing: {
    title: string;
    subtitle: string;
    years: ReadonlyArray<{ year: number; tone: HeroDemoShijingTone; label: string }>;
    selectedYearEyebrow: string;
    summaryTitle: string;
    summaryTone: HeroDemoShijingTone;
    summaryLabel: string;
    summaryBody: string;
    yearLeadLabel: string;
    concerns: ReadonlyArray<{ name: string; tone: HeroDemoShijingTone; label: string; body: string }>;
    detailAction: string;
  };
  mingjing: HeroDemoShijingMingjing;
  /** 合镜 first-run state: the immersive intake hero shown before any relationship person exists. */
  hejing: {
    title: string;
    ariaLabel: string;
    eyebrow: string;
    titleLead: string;
    titleEmphasis: string;
    body: string;
    primaryAction: string;
    stepsHint: string;
    footer: string;
    heroImage: string;
  };
  ask: {
    title: string;
    subtitle: string;
    railAria: string;
    newQuestion: string;
    newQuestionAria: string;
    searchPlaceholder: string;
    filterButton: string;
    /** `{{count}}` placeholder template. */
    filterButtonActive: string;
    filterMenuAria: string;
    filterAll: string;
    railEmptyTitle: string;
    railEmptyBody: string;
    emptySearch: string;
    groups: { today: string; week: string; earlier: string };
    justNow: string;
    composerAria: string;
    composerTitle: string;
    questionAria: string;
    placeholderLines: ReadonlyArray<string>;
    contextTitle: string;
    contextDescription: string;
    contextEmpty: string;
    contextManage: string;
    concerns: ReadonlyArray<string>;
    generate: string;
    generateTitle: string;
    generating: string;
    send: string;
    sendTitle: string;
    sending: string;
    recallAria: string;
    recallTitle: string;
    resultAria: string;
    thinking: string;
    roleUser: string;
    roleAi: string;
    citedFormat: string;
    fields: { riskLevel: string; why: string; suggestion: string; avoid: string };
    history: ReadonlyArray<{ id: string; question: string; group: 'today' | 'week' | 'earlier'; date: string; concerns?: ReadonlyArray<string> }>;
    followUpAnswer: ReadonlyArray<string>;
    answer: {
      title: string;
      conclusion: string;
      cards: ReadonlyArray<{ title: string; risk: string; why: string; suggestion: string; avoid: string }>;
      summary: string;
      cited: number;
    };
  };
};

/** ParentOS (成长底稿) preview content; the app ships zh-first copy. */
export type HeroDemoParentosPreview = {
  appName: string;
  logoAlt: string;
  nav: { timeline: string; profile: string; journal: string; advisor: string; reports: string; settings: string };
  childMenuLabel: string;
  childSwitcherLabel: string;
  addFamilyMember: string;
  child: { name: string; ageLabel: string; genderLabel: string; nurtureMode: string; avatarSrc: string; siblings: ReadonlyArray<{ name: string; ageLabel: string }> };
  home: {
    viewFullProfile: string;
    stageFocusTitle: string;
    viewAllReminders: string;
    healthGroup: string;
    devGroup: string;
    overflowFormat: string;
    health: ReadonlyArray<{ id: string; title: string; description: string }>;
    development: ReadonlyArray<{ id: string; title: string; description: string }>;
    healthOverflow: number;
    quickLinksTitle: string;
    quickLinks: ReadonlyArray<{ id: string; label: string }>;
    growthSnapshotTitle: string;
    viewCurves: string;
    latestMeasurement: string;
    updatedLabel: string;
    trends: ReadonlyArray<{ id: 'height' | 'weight'; label: string; unit: string; latestValue: string; delta: string; deltaPercent: string; points: ReadonlyArray<number> }>;
    sleepTitle: string;
    viewDetails: string;
    sleep: { average: string; averageLabel: string; bedtimeLabel: string; bedtime: string; wakeLabel: string; wake: string; points: ReadonlyArray<{ date: string; minutes: number }> };
    visionTitle: string;
    vision: { leftLabel: string; left: string; rightLabel: string; right: string; measured: string };
    outdoorTitle: string;
    outdoor: { minutes: number; goal: number; unit: string; primary: string; secondary: string };
    sensitiveBadge: string;
    periods: ReadonlyArray<{ title: string; sign: string }>;
    recordAction: string;
    milestoneTitle: string;
    viewAll: string;
    recentlyAchieved: string;
    upcoming: string;
    milestones: { achieved: ReadonlyArray<{ title: string; meta: string }>; upcoming: ReadonlyArray<{ title: string; meta: string }> };
    recentLinesTitle: string;
    viewAllRecords: string;
    lines: ReadonlyArray<{ badge: string; keepsake: boolean; when: string; title: string; detail: string; tag: string | null }>;
    observationTitle: string;
    viewRecords: string;
    last30: string;
    observations: ReadonlyArray<{ name: string; count: number; ratio: number }>;
    monthlyReportTitle: string;
    viewFullReport: string;
    teaser: string;
    todoTitle: string;
    actionText: string;
  };
  panel: {
    title: string;
    todayTab: string;
    upcomingTab: string;
    overdueSummary: string;
    reminders: ReadonlyArray<{ id: string; title: string; status: string; primary: string; kind: 'task' | 'consult' | 'practice' | 'guide' }>;
    upcoming: ReadonlyArray<{ id: string; title: string; status: string; primary: string; kind: 'task' | 'consult' | 'practice' | 'guide' }>;
    overdue: ReadonlyArray<{ id: string; title: string; status: string; primary: string }>;
    schedule: string;
    /** In-demo port of the app's ScheduleModal (reminders/schedule-modal.tsx). */
    scheduleDialog: {
      title: string;
      description: string;
      confirm: string;
      close: string;
      /** Status line for a scheduled reminder; {{date}} is YYYY-MM-DD. */
      scheduled: string;
      /** Transient notice after confirming; {{date}} is YYYY-MM-DD. */
      scheduledNotice: string;
    };
    markComplete: string;
    customTodoPlaceholder: string;
    customTodoTitlePlaceholder: string;
    add: string;
    todos: ReadonlyArray<{ id: string; title: string; due: string }>;
    observationNudges: string;
    nudges: ReadonlyArray<{ text: string; question: string }>;
    observe: string;
  };
  advisor: {
    newConversation: string;
    conversations: ReadonlyArray<{ id: string; title: string; when: string; messages: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }> }>;
    user: string;
    assistant: string;
    thinking: string;
    stop: string;
    placeholder: string;
    send: string;
    recordData: string;
    suggestions: ReadonlyArray<string>;
    emptyEyebrow: string;
    emptyTitle: string;
    emptyDescription: string;
    replies: ReadonlyArray<string>;
  };
  journal: {
    heroLead: string;
    heroTail: string;
    subtitleLead: string;
    subtitleTail: string;
    stats: { thisMonth: string; total: string; keepsake: string };
    counts: { thisMonth: number; total: number; keepsake: number };
    captureText: string;
    captureVoice: string;
    placeholder: string;
    save: string;
    keepsakeToggle: string;
    filterAll: string;
    filterKeepsake: string;
    keepsakeBadge: string;
    entries: ReadonlyArray<{ id: string; dateLabel: string; time: string; text: string; dimension: string | null; keepsake: boolean; recorder: string }>;
  };
  profile: {
    title: string;
    recordSummary: string;
    completenessLabel: string;
    completeness: number;
    addData: string;
    editChild: string;
    archiveTitle: string;
    groups: ReadonlyArray<{ id: string; name: string; summary: string; metrics: ReadonlyArray<{ label: string; value: string }> }>;
  };
  reports: {
    title: string;
    subtitle: string;
    generate: string;
    presets: ReadonlyArray<string>;
    letter: { badge: string; period: string; greeting: string; paragraphs: ReadonlyArray<string>; actionsTitle: string; actions: ReadonlyArray<string> };
  };
  settings: {
    title: string;
    general: string;
    other: string;
    account: { name: string; note: string };
    languageTitle: string;
    languageDesc: string;
    sections: ReadonlyArray<{ id: string; label: string; desc: string }>;
    info: ReadonlyArray<{ label: string; desc: string }>;
  };
  notices: { hostOnly: string; dismiss: string };
};

export type HeroDemoStorybookChoice = {
  id: string;
  label: string;
  targetNodeId: string;
  /** Effect on the 与他人的联结 variable, as the app's authored choices carry. */
  trust?: number;
};

export type HeroDemoStorybookNode = {
  id: string;
  title: string;
  text: string;
  speaker?: string;
  choices: ReadonlyArray<HeroDemoStorybookChoice>;
  ending?: boolean;
};

export type HeroDemoStorybookStory = {
  id: string;
  title: string;
  subtitle: string;
  themes: ReadonlyArray<string>;
  role: string;
  cover: string;
  cast: ReadonlyArray<{ name: string; voice: string; publicFacts: ReadonlyArray<string> }>;
  nodes: ReadonlyArray<HeroDemoStorybookNode>;
  endings: ReadonlyArray<{ id: string; label: string }>;
};

/**
 * Storybook preview content. The app's UI copy is inline zh in its TSX, so
 * the preview keeps those strings inline too; this carries the authored
 * stories (the app's curated library), seeded footprints, Studio seeds, and
 * the scripted improv replies that stand in for Runtime AI.
 */
export type HeroDemoStorybookPreview = {
  appName: string;
  stories: ReadonlyArray<HeroDemoStorybookStory>;
  /** Footprints seeded on first open: a run in progress and a finished one. */
  runs: ReadonlyArray<{ id: string; storyId: string; path: ReadonlyArray<string>; minutesAgo: number }>;
  intakeSeeds: ReadonlyArray<{ label: string; text: string }>;
  intakeDirections: ReadonlyArray<string>;
  improvReplies: ReadonlyArray<string>;
  studioProject: { name: string; premise: string; status: string; minutesAgo: number };
  settings: { accountName: string; accountNote: string; modelLabel: string; modelNote: string };
  demo: { hostOnly: string; dismiss: string };
};

export type HeroDemoOddBureauBox = { x1: number; y1: number; x2: number; y2: number };
export type HeroDemoOddBureauProp = { id: string; label: string; box: HeroDemoOddBureauBox };
export type HeroDemoOddBureauMachineOp = 'source' | 'echo' | 'reverse' | 'raise' | 'slow' | 'store';
export type HeroDemoOddBureauMachinePlan = {
  title: string;
  invitation: string;
  nodes: ReadonlyArray<{ objectId: string; op: HeroDemoOddBureauMachineOp; melody: number[]; line: string }>;
};
export type HeroDemoOddBureauStrikeTask = 'story' | 'reading' | 'stage';
export type HeroDemoOddBureauStrikePlan = {
  title: string;
  situation: string;
  people: ReadonlyArray<{
    objectId: string;
    persona: string;
    offers: ReadonlyArray<{ task: HeroDemoOddBureauStrikeTask; needsCredit: boolean; needsRest: string | null }>;
  }>;
};
export type HeroDemoOddBureauMoodId = 'missing' | 'strike' | 'party';
export type HeroDemoOddBureauCharacter = {
  objectId: string;
  persona: string;
  greeting: string;
  testimony: string;
  clueTitle: string;
  suggestedQuestion: string;
  /** Scripted in-character answers standing in for Runtime text.generate turns. */
  replies: ReadonlyArray<string>;
};
export type HeroDemoOddBureauMystery = {
  mood: HeroDemoOddBureauMoodId;
  title: string;
  opening: string;
  incident: string;
  culpritId: string;
  resolution: string;
  decisiveEvidenceIds: ReadonlyArray<string>;
  characters: ReadonlyArray<HeroDemoOddBureauCharacter>;
};

/**
 * Odd Bureau (奇物局) preview content: the app's sample scene with the six
 * objects its vision.locate query order would find, plus authored stand-ins
 * for what Runtime text.generate produces in the app (a machine plan, a strike
 * plan, three mysteries, a three-act performance). The app's UI copy is inline
 * zh in its TSX, so the preview keeps those strings inline too.
 */
export type HeroDemoOddBureauPreview = {
  appName: string;
  photo: { src: string; name: string; width: number; height: number };
  props: ReadonlyArray<HeroDemoOddBureauProp>;
  machine: HeroDemoOddBureauMachinePlan;
  strike: HeroDemoOddBureauStrikePlan;
  performance: ReadonlyArray<string>;
  mysteries: ReadonlyArray<HeroDemoOddBureauMystery>;
  demo: { hostOnly: string; voice: string; dismiss: string };
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
    /** These are zh-CN-first apps; their preview copy intentionally stays zh. */
    zhiyu: HeroDemoZhiyuPreview;
    shijing: HeroDemoShijingPreview;
    parentos: HeroDemoParentosPreview;
    storybook: HeroDemoStorybookPreview;
    oddBureau: HeroDemoOddBureauPreview;
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
    /** Secondary hero line, rendered lighter and smaller under the sub-slogan. */
    subSloganNote: string;
    downloadCta: string;
    downloadNote: string;
    /** Quiet secondary action that opens the docs folder on GitHub. */
    docsCta: string;
    demo: HeroDemo;
  };
  apps: {
    title: string;
    subtitle: string;
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
