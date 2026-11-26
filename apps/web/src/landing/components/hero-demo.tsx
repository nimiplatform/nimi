import { ArrowLeft, ArrowRight, Check, PanelLeft, Send, X } from 'lucide-react';
import { DemoHomeSurface, DemoMessages } from './demo-home.js';
import { DemoIntegrationsSurface } from './demo-connections.js';
import { DemoDownloadsSurface, DemoDiagnosticsSurface } from './demo-system.js';
import { cn } from '@nimiplatform/kit/ui';
import { DemoAppsSurface } from './demo-apps.js';
import { DemoSessionChat } from './demo-chat.js';
import { DemoExploreSurface } from './demo-explore.js';
import { DemoRail, DemoSurfaceSwitcher } from './demo-rail.js';
import { DemoRuntimeSurface } from './demo-runtime.js';
import { DemoAppPreview } from './demo-app-preview.js';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from 'react';
import type { HeroDemoSurface, LandingContent } from '../content/landing-content.js';
import { EXAMPLE_LOG } from '../content/demo-tour.js';
import { AppPreviewLocaleProvider } from '../i18n/app-preview-locale.js';
import { DemoSettingsSurface } from './demo-settings.js';

import { useHeroDemoSession } from './hero-demo-context.js';
import { DemoWindowHeader, type DemoWindowClose } from './demo-window-header.js';

export type HeroGuideStep = 'open-zhiyu' | 'send' | 'home-chat' | 'done';
export type HeroGuidePlacement = 'below' | 'above' | 'floating';
export type HeroGuideLayout = {
  left: number;
  top: number;
  caretX: number;
  placement: HeroGuidePlacement;
};

export function resolveHeroGuideStep(params: {
  activeTab: 'zhiyu' | 'home-chat' | 'home-overview';
  syncedTurnCount: number;
  completedHandoff: boolean;
}): HeroGuideStep {
  if (params.completedHandoff || (params.activeTab === 'home-chat' && params.syncedTurnCount > 0)) {
    return 'done';
  }
  if (params.syncedTurnCount > 0) return 'home-chat';
  if (params.activeTab === 'zhiyu') return 'send';
  return 'open-zhiyu';
}

export function computeGuidePopoverLayout(params: {
  container: { width: number; height: number };
  card: { width: number; height: number };
  target: { left: number; top: number; width: number; height: number } | null;
  preferredPlacement: 'below' | 'above' | 'above-floating' | 'floating';
  safeTop?: number;
  pad?: number;
  gap?: number;
}): HeroGuideLayout {
  const { container, card, target, preferredPlacement } = params;
  const pad = params.pad ?? 12;
  const gap = params.gap ?? 12;
  const safeTop = Math.max(pad, params.safeTop ?? 48);
  const maxLeft = Math.max(pad, container.width - card.width - pad);
  const maxTop = Math.max(safeTop, container.height - card.height - pad);

  const floatingFallback = (): HeroGuideLayout => ({
    left: Math.round(Math.max(pad, Math.min(maxLeft, (container.width - card.width) / 2))),
    top: Math.round(Math.max(safeTop, container.height - card.height - 20)),
    caretX: Math.round(card.width / 2),
    placement: 'floating',
  });

  if (preferredPlacement === 'floating' || !target || target.width <= 0 || target.height <= 0) {
    return floatingFallback();
  }

  const targetBottom = target.top + target.height;
  if (targetBottom < safeTop || target.top > container.height) {
    return floatingFallback();
  }

  const targetCenterX = target.left + target.width / 2;
  const left = Math.round(Math.max(pad, Math.min(maxLeft, targetCenterX - card.width / 2)));
  const caretX = Math.round(Math.max(20, Math.min(card.width - 20, targetCenterX - left)));

  const belowTop = targetBottom + gap;
  const aboveTop = target.top - card.height - gap;
  const fitsBelow = belowTop >= safeTop && belowTop + card.height <= container.height - pad;
  const fitsAbove = aboveTop >= safeTop && aboveTop + card.height <= container.height - pad;

  if (preferredPlacement === 'above-floating') {
    if (fitsAbove) {
      return { left, top: Math.round(aboveTop), caretX, placement: 'floating' };
    }
    return floatingFallback();
  }

  if (preferredPlacement === 'below') {
    if (fitsBelow) return { left, top: Math.round(belowTop), caretX, placement: 'below' };
    if (fitsAbove) return { left, top: Math.round(aboveTop), caretX, placement: 'above' };
  } else {
    if (fitsAbove) return { left, top: Math.round(aboveTop), caretX, placement: 'above' };
    if (fitsBelow) return { left, top: Math.round(belowTop), caretX, placement: 'below' };
  }

  return {
    left,
    top: Math.round(Math.max(safeTop, Math.min(maxTop, belowTop))),
    caretX,
    placement: 'floating',
  };
}

