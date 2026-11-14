import { ArrowLeft, ArrowRight, PanelLeft, Send } from 'lucide-react';
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
import { lazy, Suspense, useCallback, useRef, useState, type ReactNode, type Ref } from 'react';
import type { LandingContent } from '../content/landing-content.js';
import { EXAMPLE_LOG } from '../content/demo-tour.js';
import { AppPreviewLocaleProvider } from '../i18n/app-preview-locale.js';
import { DemoSettingsSurface } from './demo-settings.js';

import { useHeroDemoSession } from './hero-demo-context.js';
import { DemoWindowHeader, type DemoWindowClose } from './demo-window-header.js';

export type HeroContinuitySwitcherConfig = {
  partnerId: string;
  zhiyuWindowTitle: string;
  hint: string;
  quickSendLabel: string;
  sampleText: string;
  sampleReply: string;
  tabZhiyu: string;
  tabHomeChat: string;
  tabHomeOverview: string;
  formatSyncedBadge: (count: number) => string;
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

export function HeroDemoView({ expanded, windowTitle, windowActions, windowClose, inlinePreview, disablePreviewModal, previewHeaderActions, continuitySwitcher, riskCopy, previewCaption, onPreviewBody, openChatRef }: HeroDemoProps) {
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
  const [continuityMode, setContinuityMode] = useState<'zhiyu' | 'home'>('zhiyu');
  const focusChatComposer = useRef(false);
  const chatSurfaceRef = useCallback((node: HTMLDivElement | null) => {
    if (!node || !focusChatComposer.current) return;
    focusChatComposer.current = false;
    node.querySelector('textarea')?.focus({ preventScroll: true });
  }, []);

  if (inlinePreview && preview) return <DemoAppPreview opened={preview} inline
    guiding={guideStep !== undefined} apps={demo.apps} preview={demo.appPreview}
    onClose={closePreview} onBody={onPreviewBody} />;

  const showInlineZhiyu = Boolean(continuitySwitcher && continuityMode === 'zhiyu');
  const activeContinuityTab: 'zhiyu' | 'home-chat' | 'home-overview' = showInlineZhiyu
    ? 'zhiyu'
    : surface === 'chat' && selectedChatTargetId === continuitySwitcher?.partnerId
      ? 'home-chat'
      : 'home-overview';
  const syncedTurnCount = continuitySwitcher
    ? (localMessages[continuitySwitcher.partnerId]?.length ?? 0)
    : 0;
  const effectiveWindowTitle = showInlineZhiyu && continuitySwitcher
    ? continuitySwitcher.zhiyuWindowTitle
    : (windowTitle ?? demo.windowTitle);
  const effectiveWindowIcon = showInlineZhiyu
    ? '/demo/zhiyu-icon.png'
    : continuitySwitcher
      ? '/logo.svg'
      : undefined;

  return (
    <div
      className={cn('hero-demo-frame demo-home-frame', expanded && 'flex h-full min-h-0 flex-col')}
      data-demo-owns-scroll="true"
      data-demo-interactive="true"
      data-demo-theme={preferences.theme}
      data-demo-reduced-motion={preferences.reducedMotion}
    >
      <DemoWindowHeader
        title={effectiveWindowTitle}
        iconSrc={effectiveWindowIcon}
        close={windowClose}
        navigation={showInlineZhiyu ? undefined : <>
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
        <span className="demo-preview-badge">
          {demo.home.badge}
        </span>
        {windowActions}
      </DemoWindowHeader>
      {continuitySwitcher ? (
        <div className="story-continuity-bar" data-testid="hero-continuity-bar">
          <div className="story-continuity-tabs" role="group" aria-label={continuitySwitcher.hint}>
            <button
              type="button"
              className={cn('story-continuity-tab', activeContinuityTab === 'zhiyu' && 'is-active')}
              aria-pressed={activeContinuityTab === 'zhiyu'}
              onClick={() => setContinuityMode('zhiyu')}
            >
              <img src="/demo/zhiyu-icon.png" alt="" width={16} height={16} />
              <span>{continuitySwitcher.tabZhiyu}</span>
            </button>
            <button
              type="button"
              className={cn('story-continuity-tab', activeContinuityTab === 'home-chat' && 'is-active')}
              aria-pressed={activeContinuityTab === 'home-chat'}
              onClick={() => {
                navigate('chat', continuitySwitcher.partnerId);
                setContinuityMode('home');
              }}
            >
              <img src="/logo.svg" alt="" width={16} height={16} />
              <span>{continuitySwitcher.tabHomeChat}</span>
              {syncedTurnCount > 0 ? (
                <em className="story-continuity-badge">
                  {continuitySwitcher.formatSyncedBadge(syncedTurnCount)}
                </em>
              ) : null}
            </button>
            <button
              type="button"
              className={cn('story-continuity-tab', activeContinuityTab === 'home-overview' && 'is-active')}
              aria-pressed={activeContinuityTab === 'home-overview'}
              onClick={() => {
                navigate('home');
                setContinuityMode('home');
              }}
            >
              <img src="/logo.svg" alt="" width={16} height={16} />
              <span>{continuitySwitcher.tabHomeOverview}</span>
            </button>
          </div>
          <div className="story-continuity-actions">
            <span className="story-continuity-hint">{continuitySwitcher.hint}</span>
            {showInlineZhiyu ? (
              <button
                type="button"
                className="story-continuity-quick-send"
                onClick={() => submitTo(
                  continuitySwitcher.partnerId,
                  { text: continuitySwitcher.sampleText },
                  continuitySwitcher.sampleReply,
                )}
              >
                <Send size={13} aria-hidden="true" />
                <span>{continuitySwitcher.quickSendLabel}</span>
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {showInlineZhiyu && continuitySwitcher ? (
        <div
          className={
            expanded
              ? 'demo-embedded-app-body min-h-0 flex-1'
              : 'demo-embedded-app-body h-[520px] md:h-[620px] lg:h-[min(720px,80vh)] xl:h-[min(780px,82vh)] 2xl:h-[min(840px,84vh)]'
          }
          lang={demo.appPreview.locale === 'zh' ? 'zh-CN' : 'en'}
        >
          <Suspense fallback={<div className="tour-load-state" aria-busy="true">{continuitySwitcher.tabZhiyu}</div>}>
            <AppPreviewLocaleProvider locale={demo.appPreview.locale} messages={demo.appPreview.messages}>
              <InlineZhiyuPreview
                key={continuitySwitcher.partnerId}
                content={demo.appPreview.zhiyu}
                initialPartnerId={continuitySwitcher.partnerId}
              />
            </AppPreviewLocaleProvider>
          </Suspense>
        </div>
      ) : (
        <>
      <div className="px-3 pt-2 md:hidden">
        <DemoSurfaceSwitcher demo={demo} surface={surface} onSelect={navigate} />
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
            <DemoRail demo={demo} surface={surface} onSelect={navigate} />
          </div>
        )}
        <div className="demo-window-content min-w-0 flex-1">
          <div
            key={`${homeRevision}:${surface}:${surface === 'explore' || surface === 'chat' ? '' : current.target ?? ''}`}
            ref={surface === 'chat' ? chatSurfaceRef : undefined}
            data-demo-surface
            className="demo-surface-enter h-full min-h-0"
          >
            {surface === 'home' && (
              <DemoHomeSurface
                demo={demo}
                messages={messages}
                openChatRef={openChatRef}
                onOpenChat={(event) => {
                  focusChatComposer.current = event.detail === 0;
                  const preferredAgent = demo.chat.agents[1]?.id ?? demo.chat.agents[0]?.id;
                  navigate('chat', preferredAgent);
                }}
                onNavigate={navigate}
                onRead={readMessage}
                onHide={hideMessage}
                onReply={(id, text) => {
                  setComposerDrafts((previous) => ({ ...previous, [id]: text }));
                  navigate('chat', id);
                }}
              />
            )}
            {surface === 'chat' && (
              <DemoSessionChat
                key={selectedChatTargetId === EXAMPLE_LOG ? current.view ?? 'log' : 'chat'}
                targetId={selectedChatTargetId}
                logExample={selectedChatTargetId === EXAMPLE_LOG ? riskCopy : undefined}
              />
            )}
            {surface === 'explore' && (
              <DemoExploreSurface
                demo={demo}
                target={current.target}
                onNavigate={navigate}
                onAddPartner={addExplorePartner}
                onChat={(character) => {
                  addExplorePartner(character);
                  navigate('chat', character.id);
                }}
              />
            )}
            {surface === 'apps' && (
              <DemoAppsSurface
                key={current.view}
                apps={demo.apps}
                preview={demo.appPreview}
                onLaunch={openPreview}
                initialAccess={current.view === 'access'}
                initialAppId={current.surface === 'apps' ? current.target : undefined}
              />
            )}
            {surface === 'runtime' && (current.target?.startsWith('cloud-setup/') ?
              <Suspense fallback={<div aria-busy="true">{demo.nav.runtime}</div>}><DemoCloudSetup target={current.target} demo={demo} /></Suspense> :
              <DemoRuntimeSurface demo={demo} initialCapability={current.target} onNavigate={navigate} />)}
            {surface === 'cloud' && <Suspense fallback={<div aria-busy="true">{demo.nav.cloud}</div>}><DemoCloudSurface demo={demo} target={current.target} /></Suspense>}
            {surface === 'integrations' && <DemoIntegrationsSurface demo={demo} target={current.target} />}
            {surface === 'messages' && (
              <DemoMessages
                full
                demo={demo}
                messages={messages}
                onNavigate={navigate}
                onRead={readMessage}
                onHide={hideMessage}
              />
            )}
            {surface === 'downloads' && <DemoDownloadsSurface demo={demo} onNavigate={navigate} />}
            {surface === 'diagnostics' && <DemoDiagnosticsSurface demo={demo} />}
            {surface === 'settings' && (
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
}
