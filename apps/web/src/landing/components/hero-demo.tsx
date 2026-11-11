import { ArrowLeft, ArrowRight, PanelLeft } from 'lucide-react';
import { DemoHomeSurface, DemoMessages } from './demo-home.js';
import { DemoIntegrationsSurface } from './demo-connections.js';
import { DemoDownloadsSurface, DemoDiagnosticsSurface } from './demo-system.js';
import { cn } from '@nimiplatform/kit/ui';
import { DemoAppsSurface } from './demo-apps.js';
import { DemoChatSurface } from './demo-chat.js';
import { DemoExploreSurface } from './demo-explore.js';
import { DemoRail, DemoSurfaceSwitcher } from './demo-rail.js';
import { DemoRuntimeSurface } from './demo-runtime.js';
import { DemoAppPreview } from './demo-app-preview.js';
import { lazy, Suspense, useCallback, useRef, type ReactNode, type Ref } from 'react';
import type { LandingContent } from '../content/landing-content.js';
import { EXAMPLE_LOG } from '../content/demo-tour.js';
import { DemoSettingsSurface } from './demo-settings.js';

import { useHeroDemoSession } from './hero-demo-context.js';
import { DemoWindowHeader, type DemoWindowClose } from './demo-window-header.js';

export type HeroDemoProps = {
  expanded?: boolean;
  windowTitle?: string;
  windowActions?: ReactNode;
  windowClose?: DemoWindowClose;
  inlinePreview?: boolean;
  riskCopy?: LandingContent['riskControl'];
  previewCaption?: ReactNode;
  onPreviewBody?: (node: HTMLDivElement | null) => void;
  openChatRef?: Ref<HTMLButtonElement>;
};

const DemoCloudSurface = lazy(async () => ({ default: (await import('./demo-cloud.js')).DemoCloudSurface }));
const DemoCloudSetup = lazy(async () => ({ default: (await import('./demo-cloud-setup.js')).DemoCloudSetup }));

export function HeroDemoView({ expanded, windowTitle, windowActions, windowClose, inlinePreview, riskCopy, previewCaption, onPreviewBody, openChatRef }: HeroDemoProps) {
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
    composerDrafts,
    setComposerDrafts,
    localMessages,
    messages,
    baseMessages,
    navigate,
    goHistory,
    switchChatSide,
    readMessage,
    hideMessage,
    changeLocale,
    addExplorePartner,
    handleSubmit,
    createThread,
  } = useHeroDemoSession();
  const focusChatComposer = useRef(false);
  const chatSurfaceRef = useCallback((node: HTMLDivElement | null) => {
    if (!node || !focusChatComposer.current) return;
    focusChatComposer.current = false;
    node.querySelector('textarea')?.focus({ preventScroll: true });
  }, []);

  if (inlinePreview && preview) return <DemoAppPreview opened={preview} inline
    guiding={guideStep !== undefined} apps={demo.apps} preview={demo.appPreview}
    onClose={closePreview} onBody={onPreviewBody} />;

  return (
    <div
      className={cn('hero-demo-frame demo-home-frame', expanded && 'flex h-full min-h-0 flex-col')}
      data-demo-owns-scroll="true"
      data-demo-interactive="true"
      data-demo-theme={preferences.theme}
      data-demo-reduced-motion={preferences.reducedMotion}
    >
      <DemoWindowHeader title={windowTitle ?? demo.windowTitle} close={windowClose} navigation={<>
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
      </>}>
        <span className="demo-preview-badge">
          {demo.home.badge}
        </span>
        {windowActions}
      </DemoWindowHeader>
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
                  navigate('chat');
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
              <DemoChatSurface
                key={selectedChatTargetId === EXAMPLE_LOG ? current.view ?? 'log' : 'chat'}
                demo={demo}
                logExample={selectedChatTargetId === EXAMPLE_LOG ? riskCopy : undefined}
                draft={composerDrafts[selectedChatTargetId ?? demo.chat.defaultTargetId] ?? ''}
                onDraftChange={(text) =>
                  setComposerDrafts((previous) => ({
                    ...previous,
                    [selectedChatTargetId ?? demo.chat.defaultTargetId]: text,
                  }))
                }
                selectedTargetId={selectedChatTargetId}
                baseMessages={baseMessages}
                localMessages={localMessages}
                onSelectTarget={(id) => navigate('chat', id ?? undefined)}
                onSwitchSide={switchChatSide}
                onNavigate={navigate}
                onCreateThread={createThread}
                onSubmit={(submission) => {
                  handleSubmit(submission);
                  if (!selectedChatTargetId) navigate('chat', demo.chat.defaultTargetId);
                }}
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
      <DemoAppPreview opened={preview} guiding={Boolean(preview?.guided) && guideStep !== undefined} apps={demo.apps} preview={demo.appPreview} onClose={closePreview}
        onBody={onPreviewBody} caption={previewCaption} />
    </div>
  );
}