export type HeroContinuityGuideConfig = {
  formatStepLabel: (step: number) => string;
  skipLabel: string;
  step1Title: string;
  step1Action: string;
  step2Title: string;
  step2Action: string;
  step3Title: string;
  step3Action: string;
  doneText: string;
};

export type HeroContinuitySwitcherConfig = {
  partnerId: string;
  zhiyuWindowTitle: string;
  ariaLabel: string;
  quickSendLabel: string;
  viewSyncedLabel: string;
  sampleText: string;
  sampleReply: string;
  tabZhiyu: string;
  tabHomeChat: string;
  tabHomeOverview: string;
  formatSyncedBadge: (count: number) => string;
  guide?: HeroContinuityGuideConfig;
};

export type HeroDemoProps = {
  expanded?: boolean;
  windowTitle?: string;
  windowActions?: ReactNode;
  windowClose?: DemoWindowClose;
  inlinePreview?: boolean;
  disablePreviewModal?: boolean;
  previewHeaderActions?: ReactNode;
  continuitySwitcher?: HeroContinuitySwitcherConfig;
  stageActive?: boolean;
  surfaceOverride?: HeroDemoSurface;
  onSurfaceNavigate?: () => void;
  riskCopy?: LandingContent['riskControl'];
  previewCaption?: ReactNode;
  onPreviewBody?: (node: HTMLDivElement | null) => void;
  openChatRef?: Ref<HTMLButtonElement>;
};

const DemoCloudSurface = lazy(async () => ({ default: (await import('./demo-cloud.js')).DemoCloudSurface }));
const DemoCloudSetup = lazy(async () => ({ default: (await import('./demo-cloud-setup.js')).DemoCloudSetup }));
const InlineZhiyuPreview = lazy(async () => {
  if (typeof document !== 'undefined') {
    await import('../demo-zhiyu.css');
  }
  return { default: (await import('./demo-zhiyu-preview.js')).DemoZhiyuPreview };
});

