import { ArrowLeft, ArrowRight, PanelLeft } from 'lucide-react';
import { DemoHomeSurface, DemoMessages } from './demo-home.js';
import { DemoCloudSurface, DemoIntegrationsSurface } from './demo-connections.js';
import { DemoDownloadsSurface, DemoDiagnosticsSurface } from './demo-system.js';
import { cn } from '@nimiplatform/kit/ui';
import { DemoAppsSurface } from './demo-apps.js';
import { DemoChatSurface } from './demo-chat.js';
import { DemoExploreSurface } from './demo-explore.js';
import { DemoRail, DemoSurfaceSwitcher } from './demo-rail.js';
import { DemoRuntimeSurface } from './demo-runtime.js';
import { DemoSettingsSurface } from './demo-settings.js';

import { useHeroDemoSession } from './hero-demo-session.js';

export type HeroDemoProps = { expanded?: boolean };

export function HeroDemoView({ expanded }: HeroDemoProps) {
  const {
    demo,
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

  return (
    <div
      className={cn('hero-demo-frame demo-home-frame', expanded && 'flex h-full min-h-0 flex-col')}
      data-demo-owns-scroll="true"
      data-demo-interactive="true"
      data-demo-theme={preferences.theme}
      data-demo-reduced-motion={preferences.reducedMotion}
    >
      <div className="hero-demo-titlebar demo-home-titlebar">
        <div className="demo-traffic-lights" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
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
        <span className="demo-window-title">{demo.windowTitle}</span>
        <span className="demo-preview-badge" title={demo.home.note}>
          {demo.home.badge}
        </span>
      </div>
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
            key={surface === 'explore' || surface === 'chat' ? surface : `${surface}:${current.target ?? ''}`}
            data-demo-surface
            className="demo-surface-enter h-full min-h-0"
          >
            {surface === 'home' && (
              <DemoHomeSurface
                demo={demo}
                messages={messages}
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
                demo={demo}
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
                apps={demo.apps}
                preview={demo.appPreview}
                initialAppId={current.surface === 'apps' ? current.target : undefined}
              />
            )}
            {surface === 'runtime' && <DemoRuntimeSurface demo={demo} onNavigate={navigate} />}
            {surface === 'cloud' && <DemoCloudSurface demo={demo} onNavigate={navigate} />}
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
    </div>
  );
}