export function HeroDemoView({ expanded, windowTitle, windowActions, windowClose, inlinePreview, disablePreviewModal, previewHeaderActions, continuitySwitcher, stageActive, surfaceOverride, onSurfaceNavigate, riskCopy, previewCaption, onPreviewBody, openChatRef }: HeroDemoProps) {
  const {
    demo,
    preview,
    guideStep,
    homeRevision,
    openPreview,
    closePreview,
    history,
    position,
    current,
    surface,
    selectedChatTargetId,
    sidebar,
    setSidebar,
    preferences,
    setPreferences,
    setComposerDrafts,
    localMessages,
    messages,
    navigate,
    goHistory,
    readMessage,
    hideMessage,
    changeLocale,
    addExplorePartner,
    submitTo,
  } = useHeroDemoSession();
  const [continuityMode, setContinuityMode] = useState<'zhiyu' | 'home'>('home');
  const [guideDismissed, setGuideDismissed] = useState(false);
  const [completedHandoff, setCompletedHandoff] = useState(false);
  const [guideLayout, setGuideLayout] = useState<HeroGuideLayout | null>(null);
  const stageWindowRef = useRef<HTMLDivElement>(null);
  const guideCardRef = useRef<HTMLDivElement>(null);
  const focusChatComposer = useRef(false);
  const chatSurfaceRef = useCallback((node: HTMLDivElement | null) => {
    if (!node || !focusChatComposer.current) return;
    focusChatComposer.current = false;
    node.querySelector('textarea')?.focus({ preventScroll: true });
  }, []);
  const handleNavigate = useCallback((nextSurface: HeroDemoSurface, target?: string) => {
    navigate(nextSurface, target);
    onSurfaceNavigate?.();
  }, [navigate, onSurfaceNavigate]);

  const activeSurface = surfaceOverride ?? surface;
  const showInlineZhiyu = Boolean(continuitySwitcher && continuityMode === 'zhiyu');
  const activeContinuityTab: 'zhiyu' | 'home-chat' | 'home-overview' = showInlineZhiyu
    ? 'zhiyu'
    : activeSurface === 'chat' && selectedChatTargetId === continuitySwitcher?.partnerId
      ? 'home-chat'
      : 'home-overview';
  const syncedTurnCount = continuitySwitcher
    ? (localMessages[continuitySwitcher.partnerId]?.length ?? 0)
    : 0;
  const heroGuide = continuitySwitcher?.guide;
  const heroGuideStep = resolveHeroGuideStep({
    activeTab: activeContinuityTab,
    syncedTurnCount,
    completedHandoff,
  });
  const showHeroGuide = Boolean(
    heroGuide
    && stageActive
    && !windowClose
    && !guideDismissed
    && !preview
    && !(inlinePreview && preview),
  );

  useEffect(() => {
    if (activeContinuityTab === 'home-chat' && syncedTurnCount > 0 && !completedHandoff) {
      setCompletedHandoff(true);
    }
  }, [activeContinuityTab, syncedTurnCount, completedHandoff]);

  useEffect(() => {
    if (!showHeroGuide || heroGuideStep !== 'done') return;
    const timer = window.setTimeout(() => setGuideDismissed(true), 5500);
    return () => window.clearTimeout(timer);
  }, [showHeroGuide, heroGuideStep]);

  useLayoutEffect(() => {
    if (!showHeroGuide) {
      setGuideLayout(null);
      return;
    }
    const container = stageWindowRef.current;
    if (!container) return;

    const zhiyuComposerSelector =
      '.zhiyu-chat-canvas__composer [data-canonical-composer-width] > div:last-child > div, .zhiyu-chat-canvas__composer [data-canonical-composer-root="true"], .zhiyu-chat-canvas__composer';
    const anyComposerSelector =
      '[data-canonical-composer-root="true"] [data-canonical-composer-width] > div:last-child > div, [data-canonical-composer-root="true"]';

    const resolveTarget = (): {
      element: HTMLElement | null;
      preferredPlacement: 'below' | 'above' | 'above-floating' | 'floating';
    } => {
      if (heroGuideStep === 'done') {
        return {
          element: container.querySelector<HTMLElement>(anyComposerSelector),
          preferredPlacement: 'above-floating',
        };
      }
      if (heroGuideStep === 'open-zhiyu') {
        return {
          element: container.querySelector<HTMLElement>('[data-hero-guide-target="open-zhiyu"]'),
          preferredPlacement: 'below',
        };
      }
      if (heroGuideStep === 'send') {
        return {
          element: container.querySelector<HTMLElement>(zhiyuComposerSelector),
          preferredPlacement: 'above',
        };
      }
      if (showInlineZhiyu) {
        return {
          element: container.querySelector<HTMLElement>(zhiyuComposerSelector),
          preferredPlacement: 'above-floating',
        };
      }
      return {
        element: container.querySelector<HTMLElement>('.demo-mini-chat'),
        preferredPlacement: 'below',
      };
    };

    const updatePosition = () => {
      const containerRect = container.getBoundingClientRect();
      if (containerRect.width <= 0 || containerRect.height <= 0) return;

      const cardEl = guideCardRef.current;
      const cardWidth = cardEl?.offsetWidth || Math.min(320, containerRect.width - 24);
      const cardHeight = cardEl?.offsetHeight || 46;
      const titlebar = container.querySelector<HTMLElement>('.hero-demo-titlebar');
      const titlebarRect = titlebar?.getBoundingClientRect();
      const safeTop =
        titlebarRect && titlebarRect.height > 0
          ? Math.max(48, Math.round(titlebarRect.bottom - containerRect.top) + 10)
          : 48;

      const { element: targetEl, preferredPlacement } = resolveTarget();
      const targetRect = targetEl?.getBoundingClientRect();
      const target =
        targetRect && targetRect.width > 0 && targetRect.height > 0
          ? {
              left: targetRect.left - containerRect.left,
              top: targetRect.top - containerRect.top,
              width: targetRect.width,
              height: targetRect.height,
            }
          : null;

      const next = computeGuidePopoverLayout({
        container: { width: containerRect.width, height: containerRect.height },
        card: { width: cardWidth, height: cardHeight },
        target,
        preferredPlacement,
        safeTop,
        pad: 14,
        gap: 12,
      });

      setGuideLayout((prev) =>
        prev
        && prev.left === next.left
        && prev.top === next.top
        && prev.caretX === next.caretX
        && prev.placement === next.placement
          ? prev
          : next,
      );
    };

    let rafId = 0;
    const scheduleUpdate = () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      rafId = window.requestAnimationFrame(updatePosition);
    };

    updatePosition();
    scheduleUpdate();
    const resizeObserver = new ResizeObserver(scheduleUpdate);
    resizeObserver.observe(container);
    if (guideCardRef.current) resizeObserver.observe(guideCardRef.current);
    const mutationObserver = new MutationObserver(scheduleUpdate);
    mutationObserver.observe(container, { childList: true, subtree: true });
    container.addEventListener('scroll', scheduleUpdate, true);
    window.addEventListener('resize', scheduleUpdate);
    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      container.removeEventListener('scroll', scheduleUpdate, true);
      window.removeEventListener('resize', scheduleUpdate);
    };
  }, [showHeroGuide, heroGuideStep, showInlineZhiyu, activeSurface, syncedTurnCount]);

  if (inlinePreview && preview) return <DemoAppPreview opened={preview} inline
    guiding={guideStep !== undefined} apps={demo.apps} preview={demo.appPreview}
    onClose={closePreview} onBody={onPreviewBody} />;

  const effectiveWindowTitle = showInlineZhiyu && continuitySwitcher
    ? continuitySwitcher.zhiyuWindowTitle
    : (windowTitle ?? demo.windowTitle);
  const effectiveWindowIcon = showInlineZhiyu
    ? '/demo/zhiyu-icon.png'
    : continuitySwitcher
      ? '/logo.svg'
      : undefined;

  const windowHeaderChildren = (
    <>
      <span className="demo-preview-badge">
        {demo.home.badge}
      </span>
      {windowActions}
    </>
  );

  const openZhiyu = () => {
    setContinuityMode('zhiyu');
  };

  const openHomeChat = () => {
    if (!continuitySwitcher) return;
    navigate('chat', continuitySwitcher.partnerId);
    setContinuityMode('home');
  };

  const openHomeOverview = () => {
    navigate('home');
    setContinuityMode('home');
  };

  const sendSampleLine = () => {
    if (!continuitySwitcher) return;
    submitTo(
      continuitySwitcher.partnerId,
      { text: continuitySwitcher.sampleText },
      continuitySwitcher.sampleReply,
    );
  };

  const continuityBar = continuitySwitcher ? (
    <div className="story-continuity-bar" data-testid="hero-continuity-bar">
      <div className="story-continuity-tabs" role="group" aria-label={continuitySwitcher.ariaLabel}>
        <button
          type="button"
          className={cn(
            'story-continuity-tab',
            activeContinuityTab === 'home-overview' && 'is-active',
          )}
          aria-pressed={activeContinuityTab === 'home-overview'}
          onClick={openHomeOverview}
        >
          <img src="/logo.svg" alt="" width={16} height={16} />
          <span>{continuitySwitcher.tabHomeOverview}</span>
        </button>
        <button
          type="button"
          className={cn(
            'story-continuity-tab',
            activeContinuityTab === 'zhiyu' && 'is-active',
            showHeroGuide && heroGuideStep === 'open-zhiyu' && 'is-guide-target',
          )}
          aria-pressed={activeContinuityTab === 'zhiyu'}
          onClick={openZhiyu}
        >
          <img src="/demo/zhiyu-icon.png" alt="" width={16} height={16} />
          <span>{continuitySwitcher.tabZhiyu}</span>
        </button>
        <button
          type="button"
          className={cn(
            'story-continuity-tab',
            activeContinuityTab === 'home-chat' && 'is-active',
            showHeroGuide && heroGuideStep === 'home-chat' && 'is-guide-target',
          )}
          aria-pressed={activeContinuityTab === 'home-chat'}
          onClick={openHomeChat}
        >
          <img src="/logo.svg" alt="" width={16} height={16} />
          <span>{continuitySwitcher.tabHomeChat}</span>
          {syncedTurnCount > 0 ? (
            <em className="story-continuity-badge">
              {continuitySwitcher.formatSyncedBadge(syncedTurnCount)}
            </em>
          ) : null}
        </button>
      </div>
      {showInlineZhiyu ? (
        <div className="story-continuity-actions">
          {syncedTurnCount > 0 ? (
            <button
              type="button"
              className="story-continuity-quick-send is-synced"
              onClick={openHomeChat}
            >
              <span>{continuitySwitcher.viewSyncedLabel}</span>
              <ArrowRight size={13} aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              className={cn(
                'story-continuity-quick-send',
                showHeroGuide && heroGuideStep === 'send' && 'is-guide-target',
              )}
              onClick={sendSampleLine}
            >
              <Send size={13} aria-hidden="true" />
              <span>{continuitySwitcher.quickSendLabel}</span>
            </button>
          )}
        </div>
      ) : null}
    </div>
  ) : null;

  const currentGuideStepNumber = heroGuideStep === 'open-zhiyu' ? 1 : heroGuideStep === 'send' ? 2 : 3;

  const heroGuideOverlay = showHeroGuide && heroGuide ? (
    heroGuideStep === 'done' ? (
      <div
        ref={guideCardRef}
        className={cn(
          'story-stage-guide is-done nimi-material-glass-regular backdrop-blur-[var(--nimi-backdrop-blur-regular)]',
          guideLayout && 'has-anchor-pos',
        )}
        data-nimi-material="glass-regular"
        data-nimi-tone="overlay"
        role="status"
        aria-live="polite"
        data-testid="hero-stage-guide"
        data-guide-step="done"
        data-guide-placement="floating"
        style={
          guideLayout
            ? ({
                transform: `translate3d(${guideLayout.left}px, ${guideLayout.top}px, 0)`,
              } as CSSProperties)
            : undefined
        }
      >
        <span className="story-stage-guide-done-icon" aria-hidden="true">
          <Check size={13} strokeWidth={2.5} />
        </span>
        <span className="story-stage-guide-done-text">{heroGuide.doneText}</span>
        <button
          type="button"
          className="story-stage-guide-close"
          aria-label={heroGuide.skipLabel}
          onClick={() => setGuideDismissed(true)}
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
    ) : (
      <div
        ref={guideCardRef}
        className={cn(
          'story-stage-guide nimi-material-glass-regular backdrop-blur-[var(--nimi-backdrop-blur-regular)]',
          guideLayout && 'has-anchor-pos',
        )}
        data-nimi-material="glass-regular"
        data-nimi-tone="overlay"
        role="region"
        aria-live="polite"
        aria-label={heroGuide.formatStepLabel(currentGuideStepNumber)}
        data-testid="hero-stage-guide"
        data-guide-step={heroGuideStep}
        data-guide-placement={guideLayout?.placement ?? 'floating'}
        style={
          guideLayout
            ? ({
                transform: `translate3d(${guideLayout.left}px, ${guideLayout.top}px, 0)`,
                '--guide-caret-x': `${guideLayout.caretX}px`,
              } as CSSProperties)
            : undefined
        }
      >
        <span className="story-stage-guide-step" aria-hidden="true">
          {currentGuideStepNumber}/3
        </span>
        <span className="story-stage-guide-text">
          {heroGuideStep === 'open-zhiyu'
            ? heroGuide.step1Title
            : heroGuideStep === 'send'
              ? heroGuide.step2Title
              : heroGuide.step3Title}
        </span>
        <button
          type="button"
          className={cn(
            'story-stage-guide-cta',
            heroGuideStep === 'home-chat' && 'is-accent',
          )}
          onClick={() => {
            if (heroGuideStep === 'open-zhiyu') openZhiyu();
            else if (heroGuideStep === 'send') sendSampleLine();
            else openHomeChat();
          }}
        >
          <span>
            {heroGuideStep === 'open-zhiyu'
              ? heroGuide.step1Action
              : heroGuideStep === 'send'
                ? heroGuide.step2Action
                : heroGuide.step3Action}
          </span>
          <ArrowRight size={13} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="story-stage-guide-close"
          aria-label={heroGuide.skipLabel}
          onClick={() => setGuideDismissed(true)}
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
    )
  ) : null;

  const windowFrame = (
    <div
      className={cn('hero-demo-frame demo-home-frame', expanded && 'flex h-full min-h-0 flex-col')}
      data-demo-owns-scroll="true"
      data-demo-interactive="true"
      data-demo-theme={preferences.theme}
      data-demo-reduced-motion={preferences.reducedMotion}
    >
      {showInlineZhiyu && continuitySwitcher ? (
        <div
          className={
            expanded
              ? 'demo-embedded-app-body flex min-h-0 flex-1 flex-col'
              : 'demo-embedded-app-body flex flex-col h-[520px] md:h-[620px] lg:h-[min(720px,80vh)] xl:h-[min(780px,82vh)] 2xl:h-[min(840px,84vh)]'
          }
          lang={demo.appPreview.locale === 'zh' ? 'zh-CN' : 'en'}
        >
          <Suspense
            fallback={
              <>
                <DemoWindowHeader
                  title={effectiveWindowTitle}
                  iconSrc={effectiveWindowIcon}
                  close={windowClose}
                >
                  {windowHeaderChildren}
                </DemoWindowHeader>
                <div className="tour-load-state flex-1" aria-busy="true">{continuitySwitcher.tabZhiyu}</div>
              </>
            }
          >
            <AppPreviewLocaleProvider locale={demo.appPreview.locale} messages={demo.appPreview.messages}>
              <InlineZhiyuPreview
                key={continuitySwitcher.partnerId}
                content={demo.appPreview.zhiyu}
                initialPartnerId={continuitySwitcher.partnerId}
                windowHeader={{
                  title: effectiveWindowTitle,
                  iconSrc: effectiveWindowIcon,
                  close: windowClose,
                  children: windowHeaderChildren,
                }}
              />
            </AppPreviewLocaleProvider>
          </Suspense>
        </div>
      ) : (
        <>
      <DemoWindowHeader
        title={effectiveWindowTitle}
        iconSrc={effectiveWindowIcon}
        close={windowClose}
        navigation={<>
          <button
            type="button"
            className="demo-icon-button"
            aria-label={demo.home.back}
            disabled={position === 0}
            onClick={() => goHistory(-1)}
          >
            <ArrowLeft size={17} />
          </button>
          <button
            type="button"
            className="demo-icon-button"
            aria-label={demo.appPreview.locale === 'zh' ? '前进' : 'Forward'}
            disabled={position === history.length - 1}
            onClick={() => goHistory(1)}
          >
            <ArrowRight size={17} />
          </button>
          <button
            type="button"
            className="demo-icon-button demo-sidebar-toggle"
            aria-label={demo.appPreview.locale === 'zh' ? '切换侧栏' : 'Toggle sidebar'}
            aria-pressed={sidebar}
            onClick={() => setSidebar(!sidebar)}
          >
            <PanelLeft size={17} />
          </button>
        </>}
      >
        {windowHeaderChildren}
      </DemoWindowHeader>
      <div className="px-3 pt-2 md:hidden">
        <DemoSurfaceSwitcher demo={demo} surface={activeSurface} onSelect={handleNavigate} />
      </div>
      <div
        className={
          expanded
            ? 'demo-window-body flex min-h-0 flex-1'
            : 'demo-window-body flex h-[520px] md:h-[620px] lg:h-[min(720px,80vh)] xl:h-[min(780px,82vh)] 2xl:h-[min(840px,84vh)]'
        }
      >
        {sidebar && (
          <div className="hidden md:flex">
            <DemoRail demo={demo} surface={activeSurface} onSelect={handleNavigate} />
          </div>
        )}
        <div className="demo-window-content min-w-0 flex-1">
          <div
            key={`${homeRevision}:${activeSurface}:${activeSurface === 'explore' || activeSurface === 'chat' ? '' : current.target ?? ''}`}
            ref={activeSurface === 'chat' ? chatSurfaceRef : undefined}
            data-demo-surface
            className="demo-surface-enter h-full min-h-0"
          >
            {activeSurface === 'home' && (
              <DemoHomeSurface
                demo={demo}
                messages={messages}
                openChatRef={openChatRef}
                guideHighlightAppId={showHeroGuide && heroGuideStep === 'open-zhiyu' ? 'nimi.zhiyu' : undefined}
                onOpenApp={
                  continuitySwitcher
                    ? (appId) => {
                        if (appId === 'nimi.zhiyu') {
                          openZhiyu();
                          return true;
                        }
                        return false;
                      }
                    : undefined
                }
                onOpenChat={(event, agentId) => {
                  focusChatComposer.current = event.detail === 0;
                  handleNavigate('chat', agentId);
                }}
                onNavigate={handleNavigate}
                onRead={readMessage}
                onHide={hideMessage}
                onReply={(id, text) => {
                  setComposerDrafts((previous) => ({ ...previous, [id]: text }));
                  handleNavigate('chat', id);
                }}
              />
            )}
            {activeSurface === 'chat' && (
              <DemoSessionChat
                key={selectedChatTargetId === EXAMPLE_LOG ? current.view ?? 'log' : 'chat'}
                targetId={selectedChatTargetId}
                logExample={selectedChatTargetId === EXAMPLE_LOG ? riskCopy : undefined}
              />
            )}
            {activeSurface === 'explore' && (
              <DemoExploreSurface
                demo={demo}
                target={current.target}
                onNavigate={handleNavigate}
                onAddPartner={addExplorePartner}
                onChat={(character) => {
                  addExplorePartner(character);
                  handleNavigate('chat', character.id);
                }}
              />
            )}
            {activeSurface === 'apps' && (
              <DemoAppsSurface
                key={current.view}
                apps={demo.apps}
                preview={demo.appPreview}
                onLaunch={openPreview}
                initialAccess={current.view === 'access'}
                initialAppId={current.surface === 'apps' ? current.target : undefined}
              />
            )}
            {activeSurface === 'runtime' && (current.target?.startsWith('cloud-setup/') ?
              <Suspense fallback={<div aria-busy="true">{demo.nav.runtime}</div>}><DemoCloudSetup target={current.target} demo={demo} /></Suspense> :
              <DemoRuntimeSurface demo={demo} initialCapability={current.target} onNavigate={handleNavigate} />)}
            {activeSurface === 'cloud' && <Suspense fallback={<div aria-busy="true">{demo.nav.cloud}</div>}><DemoCloudSurface demo={demo} target={current.target} /></Suspense>}
            {activeSurface === 'integrations' && <DemoIntegrationsSurface demo={demo} target={current.target} />}
            {activeSurface === 'messages' && (
              <DemoMessages
                full
                demo={demo}
                messages={messages}
                onNavigate={handleNavigate}
                onRead={readMessage}
                onHide={hideMessage}
              />
            )}
            {activeSurface === 'downloads' && <DemoDownloadsSurface demo={demo} onNavigate={handleNavigate} />}
            {activeSurface === 'diagnostics' && <DemoDiagnosticsSurface demo={demo} />}
            {activeSurface === 'settings' && (
              <DemoSettingsSurface
                demo={demo}
                target={current.target}
                preferences={preferences}
                onPreferences={setPreferences}
                onLocale={changeLocale}
              />
            )}
          </div>
        </div>
      </div>
        </>
      )}
      {!disablePreviewModal && (
        <DemoAppPreview opened={preview} guiding={Boolean(preview?.guided) && guideStep !== undefined} apps={demo.apps} preview={demo.appPreview} onClose={closePreview}
          onBody={onPreviewBody} caption={previewCaption} headerActions={previewHeaderActions} />
      )}
    </div>
  );

  if (continuityBar) {
    return (
      <div className={cn('story-stage-shell', expanded && 'flex h-full min-h-0 flex-col', Boolean(windowClose) && 'is-modal')}>
        {continuityBar}
        <div
          ref={stageWindowRef}
          className="story-stage-window flex-1 min-h-0"
          data-hero-guide-step={showHeroGuide ? heroGuideStep : undefined}
        >
          {windowFrame}
          {heroGuideOverlay}
        </div>
      </div>
    );
  }

  return windowFrame;
}
